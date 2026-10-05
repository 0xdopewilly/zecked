// Gifts: ZEC for one person, opened from a link (/g/<id>), optionally locked with a question only they can
// answer. Not stashes: never in the feed, the ticker, the leaderboard or a profile; no XP, no badges, no
// stats. Unopened gifts come back to the sender after 7 days (or when the sender takes them back); a guest
// who opens one keeps it on sign-up (creditPendingGifts, from finishSignIn).
//
// Money moves atomically through the wallet ledger: debit the sender → save the record; on open credit the
// opener (or park it for a guest); on return credit the sender. The `gifts:claim:<id>` key is the single
// arbiter for "what happened to this gift": the first writer (an opener, or a return) wins, so a gift can
// never be paid twice.
//
// KV keys live under `gifts:` (`gift:` is the welcome gift, see house.ts):
//   gifts:<id>                GiftRecord (90 d)
//   gifts:claim:<id>          nx: the opener's id, or "returned:<reason>"
//   gifts:credited:<id>       nx: a guest's gift credited once on sign-up
//   gifts:tries:<id>:<pid>    { used, windowStart } (5 tries / 10 min)
//   gifts:pending:<pid>       gift ids a guest opened, credited when they sign up
//   gifts:by:<pid>            gift ids a player sent
//   gifts:expiring            zset by expiresAt (ms), for the sweep
//   gifts:day:<pid>:<day>     sends today (20)
//   gifts:opens:<pid>:<day>   opens today (50, anti-farm)
//   gifts:sweep               nx 60 s throttle for maybeSweepGifts
//   gifts:claimat:<id>        ms when the claim key was taken (a claim that died halfway is stale after 2 min)
//   gifts:wrong:<id>          wrong answers from everyone, 1 h window (30 → "out of tries" for all)
import type { GiftOpenResult, PublicGift, WalletInfo } from "@/lib/types";
import { networkName } from "@/lib/zcash/engine";
import { kv } from "./kv";
import { notify } from "./notify";
import { avatarUrl, getPlayer, isAccount, type PlayerRecord } from "./players";
import { zecUsd } from "./price";
import { HttpError, hashAnswer, newId, newToken, normalizeAnswer, nowIso } from "./util";
import { credit, debit, walletInfo } from "./wallet";

export const GIFT_MIN_USD = Number(process.env.ZECKED_GIFT_MIN_USD || 0.5);
export const GIFT_MAX_USD = Number(process.env.ZECKED_GIFT_MAX_USD || 20);
export const GIFT_TTL_MS = 7 * 86400_000; // unopened → back to the sender
export const GIFTS_PER_DAY = 20; // per sender
export const OPENS_PER_DAY = 50; // per opener (anti-farm)
export const MESSAGE_MAX = 140;
export const QUESTION_MAX = 80;
export const ANSWER_MAX = 60;
const MAX_TRIES = 5;
const TRY_WINDOW_MS = 10 * 60_000;
const RECORD_TTL_S = 90 * 86400;

const WRONG_VERDICTS = ["Nope. Not that 😏", "Close? Maybe. Wrong? Yes.", "Not it. Think like them.", "The box didn't budge.", "Wrong, but keep going."];

export interface GiftRecord {
  id: string; // newId(): 6 chars, same alphabet as stashes
  fromId: string;
  amountZat: number;
  usd: number; // what the sender picked (shown as-is)
  message?: string; // ≤140, sanitised like setVictoryMessage (game.ts)
  lock?: { question: string; answerHashes: string[]; salt: string }; // hashAnswer / normalizeAnswer (util.ts), "|" separates answers
  status: "open" | "claimed" | "returned" | "cancelled";
  createdAt: string;
  expiresAt: string; // createdAt + GIFT_TTL_MS
  claimedBy?: string;
  claimedAt?: string;
  credited?: boolean; // false → a guest holds it until they sign up (creditPendingGifts)
  returnedAt?: string;
  returnReason?: "expired" | "cancelled";
  network: string;
}

