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
  email?: string; // verified email = signed-in account
  verifiedAt?: string;
  depositAddress?: string; // personal in-app wallet address
  depositUri?: string;
  mergedGuests?: string[];
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

export function toPublicPlayer(p: PlayerRecord, balanceZat = 0): Player {
  const i = tierFor(p.xp);
  const next = TIERS[i + 1];
  return {
    id: p.id,
    handle: p.handle,
    createdAt: p.createdAt,
    xp: p.xp,
    tier: TIERS[i].id,
    nextTier: next?.id,
    xpForNext: next?.xp,
    xpTierStart: TIERS[i].xp,
    stats: p.stats,
    badges: p.badges,
    pendingClaims: p.pendingClaims,
    shielded: p.shielded,
    account: { signedIn: !!p.email, email: p.email ? maskEmail(p.email) : undefined },
    balanceZat: p.email ? balanceZat : 0,
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

async function claimHandle(handle: string, id: string) {
  return kv().set(`handle:${handle.toLowerCase()}`, id, { nx: true });
}

export async function ensurePlayer(id?: string | null): Promise<{ player: PlayerRecord; created: boolean }> {
  if (id) {
    const p = await getPlayer(id);
    if (p) return { player: p, created: false };
  }
  const pid = `p_${newId()}${newId()}`; // always server-generated
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
function periodKeys() {
  const d = new Date();
  const day = d.toISOString().slice(0, 10);
  // ISO-ish week key: year + week number (Mon-based)
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const week1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((t.getTime() - week1.getTime()) / 86400_000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return { today: `day:${day}`, week: `wk:${t.getUTCFullYear()}-${wk}`, all: "all" };
}

export async function bumpBoard(board: Board, playerId: string, by = 1) {
  const k = periodKeys();
  await Promise.all([
    kv().zincr(`lb:${board}:${k.today}`, playerId, by),
    kv().zincr(`lb:${board}:${k.week}`, playerId, by),
    kv().zincr(`lb:${board}:${k.all}`, playerId, by),
  ]);
}

export async function leaderboard(board: Board, period: Leaderboard["period"], viewerId?: string): Promise<Leaderboard> {
  const k = periodKeys()[period];
  const rows = await kv().zrevrange(`lb:${board}:${k}`, 0, 499);
  const top = rows.slice(0, 50);
  const players = await Promise.all(top.map((r) => getPlayer(r.member)));
  const out: LeaderRow[] = top.map((r, i) => ({
    rank: i + 1,
    handle: players[i]?.handle || "@anon",
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
        tier: tierOf(me),
        score: idx >= 0 ? rows[idx].score : 0,
        isYou: true,
        deltaThisWeek: wkScore,
      };
    }
  }
  return { board, period, rows: out, you };
}
