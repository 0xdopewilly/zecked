// The vault's wallet logic: maps the HTTP API onto zingo-cli commands.
//
// Attribution. Every stash and every user gets its own diversified unified
// address (all derived from the one wallet seed, so one trial-decryption key
// sees them all). zingo-cli is patched (engine/zingo-cli-received-by-address.patch)
// so `notes all` also returns `received_by_address`: each note the wallet holds,
// with the wallet address whose receiver it was paid to. Funds are credited:
//   1. by receiving address (primary), so wallets and faucets that drop memos
//      still credit the right stash or user, and
//   2. by memo tag (secondary, "ZK:<stashId>" / "ZU:<userId>"), but only for
//      notes that landed on an address not assigned to any stash or user, so
//      one note can never be credited twice.
import { ZingoEngine, EngineError } from "./zingo.ts";
import { Store, type PayoutRecord, type AddressRecord } from "./store.ts";
import { getLatestBlockHeight, getLightdInfo } from "./lightwalletd.ts";
import { buildPaymentUri, parsePaymentUri, MAX_MONEY_ZAT } from "./zip321.ts";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export interface VaultStatus {
  network: "testnet";
  synced: boolean;
  height: number;
  balanceZat: number;
  spendableZat: number;
  address: string;
  chainTip: number;
  pendingRanges: string[];
  transport: string;
  addressAttribution: boolean;
  engineReady: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  pools: Record<string, number>;
  /** True while VAULT_SENDS_PAUSED is set: payouts, refunds and withdrawals are refused (402 sends_paused). */
  sendsPaused: boolean;
  /** What the lightwalletd reports about itself (vendor, version, consensusBranchId…), refreshed every few minutes. */
  lightd: { vendor?: string; version?: string; consensusBranchId?: string; chainName?: string } | null;
  /** When the chain tip last moved. A tip frozen for long means the server stopped following the chain (e.g. an un-upgraded node at a network upgrade). */
  tipAdvancedAt: string | null;
  tipStalled: boolean;
  /** The engine's last sync-task death, if any ("Sync error: …"). The vault relaunches sync every tick, so a
   *  deterministic one shows up here as the same message over and over while `height` stands still. */
  lastSyncError: string | null;
  /** A rescan rebuilds the wallet's chain data from its birthday (keys and addresses are kept): the fix for a
   *  wallet whose saved state the engine can no longer sync (zingolib #2834). Manual: POST /rescan. */
  rescanning: boolean;
  lastRescanAt: string | null;
  rescans: number;
}

interface ScanRange {
  priority: string;
  start_block: string;
  end_block: string;
}

interface SyncStatusJson {
  scan_ranges?: ScanRange[];
}

/** One entry of the patched `notes all` -> `received_by_address` array. */
export interface ReceivedNote {
  pool: string;
  txid: string;
  output_index: number;
  value: number;
  status: string;
  block_height: number;
  datetime: number;
  scope: string;
  spend_status: string;
  memo: string | null;
  address_index: number | null;
  address: string | null;
}

interface ValueTransferJson {
  txid: string;
  status: string;
  blockheight: number;
  datetime: number;
  kind: string;
  value: number;
  memos: string[];
}

export interface Transfer {
  txid: string;
  valueZat: number;
  status: string;
  confirmations: number;
  height: number;
  at: string | null;
  pools: string[];
  matchedBy: "address" | "memo";
}

export interface Attributed {
  receivedZat: number;
  confirmedZat: number;
  pendingZat: number;
  confirmations: number;
  txids: string[];
  lastTxAt: string | null;
  transfers: Transfer[];
}

/** One structured line on stdout (same shape as server.ts). Never includes raw engine output. */
function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_RE = /^[A-Za-z0-9_:.-]{1,128}$/;
/** Statuses that represent value that exists or is on its way. calculated/failed never count. */
const COUNTED = new Set(["confirmed", "mempool", "transmitted"]);
const STALL_MS = Number(process.env.SYNC_STALL_MS ?? 10 * 60_000);
/** A chain tip that hasn't moved for this long is reported as stalled (testnet blocks come every 12-75 s; 25 s after NU7). */
const TIP_STALL_MS = Number(process.env.TIP_STALL_MS ?? 10 * 60_000);

export function memoTag(stashId: string): string {
  return `ZK:${stashId}`;
}

export function userMemoTag(userId: string): string {
  return `ZU:${userId}`;
}