export type GiftBody = { usd: number; message?: string; lock?: { question: string; answer: string } };

const K = {
  gift: (id: string) => `gifts:${id}`,
  claim: (id: string) => `gifts:claim:${id}`,
  credited: (id: string) => `gifts:credited:${id}`,
  tries: (id: string, pid: string) => `gifts:tries:${id}:${pid}`,
  pending: (pid: string) => `gifts:pending:${pid}`,
  byPlayer: (pid: string) => `gifts:by:${pid}`,
  expiring: "gifts:expiring",
  day: (pid: string, d: string) => `gifts:day:${pid}:${d}`,
  opens: (pid: string, d: string) => `gifts:opens:${pid}:${d}`,
  sweep: "gifts:sweep",
  claimAt: (id: string) => `gifts:claimat:${id}`, // when the claim key was taken (ms), to spot a claim that died halfway
  wrong: (id: string) => `gifts:wrong:${id}`, // wrong answers from everyone, 1 h window (a lock can't be brute-forced from fresh cookies)
};
const GLOBAL_WRONG_MAX = 30;
const STALE_CLAIM_MS = 2 * 60_000;

const today = () => new Date().toISOString().slice(0, 10);
const zecStr = (zat: number) => (zat / 1e8).toFixed(4).replace(/(\.\d{2}\d*?)0+$/, "$1");
const usdStr = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const clean = (s: string | undefined, max: number) => (s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max + 1);

const loadGift = (id: string) => kv().get<GiftRecord>(K.gift(id));
// A gift a guest opened but hasn't collected yet (sign-up pending) is kept for good; everything else 90 days.
const saveGift = (g: GiftRecord) => kv().set(K.gift(g.id), g, g.status === "claimed" && g.credited === false ? undefined : { exSeconds: RECORD_TTL_S });

async function mustLoad(id: string): Promise<GiftRecord> {
  const g = /^[0-9A-Za-z]{4,12}$/.test(id || "") ? await loadGift(id) : null;
  if (!g) throw new HttpError(404, "Gift not found");
  return g;
}

/** A per-day counter with a 2-day TTL (set on first use). Returns the count after this hit. */
async function dayCount(key: string) {
  const n = await kv().incr(key);
  if (n === 1) await kv().set(key, 1, { exSeconds: 2 * 86400 });
  return n;
}

/** Does this viewer (or a guest they merged) hold the gift? */
function heldBy(g: GiftRecord, viewer: PlayerRecord) {
  return !!g.claimedBy && (g.claimedBy === viewer.id || (viewer.mergedGuests || []).includes(g.claimedBy));
}

async function toPublicGift(g: GiftRecord, viewer: PlayerRecord): Promise<PublicGift> {
  const isMine = g.fromId === viewer.id;
  const [from, opener] = await Promise.all([getPlayer(g.fromId), isMine && g.claimedBy ? getPlayer(g.claimedBy) : Promise.resolve(null)]);
  return {
    id: g.id,
    from: { handle: from?.handle || "@someone", avatarUrl: avatarUrl(from) },
    amountZat: g.amountZat,
    usd: g.usd,
    message: g.message,
    locked: !!g.lock,
    question: g.lock?.question,
    status: g.status,
    isMine,
    isYours: heldBy(g, viewer),
    credited: !!g.credited,
    createdAt: g.createdAt,
    expiresAt: g.expiresAt,
    // Handles only, and only to the sender, and only when the opener is an account (guests stay anonymous).
    openedBy: isMine && opener && isAccount(opener) ? opener.handle : undefined,
    returnReason: g.returnReason,
    testMode: g.network !== "mainnet",
  };
}

/**
 * The ZEC goes back to the sender, exactly once. The claim key decides: if an opener got there first
 * (or a return already happened) nothing moves and the current record is returned.
 */
