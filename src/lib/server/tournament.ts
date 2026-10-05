// The weekly tournament: most cracks from Monday 00:00 UTC to the next Monday wins, and the top 3 are paid
// test ZEC from the house (houseReward) on the first read after the week ends. Ranking is the existing
// crackers › week board (players.ts bumpBoard); ties go to whoever got their last crack in first. Accounts are
// paid straight away; a guest in the top 3 gets a "Sign up to collect" notice and is paid on sign-up
// (creditPendingPrizes). Prizes are wallet credits only: no XP, no badges, no ticker.
//
// KV keys: tourney:result:<wk> (TournamentResult, no TTL), tourney:latest (the newest settled week key),
// tourney:lock:<wk> (nx 60 s), tourney:check (nx 120 s throttle), tourney:paid:<wk>:<pid> (nx, permanent:
// exactly-once payouts; value = zat once paid), tourney:owed:<pid> (a guest winner's prizes, paid on sign-up),
// tourney:owedpaid:<wk>:<pid> (nx, permanent).
import type { LeaderRow, TournamentChampion, TournamentInfo } from "@/lib/types";
import { HOUSE_ID, houseReward } from "./house";
import { kv } from "./kv";
import { notify } from "./notify";
import { avatarUrl, getPlayer, isAccount, lastCrackKey, rankCrackersWeek, tierOf, weekBounds, weekBoundsForKey, type PlayerRecord, type WeekBounds } from "./players";
import { HttpError, nowIso } from "./util";

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

/** A prize a guest earned before signing up (tourney:owed:<pid>). */
interface OwedPrize {
  key: string;
  place: number;
  prizeUsd: number;
  score: number;
}

const K = {
  result: (wk: string) => `tourney:result:${wk}`,
  latest: "tourney:latest",
  lock: (wk: string) => `tourney:lock:${wk}`,
  check: "tourney:check",
  paid: (wk: string, pid: string) => `tourney:paid:${wk}:${pid}`,
  owed: (pid: string) => `tourney:owed:${pid}`,
  owedPaid: (wk: string, pid: string) => `tourney:owedpaid:${wk}:${pid}`,
};

const TOP_SHOWN = 5;
const RANKED = 50; // tie-break depth (the board shows 50 rows too)
const fmtUsd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const ordinal = (n: number) => `#${n}`;

/** The house and seeded demo players never win prizes. */
const eligible = (pid: string) => pid !== HOUSE_ID && !pid.startsWith("seed_");

/** A week's crackers in prize order (most cracks, then the earlier last crack), prize-eligible players only. */
async function rankedWeek(week: string) {
  const raw = (await kv().zrevrange(`lb:crackers:${week}`, 0, RANKED - 1)).filter((r) => r.score > 0 && eligible(r.member));
  return rankCrackersWeek(week, raw);
}

/** The week behind `w`. */
const previousWeek = (w: WeekBounds) => weekBounds(new Date(Date.parse(w.startsAt) - 1));

function parseWeek(raw: string | undefined, fallback: WeekBounds): WeekBounds {
  if (!raw) return fallback;
  const b = weekBoundsForKey(raw);
  if (!b) throw new HttpError(400, "Week looks like 2026-41");
  return b;
}

async function championRows(result: TournamentResult): Promise<TournamentChampion[]> {
  const players = await Promise.all(result.champions.map((c) => getPlayer(c.pid)));
  return result.champions.map((c, i) => ({
    place: c.place,
    handle: players[i]?.handle || "@anon",
    avatarUrl: avatarUrl(players[i]),
    tier: tierOf(players[i]),
    score: c.score,
    prizeUsd: c.prizeUsd,
    paidZat: c.paidZat,
  }));
}

