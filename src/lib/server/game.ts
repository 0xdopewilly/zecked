// ZECKED game rules: stash lifecycle, riddle guesses, sealed prediction calls, winners, claims.
import type { Reaction,
  AppConfig,
  BadgeId,
  ClaimResult,
  GuessResult,
  Match,
  MyCall,
  PredictionKind,
  PublicStash,
  RunnerCall,
  StashStatus,
  StashType,
  TickerItem,
  WinPayload,
  WinnerPick,
} from "@/lib/types";
import { NETWORK_FEE_ZAT, networkName, zcash } from "@/lib/zcash/engine";
import { kv } from "./kv";
import { emailSignInAvailable } from "./auth";
import { notify } from "./notify";
import { myReactions, reactionCounts } from "./social";
import { googleEnabled } from "./google";
import { XP, bumpBoard, ensurePlayer, getPlayer, grant, isAccount, savePlayer, tierOf, toPublicPlayer, touchPlay, type PlayerRecord } from "./players";
import { zecUsd } from "./price";
import { balanceOf, credit, debit } from "./wallet";
import { getMatch } from "./sports";
import {
  HttpError,
  hashAnswer,
  isShieldedAddress,
  isTransparentAddress,
  newId,
  newToken,
  normalizeAnswer,
  nowIso,
  shortAddr,
} from "./util";

// ---------- constants ----------
const MAX_TRIES = 3;
const TRY_WINDOW_MS = 10 * 60_000;
const CLAIM_WINDOW_MS = 7 * 86400_000;
const MIN_USD = Number(process.env.ZECKED_MIN_USD || 1);
const MAX_USD = Number(process.env.ZECKED_MAX_USD || 100);
const WHALE_USD = 50;
const EXPIRY_HOURS = [1, 24, 72, 168];

const WRONG_VERDICTS = [
  "Bold guess. Wrong, but bold 😏",
  "Nope! Try again 😏",
  "So close. Or not. Who knows 🤫",
  "The vault didn't even flinch.",
  "Wrong, but we love the confidence.",
  "Cold. Ice cold. 🧊",
];

// ---------- records ----------
export interface StashRecord {
  id: string;
  type: StashType;
  status: StashStatus;
  hiderId: string;
  amountZat: number;
  createdAt: string;
  liveAt?: string;
  expiresAt: string;
  expiryHours: number;
  network: string;
  riddle?: { text: string; answerHashes: string[]; salt: string; hint?: string; hintUnlocksAt?: string; answer?: string };
  usdAtHide?: number; // the dollar size the hider picked (shown as-is, not re-derived from rounded zats)
  prediction?: { matchId: string; kind: PredictionKind; kickoff: string; home?: { code: string; name: string }; away?: { code: string; name: string }; leagueName?: string };
  refundAddress?: string;
  funding: { address: string; uri: string; amountZat: number };
  simFundedZat?: number;
  winnerId?: string;
  zeckedAt?: string;
  crackSeconds?: number;
  claimToken?: string;
  claimed?: { txid: string; to: string; at: string; shielded: boolean; internal?: boolean };
  fundedFrom?: "balance" | "chain";
  victoryMessage?: string;
  finalScore?: string;
  correctCalls?: number;
  refund?: { txid?: string; at: string; reason: string; internal?: boolean };
  seeded?: boolean;
}

interface CallRecord {
  pid: string;
  kind: PredictionKind;
  home?: number;
  away?: number;
  pick?: WinnerPick;
  at: string;
}

const K = {
  stash: (id: string) => `stash:${id}`,
  index: "stashes",
  byPlayer: (pid: string) => `pstash:${pid}`,
  tries: (id: string) => `stash:${id}:tries`,
  myTries: (id: string, pid: string) => `tries:${id}:${pid}`,
  win: (id: string) => `win:${id}`,
  calls: (id: string) => `calls:${id}`,
  callCount: (id: string) => `stash:${id}:calls`,
  myCall: (id: string, pid: string) => `call:${id}:${pid}`,
  viewers: (id: string) => `viewers:${id}`,
  firstSeen: (id: string, pid: string) => `seen:${id}:${pid}`,
  tick: (id: string) => `tick:${id}`,
  ticker: "ticker",
};

const getStash = (id: string) => kv().get<StashRecord>(K.stash(id));
const saveStash = (s: StashRecord) => kv().set(K.stash(s.id), s);

// ---------- config ----------
export async function appConfig(): Promise<AppConfig> {
  const net = networkName();
  return {
    testMode: net !== "mainnet",
    network: net,
    zecUsd: await zecUsd(),
    maxStashUsd: MAX_USD,
    minStashUsd: MIN_USD,
    auth: { google: googleEnabled(), passkey: true, email: emailSignInAvailable() },
  };
}