/** A memo carries a tag when it is exactly the tag, or starts with the tag followed by whitespace. */
export function memoMatches(memo: string, tag: string): boolean {
  const m = memo.replace(/\0+$/, "").trim();
  return m === tag || (m.startsWith(tag) && /\s/.test(m.charAt(tag.length)));
}

function assertId(v: unknown, name: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) throw new HttpError(400, "bad_request", `${name} must be 1-64 chars of [A-Za-z0-9_-]`);
  return v;
}

function assertZat(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0 || BigInt(v) > MAX_MONEY_ZAT) {
    throw new HttpError(400, "bad_request", `${name} must be a positive integer number of zatoshis`);
  }
  return v;
}

/** Scanned height: the end of the contiguous run of fully scanned ranges from the wallet birthday. */
function scannedHeight(status: SyncStatusJson): number {
  const ranges = [...(status.scan_ranges ?? [])].sort((a, b) => Number(a.start_block) - Number(b.start_block));
  let h = 0;
  for (const r of ranges) {
    if (!/^(Scanned|Ignored)/.test(r.priority)) break;
    h = Number(r.end_block);
  }
  return h;
}

function parseBalanceText(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of text.matchAll(/(\w+_balance):\s*([\d_]+)/g)) out[m[1]] = Number(m[2].replace(/_/g, ""));
  return out;
}

function toHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof EngineError) {
    if (e.code === "engine_starting" || e.code === "engine_down") return new HttpError(503, e.code, e.message);
    if (e.code === "timeout") return new HttpError(504, e.code, e.message);
    return new HttpError(502, "engine_error", e.message);
  }
  return new HttpError(500, "internal", (e as Error)?.message ?? String(e));
}

function isoFromUnix(s: number): string | null {
  return s > 0 ? new Date(s * 1000).toISOString() : null;
}

/**
 * Pure attribution over the patched note list (exported for tests).
 * `target` is the stash/user record (may be undefined for memo-only lookups),
 * `assigned` is every address handed out to any stash or user.
 */
export function attribute(
  notes: ReceivedNote[],
  target: AddressRecord | undefined,
  tag: string,
  assigned: Set<string>,
  tip: number,
  minConf: number,
): Attributed {
  const byTx = new Map<string, Transfer>();
  const seen = new Set<string>();
  for (const n of notes) {
    if (n.scope !== "External" || !COUNTED.has(n.status)) continue; // change notes are never deposits
    const byAddress =
      !!target &&
      ((n.address !== null && n.address === target.address) ||
        (target.addressIndex !== undefined && n.address_index !== null && n.address_index === target.addressIndex));
    const byMemo = !byAddress && n.memo !== null && (n.address === null || !assigned.has(n.address)) && memoMatches(n.memo, tag);
    if (!byAddress && !byMemo) continue;
    const noteId = `${n.txid}:${n.pool}:${n.output_index}`;
    if (seen.has(noteId)) continue;
    seen.add(noteId);
    const confirmations = n.status === "confirmed" && n.block_height > 0 ? Math.max(0, tip - n.block_height + 1) : 0;
    const t = byTx.get(n.txid) ?? {
      txid: n.txid,
      valueZat: 0,
      status: n.status,
      confirmations,
      height: n.block_height,
      at: isoFromUnix(n.datetime),
      pools: [],
      matchedBy: byAddress ? "address" : "memo",
    };
    t.valueZat += Number(n.value);
    if (!t.pools.includes(n.pool)) t.pools.push(n.pool);
    if (byAddress) t.matchedBy = "address";
    byTx.set(n.txid, t);
  }
  return summarize([...byTx.values()], minConf);
}

function summarize(transfers: Transfer[], minConf: number): Attributed {
  transfers.sort((a, b) => (a.height || Number.MAX_SAFE_INTEGER) - (b.height || Number.MAX_SAFE_INTEGER));
  const confirmedZat = transfers.filter((t) => t.confirmations >= minConf).reduce((s, t) => s + t.valueZat, 0);
  const receivedZat = transfers.reduce((s, t) => s + t.valueZat, 0);
  const times = transfers.map((t) => t.at).filter((x): x is string => !!x).sort();
  return {
    receivedZat,
    confirmedZat,
    pendingZat: receivedZat - confirmedZat,
    confirmations: transfers.length ? Math.min(...transfers.map((t) => t.confirmations)) : 0,
    txids: transfers.map((t) => t.txid),
    lastTxAt: times.at(-1) ?? null,
    transfers,
  };
}

