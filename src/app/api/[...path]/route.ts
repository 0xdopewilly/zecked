// Single API entrypoint (one serverless function → one warm memory store in demo mode).
import { NextRequest, NextResponse } from "next/server";
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
  fundFromBalance,
  setRefundAddress,
  setVictoryMessage,
  simulateFund,
  stashDetail,
  ticker,
  toPublic,
} from "@/lib/server/game";
import { leaderboard, setHandle, toPublicPlayer, type PlayerRecord } from "@/lib/server/players";
import { createSession, destroySession, sessionPlayer, startEmailSignIn, verifyEmailSignIn } from "@/lib/server/auth";
import { SIM_WELCOME_BONUS_ZAT, balanceOf, credit, simulateDeposit, walletInfo, withdraw } from "@/lib/server/wallet";
import { ensureSeeded } from "@/lib/server/seed";
import { upcomingMatches } from "@/lib/server/sports";
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
  return toPublicPlayer(p, p.email ? await balanceOf(p.id) : 0);
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
    await ensureSeeded();
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
      if (isNew && networkName() === "sim") await credit(account.id, SIM_WELCOME_BONUS_ZAT, "bonus", "Test-mode welcome bonus 🎁");
      const creditedZat = await creditPendingClaims(account);
      await destroySession(sid);
      const nsid = await createSession(account.id);
      return json({ player: await pub(account), creditedZat }, { sid: nsid, setCookie: true });
    }
    if (a === "auth" && b === "logout" && method === "POST") {
      await destroySession(sid);
      const res = json({ ok: true });
      res.cookies.set(SID, "", { path: "/", maxAge: 0 });
      return res;
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

    if (a === "leaderboard" && method === "GET") {
      const board = (req.nextUrl.searchParams.get("board") || "crackers") as "crackers" | "hiders" | "oracles";
      const period = (req.nextUrl.searchParams.get("period") || "week") as "today" | "week" | "all";
      if (!["crackers", "hiders", "oracles"].includes(board) || !["today", "week", "all"].includes(period)) throw new HttpError(400, "Bad board");
      return out(await leaderboard(board, period, player.id));
    }
    if (a === "ticker" && method === "GET") return out({ items: await ticker() });
    if (a === "matches" && method === "GET") return out({ matches: await upcomingMatches(5, networkName() === "sim") });

    if (a === "stashes" && !b) {
      if (method === "GET") return out({ stashes: await feed(req.nextUrl.searchParams.get("filter") || "all", player.id) });
      if (method === "POST") {
        const s = await createStash(player, await body(req));
        return out({ stash: await toPublic(s, player.id) }, 201);
      }
    }
    if (a === "stashes" && b) {
      if (!c && method === "GET") return out(await stashDetail(b, player));
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

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