async function returnGift(g: GiftRecord, reason: "expired" | "cancelled"): Promise<GiftRecord> {
  if (!(await kv().set(K.claim(g.id), `returned:${reason}`, { nx: true }))) {
    // Someone holds the claim. Normally that means the gift was opened (or already returned). If the record
    // is still "open" the opener's request died halfway: paid → finish their claim; unpaid for 2+ min → stale.
    const owner = await kv().get<string>(K.claim(g.id));
    const fresh = (await loadGift(g.id)) || g;
    if (!owner || owner.startsWith("returned:") || fresh.status !== "open") return fresh;
    if (await kv().get<string>(K.credited(g.id))) {
      fresh.status = "claimed";
      fresh.claimedBy = owner;
      fresh.claimedAt = fresh.claimedAt || nowIso();
      fresh.credited = true;
      await saveGift(fresh);
      await kv().zrem(K.expiring, g.id);
      return fresh;
    }
    const at = Number(await kv().get<number>(K.claimAt(g.id))) || 0;
    if (Date.now() - at < STALE_CLAIM_MS) return fresh;
    await kv().del(K.claim(g.id));
    if (!(await kv().set(K.claim(g.id), `returned:${reason}`, { nx: true }))) return (await loadGift(g.id)) || g;
  }
  await credit(g.fromId, g.amountZat, "gift", reason === "expired" ? "Gift came back · nobody opened it 🎁" : "Took a gift back 🎁", { giftId: g.id });
  g.status = reason === "cancelled" ? "cancelled" : "returned";
  g.returnedAt = nowIso();
  g.returnReason = reason;
  await saveGift(g);
  await kv().zrem(K.expiring, g.id);
  if (reason === "expired") {
    await notify(g.fromId, { kind: "gift", amountZat: g.amountZat, text: `Nobody opened your gift in 7 days, so ${zecStr(g.amountZat)} ZEC came back to you.` });
  }
  return g;
}

/** Lazy expiry: an open gift past its 7 days goes back before anyone sees it. */
async function tick(g: GiftRecord): Promise<GiftRecord> {
  if (g.status === "open" && Date.parse(g.expiresAt) <= Date.now()) return returnGift(g, "expired");
  return g;
}

/** POST /gifts (accounts only): debit the sender's wallet (kind "gift", giftId), save the gift → 201 { gift, wallet }. */
export async function createGift(p: PlayerRecord, body: GiftBody): Promise<{ gift: PublicGift; wallet: WalletInfo }> {
  if (!isAccount(p)) throw new HttpError(401, "Sign up to send a gift");
  const usd = Math.round(Number(body?.usd) * 100) / 100;
  if (!(usd >= GIFT_MIN_USD && usd <= GIFT_MAX_USD)) throw new HttpError(400, `Gifts are between ${usdStr(GIFT_MIN_USD)} and ${usdStr(GIFT_MAX_USD)}`);
  const message = clean(body?.message, MESSAGE_MAX);
  if (message.length > MESSAGE_MAX) throw new HttpError(400, `Messages are up to ${MESSAGE_MAX} characters`);

  let lock: GiftRecord["lock"];
  const q = clean(body?.lock?.question, QUESTION_MAX);
  const a = (body?.lock?.answer || "").trim();
  if (q || a) {
    if (q.length < 2 || q.length > QUESTION_MAX) throw new HttpError(400, `Questions are 2–${QUESTION_MAX} characters`);
    if (!a || a.length > ANSWER_MAX) throw new HttpError(400, `Add an answer (up to ${ANSWER_MAX} characters)`);
    const alts = a.split("|").map((x) => x.trim()).filter(Boolean);
    if (!alts.length || alts.some((x) => normalizeAnswer(x).length === 0)) throw new HttpError(400, "That answer is empty after cleanup");
    const salt = newToken();
    lock = { question: q, salt, answerHashes: alts.map((x) => hashAnswer(x, salt)) };
  }

  if ((Number(await kv().get<number>(K.day(p.id, today()))) || 0) >= GIFTS_PER_DAY) throw new HttpError(429, "That's a lot of gifts for one day. Try again tomorrow");

  const rate = await zecUsd();
  const amountZat = Math.max(10_000, Math.round(((usd / rate) * 1e8) / 10_000) * 10_000);
  const now = Date.now();
  const id = newId();
  // Money first (atomic: a short wallet throws 402 and nothing else happens), then the record. If the
  // record can't be saved, the ZEC goes straight back.
  await debit(p.id, amountZat, "gift", "Sent a gift 🎁", { giftId: id });
  await dayCount(K.day(p.id, today())); // counted once the ZEC has actually moved
  const rec: GiftRecord = {
    id,
    fromId: p.id,
    amountZat,
    usd,
    message: message || undefined,
    lock,
    status: "open",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GIFT_TTL_MS).toISOString(),
    network: networkName(),
  };
  try {
    if (!(await kv().set(K.gift(id), rec, { nx: true, exSeconds: RECORD_TTL_S }))) throw new Error("gift id collision");
    await kv().zadd(K.expiring, now + GIFT_TTL_MS, id);
    await kv().rpush(K.byPlayer(p.id), id);
  } catch (e) {
    await credit(p.id, amountZat, "gift", "Gift didn't send · ZEC back");
    throw e;
  }
  return { gift: await toPublicGift(rec, p), wallet: await walletInfo(p) };
}

