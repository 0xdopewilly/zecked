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
  setRefundAddress,
  simulateFund,
  stashDetail,
  ticker,
  toPublic,
} from "@/lib/server/game";
import { ensurePlayer, leaderboard, setHandle, toPublicPlayer, type PlayerRecord } from "@/lib/server/players";
import { ensureSeeded } from "@/lib/server/seed";
import { upcomingMatches } from "@/lib/server/sports";
import { HttpError } from "@/lib/server/util";
import { networkName } from "@/lib/zcash/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COOKIE = "zk_pid";

type Ctx = { params: Promise<{ path: string[] }> };

async function withPlayer(req: NextRequest) {
  const id = req.cookies.get(COOKIE)?.value;
  const { player, created } = await ensurePlayer(id);
  return { player, setCookie: created || id !== player.id };
}

function json(data: unknown, init: { status?: number; player?: PlayerRecord; setCookie?: boolean } = {}) {
  const res = NextResponse.json(data, { status: init.status ?? 200, headers: { "cache-control": "no-store" } });
  if (init.player && init.setCookie) {
    res.cookies.set(COOKIE, init.player.id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }
  return res;
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
    const { player, setCookie } = await withPlayer(req);
    const out = (data: unknown, status = 200) => json(data, { status, player, setCookie });

    if (a === "config" && method === "GET") return out(await appConfig());
    if (a === "health") return out({ ok: true, network: networkName() });

    if (a === "me" && !b) {
      if (method === "GET") return out({ player: toPublicPlayer(player) });
      if (method === "PATCH") {
        const { handle: h } = await body<{ handle: string }>(req);
        try {
          return out({ player: toPublicPlayer(await setHandle(player, h || "")) });
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