// ---------- ticker ----------
async function tick_(text: string, kind: TickerItem["kind"]) {
  await kv().lpushTrim(K.ticker, { id: newId(), text, at: nowIso(), kind } satisfies TickerItem, 30);
}
export async function ticker(): Promise<TickerItem[]> {
  return kv().lrange<TickerItem>(K.ticker, 0, 19);
}
const fmtSeconds = (sec: number) => (sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 3600)}h`);
const zecStr = (zat: number) => (zat / 1e8).toFixed(4).replace(/(\.\d{2}\d*?)0+$/, "$1");

// ---------- create ----------
export async function createStash(
  hider: PlayerRecord,
  body: {
    type: StashType;
    riddle?: { text: string; answer: string; hint?: string };
    prediction?: { matchId: string; kind: PredictionKind };
    usd: number;
    expiryHours?: number;
    refundAddress?: string;
  },
  opts: { seeded?: boolean; now?: number } = {}
): Promise<StashRecord> {
  if (!opts.seeded && !isAccount(hider)) throw new HttpError(401, "Sign up to hide a stash");
  const usd = Number(body.usd);
  if (!(usd >= MIN_USD && usd <= MAX_USD)) throw new HttpError(400, `Stash size must be between $${MIN_USD} and $${MAX_USD}`);
  const rate = await zecUsd();
  const amountZat = Math.max(10_000, Math.round(((usd / rate) * 1e8) / 10_000) * 10_000);
  const now = opts.now ?? Date.now();
  const id = newId();
  let expiresAt: string;
  let riddle: StashRecord["riddle"];
  let prediction: StashRecord["prediction"];
  let expiryHours = Number(body.expiryHours || 24);

  if (body.type === "riddle") {
    const text = (body.riddle?.text || "").trim();
    const answer = (body.riddle?.answer || "").trim();
    const hint = (body.riddle?.hint || "").trim() || undefined;
    if (text.length < 8 || text.length > 200) throw new HttpError(400, "Riddles are 8–200 characters");
    if (!answer || answer.length > 60) throw new HttpError(400, "Add an answer (up to 60 characters)");
    if (hint && hint.length > 120) throw new HttpError(400, "Hints are up to 120 characters");
    if (!EXPIRY_HOURS.includes(expiryHours)) expiryHours = 24;
    const salt = newToken();
    const alts = answer.split("|").map((a) => a.trim()).filter(Boolean);
    // `answer` (as the hider typed it) is only ever revealed once the stash has ended.
    riddle = { text, salt, hint, answerHashes: alts.map((a) => hashAnswer(a, salt)), answer: alts[0] };
    if (alts.some((a) => normalizeAnswer(a).length === 0)) throw new HttpError(400, "That answer is empty after cleanup");
    expiresAt = new Date(now + expiryHours * 3600_000).toISOString(); // reset when it goes live
  } else if (body.type === "prediction") {
    const matchId = body.prediction?.matchId || "";
    const kind: PredictionKind = body.prediction?.kind === "winner" ? "winner" : "exact";
    const m = await getMatch(matchId);
    if (!m) throw new HttpError(400, "Couldn't find that match");
    const lead = m.demo ? 60_000 : 10 * 60_000;
    if (m.status !== "scheduled" || Date.parse(m.kickoff) < now + lead) throw new HttpError(400, "That match kicks off too soon. Pick another one");
    // Team names are kept on the record so link previews never need a live sports lookup.
    prediction = { matchId, kind, kickoff: m.kickoff, home: { code: m.home.code, name: m.home.name }, away: { code: m.away.code, name: m.away.name }, leagueName: m.leagueName };
    expiresAt = new Date(Date.parse(m.kickoff) + 5 * 3600_000).toISOString();
    expiryHours = Math.round((Date.parse(expiresAt) - now) / 3600_000);
  } else {
    throw new HttpError(400, "Pick a riddle or a prediction");
  }

  let refundAddress: string | undefined;
  if (body.refundAddress) {
    const a = body.refundAddress.trim();
    if (!isShieldedAddress(a) && !isTransparentAddress(a)) throw new HttpError(400, "That refund address doesn't look like a Zcash address");
    refundAddress = a;
  }

  const funding = await zcash().requestFunding(id, amountZat + NETWORK_FEE_ZAT);
  const s: StashRecord = {
    id,
    type: body.type,
    usdAtHide: usd,
    status: "awaiting_funding",
    hiderId: hider.id,
    amountZat,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    expiryHours,
    network: networkName(),
    riddle,
    prediction,
    refundAddress,
    funding: { ...funding, amountZat: amountZat + NETWORK_FEE_ZAT },
    seeded: opts.seeded,
  };
  await saveStash(s);
  await kv().zadd(K.index, now, id);
  await kv().rpush(K.byPlayer(hider.id), id);
  return s;
}

// ---------- funding ----------
async function goLive(s: StashRecord) {
  invalidateFeed();
  if (!s.seeded) await kv().incr("stats:hidden");
  const now = Date.now();
  s.status = "live";
  s.liveAt = new Date(now).toISOString();
  if (s.type === "riddle") {
    s.expiresAt = new Date(now + s.expiryHours * 3600_000).toISOString();
    if (s.riddle?.hint) s.riddle.hintUnlocksAt = new Date(now + Math.min(3600_000, (s.expiryHours * 3600_000) / 3)).toISOString();
  }
  if (s.type === "prediction" && s.prediction && Date.parse(s.prediction.kickoff) <= now) {
    // Funded after kickoff: too late to take calls.
    await voidAndRefund(s, "Funded after kickoff");
    return;
  }
  await saveStash(s);
  const hider = await getPlayer(s.hiderId);
  if (hider) {
    hider.stats.hidden += 1;
    hider.xp += XP.hide;
    const usd = (s.amountZat / 1e8) * (await zecUsd());
    if (usd >= MAX_USD - 0.5) grant(hider, "whale-hider");
    touchPlay(hider);
    await savePlayer(hider);
    await bumpBoard("hiders", hider.id, 1);
    if (!s.seeded) {
      const m = s.prediction ? await getMatch(s.prediction.matchId) : null;
      await tick_(
        s.type === "riddle"
          ? `${hider.handle} just hid ${zecStr(s.amountZat)} ZEC behind a riddle 🔐`
          : `${hider.handle} just hid ${zecStr(s.amountZat)} ZEC on ${m ? `${m.home.code} vs ${m.away.code}` : "a match"} ⚽`,
        "hidden"
      );
    }
  }
}

export async function checkFunding(s: StashRecord): Promise<{ fundedZat: number }> {
  if (s.status !== "awaiting_funding") return { fundedZat: s.funding.amountZat };
  const st = await zcash().checkFunding(s.id, s.simFundedZat);
  if (st.fundedZat >= s.funding.amountZat) await goLive(s);
  return { fundedZat: st.fundedZat };
}

export async function simulateFund(s: StashRecord, viewer: PlayerRecord) {
  if (networkName() !== "sim") throw new HttpError(400, "Simulated payments only work in sim mode. Send real testnet ZEC with the QR");
  if (s.hiderId !== viewer.id) throw new HttpError(403, "Only the hider can fund this stash");
  if (s.status !== "awaiting_funding") return;
  s.simFundedZat = s.funding.amountZat;
  await saveStash(s);
  await checkFunding(s);
}

// ---------- refunds ----------
async function refund(s: StashRecord, reason: string) {
  let txid: string | undefined;
  const hider = s.seeded ? null : await getPlayer(s.hiderId);
  const wasFunded = !!s.liveAt;
  if (hider && isAccount(hider) && wasFunded) {
    await notify(hider.id, {
      kind: "refunded",
      stashId: s.id,
      amountZat: s.amountZat,
      text: reason === "Nobody cracked it" || reason === "Nobody called it" ? `Uncrackable! Nobody got it, so your ${zecStr(s.amountZat)} ZEC came back.` : `Your stash came back: ${reason}.`,
    });
    await credit(hider.id, s.amountZat, "refund", reason === "Nobody cracked it" || reason === "Nobody called it" ? "Uncrackable! Your stash came back" : `Stash returned · ${reason}`, { stashId: s.id });
    s.refund = { at: nowIso(), reason, internal: true };
    return;
  }
  if (s.refundAddress && wasFunded) {
    try {
      txid = (await zcash().payout(s.id, s.refundAddress, s.amountZat, `ZECKED refund · ${reason}`)).txid;
    } catch (e) {
      // The on-chain send failed (vault paused for a network upgrade, server trouble): the ZEC goes back to
      // the hider's in-app balance instead, so a refund is never lost. They can withdraw it later.
      console.error("refund failed", s.id, (e as Error).message);
      if (hider) {
        await credit(hider.id, s.amountZat, "refund", `Stash returned · ${reason}`, { stashId: s.id });
        s.refund = { at: nowIso(), reason, internal: true };
        return;
      }
    }
  }
  s.refund = { txid, at: nowIso(), reason };
}

async function voidAndRefund(s: StashRecord, reason: string) {
  s.status = "void";
  await refund(s, reason);
  await saveStash(s);
}

async function uncrackable(s: StashRecord, reason: string) {
  s.status = "refunded";
  await refund(s, reason);
  await saveStash(s);
  const hider = await getPlayer(s.hiderId);
  if (hider) {
    hider.stats.uncrackable += 1;
    hider.xp += XP.uncrackable;
    grant(hider, "uncrackable");
    await savePlayer(hider);
    if (!s.seeded) await tick_(`${hider.handle}'s stash was UNCRACKABLE 🛡️`, "hidden");
  }
}