/** GET /tournament: this week's bounds and prizes, the tie-broken top 5, your rank, and the latest settled week's champions. */
export async function tournamentInfo(viewerId?: string): Promise<TournamentInfo> {
  const week = weekBounds();
  const prev = previousWeek(week);
  const [ranked, prevResult, latestKey] = await Promise.all([rankedWeek(week.key), kv().get<TournamentResult>(K.result(prev.key)), kv().get<string>(K.latest)]);
  const topIds = ranked.slice(0, TOP_SHOWN);
  const players = await Promise.all(topIds.map((r) => getPlayer(r.member)));
  const top: LeaderRow[] = topIds.map((r, i) => ({
    rank: i + 1,
    handle: players[i]?.handle || "@anon",
    avatarUrl: avatarUrl(players[i]),
    isHouse: players[i]?.house || undefined,
    tier: tierOf(players[i]),
    score: r.score,
    isYou: r.member === viewerId,
  }));
  let you: TournamentInfo["you"];
  if (viewerId) {
    const idx = ranked.findIndex((r) => r.member === viewerId);
    if (idx >= 0) you = { rank: idx + 1, score: ranked[idx].score };
  }
  // The newest settled week: normally last week; a week the owner settled early (ops, tests) when that's newer.
  const result = latestKey && latestKey !== prev.key ? await kv().get<TournamentResult>(K.result(latestKey)) : prevResult;
  const info: TournamentInfo = { week, prizesUsd: prizesUsd(), top };
  if (you) info.you = you;
  if (result) info.last = { key: result.key, endedAt: result.endsAt, champions: await championRows(result) };
  return info;
}

/** Computes a week's champions (unpaid) from the board. */
async function compute(w: WeekBounds): Promise<TournamentResult> {
  const prizes = prizesUsd();
  const ranked = (await rankedWeek(w.key)).slice(0, prizes.length);
  // The tie-break only read lastAt for tied players; fill it in for the record.
  const lastAt = await Promise.all(ranked.map((r) => (r.lastAt !== undefined ? r.lastAt : kv().get<number>(lastCrackKey(w.key, r.member)))));
  return {
    key: w.key,
    startsAt: w.startsAt,
    endsAt: w.endsAt,
    champions: ranked.map((r, i) => ({ pid: r.member, place: i + 1, score: r.score, lastAt: Number(lastAt[i]) || 0, prizeUsd: prizes[i], paidZat: 0 })),
    computedAt: nowIso(),
    allPaid: false,
  };
}

/** Pays whoever is still unpaid in a result. Mutates and saves it. Stops at the first house-empty payout. */
async function payOut(result: TournamentResult) {
  for (const c of result.champions) {
    if (c.paidZat !== 0) continue;
    if (!(await kv().set(K.paid(result.key, c.pid), 0, { nx: true }))) {
      // Another run got here first: take its outcome (0 = still in flight, we pick it up on a later run).
      const v = await kv().get<number>(K.paid(result.key, c.pid));
      if (v) c.paidZat = v;
      continue;
    }
    const p = await getPlayer(c.pid);
    const usd = fmtUsd(c.prizeUsd);
    if (!p || !isAccount(p)) {
      // A guest (or a player who is gone): the prize waits for them to sign up (creditPendingPrizes).
      await kv().rpush(K.owed(c.pid), { key: result.key, place: c.place, prizeUsd: c.prizeUsd, score: c.score } satisfies OwedPrize);
      await kv().set(K.paid(result.key, c.pid), -1);
      c.paidZat = -1;
      if (p) await notify(c.pid, { kind: "tourney", text: `You finished ${ordinal(c.place)} this week 🏆 Sign up to collect your ${usd} prize` }).catch(() => {});
      continue;
    }
    const zat = await houseReward(c.pid, c.prizeUsd, `Weekly tournament ${ordinal(c.place)} 🏆`, `Tournament prize → ${p.handle}`);
    if (!zat) {
      await kv().del(K.paid(result.key, c.pid)); // the house is empty: retry on a later read, once the owner tops up
      break;
    }
    await kv().set(K.paid(result.key, c.pid), zat);
    c.paidZat = zat;
    await notify(c.pid, { kind: "tourney", text: `You finished ${ordinal(c.place)} this week 🏆 +${usd} of test ZEC`, amountZat: zat }).catch(() => {});
  }
  result.allPaid = result.champions.every((c) => c.paidZat !== 0);
  await kv().set(K.result(result.key), result);
  return result;
}

