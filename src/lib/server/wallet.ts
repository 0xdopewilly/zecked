// In-app ZECKED wallet (TEST MODE): an internal balance ledger backed by the pooled vault wallet.
// Each signed-in player gets their own deposit address; wins and refunds are internal credits;
// withdrawals are real shielded payouts from the vault.
import type { WalletInfo, WalletTx, WalletTxKind } from "@/lib/types";
import { NETWORK_FEE_ZAT, PayoutUncertainError, networkName, zcash } from "@/lib/zcash/engine";
import { kv } from "./kv";
import { savePlayer, type PlayerRecord } from "./players";
import { zecUsd } from "./price";
import { HttpError, isShieldedAddress, isTransparentAddress, newId, nowIso, shortAddr } from "./util";

export const MIN_WITHDRAW_ZAT = 100_000; // 0.001 ZEC
export const WITHDRAW_FEE_ZAT = NETWORK_FEE_ZAT;
export const SIM_WELCOME_BONUS_ZAT = 5_000_000; // 0.05 play ZEC on sign-up (sim network only)

const K = {
  bal: (pid: string) => `bal:${pid}`,
  ledger: (pid: string) => `ledger:${pid}`,
  depCredited: (pid: string) => `depcred:${pid}`,
  depLock: (pid: string) => `deplock:${pid}`,
  simDeposits: (pid: string) => `simdep:${pid}`,
};

export async function balanceOf(pid: string) {
  return Number((await kv().get<number>(K.bal(pid))) || 0);
}

function tx(kind: WalletTxKind, amountZat: number, label: string, extra: Partial<WalletTx> = {}): WalletTx {
  return { id: newId(), kind, amountZat, at: nowIso(), label, status: "done", ...extra };
}

export async function credit(pid: string, amountZat: number, kind: WalletTxKind, label: string, extra: Partial<WalletTx> = {}) {
  if (!(amountZat > 0)) return;
  await kv().incr(K.bal(pid), Math.round(amountZat));
  await kv().rpush(K.ledger(pid), tx(kind, Math.round(amountZat), label, extra));
}

export async function debit(pid: string, amountZat: number, kind: WalletTxKind, label: string, extra: Partial<WalletTx> = {}) {
  const amt = Math.round(amountZat);
  const after = await kv().incr(K.bal(pid), -amt);
  if (after < 0) {
    await kv().incr(K.bal(pid), amt);
    throw new HttpError(402, "Not enough ZEC in your wallet");
  }
  const t = tx(kind, -amt, label, extra);
  await kv().rpush(K.ledger(pid), t);
  return t;
}

async function activity(pid: string): Promise<WalletTx[]> {
  const all = await kv().lrange<WalletTx>(K.ledger(pid), -40, -1);
  // Later entries override earlier ones with the same id (status updates are appended).
  const byId = new Map<string, WalletTx>();
  for (const t of all) byId.set(t.id, { ...(byId.get(t.id) || {}), ...t });
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
}

export async function ensureDepositAddress(p: PlayerRecord) {
  if (p.depositAddress && p.depositUri) return { address: p.depositAddress, uri: p.depositUri };
  const r = await zcash().userAddress(p.id);
  p.depositAddress = r.address;
  p.depositUri = r.uri;
  await savePlayer(p);
  return r;
}

/** Credit any newly confirmed deposits seen at the player's address. Returns pending (unconfirmed) amount. */
export async function syncDeposits(p: PlayerRecord): Promise<number> {
  const net = networkName();
  if (!p.depositAddress) return 0;
  let confirmedZat = 0;
  let pendingZat = 0;
  if (net === "sim") {
    confirmedZat = Number((await kv().get<number>(K.simDeposits(p.id))) || 0);
  } else {
    try {
      const d = await zcash().deposits(p.id);
      confirmedZat = d.confirmedZat;
      pendingZat = d.pendingZat;
    } catch (e) {
      console.error("deposit sync failed", (e as Error).message);
      return 0;
    }
  }
  const credited = Number((await kv().get<number>(K.depCredited(p.id))) || 0);
  if (confirmedZat > credited && (await kv().set(K.depLock(p.id), 1, { nx: true, exSeconds: 15 }))) {
    try {
      const fresh = Number((await kv().get<number>(K.depCredited(p.id))) || 0);
      const delta = confirmedZat - fresh;
      if (delta > 0) {
        await kv().set(K.depCredited(p.id), confirmedZat);
        await credit(p.id, delta, "deposit", net === "sim" ? "Test deposit (simulated)" : "ZEC received");
      }
    } finally {
      await kv().del(K.depLock(p.id));
    }
  }
  return pendingZat;
}

