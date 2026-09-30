// Single API entrypoint (one serverless function → one warm memory store in demo mode).
import { NextRequest, NextResponse, after } from "next/server";
import {
  appConfig,
  checkFunding,
  claim,
  createStash,
  feed,
  guess,
  loadStash,
  makeCall,
  myStashes,
  creditPendingClaims,
  publicStats,
  fundFromBalance,
  hiddenBy,
  setRefundAddress,
  setVictoryMessage,
  simulateFund,
  stashDetail,
  ticker,
  toPublic,
} from "@/lib/server/game";
import { isAccount, leaderboard, setHandle, toPublicPlayer, type PlayerRecord } from "@/lib/server/players";
import { createSession, destroySession, sessionPlayer, startEmailSignIn, verifyEmailSignIn } from "@/lib/server/auth";
import { googleCallback, googleStart } from "@/lib/server/google";
import { passkeyLoginOptions, passkeyLoginVerify, passkeyRegisterOptions, passkeyRegisterVerify, relyingParty } from "@/lib/server/passkeys";
import { SIM_WELCOME_BONUS_ZAT, balanceOf, credit, simulateDeposit, walletInfo, withdraw } from "@/lib/server/wallet";
import { ensureSeeded } from "@/lib/server/seed";
import { upcomingMatches } from "@/lib/server/sports";
import { kv, withKvStats } from "@/lib/server/kv";
import { notices } from "@/lib/server/notify";
import { publicProfile, toggleReaction } from "@/lib/server/social";
import { removePushSub, savePushSub } from "@/lib/server/push";
import { houseAdmin, houseStatus, houseTopUpSim, maybeHouseDrop, welcomeGift } from "@/lib/server/house";
import { adminRemoveAvatar, readCapped, removeAvatar, serveAvatar, setAvatar } from "@/lib/server/avatars";
import { HttpError } from "@/lib/server/util";
import { networkName } from "@/lib/zcash/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SID = "zk_sid";
const LEGACY_PID = "zk_pid";
const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 };

type Ctx = { params: Promise<{ path: string[] }> };

async function withPlayer(req: NextRequest) {
  const { player, sid, fresh } = await sessionPlayer(req.cookies.get(SID)?.value, req.cookies.get(LEGACY_PID)?.value);
  return { player, sid, setCookie: fresh };
}

function json(data: unknown, init: { status?: number; sid?: string; setCookie?: boolean; clearLegacy?: boolean } = {}) {
  const res = NextResponse.json(data, { status: init.status ?? 200, headers: { "cache-control": "no-store" } });
  if (init.sid && init.setCookie) {
    res.cookies.set(SID, init.sid, COOKIE_OPTS);
    res.cookies.set(LEGACY_PID, "", { path: "/", maxAge: 0 });
  }
  return res;
}

async function pub(p: PlayerRecord) {
  return toPublicPlayer(p, isAccount(p) ? await balanceOf(p.id) : 0);
}

/** The owner's admin token (ZECKED_ADMIN_TOKEN), as a header or ?token=. Unset → no admin at all. */
function isOwner(req: NextRequest) {
  const token = process.env.ZECKED_ADMIN_TOKEN;
  const given = req.headers.get("x-admin-token") || req.nextUrl.searchParams.get("token");
  return !!token && given === token;
}

/** Same-origin app paths only (never `//host` or `javascript:`). */
function safePath(raw: string | null | undefined) {
  const v = (raw || "").trim();
  return v.startsWith("/") && !v.startsWith("//") && !/[\\\u0000-\u001f]/.test(v) ? v : "/feed";
}

/** Every sign-in method ends here: first-account perks, pending wins credited, and a fresh session. */
async function finishSignIn(account: PlayerRecord, isNew: boolean, oldSid: string, ip: string) {
  let gift = 0;
  if (isNew) await kv().incr("stats:accounts");
  if (isNew && networkName() === "sim" && process.env.ZECKED_HOUSE !== "on") await credit(account.id, (gift = SIM_WELCOME_BONUS_ZAT), "bonus", "Test-mode welcome bonus 🎁");
  else if (isNew) gift = await welcomeGift(account, ip).catch(() => 0);
  const creditedZat = (await creditPendingClaims(account)) + gift;
  await destroySession(oldSid);
  const sid = await createSession(account.id);
  return { creditedZat, sid };
}