export class Vault {
  private readonly engine: ZingoEngine;
  private readonly store: Store;
  private readonly lightwalletdUrl: string;
  private status: VaultStatus;
  private syncing = false;
  private lastFingerprint = "";
  private lightdAt = 0;
  private syncErrorSeenAt = 0;
  private lastAdvanceAt = Date.now();
  private readonly payoutLocks = new Set<string>();
  private readonly minting = new Map<string, Promise<{ address: string; addressIndex?: number }>>();

  constructor(engine: ZingoEngine, store: Store, lightwalletdUrl: string, transport: string) {
    this.engine = engine;
    this.store = store;
    this.lightwalletdUrl = lightwalletdUrl;
    this.status = {
      network: "testnet",
      transport,
      synced: false,
      height: 0,
      balanceZat: 0,
      spendableZat: 0,
      address: "",
      chainTip: 0,
      pendingRanges: [],
      addressAttribution: false,
      engineReady: false,
      lastSyncAt: null,
      lastError: null,
      sendsPaused: !!process.env.VAULT_SENDS_PAUSED,
      lightd: null,
      tipAdvancedAt: null,
      tipStalled: false,
      lastSyncError: null,
      rescanning: false,
      lastRescanAt: null,
      rescans: 0,
      pools: {},
    };
  }

  health(): VaultStatus {
    return { ...this.status, engineReady: this.engine.ready, lastError: this.status.lastError ?? this.engine.lastError ?? null };
  }

  /** Called when the engine (re)starts: detects whether it carries the received-by-address patch. */
  async onEngineReady(): Promise<void> {
    try {
      const notes = await this.engine.json<Record<string, unknown>>(["notes", "all"]);
      this.status.addressAttribution = Array.isArray(notes.received_by_address);
    } catch {
      this.status.addressAttribution = false;
    }
  }

  /** One pass of the background loop: keep the sync task running and refresh the cached status. */
  async syncTick(): Promise<void> {
    if (this.syncing || this.status.rescanning) return;
    this.syncing = true;
    try {
      const tip = await getLatestBlockHeight(this.lightwalletdUrl).catch(() => this.status.chainTip);
      if (tip !== this.status.chainTip || !this.status.tipAdvancedAt) this.status.tipAdvancedAt = new Date().toISOString();
      this.status.chainTip = tip;
      this.status.tipStalled = Date.now() - Date.parse(this.status.tipAdvancedAt) > TIP_STALL_MS;
      this.status.sendsPaused = !!process.env.VAULT_SENDS_PAUSED;
      if (!this.status.lightd || Date.now() - this.lightdAt > 5 * 60_000) {
        this.lightdAt = Date.now();
        const info = await getLightdInfo(this.lightwalletdUrl).catch(() => null);
        if (info) this.status.lightd = { vendor: info.vendor, version: info.version, consensusBranchId: info.consensusBranchId, chainName: info.chainName };
      }
      if (!this.engine.ready) return;
      await this.engine.run(["sync", "run"], { timeoutMs: 60_000 });
      // Give a just-launched sync a few seconds to reach the tip before sampling it.
      let sync = await this.engine.json<SyncStatusJson>(["sync", "status"], { timeoutMs: 60_000 });
      for (let i = 0; i < 6 && scannedHeight(sync) < tip; i++) {
        await new Promise((r) => setTimeout(r, 1_500));
        sync = await this.engine.json<SyncStatusJson>(["sync", "status"], { timeoutMs: 60_000 });
      }
      this.status.pendingRanges = (sync.scan_ranges ?? [])
        .filter((r) => !/^(Scanned|Ignored)/.test(r.priority))
        .map((r) => `${r.priority}:${r.start_block}-${r.end_block}`);
      const height = scannedHeight(sync);
      this.status.height = height;
      this.status.synced = tip > 0 && height >= tip - 1;
      const se = this.engine.syncError;
      if (se && se.at > this.syncErrorSeenAt) {
        this.syncErrorSeenAt = se.at;
        this.status.lastSyncError = se.message;
        log("sync task died", { error: se.message, height, tip });
        // A shard-tree root conflict is permanent for this wallet file: only a rescan clears it. Once per 6 h.
        const since = this.status.lastRescanAt ? Date.now() - Date.parse(this.status.lastRescanAt) : Infinity;
        if (/shard tree|conflicts with existing root/i.test(se.message) && since > 6 * 3600_000) void this.rescan("auto: " + se.message.slice(0, 120));
      }
      // Progress = caught up, or the scan ranges changed since the last look. The ChainTip range's end
      // follows the growing chain, so it is left out: otherwise a wedged scanner still looks like
      // progress every tick and the watchdog below never fires (seen 2026-10-04: stuck 31k blocks
      // behind for days).
      const fingerprint = JSON.stringify(
        (sync.scan_ranges ?? []).map((r) => (r.priority === "ChainTip" ? { ...r, end_block: 0 } : r)),
      );
      if (this.status.synced || fingerprint !== this.lastFingerprint) {
        this.lastFingerprint = fingerprint;
        this.lastAdvanceAt = Date.now();
      }
      // Balances take the wallet lock, which a catch-up sync holds for long stretches;
      // read them only when caught up so the command queue stays free for API calls.
      if (this.status.synced) {
        const spendable = await this.engine.json<{ spendable_balance: number }>(["spendable_balance"], { timeoutMs: 60_000 });
        const bal = parseBalanceText((await this.engine.run(["balance"], { timeoutMs: 60_000 })).stdout);
        this.status.spendableZat = Number(spendable.spendable_balance ?? 0);
        this.status.pools = bal;
        this.status.balanceZat = Object.entries(bal)
          .filter(([k]) => k.startsWith("total_"))
          .reduce((s, [, v]) => s + v, 0);
      }
      if (!this.status.address) this.status.address = await this.defaultAddress();
      this.status.lastSyncAt = new Date().toISOString();
      this.status.lastError = null;
    } catch (e) {
      this.status.lastError = (e as Error).message;
    } finally {
      this.syncing = false;
      // Watchdog: no sync progress (or no answer from the engine at all) for STALL_MS while
      // behind the tip -> the session is wedged; recycle it.
      if (this.engine.ready && !this.status.synced && Date.now() - this.lastAdvanceAt > STALL_MS) {
        this.lastAdvanceAt = Date.now();
        this.engine.recycle(`no sync progress for ${Math.round(STALL_MS / 60_000)} min (height ${this.status.height}, tip ${this.status.chainTip})`);
      }
    }
  }

