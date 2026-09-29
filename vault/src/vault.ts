// The vault's wallet logic: maps the HTTP API onto zingo-cli commands.
import { ZingoEngine, EngineError } from "./zingo.ts";
import { Store, type PayoutRecord } from "./store.ts";
import { getLatestBlockHeight } from "./lightwalletd.ts";
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
  engineReady: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  pools: Record<string, number>;
}

interface ScanRange {
  priority: string;
  start_block: string;
  end_block: string;
}

interface SyncStatusJson {
  scan_ranges?: ScanRange[];
  percentage_total_blocks_scanned?: number;
}

interface ValueTransferJson {
  txid: string;
  status: string;
  blockheight: number;
  kind: string;
  value: number;
  memos: string[];
}

const STASH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function memoTag(stashId: string): string {
  return `ZK:${stashId}`;
}

/** A memo attributes funds to a stash when it is exactly the tag, or starts with the tag followed by whitespace. */
export function memoMatches(memo: string, tag: string): boolean {
  const m = memo.replace(/\0+$/, "").trim();
  return m === tag || (m.startsWith(tag) && /\s/.test(m.charAt(tag.length)));
}

function assertStashId(stashId: unknown): string {
  if (typeof stashId !== "string" || !STASH_ID_RE.test(stashId)) {
    throw new HttpError(400, "bad_request", "stashId must be 1-64 chars of [A-Za-z0-9_-]");
  }
  return stashId;
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

export class Vault {
  private readonly engine: ZingoEngine;
  private readonly store: Store;
  private readonly lightwalletdUrl: string;
  private status: VaultStatus;
  private syncing = false;
  private readonly payoutLocks = new Set<string>();

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
      engineReady: false,
      lastSyncAt: null,
      lastError: null,
      pools: {},
    };
  }

  health(): VaultStatus {
    return { ...this.status, engineReady: this.engine.ready, lastError: this.status.lastError ?? this.engine.lastError ?? null };
  }

  /** One pass of the background loop: keep the sync task running and refresh the cached status. */
  async syncTick(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const tip = await getLatestBlockHeight(this.lightwalletdUrl).catch(() => this.status.chainTip);
      this.status.chainTip = tip;
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
      const spendable = await this.engine.json<{ spendable_balance: number }>(["spendable_balance"], { timeoutMs: 60_000 });
      const bal = parseBalanceText((await this.engine.run(["balance"], { timeoutMs: 60_000 })).stdout);
      if (!this.status.address) this.status.address = await this.defaultAddress();
      const height = scannedHeight(sync);
      this.status.height = height;
      this.status.synced = tip > 0 && height >= tip - 1;
      this.status.spendableZat = Number(spendable.spendable_balance ?? 0);
      this.status.pools = bal;
      this.status.balanceZat = Object.entries(bal)
        .filter(([k]) => k.startsWith("total_"))
        .reduce((s, [, v]) => s + v, 0);
      this.status.lastSyncAt = new Date().toISOString();
      this.status.lastError = null;
    } catch (e) {
      this.status.lastError = (e as Error).message;
    } finally {
      this.syncing = false;
    }
  }

  private async defaultAddress(): Promise<string> {
    const list = await this.engine.json<Array<{ address_index: number; encoded_address: string }>>(["addresses"]);
    const first = [...list].sort((a, b) => a.address_index - b.address_index)[0];
    if (!first) throw new EngineError("wallet has no unified address", "bad_output");
    return first.encoded_address;
  }

  async stashAddress(body: Record<string, unknown>): Promise<{ address: string; uri: string }> {
    try {
      const stashId = assertStashId(body.stashId);
      const amountZat = assertZat(body.amountZat, "amountZat");
      const now = new Date().toISOString();
      let rec = this.store.getStash(stashId);
      if (!rec) {
        // A fresh diversified unified address (Orchard/Ironwood + Sapling receivers, no transparent).
        const ua = await this.engine.json<{ encoded_address: string }>(["new_address", "oz"]);
        if (!/^utest1/.test(ua.encoded_address)) throw new HttpError(500, "not_testnet", "engine returned a non-testnet address");
        rec = { stashId, address: ua.encoded_address, amountZat, createdAt: now, updatedAt: now };
        this.store.putStash(rec);
      } else if (rec.amountZat !== amountZat) {
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

  async funding(stashIdRaw: string) {
    try {
      const stashId = assertStashId(stashIdRaw);
      const tag = memoTag(stashId);
      const res = await this.engine.json<{ value_transfers: ValueTransferJson[] }>(["messages", tag]);
      const tip = this.status.chainTip || (await getLatestBlockHeight(this.lightwalletdUrl));
      const byTx = new Map<string, { valueZat: number; confirmations: number; status: string; height: number }>();
      for (const vt of res.value_transfers ?? []) {
        if (vt.kind !== "received" || !(vt.memos ?? []).some((m) => memoMatches(m, tag))) continue;
        const confirmations = vt.status === "confirmed" && vt.blockheight > 0 ? Math.max(0, tip - vt.blockheight + 1) : 0;
        const prev = byTx.get(vt.txid);
        byTx.set(vt.txid, {
          valueZat: (prev?.valueZat ?? 0) + Number(vt.value),
          confirmations,
          status: vt.status,
          height: vt.blockheight,
        });
      }
      const txs = [...byTx.entries()];
      return {
        fundedZat: txs.reduce((s, [, t]) => s + t.valueZat, 0),
        confirmations: txs.length ? Math.min(...txs.map(([, t]) => t.confirmations)) : 0,
        txids: txs.map(([txid]) => txid),
        synced: this.status.synced,
        transfers: txs.map(([txid, t]) => ({ txid, ...t })),
      };
    } catch (e) {
      throw toHttpError(e);
    }
  }

  async payout(body: Record<string, unknown>): Promise<{ txid: string; duplicate?: boolean }> {
    const stashId = assertStashId(body.stashId);
    if (this.payoutLocks.has(stashId)) throw new HttpError(409, "payout_in_progress", "a payout for this stash is already in progress");
    this.payoutLocks.add(stashId);
    try {
      const to = typeof body.to === "string" ? body.to.trim() : "";
      const amountZat = assertZat(body.amountZat, "amountZat");
      const memo = body.memo === undefined || body.memo === null ? `ZECKED ${memoTag(stashId)}` : body.memo;
      if (typeof memo !== "string") throw new HttpError(400, "bad_request", "memo must be a string");
      if (Buffer.byteLength(memo, "utf8") > 512) throw new HttpError(400, "bad_request", "memo exceeds 512 bytes");
      if (!to) throw new HttpError(400, "bad_request", "to is required");

      // One payout per stash (winner OR refund). Retries with the same body are idempotent.
      const existing = this.store.getPayout(stashId);
      if (existing?.state === "sent") {
        if (existing.to === to && existing.amountZat === amountZat) return { txid: existing.txid!, duplicate: true };
        throw new HttpError(409, "already_paid", "this stash was already paid out", { txid: existing.txid, to: existing.to, amountZat: existing.amountZat });
      }
      if (existing?.state === "sending") {
        throw new HttpError(409, "payout_unresolved", "an earlier payout for this stash was interrupted; check the wallet before retrying", { error: existing.error });
      }

      await this.assertShieldedTestnetAddress(to);

      let maxSendable: number;
      try {
        const max = await this.engine.json<{ max_send_value: number }>(["max_send_value", to]);
        maxSendable = Number(max.max_send_value ?? 0);
      } catch (e) {
        // With no spendable notes the engine reports an error instead of 0.
        if (e instanceof EngineError && e.code === "command_failed" && /insufficient|not enough|no spendable|balance|fee/i.test(e.message)) {
          maxSendable = 0;
        } else {
          throw e;
        }
      }
      if (amountZat > maxSendable) {
        throw new HttpError(402, "insufficient_funds", `insufficient funds: can send at most ${maxSendable} zat after fees, requested ${amountZat} zat`, {
          requestedZat: amountZat,
          maxSendableZat: maxSendable,
          spendableZat: this.status.spendableZat,
          balanceZat: this.status.balanceZat,
          synced: this.status.synced,
        });
      }

      const now = new Date().toISOString();
      const rec: PayoutRecord = { stashId, to, amountZat, memo, state: "sending", createdAt: existing?.createdAt ?? now, updatedAt: now };
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
        if (/insufficient|not enough/i.test(msg)) throw new HttpError(402, "insufficient_funds", msg);
        if (!preBuild) throw new HttpError(502, "payout_unresolved", `send outcome unknown, stash locked for manual check: ${msg}`);
        throw e;
      }
      this.store.putPayout({ ...rec, state: "sent", txid, updatedAt: new Date().toISOString() });
      void this.syncTick();
      return { txid };
    } catch (e) {
      throw toHttpError(e);
    } finally {
      this.payoutLocks.delete(stashId);
    }
  }

  payoutStatus(stashIdRaw: string) {
    const stashId = assertStashId(stashIdRaw);
    const rec = this.store.getPayout(stashId);
    if (!rec) throw new HttpError(404, "not_found", "no payout for this stash");
    return { stashId, state: rec.state, txid: rec.txid ?? null, to: rec.to, amountZat: rec.amountZat, error: rec.error ?? null, updatedAt: rec.updatedAt };
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
