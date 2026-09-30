// Sessions + email-code sign-in (Google and passkeys live in google.ts and passkeys.ts). No passwords:
// the first sign-in creates the account, and the guest's progress (XP, badges, pending wins) carries over.
import type { AuthStartResult } from "@/lib/types";
import { networkName } from "@/lib/zcash/engine";
import { kv } from "./kv";
import { ensurePlayer, getPlayer, isAccount, newPlayerId, savePlayer, type PlayerRecord } from "./players";
import { HttpError, newToken, nowIso, sha256 } from "./util";

const SESSION_TTL = 180 * 86400; // seconds
const CODE_TTL = 10 * 60;
const MAX_VERIFY_ATTEMPTS = 6;
const SECRET = process.env.ZECKED_SECRET || "zecked-dev-secret-change-me";

// ---------- sessions ----------
/** Session ids the proxy hands to new browsers (see src/proxy.ts). */
const PROXY_SID = /^[A-Za-z0-9_-]{32,64}$/;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sessionPlayer(sid: string | undefined, legacyPid: string | undefined) {
  if (sid) {
    const s = await kv().get<{ pid: string }>(`sess:${sid}`);
    if (s) {
      const p = await getPlayer(s.pid);
      if (p) return { player: p, sid, fresh: false };
    }
    // A new browser whose cookie the proxy just set: bind it to ONE new guest, even when the page's
    // first requests race each other (otherwise each would mint its own guest and cookie).
    if (!s && PROXY_SID.test(sid)) {
      const pid = newPlayerId();
      if (await kv().set(`sess:${sid}`, { pid, at: nowIso() }, { nx: true, exSeconds: SESSION_TTL })) {
        const { player } = await ensurePlayer(null, pid);
        return { player, sid, fresh: false };
      }
      for (let i = 0; i < 20; i++) {
        const won = await kv().get<{ pid: string }>(`sess:${sid}`);
        const p = won && (await getPlayer(won.pid));
        if (p) return { player: p, sid, fresh: false };
        await pause(50);
      }
    }
  }
  // New visitor, or a legacy v0.1 pid cookie. Legacy cookies may only resume an existing GUEST profile,
  // never a signed-in account (a pid alone must not grant access to an account).
  let resume: string | null = null;
  if (legacyPid) {
    const legacy = await getPlayer(legacyPid);
    if (legacy && !isAccount(legacy)) resume = legacy.id;
  }
  const { player } = await ensurePlayer(resume);
  const nsid = await createSession(player.id);
  return { player, sid: nsid, fresh: true };
}

/** Cheap check for server components: is this session a signed-in account? */
export async function sessionIsAccount(sid: string | undefined) {
  if (!sid) return false;
  const s = await kv().get<{ pid: string }>(`sess:${sid}`);
  return !!s && isAccount(await getPlayer(s.pid));
}

export async function createSession(pid: string) {
  const sid = newToken() + newToken();
  await kv().set(`sess:${sid}`, { pid, at: nowIso() }, { exSeconds: SESSION_TTL });
  return sid;
}

export async function destroySession(sid: string | undefined) {
  if (sid) await kv().del(`sess:${sid}`);
}

// ---------- email codes ----------
export function normalizeEmail(raw: string) {
  const e = (raw || "").trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(e)) throw new HttpError(400, "That email doesn't look right");
  return e;
}
export function maskEmail(e: string) {
  const [u, d] = e.split("@");
  return `${u.slice(0, 2)}${"*".repeat(Math.max(1, Math.min(3, u.length - 2)))}@${d}`;
}

async function rateLimit(key: string, max: number, windowSec: number) {
  const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const n = ((await kv().get<number>(k)) || 0) + 1;
  await kv().set(k, n, { exSeconds: windowSec + 5 });
  if (n > max) throw new HttpError(429, "Slow down a sec. Too many codes. Try again in a few minutes");
}

/** Email codes need a real sender (Resend + a verified domain). Local sim mode shows the code instead. */
export function emailSignInAvailable() {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) || networkName() === "sim";
}