async function myTries(g: GiftRecord, viewer: PlayerRecord): Promise<{ left: number; resetsAt?: string } | undefined> {
  if (!g.lock || g.status !== "open" || g.fromId === viewer.id) return undefined;
  const t = await kv().get<{ used: number; windowStart: number }>(K.tries(g.id, viewer.id));
  if (!t || Date.now() - t.windowStart > TRY_WINDOW_MS) return { left: MAX_TRIES };
  return { left: Math.max(0, MAX_TRIES - t.used), resetsAt: new Date(t.windowStart + TRY_WINDOW_MS).toISOString() };
}

/** GET /gifts/:id: the gift as the viewer sees it (lazy expiry first). */
export async function getGift(id: string, viewer: PlayerRecord): Promise<{ gift: PublicGift; myTries?: { left: number; resetsAt?: string } }> {
  const g = await tick(await mustLoad(id));
  return { gift: await toPublicGift(g, viewer), myTries: await myTries(g, viewer) };
}

/** POST /gifts/:id/open (guests allowed): the first correct opener wins; accounts are credited now, guests on sign-up. */
export async function openGift(id: string, viewer: PlayerRecord, answer?: string): Promise<GiftOpenResult> {
  let g = await tick(await mustLoad(id));
  if (g.fromId === viewer.id) throw new HttpError(400, "That's your own gift 😅");
  const settled = async (verdict?: string, triesLeft = 0, resetsAt?: string): Promise<GiftOpenResult> => ({
    opened: false,
    verdict,
    triesLeft,
    resetsAt,
    gift: await toPublicGift(g, viewer),
    credited: !!g.credited && heldBy(g, viewer),
    creditedZat: 0,
  });
  if (g.status !== "open") {
    // Opening again what you already opened is fine (and changes nothing).
    if (heldBy(g, viewer)) return { ...(await settled()), opened: true };
    return settled(g.status === "claimed" ? "Someone already opened this gift." : "This gift went back to the sender.");
  }

  let triesLeft = MAX_TRIES;
  let resetsAt: string | undefined;
  if (g.lock) {
    const a = (answer || "").slice(0, 80);
    if (!normalizeAnswer(a)) throw new HttpError(400, "Type the answer first");
    const tk = K.tries(g.id, viewer.id);
    const now = Date.now();
    let t = (await kv().get<{ used: number; windowStart: number }>(tk)) || { used: 0, windowStart: now };
    if (now - t.windowStart > TRY_WINDOW_MS) t = { used: 0, windowStart: now };
    resetsAt = new Date(t.windowStart + TRY_WINDOW_MS).toISOString();
    if (t.used >= MAX_TRIES) return settled("Out of tries. Fresh tries in a few minutes.", 0, resetsAt);
    // Tries are per player, but a cookie-less script gets a fresh guest per request: the gift itself also
    // stops answering after GLOBAL_WRONG_MAX wrong guesses in an hour.
    if ((Number(await kv().get<number>(K.wrong(g.id))) || 0) >= GLOBAL_WRONG_MAX) return settled("Too many wrong guesses on this gift. Try again in an hour.", 0, resetsAt);
    if (!g.lock.answerHashes.includes(hashAnswer(a, g.lock.salt))) {
      t.used += 1;
      await kv().set(tk, t, { exSeconds: Math.ceil(TRY_WINDOW_MS / 1000) + 60 });
      await dayCount(K.wrong(g.id)).then((n) => (n === 1 ? kv().set(K.wrong(g.id), 1, { exSeconds: 3600 }) : null));
      return settled(WRONG_VERDICTS[Math.floor(Math.random() * WRONG_VERDICTS.length)], MAX_TRIES - t.used, resetsAt);
    }
    triesLeft = MAX_TRIES - t.used;
  }

  if ((await dayCount(K.opens(viewer.id, today()))) > OPENS_PER_DAY) throw new HttpError(429, "That's a lot of gifts for one day. Try again tomorrow");

  // Exactly one opener: whoever writes the claim key first. Everything after the claim is idempotent, so an
  // opener whose first request died halfway simply completes it on the next one.
  if (!(await kv().set(K.claim(g.id), viewer.id, { nx: true }))) {
    const owner = await kv().get<string>(K.claim(g.id));
    g = (await loadGift(g.id)) || g;
    if (owner !== viewer.id || g.status !== "open") {
      return settled(g.status === "open" ? "Someone is opening this gift right now. Try again in a moment." : g.status === "claimed" ? "Someone already opened this gift." : "This gift went back to the sender.", triesLeft, resetsAt);
    }
  } else {
    await kv().set(K.claimAt(g.id), Date.now(), { exSeconds: 86400 });
  }
  g = (await loadGift(g.id)) || g;
  const sender = await getPlayer(g.fromId);
  const fromHandle = sender?.handle || "@someone";
  // 1) The record: from here the gift is theirs, whatever happens next.
  const firstTime = g.status === "open";
  if (firstTime) {
    g.status = "claimed";
    g.claimedBy = viewer.id;
    g.claimedAt = nowIso();
    g.credited = false;
    await saveGift(g);
    await kv().zrem(K.expiring, g.id);
  }
  // 2) The money: accounts now (once, guarded by the credited key), guests when they sign up.
  let creditedNow = 0;
  if (!g.credited) {
    if (isAccount(viewer)) {
      if (await kv().set(K.credited(g.id), viewer.id, { nx: true })) {
        try {
          await credit(viewer.id, g.amountZat, "gift", `Gift from ${fromHandle} 🎁`, { giftId: g.id });
        } catch (e) {
          await kv().del(K.credited(g.id)); // nothing moved: the next attempt pays
          throw e;
        }
        creditedNow = g.amountZat;
      }
      g.credited = true;
      await saveGift(g);
    } else if (!(await kv().lrange<string>(K.pending(viewer.id), 0, -1)).includes(g.id)) {
      await kv().rpush(K.pending(viewer.id), g.id);
    }
  }
  if (firstTime) {
    // The sender hears about it (an account opener by handle; a guest stays anonymous). No amountZat on
    // this one: it is the sender's own ZEC changing hands, not money landing for them.
    await notify(g.fromId, { kind: "gift", text: isAccount(viewer) ? `${viewer.handle} opened your gift 🎁` : "Someone opened your gift 🎁" });
  }
  // The opener's own notice is for their other devices (push); no amountZat, so the screen's coin isn't doubled.
  if (creditedNow) await notify(viewer.id, { kind: "gift", text: `+${zecStr(g.amountZat)} ZEC from ${fromHandle}'s gift landed in your wallet` });
  return { opened: true, triesLeft, resetsAt, gift: await toPublicGift(g, viewer), credited: !!g.credited, creditedZat: g.credited ? g.amountZat : 0 };
}