// ---------- tick (lazy resolution on read) ----------
export async function tickStash(s: StashRecord, force = false): Promise<StashRecord> {
  if (["zecked", "refunded", "void", "expired"].includes(s.status)) return s;
  if (!force && !(await kv().set(K.tick(s.id), 1, { nx: true, exSeconds: 8 }))) return s;
  const now = Date.now();
  if (s.status === "awaiting_funding") {
    if (networkName() !== "sim") await checkFunding(s).catch(() => undefined);
    if (s.status === "awaiting_funding" && now - Date.parse(s.createdAt) > 48 * 3600_000) {
      s.status = "void";
      await saveStash(s);
    }
    return s;
  }
  if (s.type === "riddle") {
    if (s.status === "live" && now > Date.parse(s.expiresAt)) await uncrackable(s, "Nobody cracked it");
    return s;
  }
  // prediction
  const m = await getMatch(s.prediction!.matchId);
  if (s.status === "live" && now >= Date.parse(s.prediction!.kickoff)) {
    s.status = "locked";
    await saveStash(s);
  }
  if (!m) return s;
  if (m.status === "postponed" || m.status === "canceled") await voidAndRefund(s, "Match called off");
  else if (m.status === "final") await resolvePrediction(s, m);
  else if (now > Date.parse(s.expiresAt) + 6 * 3600_000) await voidAndRefund(s, "No result from the sports feed");
  return s;
}