async function sendEmail(to: string, code: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM; // e.g. "ZECKED <hello@zecked.com>"
  if (!key || !from) return false;
  const html = `<div style="font-family:Inter,Arial,sans-serif;background:#0E0B1F;color:#fff;padding:32px;border-radius:24px;max-width:440px;margin:auto">
  <div style="font-size:28px;font-weight:900;letter-spacing:-.5px"><span style="color:#F4B728">Z</span>ECKED</div>
  <p style="color:#A9A3C9;font-size:15px;margin:18px 0 8px">Your sign-in code</p>
  <div style="font-family:'Space Mono',monospace;font-size:40px;font-weight:700;letter-spacing:10px;color:#F4B728">${code}</div>
  <p style="color:#A9A3C9;font-size:13px;margin-top:18px">It expires in 10 minutes. If you didn't ask for it, ignore this email.</p>
  <p style="color:#6E6892;font-size:12px;margin-top:22px">Hide it. Crack it. Get Zecked. · Built on Zcash</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject: `${code} is your ZECKED code`, html, text: `Your ZECKED code: ${code} (expires in 10 minutes)` }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) {
    console.error("resend failed", r.status, await r.text().catch(() => ""));
    throw new HttpError(502, "Couldn't send the email right now. Try again in a minute");
  }
  return true;
}

export async function startEmailSignIn(rawEmail: string, ip: string): Promise<AuthStartResult> {
  if (!emailSignInAvailable()) throw new HttpError(503, "Email sign-in is coming soon. Use Google or a passkey for now");
  const email = normalizeEmail(rawEmail);
  await rateLimit(`code:${email}`, 5, 3600);
  await rateLimit(`ip:${ip}`, 25, 3600);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + CODE_TTL * 1000).toISOString();
  await kv().set(`code:${email}`, { hash: sha256(`${SECRET}:${email}:${code}`), attempts: 0, expiresAt }, { exSeconds: CODE_TTL });
  const sent = await sendEmail(email, code);
  // Only local sim mode may show the code on screen: on a real deployment that would let anyone into any account.
  if (!sent) return { sentTo: maskEmail(email), expiresAt, devCode: code };
  return { sentTo: maskEmail(email), expiresAt };
}

/** Verifies the code. Returns the account player (the current guest upgraded, or an existing account merged with the guest). */
export async function verifyEmailSignIn(rawEmail: string, code: string, guest: PlayerRecord): Promise<{ player: PlayerRecord; isNew: boolean }> {
  const email = normalizeEmail(rawEmail);
  const rec = await kv().get<{ hash: string; attempts: number; expiresAt: string }>(`code:${email}`);
  if (!rec || Date.parse(rec.expiresAt) < Date.now()) throw new HttpError(400, "That code expired. Send a new one");
  if (rec.attempts >= MAX_VERIFY_ATTEMPTS) throw new HttpError(429, "Too many tries. Send a new code");
  if (sha256(`${SECRET}:${email}:${(code || "").trim()}`) !== rec.hash) {
    rec.attempts += 1;
    await kv().set(`code:${email}`, rec, { exSeconds: Math.max(1, Math.round((Date.parse(rec.expiresAt) - Date.now()) / 1000)) });
    throw new HttpError(400, "Wrong code. Check the email and try again");
  }
  await kv().del(`code:${email}`);

  const existingId = await kv().get<string>(`email:${email}`);
  if (existingId && existingId !== guest.id) {
    const account = await getPlayer(existingId);
    if (account) {
      adoptGuest(account, guest);
      await savePlayer(account);
      return { player: account, isNew: false };
    }
  }
  if (guest.email && guest.email !== email) {
    // Signed-in user verifying a different email: treat as a new, separate account.
    const { player } = await ensurePlayer(null);
    player.email = email;
    player.verifiedAt = nowIso();
    await kv().set(`email:${email}`, player.id);
    await savePlayer(player);
    return { player, isNew: true };
  }
  // A guest becomes an account; a passkey-only account just gains an email.
  const isNew = !isAccount(guest);
  guest.email = email;
  guest.verifiedAt = guest.verifiedAt || nowIso();
  await kv().set(`email:${email}`, guest.id);
  await savePlayer(guest);
  return { player: guest, isNew };
}

/** Signing into an existing account from a guest session: the guest's XP, badges and pending wins come along. */
export function adoptGuest(account: PlayerRecord, guest: PlayerRecord) {
  if (account.id !== guest.id && !isAccount(guest)) mergeGuestInto(account, guest);
}

function mergeGuestInto(account: PlayerRecord, guest: PlayerRecord) {
  account.xp += guest.xp;
  for (const k of Object.keys(account.stats) as (keyof PlayerRecord["stats"])[]) {
    if (k !== "streak") account.stats[k] += guest.stats[k];
  }
  account.stats.streak = Math.max(account.stats.streak, guest.stats.streak);
  for (const b of guest.badges) if (!account.badges.includes(b)) account.badges.push(b);
  account.mergedGuests = [...(account.mergedGuests || []), guest.id];
  for (const s of guest.pendingClaims) if (!account.pendingClaims.includes(s)) account.pendingClaims.push(s);
}