/** POST /gifts/:id/cancel (the sender, while still open): the ZEC comes back and the link stops working. */
export async function cancelGift(id: string, viewer: PlayerRecord): Promise<{ gift: PublicGift; wallet: WalletInfo }> {
  let g = await tick(await mustLoad(id));
  if (g.fromId !== viewer.id) throw new HttpError(403, "Only the sender can take a gift back");
  if (g.status === "claimed") throw new HttpError(400, "Too late, this gift was already opened");
  if (g.status !== "open") throw new HttpError(400, "This gift already came back to you");
  g = await returnGift(g, "cancelled");
  if (g.status === "claimed") throw new HttpError(400, "Too late, this gift was already opened");
  return { gift: await toPublicGift(g, viewer), wallet: await walletInfo(viewer) };
}

/** GET /gifts: the gifts this player sent, newest first. */
export async function ownerGifts(p: PlayerRecord): Promise<PublicGift[]> {
  const ids = await kv().lrange<string>(K.byPlayer(p.id), -30, -1);
  const recs = await Promise.all(ids.map((id) => loadGift(id)));
  const out: PublicGift[] = [];
  for (const r of recs.reverse()) if (r) out.push(await toPublicGift(await tick(r), p));
  return out;
}

/** On sign-in: gifts this account (or a guest it merged) opened before signing up land in its wallet. Returns the zat credited. Never throws. */
export async function creditPendingGifts(account: PlayerRecord): Promise<number> {
  let total = 0;
  try {
    const ids = [account.id, ...(account.mergedGuests || [])];
    for (const gid of ids) {
      const list = await kv().lrange<string>(K.pending(gid), 0, -1);
      if (!list.length) continue;
      let allDone = true;
      for (const id of list) {
        try {
          const g = await loadGift(id);
          if (!g || g.status !== "claimed" || !g.claimedBy || !ids.includes(g.claimedBy)) continue;
          if (g.credited) continue;
          if (!(await kv().set(K.credited(id), account.id, { nx: true }))) continue;
          const from = await getPlayer(g.fromId);
          try {
            await credit(account.id, g.amountZat, "gift", `Gift from ${from?.handle || "@someone"} 🎁`, { giftId: g.id });
          } catch (e) {
            await kv().del(K.credited(id)); // nothing moved: the next sign-in retries
            throw e;
          }
          g.claimedBy = account.id;
          g.credited = true;
          await saveGift(g);
          await kv().set(K.claim(id), account.id);
          total += g.amountZat;
        } catch (e) {
          allDone = false;
          console.error("gift credit", id, (e as Error).message);
        }
      }
      if (allDone) await kv().del(K.pending(gid));
    }
  } catch (e) {
    console.error("creditPendingGifts", (e as Error).message);
  }
  return total;
}

/** From feed reads (after the response): unopened gifts past their 7 days go back to their senders. Returns how many. */
export async function maybeSweepGifts(): Promise<number> {
  let n = 0;
  try {
    if (!(await kv().set(K.sweep, 1, { nx: true, exSeconds: 60 }))) return 0;
    // The tail of the zset = the soonest to expire (lowest scores). 20 at a time keeps a feed read cheap.
    const rows = await kv().zrevrange(K.expiring, -20, -1);
    const now = Date.now();
    for (const r of rows) {
      if (r.score > now) continue;
      const g = await loadGift(r.member);
      if (!g) {
        await kv().zrem(K.expiring, r.member);
        continue;
      }
      if (g.status !== "open") {
        await kv().zrem(K.expiring, r.member);
        continue;
      }
      await tick(g);
      n++;
    }
  } catch (e) {
    console.error("gift sweep", (e as Error).message);
  }
  return n;
}