async function body<T>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const [a, b, c] = path;
  const method = req.method;
  try {
    // Profile photos: immutable bytes, no session or player work at all.
    if (a === "avatar" && b && !c && method === "GET") return await serveAvatar(b);
    await ensureSeeded();
    // Public, cookie-less reads never create a guest profile (website stats, crawlers, link previews).
    const hasSession = !!(req.cookies.get(SID)?.value || req.cookies.get(LEGACY_PID)?.value);
    if (method === "GET" && !hasSession) {
      if (a === "health") return json({ ok: true, network: networkName() });
      if (a === "config") return json(await appConfig());
      if (a === "ticker") return json({ items: await ticker() });
      if (a === "matches") return json({ matches: await upcomingMatches(5, networkName() === "sim") });
      if (a === "stats") {
        const res = json(await publicStats());
        res.headers.set("access-control-allow-origin", "*");
        res.headers.set("cache-control", "public, s-maxage=30, stale-while-revalidate=120");
        return res;
      }
    }
    const { player, sid, setCookie } = await withPlayer(req);
    const out = (data: unknown, status = 200) => json(data, { status, sid, setCookie });
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";

    // ---- accounts ----
    if (a === "auth" && b === "email" && c === "start" && method === "POST") {
      const { email } = await body<{ email: string }>(req);
      return out(await startEmailSignIn(email, ip));
    }
    if (a === "auth" && b === "email" && c === "verify" && method === "POST") {
      const { email, code } = await body<{ email: string; code: string }>(req);
      const { player: account, isNew } = await verifyEmailSignIn(email, code, player);
      const done = await finishSignIn(account, isNew, sid, ip);
      return json({ player: await pub(account), creditedZat: done.creditedZat, isNew }, { sid: done.sid, setCookie: true });
    }

    // Passkeys: /auth/passkey/{register|login}/{options|verify}
    if (a === "auth" && b === "passkey" && method === "POST") {
      const step = path[3];
      const rp = relyingParty(req);
      if (c === "register" && step === "options") return out(await passkeyRegisterOptions(player, sid, rp));
      if (c === "login" && step === "options") return out(await passkeyLoginOptions(sid, rp));
      if ((c === "register" || c === "login") && step === "verify") {
        const { response } = await body<{ response: never }>(req);
        const { player: account, isNew } =
          c === "register" ? await passkeyRegisterVerify(player, sid, rp, response) : await passkeyLoginVerify(player, sid, rp, response);
        const done = await finishSignIn(account, isNew, sid, ip);
        return json({ player: await pub(account), creditedZat: done.creditedZat, isNew }, { sid: done.sid, setCookie: true });
      }
    }

    // Google: /auth/google/start → Google → /auth/google/callback → /signin?welcome=google
    if (a === "auth" && b === "google" && method === "GET") {
      const withCookie = (res: NextResponse, s: string, set: boolean) => {
        if (set) res.cookies.set(SID, s, COOKIE_OPTS);
        return res;
      };
      if (c === "start") {
        const url = await googleStart(sid, relyingParty(req).origin, safePath(req.nextUrl.searchParams.get("next")));
        return withCookie(NextResponse.redirect(url, 302), sid, setCookie);
      }
      if (c === "callback") {
        const q = req.nextUrl.searchParams;
        const back = (params: Record<string, string>) => new URL(`/signin?${new URLSearchParams(params)}`, req.url);
        if (q.get("error") || !q.get("code") || !q.get("state")) {
          return withCookie(NextResponse.redirect(back({ error: "Google sign-in was cancelled" }), 302), sid, setCookie);
        }
        try {
          const { player: account, isNew, next } = await googleCallback(player, sid, q.get("code")!, q.get("state")!);
          const done = await finishSignIn(account, isNew, sid, ip);
          const to = back({ welcome: isNew ? "new" : "back", next, ...(done.creditedZat ? { c: String(done.creditedZat) } : {}) });
          return withCookie(NextResponse.redirect(to, 302), done.sid, true);
        } catch (e) {
          const msg = e instanceof HttpError ? e.message : "Google sign-in failed. Try again";
          return withCookie(NextResponse.redirect(back({ error: msg }), 302), sid, setCookie);
        }
      }
    }
    if (a === "auth" && b === "logout" && method === "POST") {
      await destroySession(sid);
      const res = json({ ok: true });
      res.cookies.set(SID, "", { path: "/", maxAge: 0 });
      return res;
    }

    // ---- owner: the house account (top-up address, balance, force a drop) ----
    if (a === "admin" && b === "house") {
      if (!isOwner(req)) return json({ error: "Not found" }, { status: 404 });
      if (!c && method === "GET") return json(await houseAdmin());
      if (c === "drop" && method === "POST") {
        const s = await maybeHouseDrop(true);
        return json({ dropped: s ? s.id : null });
      }
      if (c === "topup" && method === "POST" && networkName() === "sim") {
        return json({ balanceZat: await houseTopUpSim(Number(req.nextUrl.searchParams.get("zat") || 10_000_000)) });
      }
    }

    // ---- owner: take down a player's profile photo ----
    if (a === "admin" && b === "avatar") {
      if (!isOwner(req)) return json({ error: "Not found" }, { status: 404 });
      if (c === "remove" && method === "POST") {
        const { handle: h } = await body<{ handle: string }>(req);
        return json(await adminRemoveAvatar(String(h || "")));
      }
    }

    // ---- push notifications ----
    if (a === "push" && b === "subscribe" && method === "POST") {
      const { subscription } = await body<{ subscription: unknown }>(req);
      return out(await savePushSub(player.id, subscription));
    }
    if (a === "push" && b === "unsubscribe" && method === "POST") {
      const { endpoint } = await body<{ endpoint: string }>(req);
      return out(await removePushSub(player.id, String(endpoint || "")));
    }

    // ---- public profiles ----
    if (a === "players" && b && !c && method === "GET") return out({ profile: await publicProfile(b, player.id, hiddenBy) });

    // ---- notices ----
    if (a === "notifications" && method === "GET") {
      return out({ items: await notices(player.id, req.nextUrl.searchParams.get("after")), now: new Date().toISOString() });
    }

    // ---- wallet ----
    if (a === "wallet" && !b && method === "GET") return out(await walletInfo(player));
    if (a === "wallet" && b === "simulate-deposit" && method === "POST") {
      const { amountZat } = await body<{ amountZat?: number }>(req);
      return out(await simulateDeposit(player, amountZat));
    }
    if (a === "wallet" && b === "withdraw" && method === "POST") {
      const { address, amountZat } = await body<{ address: string; amountZat: number }>(req);
      return out(await withdraw(player, address, amountZat));
    }

    if (a === "config" && method === "GET") return out(await appConfig());
    if (a === "stats" && method === "GET") {
      const res = json(await publicStats());
      res.headers.set("access-control-allow-origin", "*");
      res.headers.set("cache-control", "public, s-maxage=30, stale-while-revalidate=120");
      return res;
    }
    if (a === "health") return out({ ok: true, network: networkName() });

    if (a === "me" && !b) {
      if (method === "GET") return out({ player: await pub(player) });
      if (method === "PATCH") {
        const { handle: h } = await body<{ handle: string }>(req);
        try {
          return out({ player: await pub(await setHandle(player, h || "")) });
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
      }
    }
    if (a === "me" && b === "stashes" && method === "GET") return out({ stashes: await myStashes(player.id) });
    // Profile photo: the raw image bytes (a 320×320 JPEG from the app's cropper).
    if (a === "me" && b === "avatar") {
      if (method === "POST") {
        if (!isAccount(player)) throw new HttpError(403, "Sign up to add a profile photo");
        const bytes = await readCapped(req.body, req.headers.get("content-length"));
        return out({ player: await pub(await setAvatar(player, bytes)) });
      }
      if (method === "DELETE") return out({ player: await pub(await removeAvatar(player)) });
    }

    if (a === "leaderboard" && method === "GET") {
      const board = (req.nextUrl.searchParams.get("board") || "crackers") as "crackers" | "hiders" | "oracles";
      const period = (req.nextUrl.searchParams.get("period") || "week") as "today" | "week" | "all";
      if (!["crackers", "hiders", "oracles"].includes(board) || !["today", "week", "all"].includes(period)) throw new HttpError(400, "Bad board");
      return out(await leaderboard(board, period, player.id));
    }
    if (a === "ticker" && method === "GET") return out({ items: await ticker() });
    if (a === "matches" && method === "GET") return out({ matches: await upcomingMatches(5, networkName() === "sim") });

    if (a === "stashes" && !b) {
      if (method === "GET") {
        // Keep the feed alive: hide the next house riddle when one is due (after the response is sent).
        after(() => maybeHouseDrop().catch((e) => console.error("house drop", (e as Error).message)));
        const [stashes, house] = await Promise.all([feed(req.nextUrl.searchParams.get("filter") || "all", player.id), houseStatus().catch(() => null)]);
        return out({ stashes, house });
      }
      if (method === "POST") {
        const s = await createStash(player, await body(req));
        return out({ stash: await toPublic(s, player.id) }, 201);
      }
    }
    if (a === "stashes" && b) {
      if (!c && method === "GET") return out(await stashDetail(b, player, { peek: req.nextUrl.searchParams.get("peek") === "1" }));
      const s = await loadStash(b);
      if (c === "guess" && method === "POST") {
        const { answer } = await body<{ answer: string }>(req);
        return out(await guess(s, player, answer));
      }
      if (c === "call" && method === "POST") return out(await makeCall(s, player, await body(req)));
      if (c === "fund-check" && method === "POST") {
        const r = await checkFunding(s);
        return out({ stash: await toPublic(await loadStash(b), player.id), fundedZat: r.fundedZat });
      }
      if (c === "simulate-fund" && method === "POST") {
        await simulateFund(s, player);
        return out({ stash: await toPublic(await loadStash(b), player.id) });
      }
      if (c === "claim" && method === "POST") return out(await claim(s, player, await body(req)));
      if (c === "fund-from-balance" && method === "POST") {
        await fundFromBalance(s, player);
        return out({ stash: await toPublic(await loadStash(b), player.id), wallet: await walletInfo(player) });
      }
      if (c === "react" && method === "POST") {
        const { emoji } = await body<{ emoji: string }>(req);
        return out(await toggleReaction(s, player, emoji));
      }
      if (c === "victory" && method === "POST") {
        const { message } = await body<{ message: string }>(req);
        await setVictoryMessage(s, player, message);
        return out({ ok: true });
      }
      if (c === "refund-address" && method === "PATCH") {
        const { address } = await body<{ address: string }>(req);
        await setRefundAddress(s, player, address);
        return out({ ok: true });
      }
    }
    throw new HttpError(404, "Not found");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
    console.error(e);
    return json({ error: "Something broke on our side. Try again." }, { status: 500 });
  }
}

/** Every API response says how long it took and how many KV calls it made (DevTools → Timing). */
async function timed(req: NextRequest, ctx: Ctx) {
  const t0 = performance.now();
  const { result, stats } = await withKvStats(() => handle(req, ctx));
  const total = performance.now() - t0;
  try {
    result.headers.set("server-timing", `kv;desc="${stats.calls} calls";dur=${stats.ms.toFixed(1)}, app;dur=${total.toFixed(1)}`);
  } catch {
    /* immutable redirect headers */
  }
  return result;
}

export const GET = timed;
export const POST = timed;
export const PATCH = timed;
export const DELETE = timed;
