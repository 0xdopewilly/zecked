// Per-player notices ("your stash got ZECKED", "your ZEC came back", "ZEC landed"). The app polls
// /api/notifications and shows each new one as a toast with a sound, wherever the player is.
import type { Notice } from "@/lib/types";
import { kv } from "./kv";
import { newId, nowIso } from "./util";

const KEY = (pid: string) => `notif:${pid}`;

export async function notify(pid: string, n: Omit<Notice, "id" | "at">) {
  await kv().lpushTrim(KEY(pid), { ...n, id: newId(), at: nowIso() } satisfies Notice, 30);
}

/** Newest first. `after` (ISO) returns only newer notices. */
export async function notices(pid: string, after?: string | null): Promise<Notice[]> {
  const all = await kv().lrange<Notice>(KEY(pid), 0, 29);
  const t = after ? Date.parse(after) : NaN;
  return Number.isFinite(t) ? all.filter((n) => Date.parse(n.at) > t) : all;
}
