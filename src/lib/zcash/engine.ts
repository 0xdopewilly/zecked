// The Zcash engine: the only part of ZECKED that touches money.
//
//  - "sim"      Test mode with no chain. Addresses and txids are simulated; funding is confirmed by the
//               hider pressing "Simulate payment". Default for local dev and preview deploys.
//  - "testnet"  Talks to the ZECKED vault service (./vault), which holds a Zcash TESTNET hot wallet.
//  - "mainnet"  Same vault protocol, real ZEC. Not enabled until the security review is done.
//
// Funding attribution: every stash gets a ZIP-321 request whose memo is "ZK:<stashId>".
import { HttpError, sha256 } from "@/lib/server/util";

export type Network = "sim" | "testnet" | "mainnet";

export interface FundingRequest {
  address: string;
  uri: string;
}
export interface FundingStatus {
  fundedZat: number;
  confirmations: number;
  txids: string[];
}

export interface DepositStatus {
  receivedZat: number;
  confirmedZat: number;
  pendingZat: number;
  txids: string[];
}

/** What the vault says about itself (the app's /api/health forwards a cached copy). */
export interface VaultHealth {
  ok: boolean; // reachable and answering
  synced?: boolean;
  height?: number;
  chainTip?: number;
  tipStalled?: boolean; // the chain tip hasn't moved for a while: the lightwalletd is behind
  sendsPaused?: boolean; // external sends paused by the operator (network upgrade)
  rescanning?: boolean;
  branch?: string; // consensus branch id the lightwalletd reports (NU7 testnet = 77190ad9)
}

/** Thrown when a payout's outcome is unknown (timeout, in-flight, interrupted): the money may have been sent. Never refund on this. */
export class PayoutUncertainError extends HttpError {
  uncertain = true;
  constructor(message = "Your withdrawal is processing. Check your wallet activity in a minute.") {
    super(502, message);
  }
}

export interface ZcashEngine {
  network: Network;
  requestFunding(stashId: string, amountZat: number): Promise<FundingRequest>;
  checkFunding(stashId: string, simFundedZat?: number): Promise<FundingStatus>;
  /** Payout, idempotent per stashId (or per opts.key when given, e.g. withdrawals). */
  payout(stashId: string, to: string, amountZat: number, memo: string, opts?: { key?: string }): Promise<{ txid: string }>;
  /** A stable personal deposit address for a player (in-app wallet). */
  userAddress(userId: string): Promise<FundingRequest>;
  /** Funds received at a player's deposit address. */
  deposits(userId: string): Promise<DepositStatus>;
  /** Look up a keyed payout (to reconcile uncertain withdrawals). */
  payoutStatus(key: string): Promise<{ state: "sent" | "failed" | "pending" | "unknown"; txid?: string }>;
  /** Is the money side healthy right now? Never throws. */
  health(): Promise<VaultHealth>;
}

export const NETWORK_FEE_ZAT = 30_000; // 0.0003 ZEC buffer the hider adds on top of the prize

function b64url(s: string) {
  return Buffer.from(s, "utf8").toString("base64url");
}
export function zip321(address: string, amountZat: number, memo: string, label = "ZECKED stash") {
  const amount = (amountZat / 1e8).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  return `zcash:${address}?amount=${amount}&memo=${b64url(memo)}&message=${encodeURIComponent(label)}`;
}

// ---------- sim ----------
const BECH32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function fakeUa(seed: string) {
  let out = "";
  for (let block = 0; out.length < 106; block++) {
    const h = sha256(`${seed}:${block}`);
    for (let i = 0; i < 64 && out.length < 106; i += 2) out += BECH32[parseInt(h.slice(i, i + 2), 16) % 32];
  }
  return `utest1${out}`;
}

class SimEngine implements ZcashEngine {
  network = "sim" as const;
  async requestFunding(stashId: string, amountZat: number) {
    const address = fakeUa(`zecked-sim-vault:${process.env.ZECKED_SIM_SEED || "dev"}`);
    return { address, uri: zip321(address, amountZat, `ZK:${stashId}`) };
  }
  async checkFunding(_stashId: string, simFundedZat = 0) {
    return { fundedZat: simFundedZat, confirmations: simFundedZat ? 1 : 0, txids: simFundedZat ? [sha256(`fund:${_stashId}`)] : [] };
  }
  async payout(stashId: string, to: string, amountZat: number, _memo: string, opts?: { key?: string }) {
    return { txid: sha256(`payout:${opts?.key || stashId}:${to}:${amountZat}:${Date.now()}`) };
  }
  async userAddress(userId: string) {
    const address = fakeUa(`zecked-sim-user:${userId}`);
    return { address, uri: `zcash:${address}?memo=${b64url(`ZU:${userId}`)}&message=${encodeURIComponent("Add ZEC to ZECKED")}` };
  }
  async deposits() {
    return { receivedZat: 0, confirmedZat: 0, pendingZat: 0, txids: [] };
  }
  async payoutStatus() {
    return { state: "sent" as const };
  }
  async health() {
    return { ok: true, synced: true };
  }
}

