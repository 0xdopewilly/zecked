// Gifts: ZEC for one person, opened from a link (/g/<id>), optionally locked with a question only they can
// answer. Not stashes: never in the feed, the ticker, the leaderboard or a profile; no XP, no badges, no
// stats. Unopened gifts come back to the sender after 7 days; a guest who opens one keeps it on sign-up.
//
// Stub, filled in by Engineer A. Every export keeps route.ts compiling and answers "Coming soon" until then.
// KV keys live under `gifts:` (`gift:` is the welcome gift, see house.ts): gifts:<id> (GiftRecord, 90 d),
// gifts:claim:<id> (nx: the first opener wins), gifts:return:<id> (nx: returned once), gifts:tries:<id>:<pid>
// (3 tries / 10 min), gifts:pending:<pid> (ids a guest opened), gifts:expiring (zset by expiresAt),
// gifts:day:<pid>:<day> (20 sends), gifts:opens:<pid>:<day> (50 opens), gifts:sweep (nx 60 s).
import type { GiftOpenResult, PublicGift, WalletInfo } from "@/lib/types";
import type { PlayerRecord } from "./players";
import { HttpError } from "./util";

export const GIFT_MIN_USD = Number(process.env.ZECKED_GIFT_MIN_USD || 0.5);
export const GIFT_MAX_USD = Number(process.env.ZECKED_GIFT_MAX_USD || 20);
export const GIFT_TTL_MS = 7 * 86400_000; // unopened → back to the sender
export const GIFTS_PER_DAY = 20; // per sender
export const OPENS_PER_DAY = 50; // per opener (anti-farm)

export interface GiftRecord {
  id: string; // newId(): 6 chars, same alphabet as stashes
  fromId: string;
  amountZat: number;
  usd: number; // what the sender picked (shown as-is)
  message?: string; // ≤120, sanitised like setVictoryMessage (game.ts)
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

const soon = () => new HttpError(503, "Coming soon");

/** POST /gifts (accounts only): debit the sender's wallet (kind "gift", giftId), save the gift → 201 { gift, wallet }. */
export async function createGift(p: PlayerRecord, body: GiftBody): Promise<{ gift: PublicGift; wallet: WalletInfo }> {
  throw soon();
}

/** GET /gifts/:id: the gift as the viewer sees it (lazy expiry first). */
export async function getGift(id: string, viewer: PlayerRecord): Promise<{ gift: PublicGift; myTries?: { left: number; resetsAt?: string } }> {
  throw soon();
}

/** POST /gifts/:id/open (guests allowed): the first correct opener wins; accounts are credited now, guests on sign-up. */
export async function openGift(id: string, viewer: PlayerRecord, answer?: string): Promise<GiftOpenResult> {
  throw soon();
}

/** POST /gifts/:id/cancel (the sender, while still open): the ZEC comes back and the link stops working. */
export async function cancelGift(id: string, viewer: PlayerRecord): Promise<{ gift: PublicGift; wallet: WalletInfo }> {
  throw soon();
}

/** GET /gifts: the gifts this player sent, newest first. */
export async function ownerGifts(p: PlayerRecord): Promise<PublicGift[]> {
  return [];
}

/** On sign-in: gifts this account (or a guest it merged) opened before signing up land in its wallet. Returns the zat credited. */
export async function creditPendingGifts(account: PlayerRecord): Promise<number> {
  return 0;
}

/** From feed reads (after the response): unopened gifts past their 7 days go back to their senders. Returns how many. */
export async function maybeSweepGifts(): Promise<number> {
  return 0;
}
