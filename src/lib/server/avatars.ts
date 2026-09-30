// Profile photos. Accounts upload a small square JPEG (cropped on the phone). The bytes live in KV under
// a fresh key per upload, so the public URL never shows a player id and can be cached forever: a new
// photo (or a removed one) just means a different URL, or none.
import { createHash } from "node:crypto";
import { kv } from "./kv";
import { getPlayer, isAccount, patchPlayer, type PlayerRecord } from "./players";
import { playerIdByHandle } from "./social";
import { HttpError } from "./util";

export const AVATAR_MAX_BYTES = 200 * 1024;
const UPLOADS_PER_HOUR = 10;
const KEY_RE = /^[A-Za-z0-9_-]{8,40}$/;

type StoredAvatar = { type: string; b64: string; pid: string; at: string };
const imgKey = (v: string) => `avatar:${v}`;

/** JPEG, PNG or WebP, by their first bytes (the upload's content-type header is never trusted). */
export function sniffImage(b: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return "image/png";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Read a request body, giving up as soon as it passes `max` bytes (so a huge upload never sits in memory). */
export async function readCapped(stream: ReadableStream<Uint8Array> | null, declared: string | null, max = AVATAR_MAX_BYTES): Promise<Uint8Array> {
  const tooBig = () => new HttpError(413, "That photo is too big. Try a smaller one");
  if (declared && Number(declared) > max) throw tooBig();
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Save a new photo for an account and drop the old one. Returns the updated player. */
export async function setAvatar(p: PlayerRecord, bytes: Uint8Array): Promise<PlayerRecord> {
  if (!isAccount(p)) throw new HttpError(403, "Sign up to add a profile photo");
  const hour = Math.floor(Date.now() / 3600_000);
  const rl = `avatar-rl:${p.id}:${hour}`;
  const n = await kv().incr(rl);
  if (n === 1) await kv().set(rl, 1, { exSeconds: 7200 }); // first upload this hour: give the counter a TTL
  if (n > UPLOADS_PER_HOUR) throw new HttpError(429, "That’s a lot of new photos! Try again in an hour");
  if (!bytes.byteLength) throw new HttpError(400, "That photo didn’t come through. Try again");
  if (bytes.byteLength > AVATAR_MAX_BYTES) throw new HttpError(413, "That photo is too big. Try a smaller one");
  const type = sniffImage(bytes);
  if (!type) throw new HttpError(415, "That file isn’t a photo we can use. Try a JPEG or PNG");

  // One save at a time per player, so two racing uploads can't leave an orphaned photo behind.
  const lock = `avatar-lock:${p.id}`;
  if (!(await kv().set(lock, 1, { nx: true, exSeconds: 10 }))) throw new HttpError(409, "Hold on, still saving your last photo");
  try {
    // A short key from the player and the bytes: unguessable, and it changes whenever the photo does.
    const v = createHash("sha256").update(p.id).update(bytes).digest("base64url").slice(0, 16);
    const stored: StoredAvatar = { type, b64: Buffer.from(bytes).toString("base64"), pid: p.id, at: new Date().toISOString() };
    await kv().set(imgKey(v), stored);
    let old: string | undefined;
    const fresh = await patchPlayer(p, (x) => {
      old = x.avatarV;
      x.avatarV = v;
    });
    if (old && old !== v) await kv().del(imgKey(old));
    return fresh;
  } finally {
    await kv().del(lock);
  }
}

/** Remove a player's photo (they're back to their buddy face). */
export async function removeAvatar(p: PlayerRecord): Promise<PlayerRecord> {
  let old: string | undefined;
  const fresh = await patchPlayer(p, (x) => {
    old = x.avatarV;
    delete x.avatarV;
  });
  if (old) await kv().del(imgKey(old));
  return fresh;
}

/** Owner moderation: take down a player's photo by handle. */
export async function adminRemoveAvatar(handle: string) {
  const pid = await playerIdByHandle(handle);
  const p = pid ? await getPlayer(pid) : null;
  if (!p) throw new HttpError(404, "No player with that name");
  const had = !!p.avatarV;
  await removeAvatar(p);
  return { handle: p.handle, removed: had };
}

/** GET /api/avatar/<key>: the photo bytes, cached forever (a new photo gets a new key). */
export async function serveAvatar(v: string): Promise<Response> {
  const hit = KEY_RE.test(v) ? await kv().get<StoredAvatar>(imgKey(v)) : null;
  if (!hit?.b64) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const bytes = Buffer.from(hit.b64, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": hit.type,
      "content-length": String(bytes.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