  /** Rebuilds the wallet's chain data from its birthday (zingo-cli `rescan`: keys, addresses and the seed stay;
   *  notes and attribution are rediscovered). Runs in the background; /health shows `rescanning` meanwhile. */
  rescan(reason: string): { started: boolean; reason: string } {
    if (this.status.rescanning) return { started: false, reason: "already rescanning" };
    if (!this.engine.ready) return { started: false, reason: "engine not ready" };
    this.status.rescanning = true;
    this.status.lastRescanAt = new Date().toISOString();
    this.status.rescans += 1;
    log("rescan started", { reason, height: this.status.height, tip: this.status.chainTip });
    void (async () => {
      try {
        await this.engine.run(["rescan"], { timeoutMs: 45 * 60_000 });
        this.lastAdvanceAt = Date.now();
        log("rescan finished", { reason });
      } catch (e) {
        this.status.lastError = `rescan failed: ${(e as Error).message}`;
        log("rescan failed", { reason, error: (e as Error).message });
      } finally {
        this.status.rescanning = false;
      }
    })();
    return { started: true, reason };
  }

  private async defaultAddress(): Promise<string> {
    const list = await this.engine.json<Array<{ address_index: number; encoded_address: string }>>(["addresses"]);
    const first = [...list].sort((a, b) => a.address_index - b.address_index)[0];
    if (!first) throw new EngineError("wallet has no unified address", "bad_output");
    return first.encoded_address;
  }

  /** A fresh diversified unified address with Orchard/Ironwood + Sapling receivers and no transparent receiver. */
  private async mintAddress(): Promise<{ address: string; addressIndex?: number }> {
    const ua = await this.engine.json<{ encoded_address: string; address_index?: number; has_orchard?: boolean; has_sapling?: boolean; has_transparent?: boolean }>(
      ["new_address", "oz"],
    );
    if (!/^utest1/.test(ua.encoded_address)) throw new HttpError(500, "not_testnet", "engine returned a non-testnet address");
    if (ua.has_transparent || ua.has_orchard === false || ua.has_sapling === false) {
      throw new HttpError(500, "bad_address", "engine returned an address without the expected receivers");
    }
    return { address: ua.encoded_address, addressIndex: typeof ua.address_index === "number" ? ua.address_index : undefined };
  }

