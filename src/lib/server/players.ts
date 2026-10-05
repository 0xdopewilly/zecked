// Players: anonymous cookie identity + handle, XP, tiers, badges, streaks, leaderboards.
import type { BadgeId, LeaderRow, Leaderboard, Player, TierId } from "@/lib/types";
import { kv } from "./kv";
import { newId, nowIso } from "./util";

export const TIERS: { id: TierId; xp: number }[] = [
  { id: "rookie", xp: 0 },
  { id: "cracker", xp: 300 },
  { id: "safecracker", xp: 900 },
  { id: "vault", xp: 1500 },
  { id: "oracle", xp: 2500 },
  { id: "legend", xp: 4000 },
];

export const XP = {
  hide: 40,
  call: 10,
  crackRiddle: 120,
  speedBonus: 60,
  winPrediction: 150,
  exactCall: 60,
  uncrackable: 80,
};

export interface PlayerRecord {
  id: string;
  handle: string;
  createdAt: string;
  xp: number;
  stats: { cracked: number; hidden: number; uncrackable: number; oracle: number; streak: number };
  badges: BadgeId[];
  pendingClaims: string[];
  shielded: boolean;
  lastPlayedDay?: string; // YYYY-MM-DD (UTC)
  email?: string; // verified email (a sign-in code, or Google's verified address)
  verifiedAt?: string; // when this player became an account (any sign-in method)
  googleSub?: string; // Google account id, when signed up with Google
  passkeys?: number; // passkeys registered to this account
  passkeyUser?: string; // WebAuthn user handle (base64url), created with the first passkey
  house?: boolean; // the ZECKED house account (welcome gifts, house drops)
  depositAddress?: string; // personal in-app wallet address
  depositUri?: string;
  mergedGuests?: string[];
  avatarV?: string; // profile photo key (see avatars.ts), accounts only
  inviteCode?: string; // their invite link: /i/<code> (see invites.ts)
  dropAlerts?: boolean; // push when a free house drop goes live (default on)
}

const ADJ = ["night", "quiet", "shadow", "ghost", "zero", "gold", "vault", "cipher", "silent", "lucky", "neon", "velvet", "hidden", "sly", "misty"];
const NOUN = ["owl", "fox", "key", "cat", "raven", "lynx", "wolf", "moth", "otter", "hawk", "viper", "tiger", "panda", "koala", "zebra"];

function tierFor(xp: number) {
  let idx = 0;
  TIERS.forEach((t, i) => {
    if (xp >= t.xp) idx = i;
  });
  return idx;
}

