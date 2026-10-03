// Web push: phone/desktop notifications when the app is closed ("your stash got ZECKED").
// Subscriptions are stored per player (a few devices each). Needs NEXT_PUBLIC_VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY and VAPID_SUBJECT; without them every call is a quiet no-op.
import webpush, { type PushSubscription } from "web-push";
import { kv } from "./kv";
import { HttpError } from "./util";

const KEY = (pid: string) => `push:${pid}`;
const MAX_DEVICES = 6;
let configured: boolean | null = null;

export function pushConfigured() {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (configured = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://zecked.com", pub, priv);
  return (configured = true);
}

function validSub(raw: unknown): PushSubscription {
  const s = raw as PushSubscription;
  if (!s || typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) {
    throw new HttpError(400, "That notification subscription doesn't look right");
  }
  return { endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) } };
}

export async function savePushSub(pid: string, raw: unknown) {
  const sub = validSub(raw);
  const subs = ((await kv().get<PushSubscription[]>(KEY(pid))) || []).filter((x) => x.endpoint !== sub.endpoint);
  subs.push(sub);
  await kv().set(KEY(pid), subs.slice(-MAX_DEVICES));
  return { ok: true, devices: Math.min(subs.length, MAX_DEVICES) };
}

export async function removePushSub(pid: string, endpoint: string) {
  const subs = ((await kv().get<PushSubscription[]>(KEY(pid))) || []).filter((x) => x.endpoint !== endpoint);
  await kv().set(KEY(pid), subs);
  return { ok: true };
}

export type PushPayload = { title: string; body: string; url: string; tag?: string };

/** Best effort: sends to every device of this player, forgets the ones the push service says are gone. */
export async function sendPush(pid: string, payload: PushPayload) {
  if (!pushConfigured()) return;
  const subs = (await kv().get<PushSubscription[]>(KEY(pid))) || [];
  if (!subs.length) return;
  const gone: string[] = [];
  await Promise.all(
    subs.map((s) =>
      webpush
        .sendNotification(s, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high", timeout: 6000 })
        .catch((e: { statusCode?: number }) => {
          if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(s.endpoint);
          else console.error("push failed", e?.statusCode ?? (e as Error)?.message);
        }),
    ),
  );
  if (gone.length) await kv().set(KEY(pid), subs.filter((s) => !gone.includes(s.endpoint)));
}