function callCorrect(c: CallRecord, m: Match) {
  const h = m.homeScore ?? 0,
    a = m.awayScore ?? 0;
  if (c.kind === "exact") return c.home === h && c.away === a;
  const outcome: WinnerPick = h > a ? "home" : h < a ? "away" : "draw";
  return c.pick === outcome;
}

async function resolvePrediction(s: StashRecord, m: Match) {
  const calls = (await kv().lrange<CallRecord>(K.calls(s.id), 0, -1)).sort((x, y) => x.at.localeCompare(y.at));
  const correct = calls.filter((c) => callCorrect(c, m));
  s.finalScore = `${m.homeScore ?? 0}–${m.awayScore ?? 0}`;
  s.correctCalls = correct.length;
  // Oracle stat for every exact-score caller who got it right.
  if (s.prediction!.kind === "exact") {
    for (const c of correct) {
      const p = await getPlayer(c.pid);
      if (!p) continue;
      p.stats.oracle += 1;
      p.xp += XP.exactCall;
      if (p.stats.oracle >= 3) grant(p, "oracle");
      await savePlayer(p);
      await bumpBoard("oracles", p.id, 1);
    }
  }
  if (!correct.length) {
    await uncrackable(s, "Nobody called it");
    return;
  }
  const first = correct[0];
  if (await kv().set(K.win(s.id), first.pid, { nx: true })) {
    await award(s, first.pid, "prediction");
  }
}

// ---------- winning ----------
async function award(s: StashRecord, pid: string, kind: StashType): Promise<WinPayload> {
  invalidateFeed();
  if (!s.seeded) {
    await kv().incr("stats:zecked");
    await kv().incr("stats:zeckedZat", s.amountZat);
  }
  const now = Date.now();
  s.status = "zecked";
  s.winnerId = pid;
  s.zeckedAt = new Date(now).toISOString();
  s.claimToken = newToken();
  const seen = await kv().get<number>(K.firstSeen(s.id, pid));
  if (kind === "riddle" && seen) s.crackSeconds = Math.max(1, Math.round((now - seen) / 1000));
  await saveStash(s);

  const p = (await getPlayer(pid))!;
  const badges: BadgeId[] = [];
  let xp = kind === "riddle" ? XP.crackRiddle : XP.winPrediction;
  p.stats.cracked += 1;
  badges.push(...grant(p, "first-crack"));
  if (kind === "riddle" && s.crackSeconds !== undefined && s.crackSeconds < 60) {
    xp += XP.speedBonus;
    badges.push(...grant(p, "speed-demon"));
  }
  if (kind === "prediction" && s.prediction?.kind === "exact" && p.badges.includes("oracle") && p.stats.oracle === 3) badges.push("oracle");
  badges.push(...touchPlay(p));
  p.xp += xp;
  if (kind === "riddle") await kv().set(`celebrated:${s.id}`, 1, { nx: true, exSeconds: 30 * 86400 }); // riddle winners celebrate from the guess response
  if (isAccount(p)) {
    await creditWin(s, p);
  } else if (!p.pendingClaims.includes(s.id)) p.pendingClaims.push(s.id);
  await savePlayer(p);
  await bumpBoard("crackers", pid, 1);
  // Winners stay anonymous, in the ticker too.
  if (!s.seeded) await tick_(`Someone just zecked ${zecStr(s.amountZat)} ZEC 🔓`, "zecked");
  if (!s.seeded && s.hiderId !== pid) {
    await notify(s.hiderId, {
      kind: "zecked",
      stashId: s.id,
      amountZat: s.amountZat,
      text:
        kind === "riddle"
          ? `Your riddle got ZECKED${s.crackSeconds ? ` in ${fmtSeconds(s.crackSeconds)}` : ""}! Someone cracked it.`
          : "Your prediction stash got ZECKED! Someone called it.",
    });
  }
  return winPayload(s, p, xp, badges);
}

/** Credit a won stash into the winner's ZECKED wallet (once). Mutates s and p; saves s. */
async function creditWin(s: StashRecord, p: PlayerRecord) {
  if (s.claimed) return 0;
  if (!(await kv().set(`credited:${s.id}`, p.id, { nx: true }))) return 0;
  await credit(p.id, s.amountZat, "win", s.type === "riddle" ? "Cracked a riddle stash 🔓" : "Called it! Prediction stash", { stashId: s.id });
  s.claimed = { txid: "internal", to: "ZECKED wallet", at: nowIso(), shielded: true, internal: true };
  await saveStash(s);
  p.pendingClaims = p.pendingClaims.filter((x) => x !== s.id);
  return s.amountZat;
}

/** On sign-in: move any wins made as a guest into the new wallet. */
export async function creditPendingClaims(p: PlayerRecord): Promise<number> {
  let total = 0;
  const guestIds = new Set([p.id, ...(p.mergedGuests || [])]);
  for (const id of [...p.pendingClaims]) {
    const s = await getStash(id);
    if (!s || s.status !== "zecked" || !s.winnerId || !guestIds.has(s.winnerId)) {
      p.pendingClaims = p.pendingClaims.filter((x) => x !== id);
      continue;
    }
    if (s.winnerId !== p.id) {
      s.winnerId = p.id;
      await kv().set(K.win(s.id), p.id);
    }
    total += await creditWin(s, p);
  }
  await savePlayer(p);
  return total;
}