  /** Mints at most once per id even under concurrent requests. */
  private mintOnce(slot: string): Promise<{ address: string; addressIndex?: number }> {
    let p = this.minting.get(slot);
    if (!p) {
      p = this.mintAddress().finally(() => this.minting.delete(slot));
      this.minting.set(slot, p);
    }
    return p;
  }

  private assignedAddresses(): Set<string> {
    return this.store.assignedAddresses();
  }

  private async receivedNotes(): Promise<ReceivedNote[]> {
    const res = await this.engine.json<{ received_by_address?: ReceivedNote[] }>(["notes", "all"]);
    if (!Array.isArray(res.received_by_address)) {
      this.status.addressAttribution = false;
      throw new HttpError(501, "engine_unpatched", "this zingo-cli lacks the received-by-address patch; rebuild it with scripts/build-engine.sh");
    }
    this.status.addressAttribution = true;
    return res.received_by_address;
  }

  private async tip(): Promise<number> {
    return this.status.chainTip || (await getLatestBlockHeight(this.lightwalletdUrl));
  }

  async stashAddress(body: Record<string, unknown>): Promise<{ address: string; uri: string }> {
    try {
      const stashId = assertId(body.stashId, "stashId");
      const amountZat = assertZat(body.amountZat, "amountZat");
      const now = new Date().toISOString();
      let rec = this.store.getStash(stashId);
      if (!rec) {
        const minted = await this.mintOnce(`stash:${stashId}`);
        rec = this.store.getStash(stashId) ?? { stashId, ...minted, amountZat, createdAt: now, updatedAt: now };
        this.store.putStash(rec);
      }
      if (rec.amountZat !== amountZat) {
        rec = { ...rec, amountZat, updatedAt: now };
        this.store.putStash(rec);
      }
      const memo = memoTag(stashId);
      const uri = buildPaymentUri({ address: rec.address, amountZat: BigInt(amountZat), memo });
      const check = parsePaymentUri(uri);
      if (check.address !== rec.address || check.amountZat !== BigInt(amountZat) || check.memo !== memo) {
        throw new HttpError(500, "uri_self_check_failed", "generated ZIP-321 URI did not round-trip");
      }
      return { address: rec.address, uri };
    } catch (e) {
      throw toHttpError(e);
    }
  }

  async userAddress(body: Record<string, unknown>): Promise<{ address: string; uri: string }> {
    try {
      const userId = assertId(body.userId, "userId");
      let rec = this.store.getUser(userId);
      if (!rec) {
        const minted = await this.mintOnce(`user:${userId}`);
        const now = new Date().toISOString();
        rec = this.store.getUser(userId) ?? { userId, ...minted, createdAt: now, updatedAt: now };
        this.store.putUser(rec);
      }
      const memo = userMemoTag(userId);
      const uri = buildPaymentUri({ address: rec.address, memo });
      const check = parsePaymentUri(uri);
      if (check.address !== rec.address || check.amountZat !== undefined || check.memo !== memo) {
        throw new HttpError(500, "uri_self_check_failed", "generated ZIP-321 URI did not round-trip");
      }
      return { address: rec.address, uri };
    } catch (e) {
      throw toHttpError(e);
    }
  }

  async deposits(userIdRaw: string, minConfRaw: string | null) {
    try {
      const userId = assertId(userIdRaw, "userId");
      const minConf = parseMinConf(minConfRaw);
      const rec = this.store.getUser(userId);
      if (!rec) throw new HttpError(404, "unknown_user", "no deposit address for this userId; call POST /user-address first");
      const notes = await this.receivedNotes();
      const a = attribute(notes, rec, userMemoTag(userId), this.assignedAddresses(), await this.tip(), minConf);
      return { userId, address: rec.address, ...a, minConf, synced: this.status.synced };
    } catch (e) {
      throw toHttpError(e);
    }
  }

