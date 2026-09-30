// "Continue with Google": OAuth 2.0 authorization code flow with PKCE, bound to the browser's session.
// Turns on when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. The redirect URI to register in the
// Google console is <origin>/api/auth/google/callback.
import { createHash, randomBytes } from "node:crypto";
import { adoptGuest } from "./auth";
import { kv } from "./kv";
import { ensurePlayer, getPlayer, isAccount, savePlayer, type PlayerRecord } from "./players";
import { HttpError, newToken, nowIso } from "./util";

const STATE_TTL = 10 * 60;

export function googleEnabled() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(origin: string) {
  return `${process.env.GOOGLE_REDIRECT_ORIGIN || origin}/api/auth/google/callback`;
}

/** Returns the Google consent URL. `next` is an app path to land on afterwards. */
export async function googleStart(sid: string, origin: string, next: string) {
  if (!googleEnabled()) throw new HttpError(503, "Google sign-in isn't switched on yet");
  const state = newToken() + newToken();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await kv().set(`goog:${state}`, { sid, verifier, next, redirect: redirectUri(origin) }, { exSeconds: STATE_TTL });
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

type IdClaims = { iss: string; aud: string; sub: string; exp: number; email?: string; email_verified?: boolean; name?: string };

/** Completes the flow. Signs into the Google-linked account, links Google to a matching account, or upgrades the guest. */
export async function googleCallback(guest: PlayerRecord, sid: string, code: string, state: string) {
  const rec = await kv().get<{ sid: string; verifier: string; next: string; redirect: string }>(`goog:${state}`);
  await kv().del(`goog:${state}`);
  if (!rec || rec.sid !== sid) throw new HttpError(400, "That sign-in link expired. Try again");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: rec.redirect,
      grant_type: "authorization_code",
      code_verifier: rec.verifier,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) {
    console.error("google token", r.status, await r.text().catch(() => ""));
    throw new HttpError(502, "Google didn't let us in. Try again");
  }
  const { id_token } = (await r.json()) as { id_token?: string };
  // The ID token came straight from Google's token endpoint over TLS, so its claims can be trusted as-is
  // (Google's guidance); we still check who it was issued by and for.
  const claims = JSON.parse(Buffer.from((id_token || "").split(".")[1] || "", "base64url").toString("utf8") || "{}") as IdClaims;
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) || claims.aud !== process.env.GOOGLE_CLIENT_ID || claims.exp * 1000 < Date.now() || !claims.sub) {
    throw new HttpError(400, "Google sign-in didn't check out. Try again");
  }
  const email = claims.email_verified && claims.email ? claims.email.toLowerCase() : undefined;
  const next = rec.next;

  // 1) Google already linked to an account → sign into it.
  const linked = await kv().get<string>(`google:${claims.sub}`);
  if (linked) {
    const account = await getPlayer(linked);
    if (account) {
      adoptGuest(account, guest);
      await savePlayer(account);
      return { player: account, isNew: false, next };
    }
  }
  // 2) An account with this (Google-verified) email → link Google to it.
  const byEmail = email ? await kv().get<string>(`email:${email}`) : null;
  const target = byEmail ? await getPlayer(byEmail) : null;
  if (target) {
    target.googleSub = claims.sub;
    target.verifiedAt = target.verifiedAt || nowIso();
    adoptGuest(target, guest);
    await savePlayer(target);
    await kv().set(`google:${claims.sub}`, target.id);
    return { player: target, isNew: false, next };
  }
  // 3) Otherwise the current player becomes (or, if already an account without Google, gains) this Google login.
  let p = guest;
  if (isAccount(guest) && guest.googleSub) p = (await ensurePlayer(null)).player; // signed into a different Google account
  const isNew = !isAccount(p);
  p.googleSub = claims.sub;
  if (email && !p.email) {
    p.email = email;
    await kv().set(`email:${email}`, p.id);
  }
  p.verifiedAt = p.verifiedAt || nowIso();
  await savePlayer(p);
  await kv().set(`google:${claims.sub}`, p.id);
  return { player: p, isNew, next };
}