/** Pay for an awaiting stash straight from the hider's ZECKED balance. */
export async function fundFromBalance(s: StashRecord, p: PlayerRecord) {
  if (!isAccount(p)) throw new HttpError(401, "Sign up first");
  if (s.hiderId !== p.id) throw new HttpError(403, "Only the hider can fund this stash");
  if (s.status !== "awaiting_funding") throw new HttpError(400, "This stash is already funded");
  if (!(await kv().set(`fundlock:${s.id}`, 1, { nx: true, exSeconds: 30 }))) throw new HttpError(409, "Funding in progress");
  try {
    await debit(p.id, s.amountZat, "hide", s.type === "riddle" ? "Hid a riddle stash 🔐" : "Hid a prediction stash ⚽", { stashId: s.id });
    s.fundedFrom = "balance";
    await saveStash(s);
    await goLive(s);
  } finally {
    await kv().del(`fundlock:${s.id}`);
  }
}

export async function setVictoryMessage(s: StashRecord, p: PlayerRecord, message: string) {
  if (s.status !== "zecked" || s.winnerId !== p.id) throw new HttpError(403, "Only the winner can leave a victory message");
  const msg = (message || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
  s.victoryMessage = msg || undefined;
  await saveStash(s);
}

async function winPayload(s: StashRecord, p: PlayerRecord, xpGained: number, badges: BadgeId[]): Promise<WinPayload> {
  const rate = await zecUsd();
  return {
    stashId: s.id,
    amountZat: s.amountZat,
    usd: s.usdAtHide ?? Math.round((s.amountZat / 1e8) * rate * 100) / 100,
    xpGained,
    badgesUnlocked: badges,
    player: toPublicPlayer(p, isAccount(p) ? await balanceOf(p.id) : 0),
    claimToken: s.claimToken!,
    credited: !!s.claimed?.internal,
  };
}

// ---------- riddle guesses ----------
export async function guess(s: StashRecord, p: PlayerRecord, answer: string): Promise<GuessResult> {
  await tickStash(s);
  if (s.type !== "riddle") throw new HttpError(400, "That's a prediction stash");
  if (s.hiderId === p.id) throw new HttpError(400, "You can't crack your own stash 😅");
  if (s.status === "zecked") return { correct: false, triesLeft: 0, verdict: "Too late. Someone already zecked it.", alreadyZecked: true };
  if (s.status !== "live") throw new HttpError(400, "This stash isn't open for cracking");
  const a = (answer || "").slice(0, 80);
  if (!normalizeAnswer(a)) throw new HttpError(400, "Type an answer first");

  const tk = K.myTries(s.id, p.id);
  const now = Date.now();
  let t = (await kv().get<{ used: number; windowStart: number }>(tk)) || { used: 0, windowStart: now };
  if (now - t.windowStart > TRY_WINDOW_MS) t = { used: 0, windowStart: now };
  if (t.used >= MAX_TRIES) {
    return { correct: false, triesLeft: 0, resetsAt: new Date(t.windowStart + TRY_WINDOW_MS).toISOString(), verdict: "Out of tries. Breathe. Think. Come back." };
  }
  await kv().incr(K.tries(s.id));
  const correct = s.riddle!.answerHashes.includes(hashAnswer(a, s.riddle!.salt));
  touchPlay(p);
  if (correct) {
    if (!(await kv().set(K.win(s.id), p.id, { nx: true }))) {
      await savePlayer(p);
      return { correct: false, triesLeft: MAX_TRIES - t.used, verdict: "Right answer… but someone got there first 😤", alreadyZecked: true };
    }
    const fresh = (await getStash(s.id))!;
    const win = await award(fresh, p.id, "riddle");
    return { correct: true, triesLeft: MAX_TRIES - t.used, verdict: "The vault is open.", win };
  }
  t.used += 1;
  await kv().set(tk, t, { exSeconds: Math.ceil(TRY_WINDOW_MS / 1000) + 60 });
  await savePlayer(p);
  return {
    correct: false,
    triesLeft: MAX_TRIES - t.used,
    resetsAt: new Date(t.windowStart + TRY_WINDOW_MS).toISOString(),
    verdict: WRONG_VERDICTS[Math.floor(Math.random() * WRONG_VERDICTS.length)],
  };
}

// ---------- prediction calls ----------
export async function makeCall(s: StashRecord, p: PlayerRecord, body: { home?: number; away?: number; pick?: WinnerPick }) {
  await tickStash(s);
  if (s.type !== "prediction") throw new HttpError(400, "That's a riddle stash");
  if (s.hiderId === p.id) throw new HttpError(400, "You can't call your own match");
  if (s.status !== "live" || Date.now() >= Date.parse(s.prediction!.kickoff)) throw new HttpError(400, "Calls are locked for this match");
  const kind = s.prediction!.kind;
  const call: CallRecord = { pid: p.id, kind, at: nowIso() };
  if (kind === "exact") {
    const h = Number(body.home),
      a = Number(body.away);
    if (![h, a].every((x) => Number.isInteger(x) && x >= 0 && x <= 9)) throw new HttpError(400, "Scores are 0–9");
    call.home = h;
    call.away = a;
  } else {
    if (!["home", "draw", "away"].includes(String(body.pick))) throw new HttpError(400, "Pick home, draw or away");
    call.pick = body.pick;
  }
  if (!(await kv().set(K.myCall(s.id, p.id), call, { nx: true }))) throw new HttpError(409, "You already sealed a call on this one");
  await kv().rpush(K.calls(s.id), call);
  const calls = await kv().incr(K.callCount(s.id));
  p.xp += XP.call;
  touchPlay(p);
  await savePlayer(p);
  const myCall: MyCall = { kind, home: call.home, away: call.away, pick: call.pick, at: call.at };
  return { myCall, calls };
}

// ---------- refund address (hider sets it while funding) ----------
export async function setRefundAddress(s: StashRecord, p: PlayerRecord, address: string) {
  if (s.hiderId !== p.id) throw new HttpError(403, "Only the hider can set the refund address");
  if (["zecked", "refunded", "void"].includes(s.status)) throw new HttpError(400, "This stash is already settled");
  const a = (address || "").trim();
  if (a && !isShieldedAddress(a) && !isTransparentAddress(a)) throw new HttpError(400, "That doesn't look like a Zcash address");
  s.refundAddress = a || undefined;
  await saveStash(s);
}

// ---------- claim ----------
export async function claim(s: StashRecord, p: PlayerRecord, body: { claimToken: string; address: string; message?: string }): Promise<ClaimResult> {
  if (s.status !== "zecked" || s.winnerId !== p.id) throw new HttpError(403, "Nothing to claim here");
  if (s.claimed?.internal) throw new HttpError(409, "Already in your ZECKED wallet");
  if (s.claimed) throw new HttpError(409, "Already claimed");
  if (!body.claimToken || body.claimToken !== s.claimToken) throw new HttpError(403, "Claim link expired. Open the stash again");
  if (Date.now() - Date.parse(s.zeckedAt!) > CLAIM_WINDOW_MS) throw new HttpError(410, "The 7-day claim window has closed");
  const to = (body.address || "").trim();
  const shielded = isShieldedAddress(to);
  if (!shielded && !isTransparentAddress(to)) throw new HttpError(400, "That doesn't look like a Zcash address");
  const net = networkName();
  if (net === "testnet" && !/^(utest1|ztestsapling1|tm|textest1)/.test(to)) throw new HttpError(400, "Test mode pays out on Zcash testnet. Use a testnet address (utest1…)");
  if (net === "mainnet" && /^(utest1|ztestsapling1|tm|textest1)/.test(to)) throw new HttpError(400, "That's a testnet address");

  const { txid } = await zcash().payout(s.id, to, s.amountZat, `ZECKED 🔓 You zecked it! (${s.id})`);
  s.claimed = { txid, to, at: nowIso(), shielded };
  const msg = (body.message || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
  if (msg) s.victoryMessage = msg;
  await saveStash(s);
  p.pendingClaims = p.pendingClaims.filter((x) => x !== s.id);
  if (shielded) {
    p.shielded = true;
    grant(p, "shielded");
  }
  await savePlayer(p);
  const rate = await zecUsd();
  return { txid, amountZat: s.amountZat, usd: Math.round((s.amountZat / 1e8) * rate * 100) / 100, to: shortAddr(to), shielded, testMode: net !== "mainnet" };
}

// ---------- views & projection ----------
async function recordView(s: StashRecord, pid: string) {
  const [, seen] = await Promise.all([
    kv().set(K.firstSeen(s.id, pid), Date.now(), { nx: true, exSeconds: 14 * 86400 }),
    kv().get<Record<string, number>>(K.viewers(s.id)),
  ]);
  const map = seen || {};
  const cutoff = Date.now() - 5 * 60_000;
  for (const k of Object.keys(map)) if (map[k] < cutoff) delete map[k];
  map[pid] = Date.now();
  await kv().set(K.viewers(s.id), map, { exSeconds: 3600 });
}

export async function toPublic(s: StashRecord, viewerId?: string, rate?: number): Promise<PublicStash> {
  // Everything this card needs, fetched in parallel (one pipelined round trip to Redis instead of ~6).
  const [r, hider, triesN, viewersMap, match, callsN, rx] = await Promise.all([
    rate ?? zecUsd(),
    getPlayer(s.hiderId),
    s.riddle ? kv().get<number>(K.tries(s.id)) : Promise.resolve(null),
    s.riddle ? kv().get<Record<string, number>>(K.viewers(s.id)) : Promise.resolve(null),
    s.prediction ? getMatch(s.prediction.matchId) : Promise.resolve(null),
    s.prediction ? kv().get<number>(K.callCount(s.id)) : Promise.resolve(null),
    reactionCounts(s.id),
  ]);
  const isMine = viewerId === s.hiderId;
  const usd = s.usdAtHide ?? Math.round((s.amountZat / 1e8) * r * 100) / 100;
  const ended = s.status === "zecked" || s.status === "refunded" || s.status === "void";
  const out: PublicStash = {
    id: s.id,
    type: s.type,
    status: s.status,
    hider: { handle: hider?.handle || "@anon", tier: tierOf(hider), stashesHidden: hider?.stats.hidden || 0 },
    amountZat: s.amountZat,
    usd,
    createdAt: s.createdAt,
    liveAt: s.liveAt,
    expiresAt: s.expiresAt,
    whale: usd >= WHALE_USD,
    testMode: s.network !== "mainnet",
    isMine,
  };
  if (s.riddle) {
    const tries = triesN || 0;
    const viewers = viewersMap || {};
    const cutoff = Date.now() - 5 * 60_000;
    const unlocked = !!s.riddle.hintUnlocksAt && Date.now() >= Date.parse(s.riddle.hintUnlocksAt);
    out.riddle = {
      text: s.riddle.text,
      hasHint: !!s.riddle.hint,
      hint: unlocked || isMine || s.status !== "live" ? s.riddle.hint : undefined,
      hintUnlocksAt: s.riddle.hintUnlocksAt,
      tries,
      // Other people on it right now (never counts you, or the hider watching their own stash).
      crackingNow: Object.entries(viewers).filter(([pid, t]) => t >= cutoff && pid !== viewerId && pid !== s.hiderId).length,
      answer: ended ? s.riddle.answer : undefined,
    };
  }
  if (s.prediction) {
    const m = match;
    const calls = callsN || 0;
    out.prediction = {
      match: m || {
        id: s.prediction.matchId,
        league: "",
        leagueName: "",
        kickoff: s.prediction.kickoff,
        status: "scheduled",
        home: { code: "HOM", name: "Home", color: "#7C5CFF", ink: "#fff" },
        away: { code: "AWY", name: "Away", color: "#FF4D9A", ink: "#fff" },
      },
      kind: s.prediction.kind,
      calls,
      locksAt: s.prediction.kickoff,
    };
  }
  if (s.status === "zecked" || s.status === "refunded" || s.status === "void") {
    out.result = {
      zeckedAt: s.zeckedAt || s.refund?.at || s.expiresAt,
      winnerIsYou: !!viewerId && s.winnerId === viewerId,
      winnerLabel: s.type === "prediction" ? "a mystery caller" : "a mystery cracker",
      victoryMessage: s.victoryMessage,
      crackSeconds: s.crackSeconds,
      finalScore: s.finalScore,
      correctCalls: s.correctCalls,
    };
  }
  if (isMine && s.status === "awaiting_funding") out.funding = s.funding;
  if (rx && Object.keys(rx).length) out.reactions = rx;
  return out;
}

/** `peek`: a background warm-up read (the feed pre-loading a card): doesn't count as viewing it. */
export async function stashDetail(id: string, viewer: PlayerRecord, opts: { peek?: boolean } = {}) {
  let s = await getStash(id);
  if (!s) throw new HttpError(404, "Stash not found");
  s = await tickStash(s); // returns the (possibly updated) record: no second read needed
  const live = s.status === "live" || s.status === "locked";
  // The view ping, the public card and the viewer's own bits, all at once.
  const [, stash, mineRx, t, c] = await Promise.all([
    live && !opts.peek ? recordView(s, viewer.id) : Promise.resolve(),
    toPublic(s, viewer.id),
    myReactions(s.id, viewer.id),
    s.type === "riddle" ? kv().get<{ used: number; windowStart: number }>(K.myTries(s.id, viewer.id)) : Promise.resolve(null),
    s.type === "prediction" ? kv().get<CallRecord>(K.myCall(s.id, viewer.id)) : Promise.resolve(null),
  ]);
  const extra: { myCall?: MyCall; runners?: RunnerCall[]; myTries?: { left: number; resetsAt?: string }; win?: WinPayload; myReactions?: Reaction[] } = {};
  if (mineRx.length) extra.myReactions = mineRx;
  if (s.type === "riddle") {
    const fresh = !t || Date.now() - t.windowStart > TRY_WINDOW_MS;
    extra.myTries = fresh ? { left: MAX_TRIES } : { left: MAX_TRIES - t!.used, resetsAt: new Date(t!.windowStart + TRY_WINDOW_MS).toISOString() };
  } else {
    if (c) extra.myCall = { kind: c.kind, home: c.home, away: c.away, pick: c.pick, at: c.at };
    const m = stash.prediction!.match;
    if (m.status !== "scheduled" || s.status !== "live") extra.runners = await runners(s, m, viewer.id);
  }
  if (s.status === "zecked" && s.winnerId === viewer.id) {
    if (!s.claimed) extra.win = await winPayload(s, viewer, 0, []);
    else if (s.claimed.internal && (await kv().set(`celebrated:${s.id}`, 1, { nx: true, exSeconds: 30 * 86400 }))) {
      extra.win = await winPayload(s, viewer, s.type === "prediction" ? XP.winPrediction : XP.crackRiddle, []);
    }
  }
  return { stash, ...extra };
}

async function runners(s: StashRecord, m: Match, viewerId: string): Promise<RunnerCall[]> {
  const calls = await kv().lrange<CallRecord>(K.calls(s.id), 0, -1);
  const h = m.homeScore ?? 0,
    a = m.awayScore ?? 0;
  const label = (c: CallRecord) =>
    c.kind === "exact" ? `${c.home}–${c.away}` : c.pick === "draw" ? "Draw" : `${c.pick === "home" ? m.home.code : m.away.code} win`;
  // "Still in the running": exact calls that haven't been exceeded by the live score, or winner calls (always).
  const alive = calls.filter((c) => (c.kind === "exact" ? (c.home ?? 0) >= h && (c.away ?? 0) >= a : true));
  // Calls are private: other callers show as "Caller N" (their place in the queue), never a handle.
  const order = new Map(calls.map((c, i) => [c, i + 1]));
  const ordered = [...alive.filter((c) => c.pid === viewerId), ...alive.filter((c) => c.pid !== viewerId)].slice(0, 8);
  return ordered.map((c) => ({
    handle: c.pid === viewerId ? "You" : `Caller ${order.get(c)}`,
    label: label(c),
    isYou: c.pid === viewerId,
    matchesNow: callCorrect(c, m),
  }));
}

// ---------- feed ----------
// Short shared cache: the feed is the hottest endpoint (every player polls it), so compute it at most
// every few seconds per server instance and personalise per viewer afterwards.
const FEED_TTL_MS = 4000;
let feedCache: { at: number; rows: { s: StashRecord; pub: PublicStash }[] } | null = null;
let feedInflight: Promise<{ s: StashRecord; pub: PublicStash }[]> | null = null;

async function loadFeedRows() {
  const ids = (await kv().zrevrange(K.index, 0, 149)).map((r) => r.member);
  const recs = (await Promise.all(ids.map(getStash))).filter(Boolean) as StashRecord[];
  await Promise.all(recs.map((s) => tickStash(s)));
  const fresh = (await Promise.all(recs.map((s) => getStash(s.id)))).filter(Boolean) as StashRecord[];
  const rate = await zecUsd();
  const dayAgo = Date.now() - 86400_000;
  const visible = fresh.filter(
    (s) =>
      s.status === "live" ||
      s.status === "locked" ||
      ((s.status === "zecked" || s.status === "refunded") && Date.parse(s.zeckedAt || s.refund?.at || s.createdAt) > dayAgo)
  );
  return Promise.all(visible.map(async (s) => ({ s, pub: await toPublic(s, undefined, rate) })));
}

export function invalidateFeed() {
  feedCache = null;
}

export async function feed(filter: string, viewerId?: string): Promise<PublicStash[]> {
  if (!feedCache || Date.now() - feedCache.at > FEED_TTL_MS) {
    feedInflight ??= loadFeedRows().finally(() => (feedInflight = null));
    const rows = await feedInflight;
    feedCache = { at: Date.now(), rows };
  }
  let list = feedCache.rows;
  if (filter === "riddles") list = list.filter((r) => r.s.type === "riddle");
  if (filter === "predictions") list = list.filter((r) => r.s.type === "prediction");
  const active = (s: StashRecord) => s.status === "live" || s.status === "locked";
  const endsAt = (s: StashRecord) => Date.parse(s.type === "prediction" ? s.prediction!.kickoff : s.expiresAt);
  if (filter === "ending") list = list.filter((r) => active(r.s)).sort((a, b) => endsAt(a.s) - endsAt(b.s));
  else if (filter === "biggest") list = list.filter((r) => active(r.s)).sort((a, b) => b.s.amountZat - a.s.amountZat);
  else list = [...list].sort((a, b) => Number(active(b.s)) - Number(active(a.s)) || b.s.createdAt.localeCompare(a.s.createdAt));
  // Personalise the shared rows for this viewer.
  return list.slice(0, 60).map(({ s, pub }) => ({
    ...pub,
    isMine: !!viewerId && s.hiderId === viewerId,
    result: pub.result ? { ...pub.result, winnerIsYou: !!viewerId && s.winnerId === viewerId } : undefined,
  }));
}

export async function myStashes(pid: string): Promise<PublicStash[]> {
  const ids = await kv().lrange<string>(K.byPlayer(pid), 0, -1);
  const recs = (await Promise.all(ids.reverse().map(getStash))).filter(Boolean) as StashRecord[];
  for (const s of recs) await tickStash(s);
  const rate = await zecUsd();
  return Promise.all(recs.filter((s) => s.status !== "void" || s.refund).map(async (s) => toPublic((await getStash(s.id))!, pid, rate)));
}

/** A player's publicly visible stashes (what they hid): live ones first, then finished; never unfunded. */
export async function hiddenBy(pid: string, viewerId: string): Promise<PublicStash[]> {
  const ids = (await kv().lrange<string>(K.byPlayer(pid), 0, -1)).reverse().slice(0, 40);
  const recs = (await Promise.all(ids.map(getStash))).filter(Boolean) as StashRecord[];
  const rate = await zecUsd();
  const shown = recs.filter((s) => s.status === "live" || s.status === "locked" || s.status === "zecked" || s.status === "refunded");
  const rank = (s: StashRecord) => (s.status === "live" || s.status === "locked" ? 0 : 1);
  shown.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
  return Promise.all(shown.slice(0, 20).map((s) => toPublic(s, viewerId, rate)));
}

export async function loadStash(id: string) {
  const s = await getStash(id);
  if (!s) throw new HttpError(404, "Stash not found");
  return s;
}

export { ensurePlayer };

// ---------- public stats (for the website) ----------
export async function publicStats() {
  const [hidden, zecked, zeckedZat, players] = await Promise.all(["stats:hidden", "stats:zecked", "stats:zeckedZat", "stats:accounts"].map((k) => kv().get<number>(k)));
  const live = (await feed("all")).filter((s) => s.status === "live" || s.status === "locked").length;
  return {
    network: networkName(),
    stashesHidden: Number(hidden || 0),
    stashesZecked: Number(zecked || 0),
    zecZecked: Number(zeckedZat || 0) / 1e8,
    players: Number(players || 0),
    liveNow: live,
    zecUsd: await zecUsd(),
  };
}