/** Settle withdrawals whose outcome was uncertain: mark sent (with txid) or refund if the vault says it failed. */
async function reconcileWithdrawals(pid: string) {
  const list = await activity(pid);
  for (const t of list) {
    if (t.kind !== "withdraw" || t.status !== "pending" || !t.payoutKey) continue;
    if (!(await kv().set(`reconcile:${t.id}`, 1, { nx: true, exSeconds: 20 }))) continue;
    const st = await zcash().payoutStatus(t.payoutKey);
    if (st.state === "sent") await kv().rpush(K.ledger(pid), { ...t, status: "done", txid: st.txid });
    else if ((st.state === "failed" || st.state === "unknown") && Date.now() - Date.parse(t.at) > 10 * 60_000) {
      if (await kv().set(`refunded-wd:${t.id}`, 1, { nx: true })) {
        await kv().incr(K.bal(pid), -t.amountZat); // amountZat is negative for a debit
        await kv().rpush(K.ledger(pid), { ...t, status: "failed", label: `${t.label} (failed, refunded)` });
      }
    }
  }
}

export async function walletInfo(p: PlayerRecord): Promise<WalletInfo> {
  if (!p.email) throw new HttpError(401, "Sign up to get your own ZECKED wallet");
  const { address, uri } = await ensureDepositAddress(p);
  if (networkName() !== "sim") await reconcileWithdrawals(p.id).catch((e) => console.error("reconcile failed", (e as Error).message));
  const pending = await syncDeposits(p);
  const bal = await balanceOf(p.id);
  const rate = await zecUsd();
  return {
    balanceZat: bal,
    usd: Math.round((bal / 1e8) * rate * 100) / 100,
    pendingDepositZat: pending,
    depositAddress: address,
    depositUri: uri,
    activity: await activity(p.id),
    minWithdrawZat: MIN_WITHDRAW_ZAT,
    withdrawFeeZat: WITHDRAW_FEE_ZAT,
    network: networkName(),
  };
}

export async function simulateDeposit(p: PlayerRecord, amountZat?: number) {
  if (networkName() !== "sim") throw new HttpError(400, "Simulated deposits only work in sim mode");
  if (!p.email) throw new HttpError(401, "Sign up first");
  const amt = Math.min(50_000_000, Math.max(100_000, Math.round(amountZat || 1_000_000)));
  await ensureDepositAddress(p);
  await kv().incr(K.simDeposits(p.id), amt);
  return walletInfo(p);
}

export async function withdraw(p: PlayerRecord, rawAddress: string, amountZat: number) {
  if (!p.email) throw new HttpError(401, "Sign up first");
  const to = (rawAddress || "").trim();
  const net = networkName();
  if (!isShieldedAddress(to) && !isTransparentAddress(to)) throw new HttpError(400, "That doesn't look like a Zcash address");
  const testnetAddr = /^(utest1|ztestsapling1|tm|textest1)/.test(to);
  if (net === "testnet" && !testnetAddr) throw new HttpError(400, "Test mode pays out on Zcash testnet. Use a testnet address (utest1…)");
  if (net === "mainnet" && testnetAddr) throw new HttpError(400, "That's a testnet address");
  if (to === p.depositAddress) throw new HttpError(400, "That's your own ZECKED address. Use an outside wallet");
  const amt = Math.round(Number(amountZat));
  if (!(amt >= MIN_WITHDRAW_ZAT)) throw new HttpError(400, `Minimum withdrawal is ${(MIN_WITHDRAW_ZAT / 1e8).toFixed(3)} ZEC`);
  const nonce = newId() + newId();
  const key = `withdraw:${p.id}:${nonce}`;
  const t = await debit(p.id, amt + WITHDRAW_FEE_ZAT, "withdraw", `Withdrew to ${shortAddr(to)}`, { status: "pending", payoutKey: key });
  try {
    const { txid } = await zcash().payout(key, to, amt, "ZECKED withdrawal 🔓", { key });
    await kv().rpush(K.ledger(p.id), { ...t, status: "done", txid });
    if (isShieldedAddress(to) && !p.shielded) {
      p.shielded = true;
      if (!p.badges.includes("shielded")) p.badges.push("shielded");
      await savePlayer(p);
    }
    return { txid, amountZat: amt, feeZat: WITHDRAW_FEE_ZAT, to: shortAddr(to), wallet: await walletInfo(p) };
  } catch (e) {
    // Outcome unknown (timeout / in flight): keep it debited as "pending" and reconcile later. Never refund here.
    if (e instanceof PayoutUncertainError) throw e;
    // Definitely not sent (bad address / vault low): put the money back.
    await kv().incr(K.bal(p.id), amt + WITHDRAW_FEE_ZAT);
    await kv().rpush(K.ledger(p.id), { ...t, status: "failed", label: `${t.label} (failed, refunded)` });
    throw e;
  }
}
