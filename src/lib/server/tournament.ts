// The weekly tournament: most cracks from Monday 00:00 UTC to the next Monday wins, and the top 3 are paid
// test ZEC from the house (houseReward) on the first read after the week ends. Ranking is the existing
// crackers › week board (players.ts bumpBoard); ties go to whoever got their last crack in first. Accounts are
// paid straight away; a guest in the top 3 gets a "Sign up to collect" notice and is paid on sign-up
// (creditPendingPrizes). Prizes are wallet credits only: no XP, no badges, no ticker.
//
// Stub, filled in by Engineer C. Every export keeps route.ts compiling until then.
// KV keys: tourney:result:<wk> (TournamentResult, no TTL), tourney:lock (nx 60 s), tourney:check (nx 120 s),
// tourney:paid:<wk>:<pid> (nx, permanent: exactly-once payouts), tourney:owed:<pid> (a guest winner's prizes).
import type { TournamentInfo } from "@/lib/types";
import type { PlayerRecord } from "./players";
import { HttpError } from "./util";

/** Prize per place in USD of test ZEC: ZECKED_TOURNEY_USD="5,3,2" (fewer entries = fewer paid places). */
export function prizesUsd(): number[] {
  return (process.env.ZECKED_TOURNEY_USD || "5,3,2")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** One settled week (tourney:result:<wk>). */
export interface TournamentResult {
  key: string; // the board's week key, e.g. "wk:2026-41"
  startsAt: string;
  endsAt: string;
  champions: { pid: string; place: number; score: number; lastAt: number; prizeUsd: number; paidZat: number }[]; // paidZat 0 = unpaid (house empty), -1 = owed to a guest
  computedAt: string;
  allPaid: boolean;
}

const soon = () => new HttpError(503, "Coming soon");

/** GET /tournament: this week's bounds and prizes, the tie-broken top 3, your rank, and last week's champions. */
export async function tournamentInfo(viewerId?: string): Promise<TournamentInfo> {
  throw soon();
}

/** From feed and /tournament reads (after the response): settles last week exactly once, when it's over. Cheap and safe to call often. */
export async function maybeSettleTournament(): Promise<void> {}

/** On sign-in: prizes this account (or a guest it merged) won before signing up are paid now. Returns the zat credited. */
export async function creditPendingPrizes(account: PlayerRecord): Promise<number> {
  return 0;
}

/** Owner: a week's result (default: last week). */
export async function tournamentAdmin(week?: string): Promise<{ week: string; result: TournamentResult | null }> {
  throw soon();
}

/** Owner: settle a week now (default: the current one), for ops and tests. */
export async function settleNow(week?: string): Promise<TournamentResult> {
  throw soon();
}