function maskEmail(e: string) {
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}${"*".repeat(Math.max(1, Math.min(3, u.length - 2)))}@${d}`;
}

/** The streak as it stands today: it only resets on the next play, so a lapsed one (last played before
 *  yesterday) shows as 0 instead of a stale number. */
function liveStreak(p: PlayerRecord) {
  if (!p.lastPlayedDay || !p.stats.streak) return 0;
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  return p.lastPlayedDay >= yesterday ? p.stats.streak : 0;
}

/** A signed-in account (email, Google or passkey), as opposed to a guest who can only browse and play. */
export function isAccount(p: PlayerRecord | null | undefined): boolean {
  return !!p && !!(p.house || p.email || p.googleSub || (p.passkeys ?? 0) > 0);
}

/** A player's profile photo URL, or null (the app then draws their buddy face). */
export function avatarUrl(p: PlayerRecord | null | undefined): string | null {
  return p?.avatarV ? `/api/avatar/${p.avatarV}` : null;
}

export function toPublicPlayer(p: PlayerRecord, balanceZat = 0): Player {
  const via: ("email" | "google" | "passkey")[] = [];
  if (p.googleSub) via.push("google");
  if ((p.passkeys ?? 0) > 0) via.push("passkey");
  if (p.email && !p.googleSub) via.push("email");
  const i = tierFor(p.xp);
  const next = TIERS[i + 1];
  return {
    id: p.id,
    handle: p.handle,
    avatarUrl: avatarUrl(p),
    createdAt: p.createdAt,
    xp: p.xp,
    tier: TIERS[i].id,
    nextTier: next?.id,
    xpForNext: next?.xp,
    xpTierStart: TIERS[i].xp,
    stats: { ...p.stats, streak: liveStreak(p) },
    badges: p.badges,
    pendingClaims: p.pendingClaims,
    shielded: p.shielded,
    account: { signedIn: isAccount(p), email: p.email ? maskEmail(p.email) : undefined, via },
    dropAlerts: p.dropAlerts !== false,
    balanceZat: isAccount(p) ? balanceZat : 0,
  };
}

export function tierOf(p: PlayerRecord | null | undefined): TierId {
  return p ? TIERS[tierFor(p.xp)].id : "rookie";
}

export async function getPlayer(id: string): Promise<PlayerRecord | null> {
  return kv().get<PlayerRecord>(`player:${id}`);
}

export async function savePlayer(p: PlayerRecord) {
  await kv().set(`player:${p.id}`, p);
}

/** Change a few fields on the LATEST copy of a player (a request's copy may be stale: saving it whole
 *  would undo XP/stats written meanwhile, e.g. by going live). Mirrors the change onto `local` too. */
export async function patchPlayer(local: PlayerRecord, fn: (p: PlayerRecord) => void): Promise<PlayerRecord> {
  const fresh = (await getPlayer(local.id)) || local;
  fn(fresh);
  fn(local);
  await savePlayer(fresh);
  return fresh;
}

export async function claimHandle(handle: string, id: string) {
  return kv().set(`handle:${handle.toLowerCase()}`, id, { nx: true });
}

export const newPlayerId = () => `p_${newId()}${newId()}`; // always server-generated

export async function ensurePlayer(id?: string | null, newPid?: string): Promise<{ player: PlayerRecord; created: boolean }> {
  if (id) {
    const p = await getPlayer(id);
    if (p) return { player: p, created: false };
  }
  const pid = newPid || newPlayerId();
  let handle = "";
  for (let i = 0; i < 6; i++) {
    const r = () => Math.floor(Math.random() * 15);
    const h = `@${ADJ[r()]}${NOUN[r()]}${i ? Math.floor(Math.random() * 900 + 100) : ""}`;
    if (await claimHandle(h, pid)) {
      handle = h;
      break;
    }
  }
  if (!handle) handle = `@cracker${Math.floor(Math.random() * 1e6)}`;
  const p: PlayerRecord = {
    id: pid,
    handle,
    createdAt: nowIso(),
    xp: 0,
    stats: { cracked: 0, hidden: 0, uncrackable: 0, oracle: 0, streak: 0 },
    badges: [],
    pendingClaims: [],
    shielded: false,
  };
  await savePlayer(p);
  return { player: p, created: true };
}

export async function setHandle(p: PlayerRecord, raw: string): Promise<PlayerRecord> {
  const base = raw.trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{2,20}$/.test(base)) throw new Error("Handles are 2–20 letters, numbers or _");
  const handle = `@${base}`;
  if (handle.toLowerCase() === p.handle.toLowerCase()) return p;
  if (!(await claimHandle(handle, p.id))) throw new Error("That handle is taken");
  await kv().del(`handle:${p.handle.toLowerCase()}`);
  p.handle = handle;
  await savePlayer(p);
  return p;
}

const BIRTHDAY_START = Date.parse("2026-10-25T00:00:00Z");
const BIRTHDAY_END = Date.parse("2026-11-01T23:59:59Z");

/** Mark activity for streaks and the Birthday OG badge. Mutates p; caller saves. */
export function touchPlay(p: PlayerRecord): BadgeId[] {
  const unlocked: BadgeId[] = [];
  const today = new Date().toISOString().slice(0, 10);
  if (p.lastPlayedDay !== today) {
    const y = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    p.stats.streak = p.lastPlayedDay === y ? p.stats.streak + 1 : 1;
    p.lastPlayedDay = today;
  }
  const now = Date.now();
  if (now >= BIRTHDAY_START && now <= BIRTHDAY_END) unlocked.push(...grant(p, "birthday-og"));
  return unlocked;
}

export function grant(p: PlayerRecord, badge: BadgeId): BadgeId[] {
  if (p.badges.includes(badge)) return [];
  p.badges.push(badge);
  return [badge];
}

// ---------- leaderboards ----------
type Board = Leaderboard["board"];

/** The Monday 00:00:00 UTC that starts the ISO week holding `d`. */
function isoMonday(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t;
}

/** The board's week key for a date: `wk:<ISO year>-<ISO week>` (Monday-based, UTC). The weekly tournament ranks this key. */
export function weekKey(d = new Date()) {
  const t = isoMonday(d);
  t.setUTCDate(t.getUTCDate() + 3); // the Thursday decides the ISO year
  const week1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((t.getTime() - week1.getTime()) / 86400_000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `wk:${t.getUTCFullYear()}-${wk}`;
}

export interface WeekBounds {
  key: string; // e.g. "wk:2026-41"
  startsAt: string; // Monday 00:00:00.000Z
  endsAt: string; // the next Monday 00:00:00.000Z (exclusive: the week runs Mon 00:00:00 → Sun 23:59:59 UTC)
}

/** The week (Mon 00:00 UTC → next Mon 00:00 UTC) holding `d`, with its board key. */
export function weekBounds(d = new Date()): WeekBounds {
  const start = isoMonday(d);
  const end = new Date(start.getTime() + 7 * 86400_000);
  return { key: weekKey(start), startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** The week for a key ("wk:2026-41", "2026-41" or "2026-W41"), or null when it isn't one. */
export function weekBoundsForKey(raw: string): WeekBounds | null {
  const m = /^(?:wk:)?(\d{4})-W?(\d{1,2})$/i.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const wk = Number(m[2]);
  if (wk < 1 || wk > 53) return null;
  const monday1 = isoMonday(new Date(Date.UTC(year, 0, 4))); // ISO week 1 holds January 4th
  const b = weekBounds(new Date(monday1.getTime() + (wk - 1) * 7 * 86400_000));
  return b.key === `wk:${year}-${wk}` ? b : null;
}

function periodKeys(d = new Date()) {
  return { today: `day:${d.toISOString().slice(0, 10)}`, week: weekKey(d), all: "all" };
}

/** When a player got their latest crack of a week (epoch ms): the tournament's tie-break (earlier wins). */
export const lastCrackKey = (week: string, playerId: string) => `lb:last:${week}:${playerId}`;
const LAST_CRACK_TTL_S = 21 * 86400;

export async function bumpBoard(board: Board, playerId: string, by = 1) {
  const k = periodKeys();
  await Promise.all([
    kv().zincr(`lb:${board}:${k.today}`, playerId, by),
    kv().zincr(`lb:${board}:${k.week}`, playerId, by),
    kv().zincr(`lb:${board}:${k.all}`, playerId, by),
    board === "crackers" && by > 0 ? kv().set(lastCrackKey(k.week, playerId), Date.now(), { exSeconds: LAST_CRACK_TTL_S }) : Promise.resolve(true),
  ]);
}

export type ScoredRow = { member: string; score: number };

/** Orders a week's crackers the tournament way: most cracks first, ties to whoever got their LAST crack in
 *  first. Only tied neighbours cost a read (one pipelined round trip on ioredis). Returns a new array. */
export async function rankCrackersWeek(week: string, rows: ScoredRow[]): Promise<(ScoredRow & { lastAt?: number })[]> {
  const tied = new Set<string>();
  rows.forEach((r, i) => {
    if ((i > 0 && rows[i - 1].score === r.score) || (i < rows.length - 1 && rows[i + 1].score === r.score)) tied.add(r.member);
  });
  if (!tied.size) return rows.map((r) => ({ ...r }));
  const ids = [...tied];
  const times = await Promise.all(ids.map((id) => kv().get<number>(lastCrackKey(week, id))));
  const lastAt = new Map(ids.map((id, i) => [id, Number(times[i]) || Number.MAX_SAFE_INTEGER]));
  const never = Number.MAX_SAFE_INTEGER;
  return rows
    .map((r, i) => ({ ...r, lastAt: lastAt.get(r.member), i }))
    .sort((a, b) => b.score - a.score || (a.lastAt ?? never) - (b.lastAt ?? never) || a.i - b.i)
    .map(({ i: _i, ...r }) => r);
}

export async function leaderboard(board: Board, period: Leaderboard["period"], viewerId?: string): Promise<Leaderboard> {
  const k = periodKeys()[period];
  let rows = await kv().zrevrange(`lb:${board}:${k}`, 0, 499);
  // The crackers › week board is the weekly tournament: show it in prize order (ties broken within the top 50).
  if (board === "crackers" && period === "week" && rows.length > 1) rows = [...(await rankCrackersWeek(k, rows.slice(0, 50))), ...rows.slice(50)];
  const top = rows.slice(0, 50);
  const players = await Promise.all(top.map((r) => getPlayer(r.member)));
  const out: LeaderRow[] = top.map((r, i) => ({
    rank: i + 1,
    handle: players[i]?.handle || "@anon",
    avatarUrl: avatarUrl(players[i]),
    isHouse: players[i]?.house || undefined,
    tier: tierOf(players[i]),
    score: r.score,
    isYou: r.member === viewerId,
  }));
  let you: Leaderboard["you"];
  if (viewerId) {
    const idx = rows.findIndex((r) => r.member === viewerId);
    const me = await getPlayer(viewerId);
    if (me) {
      const wk = await kv().zrevrange(`lb:${board}:${periodKeys().week}`, 0, 499);
      const wkScore = wk.find((r) => r.member === viewerId)?.score || 0;
      you = {
        rank: idx >= 0 ? idx + 1 : rows.length + 1,
        handle: me.handle,
        avatarUrl: avatarUrl(me),
        tier: tierOf(me),
        score: idx >= 0 ? rows[idx].score : 0,
        isYou: true,
        deltaThisWeek: wkScore,
      };
    }
  }
  return { board, period, rows: out, you };
}
