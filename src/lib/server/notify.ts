// Per-player notices ("your stash got ZECKED", "your ZEC came back", "ZEC landed"). The app polls
// /api/notifications and shows each new one as a toast with a sound, wherever the player is.
import { after } from "next/server";
import type { Notice } from "@/lib/types";
import { kv } from "./kv";
import { sendPush } from "./push";
import { newId, nowIso } from "./util";

const TITLE: Record<Notice["kind"], string> = {
  zecked: "Your stash got ZECKED 🔓",
  refunded: "Your ZEC came back 🎁",
  deposit: "ZEC landed 🪙",
  win: "You zecked it! 🏆",
  invite: "Your invite worked 🎉",
};

const KEY = (pid: string) => `notif:${pid}`;

/** Saves the notice (the app shows it as a toast) and pings the player's devices (push, app closed). */
export async function notify(pid: string, n: Omit<Notice, "id" | "at">) {
  await kv().lpushTrim(KEY(pid), { ...n, id: newId(), at: nowIso() } satisfies Notice, 30);
  const url = n.kind === "deposit" ? "/wallet" : n.stashId ? `/s/${n.stashId}` : "/me";
  const push = () => sendPush(pid, { title: TITLE[n.kind], body: n.text, url, tag: n.stashId ? `stash-${n.stashId}` : n.kind }).catch(() => {});
  // After the response goes out, so e.g. the winner's guess never waits on the hider's phone.
  try {
    after(push);
  } catch {
    void push(); // outside a request (scripts)
  }
}

/** Newest first. `after` (ISO) returns only newer notices. */
export async function notices(pid: string, after?: string | null): Promise<Notice[]> {
  const all = await kv().lrange<Notice>(KEY(pid), 0, 29);
  const t = after ? Date.parse(after) : NaN;
  return Number.isFinite(t) ? all.filter((n) => Date.parse(n.at) > t) : all;
}
