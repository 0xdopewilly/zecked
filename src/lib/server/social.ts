// Social layer: emoji reactions on stashes, and public player profiles.
import { REACTIONS, type PublicProfile, type Reaction } from "@/lib/types";
import { kv } from "./kv";
import { getPlayer, isAccount, toPublicPlayer, type PlayerRecord } from "./players";
import { HttpError } from "./util";

// ---------- reactions ----------
const counterKey = (id: string, e: string) => `rx:${id}:${e}`;
const sumKey = (id: string) => `rxs:${id}`;
const mineKey = (id: string, pid: string) => `rxu:${id}:${pid}`;

export async function reactionCounts(stashId: string): Promise<Partial<Record<Reaction, number>> | undefined> {
  return (await kv().get<Partial<Record<Reaction, number>>>(sumKey(stashId))) || undefined;
}

export async function myReactions(stashId: string, pid: string): Promise<Reaction[]> {
  return (await kv().get<Reaction[]>(mineKey(stashId, pid))) || [];
}

/** Toggle one emoji for this player. Counters are atomic; the summary is rebuilt from them. */
export async function toggleReaction(stash: { id: string; status: string }, p: PlayerRecord, raw: string) {
  const emoji = REACTIONS.find((r) => r === raw);
  if (!emoji) throw new HttpError(400, "That reaction isn't on the menu");
  if (stash.status === "awaiting_funding" || stash.status === "void") throw new HttpError(400, "This stash isn't open yet");
  const minute = Math.floor(Date.now() / 60_000);
  const rl = `rx:rl:${p.id}:${minute}`;
  const n = await kv().incr(rl);
  if (n === 1) await kv().set(rl, 1, { exSeconds: 120 }); // first tap this minute: give the counter a TTL
  if (n > 40) throw new HttpError(429, "Easy there! Too many reactions");
  // One toggle at a time per player per stash, so two racing taps can't both count.
  const lock = `rx:lock:${stash.id}:${p.id}`;
  if (!(await kv().set(lock, 1, { nx: true, exSeconds: 5 }))) throw new HttpError(409, "Hold on, still saving your last reaction");
  let nextMine: Reaction[];
  try {
    const mine = await myReactions(stash.id, p.id);
    const on = !mine.includes(emoji);
    await kv().incr(counterKey(stash.id, emoji), on ? 1 : -1);
    nextMine = on ? [...mine, emoji] : mine.filter((e) => e !== emoji);
    await kv().set(mineKey(stash.id, p.id), nextMine, { exSeconds: 90 * 86400 });
  } finally {
    await kv().del(lock);
  }
  const counts = await Promise.all(REACTIONS.map(async (e) => [e, Math.max(0, (await kv().get<number>(counterKey(stash.id, e))) || 0)] as const));
  const summary = Object.fromEntries(counts.filter(([, n]) => n > 0)) as Partial<Record<Reaction, number>>;
  await kv().set(sumKey(stash.id), summary);
  return { reactions: summary, mine: nextMine };
}

// ---------- public profiles ----------
export async function playerIdByHandle(raw: string): Promise<string | null> {
  const base = decodeURIComponent(raw || "").trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{2,24}$/.test(base)) return null;
  return kv().get<string>(`handle:@${base.toLowerCase()}`);
}

export async function publicProfile(
  raw: string,
  viewerId: string,
  hiddenBy: (pid: string, viewerId: string) => Promise<PublicProfile["stashes"]>,
): Promise<PublicProfile> {
  const pid = await playerIdByHandle(raw);
  const p = pid ? await getPlayer(pid) : null;
  if (!p) throw new HttpError(404, "No player with that name");
  const pub = toPublicPlayer(p, 0);
  return {
    handle: pub.handle,
    avatarUrl: pub.avatarUrl,
    tier: pub.tier,
    nextTier: pub.nextTier,
    xp: pub.xp,
    xpForNext: pub.xpForNext,
    xpTierStart: pub.xpTierStart,
    stats: pub.stats,
    badges: pub.badges,
    createdAt: pub.createdAt,
    isYou: p.id === viewerId,
    isHouse: !!p.house,
    stashes: isAccount(p) ? await hiddenBy(p.id, viewerId) : [],
  };
}