/** Settles a week under its lock: computes the result once, then pays whoever is still unpaid. */
async function settle(w: WeekBounds, opts: { force?: boolean } = {}): Promise<TournamentResult | null> {
  if (!(await kv().set(K.lock(w.key), 1, { nx: true, exSeconds: 60 }))) {
    if (opts.force) throw new HttpError(409, "That week is being settled right now. Try again in a minute");
    return null;
  }
  try {
    let result = await kv().get<TournamentResult>(K.result(w.key));
    if (!result) {
      result = await compute(w);
      await kv().set(K.result(w.key), result);
      // tourney:latest only moves forward (settling an old week by hand never hides a newer result).
      const latest = await kv().get<string>(K.latest);
      const latestEnds = latest ? weekBoundsForKey(latest)?.endsAt : undefined;
      if (!latestEnds || latestEnds < w.endsAt) await kv().set(K.latest, w.key);
    }
    if (result.allPaid) return result;
    return await payOut(result);
  } finally {
    await kv().del(K.lock(w.key));
  }
}

/** From feed and /tournament reads (after the response): settles last week exactly once, when it's over. Cheap and safe to call often. */
export async function maybeSettleTournament(): Promise<void> {
  try {
    if (!(await kv().set(K.check, 1, { nx: true, exSeconds: 120 }))) return; // one check per two minutes, across instances
    const prev = previousWeek(weekBounds());
    const done = await kv().get<TournamentResult>(K.result(prev.key));
    if (done?.allPaid) return;
    await settle(prev);
  } catch (e) {
    console.error("tournament settle", (e as Error).message);
  }
}

/** On sign-in: prizes this account (or a guest it merged) won before signing up are paid now. Returns the zat credited. */
export async function creditPendingPrizes(account: PlayerRecord): Promise<number> {
  let total = 0;
  try {
    const ids = [account.id, ...(account.mergedGuests || [])];
    for (const id of ids) {
      const owed = await kv().lrange<OwedPrize>(K.owed(id), 0, -1);
      if (!owed.length) continue;
      await kv().del(K.owed(id));
      for (const o of owed) {
        if (!(await kv().set(K.owedPaid(o.key, id), 1, { nx: true }))) continue; // paid on an earlier sign-in
        const usd = fmtUsd(o.prizeUsd);
        const zat = await houseReward(account.id, o.prizeUsd, `Weekly tournament ${ordinal(o.place)} 🏆`, `Tournament prize → ${account.handle}`);
        if (!zat) {
          // The house is empty: put the prize back for the next sign-in.
          await kv().del(K.owedPaid(o.key, id));
          await kv().rpush(K.owed(id), o);
          continue;
        }
        total += zat;
        await kv().set(K.paid(o.key, id), zat);
        const result = await kv().get<TournamentResult>(K.result(o.key));
        const c = result?.champions.find((x) => x.pid === id);
        if (result && c) {
          c.paidZat = zat;
          await kv().set(K.result(o.key), result);
        }
        await notify(account.id, { kind: "tourney", text: `Your tournament prize landed 🏆 You finished ${ordinal(o.place)}: +${usd} of test ZEC`, amountZat: zat }).catch(() => {});
      }
    }
  } catch (e) {
    console.error("tournament pending prizes", (e as Error).message);
  }
  return total;
}

/** Owner: a week's result (default: last week). */
export async function tournamentAdmin(week?: string): Promise<{ week: string; result: TournamentResult | null }> {
  const w = parseWeek(week, previousWeek(weekBounds()));
  return { week: w.key, result: await kv().get<TournamentResult>(K.result(w.key)) };
}

/** Owner: settle a week now (default: the current one), for ops and tests. */
export async function settleNow(week?: string): Promise<TournamentResult> {
  const w = parseWeek(week, weekBounds());
  const result = await settle(w, { force: true });
  if (!result) throw new HttpError(409, "That week is being settled right now. Try again in a minute");
  return result;
}