  async funding(stashIdRaw: string, minConfRaw: string | null = null) {
    try {
      const stashId = assertId(stashIdRaw, "stashId");
      const minConf = parseMinConf(minConfRaw);
      const tag = memoTag(stashId);
      const rec = this.store.getStash(stashId);
      let a: Attributed;
      if (this.status.addressAttribution) {
        a = attribute(await this.receivedNotes(), rec, tag, this.assignedAddresses(), await this.tip(), minConf);
      } else {
        a = await this.fundingByMemoOnly(tag, minConf);
      }
      return {
        fundedZat: a.receivedZat,
        confirmations: a.confirmations,
        txids: a.txids,
        confirmedZat: a.confirmedZat,
        pendingZat: a.pendingZat,
        lastTxAt: a.lastTxAt,
        address: rec?.address ?? null,
        attribution: this.status.addressAttribution ? "address+memo" : "memo-only",
        synced: this.status.synced,
        transfers: a.transfers,
      };
    } catch (e) {
      throw toHttpError(e);
    }
  }

  /** Fallback for an unpatched engine: received value transfers whose memo carries the tag. */
  private async fundingByMemoOnly(tag: string, minConf: number): Promise<Attributed> {
    const res = await this.engine.json<{ value_transfers: ValueTransferJson[] }>(["messages", tag]);
    const tip = await this.tip();
    const byTx = new Map<string, Transfer>();
    for (const vt of res.value_transfers ?? []) {
      if (vt.kind !== "received" || !COUNTED.has(vt.status) || !(vt.memos ?? []).some((m) => memoMatches(m, tag))) continue;
      const confirmations = vt.status === "confirmed" && vt.blockheight > 0 ? Math.max(0, tip - vt.blockheight + 1) : 0;
      const t = byTx.get(vt.txid) ?? {
        txid: vt.txid, valueZat: 0, status: vt.status, confirmations, height: vt.blockheight, at: isoFromUnix(vt.datetime), pools: [], matchedBy: "memo" as const,
      };
      t.valueZat += Number(vt.value);
      byTx.set(vt.txid, t);
    }
    return summarize([...byTx.values()], minConf);
  }