// ---------- vault (testnet / mainnet) ----------
class VaultEngine implements ZcashEngine {
  constructor(public network: "testnet" | "mainnet", private url: string, private token: string) {}
  private async call<T>(path: string, init?: RequestInit, timeoutMs = 15_000): Promise<T> {
    const r = await fetch(`${this.url.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string; message?: string };
    if (!r.ok) {
      console.error("vault error", path, r.status, j.error, j.message);
      // The operator paused external sends (network upgrade): say so, with the vault's own words.
      if (j.error === "sends_paused")
        throw new HttpError(503, j.message || "Payouts are paused for the Zcash network upgrade. Your ZEC is safe; try again later.");
      if (r.status === 402 || j.error === "insufficient_funds")
        throw new HttpError(503, "The prize vault is being topped up. Your win is safe. Try claiming again in a few minutes.");
      if (r.status === 400) throw new HttpError(400, j.message || "The vault rejected that request");
      if (r.status === 404) throw new HttpError(404, j.message || "Not found in the vault");
      throw new HttpError(502, "Couldn't reach the Zcash vault. Your win is safe. Try again shortly.");
    }
    return j;
  }
  async requestFunding(stashId: string, amountZat: number) {
    return this.call<FundingRequest>("/stash-address", { method: "POST", body: JSON.stringify({ stashId, amountZat }) });
  }
  async checkFunding(stashId: string) {
    return this.call<FundingStatus>(`/funding/${encodeURIComponent(stashId)}`);
  }
  async payout(stashId: string, to: string, amountZat: number, memo: string, opts?: { key?: string }) {
    // Only 400 (bad request/address) and 402 (insufficient funds) mean "definitely not sent".
    // Anything else (timeout, 409 in-flight/unresolved, 5xx) is uncertain: the caller must NOT refund.
    try {
      return await this.call<{ txid: string }>(
        "/payout",
        { method: "POST", body: JSON.stringify({ stashId, to, amountZat, memo, key: opts?.key }) },
        120_000
      );
    } catch (e) {
      if (e instanceof HttpError && (e.status === 400 || e.status === 503)) throw e; // definite
      throw new PayoutUncertainError();
    }
  }
  async payoutStatus(key: string) {
    try {
      const r = await this.call<{ state?: string; txid?: string }>(`/payout/${encodeURIComponent(key)}`);
      const st = String(r.state || "");
      if (r.txid && /sent|done|broadcast|confirmed|success/i.test(st || "sent")) return { state: "sent" as const, txid: r.txid };
      if (/fail|error|rejected/i.test(st)) return { state: "failed" as const };
      return { state: "pending" as const };
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return { state: "unknown" as const };
      return { state: "pending" as const };
    }
  }
  async userAddress(userId: string) {
    return this.call<FundingRequest>("/user-address", { method: "POST", body: JSON.stringify({ userId }) });
  }
  async deposits(userId: string) {
    const d = await this.call<Partial<DepositStatus>>(`/deposits/${encodeURIComponent(userId)}`);
    const received = Number(d.receivedZat || 0);
    const confirmed = Number(d.confirmedZat ?? received);
    return { receivedZat: received, confirmedZat: confirmed, pendingZat: Number(d.pendingZat ?? Math.max(0, received - confirmed)), txids: d.txids || [] };
  }
  async health(): Promise<VaultHealth> {
    try {
      const h = await this.call<{ synced?: boolean; height?: number; chainTip?: number; tipStalled?: boolean; sendsPaused?: boolean; rescanning?: boolean; lightd?: { consensusBranchId?: string } }>("/health", undefined, 8_000);
      return { ok: true, synced: !!h.synced, height: h.height, chainTip: h.chainTip, tipStalled: !!h.tipStalled, sendsPaused: !!h.sendsPaused, rescanning: !!h.rescanning, branch: h.lightd?.consensusBranchId };
    } catch {
      return { ok: false };
    }
  }
}

let engine: ZcashEngine | null = null;
export function zcash(): ZcashEngine {
  if (engine) return engine;
  const network = (process.env.ZECKED_NETWORK || "sim") as Network;
  if (network === "sim") engine = new SimEngine();
  else {
    const url = process.env.VAULT_URL;
    const token = process.env.VAULT_TOKEN;
    if (!url || !token) throw new Error(`ZECKED_NETWORK=${network} requires VAULT_URL and VAULT_TOKEN`);
    if (network === "mainnet" && process.env.ZECKED_ALLOW_MAINNET !== "yes") {
      throw new Error("Mainnet is disabled until the security review is complete (set ZECKED_ALLOW_MAINNET=yes)");
    }
    engine = new VaultEngine(network, url, token);
  }
  return engine;
}

export function networkName(): Network {
  return (process.env.ZECKED_NETWORK || "sim") as Network;
}