  async payout(body: Record<string, unknown>): Promise<{ txid: string; key: string; duplicate?: boolean }> {
    // Emergency brake (e.g. a network upgrade the engine or the lightwalletd isn't ready for): refuse before any
    // state is written. The app treats 402 as "definitely not sent": withdrawals re-credit, claims stay claimable.
    if (process.env.VAULT_SENDS_PAUSED) {
      throw new HttpError(402, "sends_paused", "External sends are paused for the Zcash network upgrade. Your ZEC is safe; try again later.", { paused: true });
    }
    const stashId = body.stashId === undefined || body.stashId === null ? undefined : assertId(body.stashId, "stashId");
    let key: string;
    if (body.key === undefined || body.key === null) {
      if (!stashId) throw new HttpError(400, "bad_request", "stashId or key is required");
      key = stashId; // one payout per stash (winner OR refund), as before
    } else {
      if (typeof body.key !== "string" || !KEY_RE.test(body.key)) {
        throw new HttpError(400, "bad_request", "key must be 1-128 chars of [A-Za-z0-9_:.-], e.g. withdraw:<userId>:<nonce>");
      }
      key = body.key;
    }
    if (this.payoutLocks.has(key)) throw new HttpError(409, "payout_in_progress", "a payout with this key is already in progress");
    this.payoutLocks.add(key);
    try {
      const to = typeof body.to === "string" ? body.to.trim() : "";
      const amountZat = assertZat(body.amountZat, "amountZat");
      const defaultMemo = stashId ? `ZECKED ${memoTag(stashId)}` : "ZECKED withdrawal";
      const memo = body.memo === undefined || body.memo === null ? defaultMemo : body.memo;
      if (typeof memo !== "string") throw new HttpError(400, "bad_request", "memo must be a string");
      if (Buffer.byteLength(memo, "utf8") > 512) throw new HttpError(400, "bad_request", "memo exceeds 512 bytes");
      if (!to) throw new HttpError(400, "bad_request", "to is required");

      // Idempotent per key: a retry with the same body returns the first txid.
      const existing = this.store.getPayout(key);
      if (existing?.state === "sent") {
        if (existing.to === to && existing.amountZat === amountZat) return { txid: existing.txid!, key, duplicate: true };
        throw new HttpError(409, "already_paid", "a payout with this key was already sent", { key, txid: existing.txid, to: existing.to, amountZat: existing.amountZat });
      }
      if (existing?.state === "sending") {
        throw new HttpError(409, "payout_unresolved", "an earlier payout with this key was interrupted; check the wallet before retrying", { key, lastError: existing.error ?? null });
      }

      await this.assertShieldedTestnetAddress(to);

      let maxSendable: number;
      try {
        const max = await this.engine.json<{ max_send_value: number }>(["max_send_value", to]);
        maxSendable = Number(max.max_send_value ?? 0);
      } catch (e) {
        // With no spendable notes the engine may report an error instead of 0.
        if (e instanceof EngineError && e.code === "command_failed" && /insufficient|not enough|no spendable|balance|fee/i.test(e.message)) {
          maxSendable = 0;
        } else {
          throw e;
        }
      }
      if (amountZat > maxSendable) {
        throw new HttpError(402, "insufficient_funds", `insufficient funds: can send at most ${maxSendable} zat after fees, requested ${amountZat} zat`, {
          key,
          requestedZat: amountZat,
          maxSendableZat: maxSendable,
          spendableZat: this.status.spendableZat,
          balanceZat: this.status.balanceZat,
          synced: this.status.synced,
        });
      }

      const now = new Date().toISOString();
      const rec: PayoutRecord = { key, stashId, to, amountZat, memo, state: "sending", createdAt: existing?.createdAt ?? now, updatedAt: now };
      this.store.putPayout(rec);
      let txid: string;
      try {
        const sent = await this.engine.json<{ txids: string[] }>(
          ["quicksend", JSON.stringify([{ address: to, amount: amountZat, memo }])],
          { timeoutMs: 15 * 60_000 },
        );
        txid = sent.txids?.[0];
        if (!txid) throw new EngineError("quicksend returned no txid", "bad_output");
      } catch (e) {
        const msg = (e as Error).message;
        // Only errors raised before a transaction was built (proposal, construction, transport
        // preflight) are safe to retry. Anything at or after transmission, a timeout, or an engine
        // crash leaves the outcome unknown: the record stays "sending" and blocks retries.
        const preBuild =
          e instanceof EngineError &&
          e.code === "command_failed" &&
          !/transmi/i.test(msg) &&
          /propose|insufficient|not enough|failed to construct|mixnet|route|offline|bootstrap|usage|invalid/i.test(msg);
        this.store.putPayout({ ...rec, state: preBuild ? "failed" : "sending", error: msg, updatedAt: new Date().toISOString() });
        if (/insufficient|not enough/i.test(msg)) throw new HttpError(402, "insufficient_funds", msg, { key });
        if (!preBuild) throw new HttpError(502, "payout_unresolved", `send outcome unknown, key locked for manual check: ${msg}`, { key });
        throw e;
      }
      this.store.putPayout({ ...rec, state: "sent", txid, updatedAt: new Date().toISOString() });
      void this.syncTick();
      return { txid, key };
    } catch (e) {
      throw toHttpError(e);
    } finally {
      this.payoutLocks.delete(key);
    }
  }

  payoutStatus(keyRaw: string) {
    if (!KEY_RE.test(keyRaw)) throw new HttpError(400, "bad_request", "bad payout key");
    const rec = this.store.getPayout(keyRaw);
    if (!rec) throw new HttpError(404, "not_found", "no payout with this key");
    return {
      key: rec.key,
      stashId: rec.stashId ?? null,
      state: rec.state,
      txid: rec.txid ?? null,
      to: rec.to,
      amountZat: rec.amountZat,
      error: rec.error ?? null,
      updatedAt: rec.updatedAt,
    };
  }

  private async assertShieldedTestnetAddress(to: string): Promise<void> {
    const parsed = await this.engine.json<{ status: string; chain_name: string | null; address_kind: string | null; receivers_available?: string[] }>(
      ["parse_address", to],
    );
    if (parsed.status !== "success") throw new HttpError(400, "bad_address", "not a valid Zcash address");
    if (parsed.chain_name !== "test") throw new HttpError(400, "not_testnet", `address is for chain '${parsed.chain_name}', this vault is TESTNET only`);
    if (parsed.address_kind === "sapling") return;
    if (parsed.address_kind === "unified" && (parsed.receivers_available ?? []).some((r) => r !== "transparent")) return;
    throw new HttpError(400, "not_shielded", "payouts go only to shielded addresses (unified with a shielded receiver, or Sapling)");
  }
}

function parseMinConf(raw: string | null): number {
  if (raw === null || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new HttpError(400, "bad_request", "minConf must be an integer 0..10000");
  return n;
}
