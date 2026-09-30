"use client";

/*
 * 09 · Hide a stash. One state machine for the whole flow:
 *
 *   type ──▶ riddle ─────┐
 *        └─▶ prediction ─┴─▶ amount ──(api.create)──▶ fund ──(funding detected)──▶ live
 *
 * `?resume=<stashId>` jumps straight to `fund` (awaiting_funding) or `live` (already funded).
 *
 * History: every step is its own browser history entry (`/hide`, `?step=riddle|prediction|amount`,
 * then `?resume=<id>` for funding), so back / forward / swipe-back move between steps. The draft lives
 * in sessionStorage, so a reload, an accidental back or a trip to the wallet keeps it; it is cleared
 * once the stash is live. After that, going back (or "Done") leaves the flow instead of replaying it.
 *
 * Hiding needs an account: guests get a sign-up gate at step 1 (also for `?resume=`).
 * `fund` offers one-tap "Pay from my ZECKED wallet" when the balance covers the stash, with the QR
 * flow folded underneath; otherwise it points to the wallet's Add ZEC (test ZEC is free) with the QR
 * flow as the other way. Uncracked ZEC goes back to the hider's ZECKED wallet, so there is no refund
 * address.
 */

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button, Chip, Confetti, Icon, Input, LiveBadge, Logo, TeamBadge, Toast } from "@/components/zk";
import type { ToastVariant } from "@/components/zk";
import { api, formatUsd, formatZec } from "@/lib/api";
import { useAppBack } from "@/lib/nav";
import { sfx } from "@/lib/sfx";
import { ZAT } from "@/lib/types";
import type { AppConfig, Match, PredictionKind, PublicStash, StashType } from "@/lib/types";

/* ───────────────────────── constants ───────────────────────── */

const POLL_MS = 5000;
const WALLET_POLL_MS = 10_000;
const MATCHES_REFRESH_MS = 60_000;
const ADVANCE_MS = 1200;
// Same limits as the server (src/lib/server/game.ts → createStash).
const RIDDLE_MIN = 8;
const RIDDLE_MAX = 200;
const ANSWER_MAX = 60;
const HINT_MAX = 120;
/** Server: a prediction needs its match to kick off at least this far out (test matches / real ones). */
const LEAD_DEMO_MS = 60_000;
const LEAD_REAL_MS = 10 * 60_000;
/** The picker is a little stricter, so there is still time to set the prize before the server checks. */
const PICK_PAD_MS = 30_000;
const DRAFT_KEY = "zk:hide-draft";
/** Backup of each flow entry's place, by URL (Next.js sometimes rewrites history.state without our key). */
const POS_KEY = "zk:hide-pos";
/** Our key inside `history.state` (Next.js keeps custom keys it doesn't own). */
const HIST_KEY = "zkHide";
const DEFAULT_USD = 20;
const FALLBACK_MIN_USD = 1;
const FALLBACK_MAX_USD = 100;

const PRESETS = [
  { label: "$5", usd: 5 },
  { label: "$10", usd: 10 },
  { label: "$20", usd: 20 },
] as const;

const EXPIRIES = [
  { label: "1 hour", hours: 1 },
  { label: "24 hours", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "7 days", hours: 168 },
] as const;

const STRENGTH = [
  { label: "Weak", color: "var(--zk-red)", tip: "A toddler could crack this. Add more twists." },
  { label: "Okay", color: "var(--zk-orange)", tip: "Getting there. Try a longer riddle." },
  { label: "Tricky", color: "var(--zk-gold)", tip: "Nice. A few people will sweat on this." },
  { label: "Brutal", color: "var(--zk-pink)", tip: "Brutal. Expect a long queue of wrong guesses." },
  { label: "Uncrackable", color: "var(--zk-purple)", tip: "Uncrackable. Respect." },
] as const;

/** One-word answers that riddle-solvers (and this crowd) try first. */
const CLASSIC_ANSWERS = new Set(
  (
    "map egg time echo shadow fire water ice candle towel piano clock keyboard secret silence darkness dark " +
    "nothing tomorrow yesterday today age breath hole name promise footstep stamp sponge needle coin mirror " +
    "river wind cloud moon sun star tree book door key love life death air rain snow bottle chair table glove " +
    "teapot envelope letter word penny human man woman you me i it zero one two three seven ten eleven bank bat " +
    "bed bell box cold comb corn dice dream eye feather fish fog hand heart horse joke knife lamp mask money " +
    "mouth nail night noise onion paper pen pencil rope salt sand shoe sleep sock spoon stair storm sugar " +
    "tongue tooth teeth trust umbrella void wallet watch wave light hope future past memory mind brain " +
    "cat dog bird wheel ring ball rock stone road window glass sky sea ocean earth world globe " +
    "zcash zec bitcoin btc satoshi crypto blockchain privacy vault stash key wallet"
  ).split(" "),
);

const ARTICLES = new Set(["a", "an", "the"]);

/* ───────────────────────── helpers ───────────────────────── */

type Step = "type" | "riddle" | "prediction" | "amount" | "fund" | "live";
const STEP_NO: Record<Step, 1 | 2 | 3 | 4> = { type: 1, riddle: 2, prediction: 2, amount: 3, fund: 4, live: 4 };
const DRAFT_STEPS: readonly Step[] = ["type", "riddle", "prediction", "amount"];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pad2 = (n: number) => String(n).padStart(2, "0");
/** Friendly copy for a failed request: never a raw "Failed to fetch" or "Request failed (500)". */
function errMsg(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  if (e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return "Can’t reach ZECKED. Check your connection.";
  }
  if (!msg || /^Request failed/.test(msg)) return "Something went wrong on our side. Try again.";
  return msg;
}
const isFunded = (s: PublicStash) => s.status === "live" || s.status === "locked" || s.status === "zecked";
const isDead = (s: PublicStash) => s.status === "expired" || s.status === "refunded" || s.status === "void";

/** Lowercased, accent-free words without punctuation or the articles a / an / the. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !ARTICLES.has(w));
}
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

interface Strength {
  /** −1 = nothing to score yet, 0–4 = Weak … Uncrackable. */
  level: number;
  tip: string;
  warn?: boolean;
}

const toLevel = (p: number) => (p < 1 ? 0 : p < 2 ? 1 : p < 3 ? 2 : p < 4.25 ? 3 : 4);

/**
 * Riddle strength heuristic (0–4). Points for a longer riddle, a longer and multi-word answer;
 * penalties for classic one-word answers, tiny numbers, and above all for giving the answer away.
 */
export function riddleStrength(riddle: string, answer: string): Strength {
  const text = riddle.trim();
  if (!text) return { level: -1, tip: "Write a riddle to see how tough it is." };
  const rw = words(text);
  const rset = new Set<string>();
  for (const w of rw) {
    rset.add(w);
    rset.add(singular(w));
  }
  const inRiddle = (w: string) => rset.has(w) || rset.has(singular(w));
  const ans = words(answer);
  const joined = ans.join(" ");

  const givenAway = ans.length === 1 ? inRiddle(ans[0]) : ans.length > 1 && ` ${rw.join(" ")} `.includes(` ${joined} `);
  if (givenAway) return { level: 0, tip: "Careful, the answer is in the riddle!", warn: true };

  // Riddle length: up to 2.5 points (125+ characters).
  let pts = text.length < 15 ? 0 : Math.min(2.5, text.length / 50);
  if (!ans.length) return { level: toLevel(pts), tip: "Add the answer to see the full score." };

  // Answer length and word count.
  const letters = ans.join("").length;
  pts += letters >= 12 ? 2 : letters >= 8 ? 1.5 : letters >= 5 ? 1 : letters >= 3 ? 0.5 : 0;
  pts += ans.length >= 3 ? 1 : ans.length === 2 ? 0.5 : 0;

  // Guessability.
  const classic = ans.length === 1 && (CLASSIC_ANSWERS.has(ans[0]) || CLASSIC_ANSWERS.has(singular(ans[0])));
  if (classic) pts -= 1;
  if (/^\d{1,3}$/.test(joined)) pts -= 0.75;
  const partial = ans.length > 1 && ans.some((w) => w.length >= 4 && inRiddle(w));
  if (partial) pts -= 1.5;

  const level = toLevel(pts);
  if (partial) return { level, tip: "Careful, part of the answer is in the riddle!", warn: true };
  if (classic && level <= 2) return { level, tip: `“${joined}” is a classic answer. Classics get cracked fast.` };
  if (letters <= 4 && text.length >= 90 && level <= 2) {
    return { level, tip: "Short answers are easy to guess. Try a longer one." };
  }
  return { level, tip: STRENGTH[level].tip };
}

/** Accepted answers: `echo | an echo` means either one wins (the server splits on "|" too). */
const answerAlts = (answer: string) =>
  answer
    .split("|")
    .map((a) => a.trim())
    .filter(Boolean);

/** Mirror of the server's answer cleanup: an answer that is only punctuation ends up empty. */
const normalizeAnswer = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the) /, "");

/** With several accepted answers, the riddle is only as strong as the easiest one. */
function riddleStrengthAll(riddle: string, answer: string): Strength {
  const alts = answerAlts(answer);
  if (alts.length < 2) return riddleStrength(riddle, alts[0] ?? "");
  return alts
    .map((a) => riddleStrength(riddle, a))
    .reduce((worst, s) => (s.warn && !worst.warn) || (!!s.warn === !!worst.warn && s.level < worst.level) ? s : worst);
}

interface RiddleIssues {
  riddle?: string;
  answer?: string;
}

/** The server's riddle rules, in plain words (empty object = good to go). */
function riddleIssues(d: { riddle: string; answer: string }): RiddleIssues {
  const out: RiddleIssues = {};
  const len = d.riddle.trim().length;
  if (!len) out.riddle = "Write your riddle first.";
  else if (len < RIDDLE_MIN) out.riddle = `Riddles need at least ${RIDDLE_MIN} characters (${RIDDLE_MIN - len} more).`;
  else if (len > RIDDLE_MAX) out.riddle = `Riddles are up to ${RIDDLE_MAX} characters.`;
  const ans = d.answer.trim();
  const alts = answerAlts(ans);
  if (!alts.length) out.answer = "Add the answer.";
  else if (ans.length > ANSWER_MAX) out.answer = `Answers are up to ${ANSWER_MAX} characters.`;
  else if (alts.some((a) => !normalizeAnswer(a))) out.answer = "Use letters or numbers in the answer.";
  return out;
}

const matchLeadMs = (m: Match) => (m.demo ? LEAD_DEMO_MS : LEAD_REAL_MS);
/** Too close to kickoff to hide a stash on (`pad` adds time for the steps still ahead). */
const kicksOffTooSoon = (m: Match, now: number, pad = 0) => Date.parse(m.kickoff) < now + matchLeadMs(m) + pad;

/** "45s", "3m 20s", "12m", "3h 5m" until kickoff; null once it is more than a day out (or already due). */
function untilKickoff(iso: string, now: number): string | null {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (!Number.isFinite(s) || s <= 0 || s >= 86_400) return null;
  if (s < 60) return `${s}s`;
  if (s < 300) return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const m = Math.floor(s / 60);
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
}

/** "Tue 20:00" in local time (with the date when it is more than 6 days out). */
function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const days = (d.getTime() - Date.now()) / 86_400_000;
  if (days > 6) return `${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" })} ${time}`;
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${time}`;
}

/** Predictions resolve at full time: kickoff + ~3h of buffer. The server has the final say. */
function hoursUntilFullTime(kickoff: string): number {
  const ms = Date.parse(kickoff) - Date.now();
  return Math.max(1, Math.ceil((Number.isFinite(ms) ? ms : 0) / 3_600_000) + 3);
}

/** A wallet balance: "0" when empty (not "0.00"). */
const fmtBal = (zat: number) => (zat > 0 ? formatZec(zat, 4) : "0");

const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-5)}` : a);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function matchesQuery(m: Match, q: string): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = `${m.home.code} ${m.home.name} ${m.away.code} ${m.away.name} ${m.leagueName} ${m.league}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

const errStatus = (e: unknown) => (e as { status?: number } | null)?.status;

/* ───────────────────────── state machine ───────────────────────── */

interface Draft {
  type: StashType;
  riddle: string;
  answer: string;
  hint: string;
  hintOpen: boolean;
  matchId: string | null;
  kind: PredictionKind;
  usd: number;
  expiryHours: number;
}

interface Flow {
  step: Step;
  /** Which way the last step change went (for the slide). */
  dir: "fwd" | "back" | "none";
  draft: Draft;
  stash: PublicStash | null;
  /** Serialized create-body of `stash`, so going back and forward again reuses it. */
  stashKey: string | null;
  /** Arrived via ?resume without a saved draft: there is no draft to go back to. */
  resumed: boolean;
}

type FlowAction =
  | { t: "patch"; patch: Partial<Draft> }
  | { t: "goto"; step: Step; dir?: Flow["dir"] }
  | { t: "restore"; draft: Draft; step: Step }
  | { t: "fund" }
  | { t: "created"; stash: PublicStash; key: string }
  | { t: "resume"; stash: PublicStash; draft?: Draft; key?: string | null }
  | { t: "update"; stash: PublicStash }
  | { t: "reset" };

const INITIAL_DRAFT: Draft = {
  type: "riddle",
  riddle: "",
  answer: "",
  hint: "",
  hintOpen: false,
  matchId: null,
  kind: "exact",
  usd: DEFAULT_USD,
  expiryHours: 24,
};
const INITIAL_FLOW: Flow = { step: "type", dir: "none", draft: INITIAL_DRAFT, stash: null, stashKey: null, resumed: false };

const detailsStep = (d: Draft): Step => (d.type === "riddle" ? "riddle" : "prediction");
const draftHasContent = (d: Draft) => !!(d.riddle.trim() || d.answer.trim() || d.hint.trim() || d.matchId);

/** The furthest a draft can honestly be: a step whose earlier steps aren't done falls back to them. */
function reachableStep(want: Step, d: Draft): Step {
  if (want === "riddle" || want === "prediction") return detailsStep(d);
  if (want === "amount") {
    const ok = d.type === "riddle" ? !riddleIssues(d).riddle && !riddleIssues(d).answer : !!d.matchId;
    return ok ? "amount" : detailsStep(d);
  }
  return want === "type" ? "type" : want;
}

function flowReducer(s: Flow, a: FlowAction): Flow {
  switch (a.t) {
    case "patch":
      return { ...s, draft: { ...s.draft, ...a.patch } };
    case "goto":
      return a.step === s.step ? s : { ...s, step: a.step, dir: a.dir ?? "none" };
    case "restore":
      return { ...s, draft: a.draft, step: a.step, dir: "none" };
    case "fund":
      return s.stash ? { ...s, step: "fund", dir: "fwd" } : s;
    case "created":
      return { ...s, stash: a.stash, stashKey: a.key, step: isFunded(a.stash) ? "live" : "fund", dir: "fwd" };
    case "resume":
      return {
        ...s,
        stash: a.stash,
        stashKey: a.draft ? (a.key ?? null) : null,
        resumed: !a.draft,
        draft: a.draft ?? { ...s.draft, type: a.stash.type },
        step: isFunded(a.stash) ? "live" : "fund",
        dir: "none",
      };
    case "update":
      return s.stash && s.stash.id === a.stash.id ? { ...s, stash: a.stash } : s;
    case "reset":
      return { ...INITIAL_FLOW, dir: "back" };
  }
}

/* ───────────────────────── draft + history persistence ───────────────────────── */

interface SavedDraft {
  draft: Draft;
  /** The unfunded stash made from this draft, so coming back reuses it instead of making another. */
  stashId?: string | null;
  stashKey?: string | null;
}

function loadSaved(): SavedDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedDraft>;
    if (!v || typeof v !== "object" || !v.draft || typeof v.draft !== "object") return null;
    const d = { ...INITIAL_DRAFT, ...v.draft };
    // Only trust the shapes we wrote.
    if (d.type !== "riddle" && d.type !== "prediction") d.type = "riddle";
    if (d.kind !== "exact" && d.kind !== "winner") d.kind = "exact";
    return {
      draft: {
        ...d,
        riddle: String(d.riddle).slice(0, RIDDLE_MAX),
        answer: String(d.answer).slice(0, ANSWER_MAX),
        hint: String(d.hint).slice(0, HINT_MAX),
        hintOpen: !!d.hintOpen,
        matchId: typeof d.matchId === "string" ? d.matchId : null,
        usd: Number.isFinite(Number(d.usd)) ? Number(d.usd) : DEFAULT_USD,
        expiryHours: EXPIRIES.some((x) => x.hours === Number(d.expiryHours)) ? Number(d.expiryHours) : 24,
      },
      stashId: typeof v.stashId === "string" ? v.stashId : null,
      stashKey: typeof v.stashKey === "string" ? v.stashKey : null,
    };
  } catch {
    return null;
  }
}

function saveDraft(v: SavedDraft | null) {
  try {
    if (v) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* private mode: the draft just won't survive a reload */
  }
}

/** Where this history entry sits in the flow: `i` = entries since the flow's first one; `from` = that first entry came from an in-app page. */
interface HistPos {
  i: number;
  from: boolean;
}

function readHist(): HistPos | null {
  try {
    const h = (window.history.state as Record<string, unknown> | null)?.[HIST_KEY] as HistPos | undefined;
    return h && typeof h.i === "number" ? { i: h.i, from: !!h.from } : null;
  } catch {
    return null;
  }
}

/**
 * pushState / replaceState with our position. Only our key is passed: Next.js copies its own
 * internals over (and learns the new URL, so useSearchParams stays in sync).
 */
function writeHist(mode: "push" | "replace", url: string, pos: HistPos) {
  const data = { [HIST_KEY]: pos };
  if (mode === "push") window.history.pushState(data, "", url);
  else window.history.replaceState(data, "", url);
  rememberPos(url, pos);
}

const hereUrl = () => window.location.pathname + window.location.search;

function rememberPos(url: string, pos: HistPos) {
  try {
    const m = JSON.parse(sessionStorage.getItem(POS_KEY) || "{}") as Record<string, HistPos>;
    m[url] = pos;
    sessionStorage.setItem(POS_KEY, JSON.stringify(m));
  } catch {
    /* no storage: history.state alone */
  }
}
function recallPos(url: string): HistPos | null {
  try {
    const h = (JSON.parse(sessionStorage.getItem(POS_KEY) || "{}") as Record<string, HistPos>)[url];
    return h && typeof h.i === "number" ? { i: h.i, from: !!h.from } : null;
  } catch {
    return null;
  }
}
function forgetPos() {
  try {
    sessionStorage.removeItem(POS_KEY);
  } catch {
    /* nothing to forget */
  }
}

const stepUrl = (step: Step, stashId?: string | null) =>
  (step === "fund" || step === "live") && stashId
    ? `/hide?resume=${encodeURIComponent(stashId)}`
    : step === "type"
      ? "/hide"
      : `/hide?step=${step}`;

function stepFromUrl(): { step: Step | null; resume: string | null } {
  const q = new URLSearchParams(window.location.search);
  const raw = q.get("step");
  const step = raw && DRAFT_STEPS.includes(raw as Step) ? (raw as Step) : null;
  return { step, resume: q.get("resume") };
}


/** history.go(-n). (A hand-rolled view transition around it used to stall the next navigation by ~2s,
 *  so going back is instant, like the app's ← buttons.) `slide` is kept for call sites. */
function goBackBy(n: number, slide: boolean) {
  void slide;
  window.history.go(-n);
}

/** The app's in-app marker (set by NavTracker in src/lib/nav.ts once this tab moved around inside ZECKED). */
function cameFromApp() {
  try {
    return sessionStorage.getItem("zk:in-app") === "1" && window.history.length > 1;
  } catch {
    return false;
  }
}

/* ───────────────────────── shared styles ───────────────────────── */

const H1: CSSProperties = { margin: "var(--zk-space-8) 0 0", font: "var(--zk-type-h1)" };
const ICON_BTN: CSSProperties = {
  width: 44,
  height: 44,
  flex: "none",
  borderRadius: "var(--zk-radius-md)",
  background: "var(--zk-surface)",
  border: "none",
  padding: 0,
  color: "var(--zk-text)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};
const SMALL_LABEL: CSSProperties = {
  font: "var(--zk-type-small)",
  fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"],
  color: "var(--zk-text-muted)",
};
const CTA: CSSProperties = { marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" };
const SELECTED_CHECK: CSSProperties = {
  position: "absolute",
  right: 16,
  bottom: 18,
  width: 34,
  height: 34,
  borderRadius: "50%",
  background: "var(--zk-gold)",
  color: "var(--zk-gold-ink)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "var(--zk-shadow-chip-active)",
};

function radioKeys(select: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select();
    }
  };
}

function Spinner({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        boxSizing: "border-box",
        borderStyle: "solid",
        borderWidth: 3,
        borderColor: "rgb(var(--zk-gold-rgb) / .25)",
        borderTopColor: "var(--zk-gold)",
        willChange: "transform",
        animation: "zk-spin .9s linear infinite",
      }}
    />
  );
}

/**
 * The step's forward button. Until the step is valid it looks disabled, but a tap still lands (on a
 * see-through layer) so we can say what's missing instead of doing nothing.
 */
function NextButton({
  label,
  valid,
  busy = false,
  onNext,
  onInvalid,
}: {
  label: string;
  valid: boolean;
  busy?: boolean;
  onNext: () => void;
  onInvalid: () => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <div aria-hidden={valid ? undefined : true}>
        <Button label={label} variant="primary" size="lg" disabled={!valid || busy} sfx="whoosh" onClick={onNext} />
      </div>
      {valid ? null : (
        <button
          type="button"
          aria-label={label}
          aria-disabled="true"
          data-sfx="none"
          onClick={onInvalid}
          style={{
            position: "absolute",
            inset: 0,
            margin: 0,
            padding: 0,
            border: "none",
            borderRadius: "var(--zk-radius-2xl)",
            background: "transparent",
            cursor: "not-allowed",
            WebkitTapHighlightColor: "transparent",
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────── header ───────────────────────── */

/** ← goes to the previous step; on the first step it is a ✕ that leaves the flow. */
function StepHeader({ n, onBack, close }: { n: 1 | 2 | 3 | 4; onBack: () => void; close?: boolean }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" aria-label={close ? "Close" : "Back"} onClick={onBack} data-sfx="tap" style={ICON_BTN}>
          {close ? <Icon icon="close" size={18} stroke={2.6} /> : <Icon icon="back" size={20} stroke={2.6} />}
        </button>
        <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-text-muted)" }}>STEP {n} / 4</span>
        <div style={{ width: 44 }} />
      </div>
      <div
        role="progressbar"
        aria-label="Hide a stash progress"
        aria-valuemin={1}
        aria-valuenow={n}
        aria-valuemax={4}
        style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--zk-space-6)" }}
      >
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            style={{
              height: 6,
              borderRadius: "var(--zk-radius-xs)",
              background: i <= n ? "var(--zk-gold)" : "var(--zk-surface-raised)",
              transition: "background var(--zk-dur-base) var(--zk-ease-out)",
            }}
          />
        ))}
      </div>
    </>
  );
}

/* ───────────────────────── step 1 · type ───────────────────────── */

function TypeStep({
  type,
  onPick,
  onContinue,
  hasDraft,
  onStartFresh,
}: {
  type: StashType;
  onPick: (t: StashType) => void;
  onContinue: () => void;
  /** A saved draft was brought back: offer to throw it away. */
  hasDraft: boolean;
  onStartFresh: () => void;
}) {
  const isRiddle = type === "riddle";
  const isPred = type === "prediction";
  return (
    <>
      <h1 style={H1}>What are you hiding?</h1>
      <div role="radiogroup" aria-label="Stash type" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>
        <div
          role="radio"
          aria-checked={isRiddle}
          tabIndex={0}
          onClick={() => onPick("riddle")}
          onKeyDown={radioKeys(() => onPick("riddle"))}
          style={{
            position: "relative",
            height: 250,
            borderRadius: "var(--zk-radius-3xl)",
            overflow: "hidden",
            background:
              "radial-gradient(circle at 75% 30%,var(--zk-purple-light) 0%,var(--zk-purple-vivid) 40%,var(--zk-purple-shade) 100%)",
            boxShadow: isRiddle
              ? "0 0 0 4px var(--zk-gold), 0 8px 0 var(--zk-purple-night), var(--zk-glow-purple)"
              : "0 8px 0 var(--zk-purple-night)",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              right: -30,
              top: -30,
              width: 220,
              height: 220,
              borderRadius: "50%",
              background: "repeating-conic-gradient(rgb(var(--zk-white-rgb) / .1) 0 10deg,transparent 10deg 22deg)",
              willChange: "transform",
              animation: "zk-spin 30s linear infinite",
            }}
          />
          <div
            aria-hidden="true"
            style={
              {
                position: "absolute",
                right: 40,
                top: 30,
                width: 110,
                height: 110,
                borderRadius: "var(--zk-radius-3xl)",
                background: "var(--zk-grad-tile-gold)",
                boxShadow: "inset 0 4px 0 rgb(var(--zk-white-rgb) / .5),0 8px 0 var(--zk-gold-deep),var(--zk-glow-gold)",
                color: "var(--zk-gold-ink)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transform: "rotate(6deg)",
                animation: "zk-bob 3s ease-in-out infinite",
                "--zk-tilt": "6deg",
              } as CSSProperties
            }
          >
            <Icon icon="lock" size={60} stroke={2.4} />
          </div>
          <div
            style={{
              position: "absolute",
              left: 20,
              top: 20,
              padding: "var(--zk-space-4) var(--zk-space-10)",
              borderRadius: "var(--zk-radius-sm)",
              background: "var(--zk-pink)",
              font: "var(--zk-type-label)",
              letterSpacing: ".06em",
              transform: "rotate(-4deg)",
              boxShadow: "var(--zk-shadow-sticker-pink)",
            }}
          >
            FIRST RIGHT ANSWER WINS
          </div>
          <div style={{ position: "absolute", left: 20, bottom: 20, right: 64 }}>
            <div style={{ font: "var(--zk-fw-black) var(--zk-fs-34)/1 var(--zk-font-display)" }}>Riddle</div>
            <div
              style={{
                font: "var(--zk-type-body)",
                fontWeight: "var(--zk-fw-semibold)" as CSSProperties["fontWeight"],
                color: "rgb(var(--zk-white-rgb) / .85)",
                marginTop: "var(--zk-space-6)",
              }}
            >
              Write a riddle. Hide the answer. Watch them sweat.
            </div>
          </div>
          {isRiddle ? (
            <div style={SELECTED_CHECK}>
              <Icon icon="check" size={18} stroke={3} />
            </div>
          ) : null}
        </div>

        <div
          role="radio"
          aria-checked={isPred}
          tabIndex={0}
          onClick={() => onPick("prediction")}
          onKeyDown={radioKeys(() => onPick("prediction"))}
          style={{
            position: "relative",
            height: 250,
            borderRadius: "var(--zk-radius-3xl)",
            overflow: "hidden",
            background: "radial-gradient(circle at 75% 30%,var(--zk-aqua-light) 0%,var(--zk-aqua) 40%,var(--zk-sky-mid) 100%)",
            boxShadow: isPred
              ? "0 0 0 4px var(--zk-gold), 0 8px 0 var(--zk-sky-night), var(--zk-glow-sky)"
              : "0 8px 0 var(--zk-sky-night)",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              right: -30,
              top: -30,
              width: 220,
              height: 220,
              borderRadius: "50%",
              background: "repeating-conic-gradient(rgb(var(--zk-white-rgb) / .12) 0 10deg,transparent 10deg 22deg)",
              willChange: "transform",
              animation: "zk-spin 30s linear infinite reverse",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 40,
              top: 30,
              width: 110,
              height: 110,
              borderRadius: "50%",
              background: "var(--zk-text)",
              boxShadow: "inset 0 -6px 0 rgb(var(--zk-black-rgb) / .12),0 8px 0 rgb(var(--zk-black-rgb) / .25)",
              color: "var(--zk-sky-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "zk-bob 3.4s ease-in-out .5s infinite",
            }}
          >
            <Icon icon="ball" size={76} stroke={1.8} />
          </div>
          <div
            style={{
              position: "absolute",
              left: 20,
              top: 20,
              padding: "var(--zk-space-4) var(--zk-space-10)",
              borderRadius: "var(--zk-radius-sm)",
              background: "var(--zk-bg)",
              font: "var(--zk-type-label)",
              letterSpacing: ".06em",
              transform: "rotate(3deg)",
            }}
          >
            BAR vs CHE · 2–1?
          </div>
          <div style={{ position: "absolute", left: 20, bottom: 20, right: 64, color: "var(--zk-sky-ink)" }}>
            <div style={{ font: "var(--zk-fw-black) var(--zk-fs-34)/1 var(--zk-font-display)" }}>Prediction</div>
            <div
              style={{
                font: "var(--zk-type-body)",
                fontWeight: "var(--zk-fw-semibold)" as CSSProperties["fontWeight"],
                marginTop: "var(--zk-space-6)",
              }}
            >
              Pick a football match. First right call zecks it.
            </div>
          </div>
          {isPred ? (
            <div style={SELECTED_CHECK}>
              <Icon icon="check" size={18} stroke={3} />
            </div>
          ) : null}
        </div>
      </div>
      <div style={CTA}>
        {hasDraft ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--zk-space-6)",
              font: "var(--zk-type-small)",
              color: "var(--zk-text-muted)",
            }}
          >
            <Icon icon="check" size={14} stroke={3} color="var(--zk-mint)" />
            <span>We kept your draft.</span>
            <button
              type="button"
              onClick={onStartFresh}
              style={{
                minHeight: 44,
                padding: "0 var(--zk-space-6)",
                border: "none",
                background: "transparent",
                font: "var(--zk-type-small)",
                fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"],
                color: "var(--zk-gold)",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Start fresh
            </button>
          </div>
        ) : null}
        <Button label="Continue" variant="primary" size="lg" sfx="whoosh" onClick={onContinue} />
      </div>
    </>
  );
}

/* ───────────────────────── step 1 · sign-up gate (guests) ───────────────────────── */

function GateStep({ href }: { href: string }) {
  return (
    <>
      <h1 style={H1}>Sign up to hide a stash.</h1>
      <div
        style={{
          position: "relative",
          height: 280,
          flex: "none",
          borderRadius: "var(--zk-radius-3xl)",
          overflow: "hidden",
          background: "radial-gradient(circle at 75% 30%,var(--zk-purple-light) 0%,var(--zk-purple-vivid) 40%,var(--zk-purple-shade) 100%)",
          boxShadow: "0 8px 0 var(--zk-purple-night), var(--zk-glow-purple)",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: -30,
            top: -30,
            width: 220,
            height: 220,
            borderRadius: "50%",
            background: "repeating-conic-gradient(rgb(var(--zk-white-rgb) / .1) 0 10deg,transparent 10deg 22deg)",
            willChange: "transform",
            animation: "zk-spin 30s linear infinite",
          }}
        />
        <div
          aria-hidden="true"
          style={
            {
              position: "absolute",
              right: 40,
              top: 30,
              width: 110,
              height: 110,
              borderRadius: "var(--zk-radius-3xl)",
              background: "var(--zk-grad-tile-gold)",
              boxShadow: "inset 0 4px 0 rgb(var(--zk-white-rgb) / .5),0 8px 0 var(--zk-gold-deep),var(--zk-glow-gold)",
              color: "var(--zk-gold-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: "rotate(6deg)",
              animation: "zk-bob 3s ease-in-out infinite",
              "--zk-tilt": "6deg",
            } as CSSProperties
          }
        >
          <Icon icon="wallet" size={58} stroke={2.4} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 20,
            top: 20,
            padding: "var(--zk-space-4) var(--zk-space-10)",
            borderRadius: "var(--zk-radius-sm)",
            background: "var(--zk-pink)",
            font: "var(--zk-type-label)",
            letterSpacing: ".06em",
            transform: "rotate(-4deg)",
            boxShadow: "var(--zk-shadow-sticker-pink)",
          }}
        >
          HIDERS NEED A WALLET
        </div>
        <div style={{ position: "absolute", left: 20, bottom: 20, right: 20 }}>
          <div style={{ font: "var(--zk-fw-black) var(--zk-fs-26)/1.1 var(--zk-font-display)" }}>
            Your stash, your wallet, your rules.
          </div>
          <div
            style={{
              font: "var(--zk-type-body)",
              fontWeight: "var(--zk-fw-semibold)" as CSSProperties["fontWeight"],
              color: "rgb(var(--zk-white-rgb) / .85)",
              marginTop: "var(--zk-space-6)",
            }}
          >
            Fund it in one tap. If nobody cracks it, the ZEC comes straight back to you.
          </div>
        </div>
      </div>
      <div style={CTA}>
        <Button label="Sign up" variant="primary" size="lg" href={href} />
        <Button label="Just crack stashes for now" variant="ghost" size="md" href="/feed" />
      </div>
    </>
  );
}

/* ───────────────────────── step 2a · riddle ───────────────────────── */

function StrengthMeter({ strength }: { strength: Strength }) {
  const lvl = strength.level;
  const st = lvl >= 0 ? STRENGTH[lvl] : null;
  const color = strength.warn ? "var(--zk-red)" : st ? st.color : "var(--zk-text-faint)";
  return (
    <div style={{ background: "var(--zk-surface)", borderRadius: "var(--zk-radius-2xl)", padding: "var(--zk-space-16)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ font: "var(--zk-type-h4)" }}>Riddle strength</span>
        <span style={{ font: "var(--zk-type-btn-md)", color }}>{st ? st.label : "–"}</span>
      </div>
      <div
        role="meter"
        aria-label="Riddle strength"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={Math.max(0, lvl)}
        aria-valuetext={st ? st.label : "Not scored yet"}
        style={{ marginTop: "var(--zk-space-12)", display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "var(--zk-space-6)" }}
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const on = lvl >= 0 && i <= lvl;
          return (
            <span
              key={i}
              style={{
                height: 14,
                borderRadius: "var(--zk-radius-pill)",
                background: on ? color : "var(--zk-surface-raised)",
                boxShadow: on ? `0 0 12px ${color}` : "none",
                transition: "background var(--zk-dur-base) var(--zk-ease-out)",
              }}
            />
          );
        })}
      </div>
      <div
        aria-hidden="true"
        style={{
          marginTop: "var(--zk-space-8)",
          display: "flex",
          justifyContent: "space-between",
          font: "var(--zk-fw-bold) var(--zk-fs-10)/1 var(--zk-font-body)",
          color: "var(--zk-text-muted)",
          letterSpacing: ".04em",
        }}
      >
        <span>WEAK</span>
        <span>OKAY</span>
        <span>TRICKY</span>
        <span>BRUTAL</span>
        <span>UNCRACKABLE</span>
      </div>
      <div
        aria-live="polite"
        style={{
          marginTop: "var(--zk-space-10)",
          font: "var(--zk-type-caption)",
          fontWeight: "var(--zk-fw-medium)" as CSSProperties["fontWeight"],
          color: strength.warn ? "var(--zk-red-soft)" : "var(--zk-text-muted)",
        }}
      >
        {strength.tip}
      </div>
    </div>
  );
}

/** A field label with its character counter on the right. */
function FieldLabel({ htmlFor, text, count, max }: { htmlFor: string; text: string; count: number; max: number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--zk-space-8)", marginBottom: -2 }}>
      <label htmlFor={htmlFor} style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
        {text}
      </label>
      <span
        aria-hidden="true"
        style={{
          font: "var(--zk-type-mono-xs)",
          fontVariantNumeric: "tabular-nums",
          color: count >= max ? "var(--zk-orange)" : "var(--zk-text-faint)",
        }}
      >
        {count} / {max}
      </span>
    </div>
  );
}

const ANSWER_ID = "zk-hide-answer";

function RiddleStep({
  draft,
  patch,
  onNext,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  onNext: () => void;
}) {
  // The answer starts masked (it's a secret), but it is a plain text field: no password-manager prompts.
  const [showAnswer, setShowAnswer] = useState(false);
  // Autofocus the hint only when it was just opened (not when coming back to this step).
  const [focusHint, setFocusHint] = useState(false);
  // Errors turn red once they tried to move on; before that the hints stay calm.
  const [tried, setTried] = useState(false);
  const [shake, setShake] = useState({ riddle: 0, answer: 0 });
  const strength = useMemo(() => riddleStrengthAll(draft.riddle, draft.answer), [draft.riddle, draft.answer]);
  const issues = riddleIssues(draft);
  const valid = !issues.riddle && !issues.answer;
  const riddleLen = draft.riddle.trim().length;

  // The shared <Input> has no pass-through props: tag the answer field so password managers and
  // autocorrect leave it alone, and mask it with CSS instead of type="password".
  useEffect(() => {
    const el = document.getElementById(ANSWER_ID) as HTMLInputElement | null;
    if (!el) return;
    el.setAttribute("data-1p-ignore", "true");
    el.setAttribute("data-lpignore", "true");
    el.setAttribute("data-bwignore", "true");
    el.setAttribute("data-form-type", "other");
    el.setAttribute("autocapitalize", "none");
    el.setAttribute("autocorrect", "off");
    el.style.setProperty("-webkit-text-security", showAnswer ? "none" : "disc");
  }, [showAnswer]);

  const onInvalid = () => {
    setTried(true);
    sfx("error");
    setShake((s) => ({ riddle: s.riddle + (issues.riddle ? 1 : 0), answer: s.answer + (issues.answer ? 1 : 0) }));
  };

  const riddleMsg = issues.riddle && (tried || riddleLen > 0) ? issues.riddle : `${RIDDLE_MIN}–${RIDDLE_MAX} characters.`;
  const answerErr = tried ? issues.answer : undefined;

  return (
    <>
      <h1 style={H1}>Make it tricky.</h1>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
        <FieldLabel htmlFor="zk-hide-riddle" text="Your riddle" count={draft.riddle.length} max={RIDDLE_MAX} />
        <Input
          id="zk-hide-riddle"
          ariaLabel="Your riddle"
          multiline
          height={132}
          font="display"
          value={draft.riddle}
          onChange={(v) => patch({ riddle: v.slice(0, RIDDLE_MAX) })}
          maxLength={RIDDLE_MAX}
          placeholder="I have cities, but no houses. Forests, but no trees. What am I?"
          state={tried && issues.riddle ? "error" : undefined}
          shake={shake.riddle}
          message={riddleMsg}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
        <FieldLabel htmlFor={ANSWER_ID} text="The answer" count={draft.answer.length} max={ANSWER_MAX} />
        <Input
          id={ANSWER_ID}
          ariaLabel="The answer"
          size="md"
          type="text"
          value={draft.answer}
          onChange={(v) => patch({ answer: v.slice(0, ANSWER_MAX) })}
          maxLength={ANSWER_MAX}
          placeholder="Only you know it"
          autoComplete="off"
          spellCheck={false}
          state={answerErr ? "error" : undefined}
          shake={shake.answer}
          message={
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span>{answerErr ?? "Not case-sensitive."}</span>
              <span style={{ color: "var(--zk-text-muted)" }}>
                “A”, “an” and “the” don’t count. More than one right answer? Separate them with{" "}
                <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text)" }}>|</span>, like{" "}
                <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text)", whiteSpace: "nowrap" }}>map | atlas</span>.
              </span>
            </span>
          }
          trailing={
            <button
              type="button"
              onClick={() => setShowAnswer((v) => !v)}
              aria-label={showAnswer ? "Hide answer" : "Show answer"}
              aria-pressed={showAnswer}
              data-sfx="tap"
              style={{
                width: 44,
                height: 44,
                margin: "0 -8px 0 0",
                padding: 0,
                border: "none",
                borderRadius: "50%",
                background: "transparent",
                color: "var(--zk-text-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <Icon icon={showAnswer ? "eyeOff" : "eye"} size={18} stroke={2.6} />
            </button>
          }
        />
      </div>
      <StrengthMeter strength={strength} />
      {draft.hintOpen ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "-10px 0 -10px" }}>
            <label htmlFor="zk-hide-hint" style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
              Bonus hint (unlocks later)
            </label>
            <button
              type="button"
              onClick={() => patch({ hintOpen: false, hint: "" })}
              data-sfx="tap"
              style={{
                minWidth: 44,
                height: 44,
                border: "none",
                background: "transparent",
                padding: "0 0 0 var(--zk-space-12)",
                font: "var(--zk-type-caption)",
                fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"],
                color: "var(--zk-text-muted)",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              Remove
            </button>
          </div>
          <Input
            id="zk-hide-hint"
            size="sm"
            value={draft.hint}
            onChange={(v) => patch({ hint: v.slice(0, HINT_MAX) })}
            maxLength={HINT_MAX}
            autoFocus={focusHint}
            placeholder="A nudge for when they’re stuck"
            message={`Optional · ${draft.hint.length} / ${HINT_MAX}`}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setFocusHint(true);
            patch({ hintOpen: true });
          }}
          style={{
            height: "var(--zk-h-btn-md)",
            borderRadius: "var(--zk-radius-lg)",
            border: "1.5px dashed rgb(var(--zk-white-rgb) / .2)",
            background: "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--zk-space-8)",
            font: "var(--zk-type-body-strong)",
            color: "var(--zk-text-muted)",
            cursor: "pointer",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <Icon icon="bulb" size={18} />
          Add a bonus hint (unlocks later)
        </button>
      )}
      <div style={CTA}>
        <NextButton label="Next: set the prize" valid={valid} onNext={onNext} onInvalid={onInvalid} />
      </div>
    </>
  );
}

/* ───────────────────────── step 2b · prediction ───────────────────────── */

function MatchRow({
  m,
  now,
  selected,
  tooSoon,
  onSelect,
  onTooSoon,
}: {
  m: Match;
  now: number;
  selected: boolean;
  /** Kicks off too soon to hide a stash on: shown greyed out, not selectable. */
  tooSoon: boolean;
  onSelect: () => void;
  onTooSoon: () => void;
}) {
  const until = untilKickoff(m.kickoff, now);
  // The countdown leads (it's what matters when picking); the league can get cut off.
  const when = until ? `Kicks off in ${until}` : formatKickoff(m.kickoff);
  const tap = tooSoon ? onTooSoon : onSelect;
  return (
    <div
      role="radio"
      aria-checked={selected}
      aria-disabled={tooSoon || undefined}
      tabIndex={0}
      onClick={tap}
      onKeyDown={radioKeys(tap)}
      data-sfx={tooSoon ? "none" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-10)",
        padding: "var(--zk-space-10) var(--zk-space-12)",
        borderRadius: "var(--zk-radius-xl)",
        background: selected ? "var(--zk-sky-tint)" : "var(--zk-surface)",
        border: `2px solid ${selected ? "var(--zk-sky)" : "transparent"}`,
        cursor: tooSoon ? "not-allowed" : "pointer",
        opacity: tooSoon ? 0.5 : 1,
        flex: "none",
        transition: "opacity var(--zk-dur-base) var(--zk-ease-out)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ display: "flex", flex: "none", filter: tooSoon ? "grayscale(.8)" : undefined }}>
        <TeamBadge code={m.home.code} color={m.home.color} ink={m.home.ink} logo={m.home.logo} name={m.home.name} size={38} />
        <div style={{ marginLeft: -8 }}>
          <TeamBadge code={m.away.code} color={m.away.color} ink={m.away.ink} logo={m.away.logo} name={m.away.name} size={38} />
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* The test-match sticker sits by the names and drops under them when a small phone runs out of room. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: "var(--zk-space-6)", rowGap: 3, minWidth: 0 }}>
          <span style={{ font: "var(--zk-type-h4)", whiteSpace: "nowrap" }}>
            {m.home.code} vs {m.away.code}
          </span>
          {m.demo ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                flex: "none",
                padding: "3px 6px 3px 4px",
                borderRadius: "var(--zk-radius-xs)",
                background: "var(--zk-gold)",
                color: "var(--zk-gold-ink)",
                font: "var(--zk-fw-black) var(--zk-fs-10)/1 var(--zk-font-body)",
                letterSpacing: ".06em",
                boxShadow: "var(--zk-shadow-chip-active)",
              }}
            >
              <Icon icon="bolt" size={10} stroke={2.6} filled />
              TEST MATCH
            </span>
          ) : null}
        </div>
        <div
          style={{
            font: "var(--zk-type-caption)",
            fontWeight: "var(--zk-fw-medium)" as CSSProperties["fontWeight"],
            fontVariantNumeric: "tabular-nums",
            color: "var(--zk-text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {tooSoon ? (
            <>
              <b style={{ color: "var(--zk-text)" }}>Too soon</b> · {until ? `kicks off in ${until}` : "kicking off now"}
            </>
          ) : (
            <>
              <span style={{ color: "var(--zk-text)" }}>{when}</span>
              {m.demo ? null : <> · {m.leagueName}</>}
            </>
          )}
        </div>
      </div>
      {tooSoon ? (
        <span aria-hidden="true" style={{ flex: "none", display: "flex", color: "var(--zk-text-faint)" }}>
          <Icon icon="clock" size={20} />
        </span>
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: 22,
            height: 22,
            flex: "none",
            borderRadius: "50%",
            boxSizing: "border-box",
            border: `2px solid ${selected ? "var(--zk-sky)" : "var(--zk-border-strong)"}`,
            background: selected ? "var(--zk-sky)" : "transparent",
          }}
        />
      )}
    </div>
  );
}

function MatchSkeleton() {
  return (
    <div
      aria-hidden="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-10)",
        padding: "var(--zk-space-10) var(--zk-space-12)",
        borderRadius: "var(--zk-radius-xl)",
        background: "var(--zk-surface)",
        border: "2px solid transparent",
        flex: "none",
        animation: "zk-glow 1.4s ease-in-out infinite",
      }}
    >
      <div style={{ display: "flex" }}>
        <span style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--zk-surface-raised)" }} />
        <span
          style={{
            width: 38,
            height: 38,
            marginLeft: -8,
            borderRadius: "50%",
            background: "var(--zk-surface-raised)",
            boxShadow: "0 0 0 2px var(--zk-surface)",
          }}
        />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ width: "46%", height: 14, borderRadius: "var(--zk-radius-xs)", background: "var(--zk-surface-raised)" }} />
        <span style={{ width: "70%", height: 10, borderRadius: "var(--zk-radius-xs)", background: "var(--zk-surface-raised)" }} />
      </div>
      <span style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid var(--zk-border-strong)", boxSizing: "border-box" }} />
    </div>
  );
}

function KindCard({
  selected,
  icon,
  title,
  sub,
  onSelect,
}: {
  selected: boolean;
  icon: string;
  title: string;
  sub: string;
  onSelect: () => void;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={radioKeys(onSelect)}
      style={{
        padding: "var(--zk-space-12)",
        borderRadius: "var(--zk-radius-lg)",
        background: selected ? "var(--zk-gold-tint)" : "var(--zk-surface)",
        border: `2px solid ${selected ? "var(--zk-gold)" : "transparent"}`,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", font: "var(--zk-type-h4)" }}>
        <Icon icon={icon} size={16} />
        {title}
      </div>
      <div
        style={{
          font: "var(--zk-fw-medium) var(--zk-fs-11)/1.3 var(--zk-font-body)",
          color: "var(--zk-text-muted)",
          marginTop: "var(--zk-space-2)",
        }}
      >
        {sub}
      </div>
    </div>
  );
}

function PredictionStep({
  draft,
  patch,
  matches,
  matchesError,
  onRetry,
  onNext,
  onToast,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  matches: Match[] | null;
  matchesError: string | null;
  onRetry: () => void;
  onNext: () => void;
  onToast: (text: string, variant?: ToastVariant, icon?: string, sound?: false) => void;
}) {
  const [q, setQ] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  // Ticks every second: kickoff countdowns, and matches greying out as kickoff gets close.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const upcoming = useMemo(
    () =>
      (matches ?? [])
        .filter((m) => m.status === "scheduled")
        .sort((a, b) => Number(!!b.demo) - Number(!!a.demo) || Date.parse(a.kickoff) - Date.parse(b.kickoff)),
    [matches],
  );
  const shown = useMemo(() => upcoming.filter((m) => matchesQuery(m, q)), [upcoming, q]);
  const loading = matches === null && !matchesError;
  const selected = upcoming.find((m) => m.id === draft.matchId);
  const selectedTooSoon = !!selected && kicksOffTooSoon(selected, now, PICK_PAD_MS);
  const valid = !!selected && !selectedTooSoon;

  // A picked match that is now about to kick off (or gone from the list) can't be hidden on anymore.
  useEffect(() => {
    if (!draft.matchId || matches === null) return;
    if (!selected) {
      patch({ matchId: null });
    } else if (selectedTooSoon) {
      patch({ matchId: null });
      onToast(`${selected.home.code} vs ${selected.away.code} is about to kick off. Pick another match.`, "default", "clock");
    }
  }, [draft.matchId, matches, selected, selectedTooSoon, patch, onToast]);

  const onTooSoon = () => {
    sfx("error");
    onToast("That one kicks off too soon. Pick a later match so people have time to call it.", "default", "clock", false);
  };
  const onInvalid = () => {
    sfx("error");
    onToast(loading ? "Matches are still loading…" : "Pick a match first.", "default", "ball", false);
  };

  let list: ReactNode;
  if (loading) {
    list = [0, 1, 2, 3, 4].map((i) => <MatchSkeleton key={i} />);
  } else if (matchesError && matches === null) {
    list = (
      <div
        style={{
          padding: "var(--zk-space-24) var(--zk-space-16)",
          borderRadius: "var(--zk-radius-xl)",
          background: "var(--zk-surface)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--zk-space-10)",
          textAlign: "center",
        }}
      >
        <span style={{ font: "var(--zk-type-h4)" }}>Couldn’t load matches</span>
        <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>{matchesError}</span>
        <Chip label="Try again" onClick={onRetry} style={{ height: 44 }} />
      </div>
    );
  } else if (!shown.length) {
    list = (
      <div
        style={{
          padding: "var(--zk-space-24) var(--zk-space-16)",
          borderRadius: "var(--zk-radius-xl)",
          background: "var(--zk-surface)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--zk-space-6)",
          textAlign: "center",
          color: "var(--zk-text-muted)",
        }}
      >
        <Icon icon="ball" size={28} stroke={1.8} />
        <span style={{ font: "var(--zk-type-h4)", color: "var(--zk-text)" }}>No upcoming matches found</span>
        {q.trim() ? <span style={{ font: "var(--zk-type-caption)" }}>Try another team or league.</span> : null}
      </div>
    );
  } else {
    list = shown.map((m) => (
      <MatchRow
        key={m.id}
        m={m}
        now={now}
        selected={draft.matchId === m.id}
        tooSoon={kicksOffTooSoon(m, now, PICK_PAD_MS)}
        onSelect={() => patch({ matchId: m.id })}
        onTooSoon={onTooSoon}
      />
    ));
  }

  return (
    <>
      <h1 style={H1}>Pick a match.</h1>
      <label
        style={{
          height: 46,
          flex: "none",
          borderRadius: "var(--zk-radius-lg)",
          background: "var(--zk-surface)",
          display: "flex",
          alignItems: "center",
          gap: "var(--zk-space-10)",
          padding: "0 var(--zk-space-14)",
          color: "var(--zk-text-muted)",
          boxShadow: searchFocused ? "0 0 0 2px var(--zk-purple), var(--zk-ring-focus)" : "none",
          transition: "box-shadow var(--zk-dur-fast) var(--zk-ease-out)",
          cursor: "text",
        }}
      >
        <Icon icon="search" size={18} />
        <input
          type="search"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="Search teams or leagues"
          aria-label="Search teams or leagues"
          autoComplete="off"
          style={{
            flex: 1,
            minWidth: 0,
            height: "100%",
            border: "none",
            outline: "none",
            background: "transparent",
            padding: 0,
            font: "var(--zk-type-body)",
            fontSize: "var(--zk-fs-15)",
            color: "var(--zk-text)",
            appearance: "none",
          }}
        />
      </label>
      <div
        role="radiogroup"
        aria-label="Upcoming matches"
        aria-busy={loading}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--zk-space-8)",
          maxHeight: "min(346px, 46dvh)",
          overflowY: "auto",
          overscrollBehavior: "contain",
          margin: "0 calc(var(--zk-space-4) * -1)",
          padding: "0 var(--zk-space-4)",
        }}
      >
        {list}
      </div>
      <div style={{ ...SMALL_LABEL, marginTop: "var(--zk-space-4)" }}>What do they call?</div>
      <div role="radiogroup" aria-label="What do they call?" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--zk-space-8)" }}>
        <KindCard
          selected={draft.kind === "exact"}
          icon="target"
          title="Exact score"
          sub="Harder. Bigger flex."
          onSelect={() => patch({ kind: "exact" })}
        />
        <KindCard
          selected={draft.kind === "winner"}
          icon="flag"
          title="Winner"
          sub="Easier. Fast crowd."
          onSelect={() => patch({ kind: "winner" })}
        />
      </div>
      <div style={CTA}>
        <NextButton label="Next: set the prize" valid={valid} onNext={onNext} onInvalid={onInvalid} />
      </div>
    </>
  );
}

/* ───────────────────────── step 3 · amount ───────────────────────── */

function PrizeSlider({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [focused, setFocused] = useState(false);
  const span = Math.max(1, max - min);
  const pct = `${((clamp(value, min, max) - min) / span) * 100}%`;

  const setFromX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const p = clamp((clientX - b.left) / (b.width || 1), 0, 1);
    onChange(Math.round(min + p * span));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* older browsers */
    }
    setFromX(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setFromX(e.clientX);
  };
  const stop = () => {
    dragging.current = false;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const big = Math.max(1, Math.round(span / 10));
    const next =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? value + 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? value - 1
          : e.key === "PageUp"
            ? value + big
            : e.key === "PageDown"
              ? value - big
              : e.key === "Home"
                ? min
                : e.key === "End"
                  ? max
                  : null;
    if (next === null) return;
    e.preventDefault();
    onChange(clamp(next, min, max));
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Prize in US dollars"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`$${value}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        position: "relative",
        height: 44,
        flex: "none",
        touchAction: "none",
        cursor: "pointer",
        outline: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 15,
          height: 14,
          borderRadius: "var(--zk-radius-pill)",
          background: "var(--zk-surface-raised)",
          boxShadow: "inset 0 2px 0 rgb(var(--zk-black-rgb) / .4)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 15,
          height: 14,
          width: pct,
          borderRadius: "var(--zk-radius-pill)",
          background: "var(--zk-grad-gold)",
          boxShadow: "0 0 16px rgb(var(--zk-gold-rgb) / .5)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 4,
          left: pct,
          marginLeft: -18,
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "var(--zk-text)",
          boxShadow: `var(--zk-shadow-btn-light-pressed),0 0 0 ${focused ? 8 : 6}px rgb(var(--zk-gold-rgb) / ${focused ? ".45" : ".25"})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          transition: "box-shadow var(--zk-dur-fast) var(--zk-ease-out)",
        }}
      >
        <Logo variant="mark" size={16} stroke="var(--zk-gold-ink)" />
      </div>
    </div>
  );
}

function AmountStep({
  draft,
  patch,
  config,
  creating,
  walletBalance,
  match,
  matchGone,
  onNext,
  onPickAnother,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  config: AppConfig | null;
  creating: boolean;
  /** ZECKED wallet balance in zat (null = unknown / still loading). */
  walletBalance: number | null;
  /** The picked match (predictions), once matches are loaded. */
  match: Match | undefined;
  /** Predictions: matches are loaded and the picked one isn't upcoming anymore (it started). */
  matchGone: boolean;
  onNext: () => void;
  onPickAnother: () => void;
}) {
  const min = Math.max(1, Math.ceil(config?.minStashUsd ?? FALLBACK_MIN_USD));
  const max = Math.max(min, Math.floor(config?.maxStashUsd ?? FALLBACK_MAX_USD));
  const usd = clamp(draft.usd, min, max);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  const zecZat = config?.zecUsd ? Math.round((usd / config.zecUsd) * ZAT) : null;
  const zec = zecZat != null ? formatZec(zecZat, 4) : "…";
  const active = customOpen ? "Custom" : (PRESETS.find((p) => p.usd === usd)?.label ?? "Custom");
  const isPrediction = draft.type === "prediction";

  // Predictions: the server wants the match to still be far enough from kickoff when the stash is made.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isPrediction) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isPrediction]);
  const matchTooSoon = isPrediction && (matchGone || (!!match && kicksOffTooSoon(match, now, 5_000)));
  const short = walletBalance != null && zecZat != null && walletBalance < zecZat;

  const setUsd = (v: number) => {
    const n = clamp(Math.round(v), min, max);
    patch({ usd: n });
    if (customOpen) setCustomText(String(n));
  };

  const presetStyle = (on: boolean, disabled = false): CSSProperties => ({
    height: 48,
    borderRadius: "var(--zk-radius-lg)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "var(--zk-type-h4)",
    background: on ? "var(--zk-gold)" : "var(--zk-surface)",
    color: on ? "var(--zk-gold-ink)" : "var(--zk-text)",
    boxShadow: on ? "var(--zk-shadow-chip-active)" : "none",
    border: "none",
    padding: 0,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    WebkitTapHighlightColor: "transparent",
  });

  return (
    <>
      <h1 style={H1}>How much is inside?</h1>
      <div
        aria-live="polite"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "var(--zk-space-18) 0 var(--zk-space-6)" }}
      >
        <div
          style={{
            font: "var(--zk-type-amount-xl)",
            color: "var(--zk-gold)",
            letterSpacing: "-.03em",
            textShadow: "var(--zk-text-shadow-gold)",
          }}
        >
          ${usd}
        </div>
        <div style={{ font: "var(--zk-type-mono)", fontSize: "var(--zk-fs-18)", marginTop: "var(--zk-space-12)" }}>{zec} ZEC</div>
        <div
          style={{
            marginTop: "var(--zk-space-6)",
            minHeight: 18,
            font: "var(--zk-type-caption)",
            fontWeight: "var(--zk-fw-medium)" as CSSProperties["fontWeight"],
            color: short ? "var(--zk-gold)" : "var(--zk-text-muted)",
            textAlign: "center",
            maxWidth: "100%",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {walletBalance == null
            ? " "
            : walletBalance <= 0
              ? "Your wallet is empty · test ZEC is free"
              : short
                ? `You have ${fmtBal(walletBalance)} test ZEC · add more next`
                : `You have ${fmtBal(walletBalance)} test ZEC`}
        </div>
      </div>
      <PrizeSlider value={usd} min={min} max={max} onChange={setUsd} />
      <div style={{ display: "flex", justifyContent: "space-between", font: "var(--zk-type-mono-xs)", color: "var(--zk-text-muted)" }}>
        <span>${min}</span>
        <span>${max}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--zk-space-8)" }}>
        {PRESETS.map((p) => {
          const disabled = p.usd < min || p.usd > max;
          const on = active === p.label;
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => {
                setCustomOpen(false);
                patch({ usd: p.usd });
              }}
              style={presetStyle(on, disabled)}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={active === "Custom"}
          aria-expanded={customOpen}
          onClick={() => {
            setCustomText(String(usd));
            setCustomOpen(true);
          }}
          style={presetStyle(active === "Custom")}
        >
          Custom
        </button>
      </div>
      {customOpen ? (
        <Input
          size="sm"
          type="text"
          inputMode="numeric"
          autoFocus
          ariaLabel="Custom amount in US dollars"
          placeholder={`$${min}–$${max}`}
          value={customText}
          onChange={(v) => {
            const digits = v.replace(/\D/g, "").slice(0, 5);
            if (!digits) {
              setCustomText("");
              return;
            }
            const n = parseInt(digits, 10);
            setCustomText(n > max ? String(max) : digits);
            patch({ usd: clamp(n, min, max) });
          }}
          onEnter={() => setCustomText(String(usd))}
          message={`Between $${min} and $${max}.`}
          trailing={<span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text-muted)" }}>USD</span>}
        />
      ) : null}
      <div style={{ ...SMALL_LABEL, marginTop: "var(--zk-space-6)" }}>Expires in</div>
      {isPrediction ? (
        <div style={{ display: "flex" }}>
          <Chip variant="info" icon="flag" label="Resolves at full time" />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--zk-space-8)" }}>
          {EXPIRIES.map((x) => (
            <Chip
              key={x.hours}
              label={x.label}
              size="sm"
              active={draft.expiryHours === x.hours}
              onClick={() => patch({ expiryHours: x.hours })}
              style={{ height: 44, width: "100%", justifyContent: "center", padding: 0 }}
            />
          ))}
        </div>
      )}
      <div
        style={{
          display: "flex",
          gap: "var(--zk-space-10)",
          alignItems: "flex-start",
          padding: "var(--zk-space-12) var(--zk-space-14)",
          borderRadius: "var(--zk-radius-lg)",
          background: "var(--zk-surface)",
          font: "var(--zk-type-small)",
          fontWeight: "var(--zk-fw-medium)" as CSSProperties["fontWeight"],
          color: "var(--zk-text-muted)",
        }}
      >
        <span style={{ color: "var(--zk-purple-light)", display: "flex", flex: "none" }}>
          <Icon icon="shield" size={18} />
        </span>
        {isPrediction ? (
          <span>If nobody calls it, the ZEC comes back to you.</span>
        ) : (
          <span>
            If nobody cracks it, the ZEC comes back to you. And you earn <b style={{ color: "var(--zk-text)" }}>Uncrackable</b>.
          </span>
        )}
      </div>
      <div style={CTA}>
        {matchTooSoon ? (
          <>
            <div
              role="alert"
              style={{
                display: "flex",
                gap: "var(--zk-space-10)",
                alignItems: "flex-start",
                padding: "var(--zk-space-12) var(--zk-space-14)",
                borderRadius: "var(--zk-radius-lg)",
                background: "var(--zk-gold-tint)",
                font: "var(--zk-type-small)",
                color: "var(--zk-text)",
              }}
            >
              <span style={{ color: "var(--zk-gold)", display: "flex", flex: "none" }}>
                <Icon icon="clock" size={18} />
              </span>
              <span>
                {match && !matchGone
                  ? `${match.home.code} vs ${match.away.code} is about to kick off, so there’s no time left to call it. Pick a later match.`
                  : "That match has already kicked off. Pick another one."}
              </span>
            </div>
            <Button label="Pick another match" variant="primary" size="lg" onClick={onPickAnother} />
          </>
        ) : (
          <Button
            label={creating ? "Hiding it…" : "Next: fund it"}
            variant="primary"
            size="lg"
            sfx="whoosh"
            disabled={creating}
            onClick={onNext}
          />
        )}
      </div>
    </>
  );
}

/* ───────────────────────── step 4a · fund ───────────────────────── */

function RefundNote({ type }: { type: StashType }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--zk-space-10)",
        alignItems: "flex-start",
        padding: "var(--zk-space-12) var(--zk-space-14)",
        borderRadius: "var(--zk-radius-lg)",
        background: "var(--zk-surface)",
        font: "var(--zk-type-small)",
        fontWeight: "var(--zk-fw-medium)" as CSSProperties["fontWeight"],
        color: "var(--zk-text-muted)",
      }}
    >
      <span style={{ color: "var(--zk-purple-light)", display: "flex", flex: "none" }}>
        <Icon icon="shield" size={18} />
      </span>
      <span>If nobody {type === "prediction" ? "calls" : "cracks"} it, the ZEC goes back to your ZECKED wallet.</span>
    </div>
  );
}

/**
 * Three ways to fund:
 *  - enough in the ZECKED wallet → one-tap "Pay from my ZECKED wallet", the QR flow folded underneath;
 *  - not enough → "Add free test ZEC" (the wallet's Add ZEC; the draft waits here), QR folded underneath;
 *  - no wallet info, or already paid / expired → the QR flow, open.
 */
function FundStep({
  stash,
  qrSrc,
  qrFailed,
  fundedZat,
  testMode,
  checking,
  simulating,
  walletBalance,
  walletPending,
  walletLoading,
  paying,
  canGoBack,
  onPayFromBalance,
  onCopyAddress,
  onSent,
  onSimulate,
  onGoLive,
  onStartOver,
  onSmaller,
}: {
  stash: PublicStash;
  qrSrc: string | null;
  qrFailed: boolean;
  fundedZat: number;
  testMode: boolean;
  checking: boolean;
  simulating: boolean;
  /** ZECKED wallet balance, or null when there is no wallet info. */
  walletBalance: number | null;
  /** Test ZEC seen on its way into the wallet (not spendable yet). */
  walletPending: number;
  walletLoading: boolean;
  paying: boolean;
  /** There is a prize step to go back to (not a bare ?resume= link). */
  canGoBack: boolean;
  onPayFromBalance: () => void;
  onCopyAddress: () => void;
  onSent: () => void;
  onSimulate: () => void;
  onGoLive: () => void;
  onStartOver: () => void;
  onSmaller: () => void;
}) {
  const [qrOpen, setQrOpen] = useState(false);
  const funding = stash.funding;
  const paid = isFunded(stash);
  const dead = isDead(stash);
  const amountZat = funding?.amountZat ?? stash.amountZat;
  const partial = !paid && fundedZat > 0 && fundedZat < amountZat;
  // The server charges the stash amount (`stash.amountZat`) from the balance.
  const chargeZat = stash.amountZat;
  const feeZat = Math.max(0, amountZat - chargeZat);
  const open = !paid && !dead;
  const canPay = open && walletBalance != null && walletBalance >= chargeZat;
  // While the balance loads, assume the one-tap path (fold the QR) so the screen doesn't jump.
  const payPath = open && (walletLoading || canPay);
  const lowPath = open && !walletLoading && walletBalance != null && !canPay;
  // A payment already coming in by QR keeps the QR open.
  const showQr = (!payPath && !lowPath) || qrOpen || partial;

  const statusText = paid
    ? "ZEC detected!"
    : dead
      ? "This stash expired before the ZEC arrived."
      : partial
        ? `Got ${formatZec(fundedZat, 8)} ZEC so far. Send the remaining ${formatZec(amountZat - fundedZat, 8)} ZEC.`
        : "Waiting for your ZEC… usually under a minute.";

  const qrBlock = (
    <>
      <div
        role="img"
        aria-label="Payment QR code"
        style={{
          alignSelf: "center",
          flex: "none",
          width: 250,
          height: 250,
          borderRadius: "var(--zk-radius-3xl)",
          background: "var(--zk-text)",
          padding: "var(--zk-space-18)",
          boxSizing: "border-box",
          position: "relative",
          boxShadow: "0 0 0 6px rgb(var(--zk-gold-rgb) / .25),var(--zk-shadow-float)",
          opacity: dead ? 0.35 : 1,
        }}
      >
        {qrSrc ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="" width={214} height={214} style={{ display: "block", width: 214, height: 214 }} />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%,-50%)",
                padding: 4,
                background: "var(--zk-text)",
                borderRadius: "var(--zk-radius-md)",
                display: "flex",
                lineHeight: 0,
              }}
            >
              <Logo variant="icon" size={30} />
            </div>
          </>
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: "var(--zk-type-caption)",
              color: "var(--zk-bg)",
              textAlign: "center",
            }}
          >
            {qrFailed ? "Couldn’t draw the QR. Copy the address below." : <Spinner />}
          </div>
        )}
      </div>
      {funding ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--zk-space-10)",
              padding: "var(--zk-space-6) var(--zk-space-6) var(--zk-space-6) var(--zk-space-16)",
              borderRadius: "var(--zk-radius-lg)",
              background: "var(--zk-surface)",
            }}
          >
            <span
              title={funding.address}
              style={{
                flex: 1,
                minWidth: 0,
                font: "var(--zk-fw-medium) var(--zk-fs-14)/1 var(--zk-font-mono)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {shortAddr(funding.address)}
            </span>
            <Button
              label="Copy"
              icon="copy"
              variant="secondary"
              size="sm"
              full={false}
              ariaLabel="Copy wallet address"
              onClick={onCopyAddress}
              style={{ height: 44 }}
            />
          </div>
          {open ? <Button label="Open in wallet" icon="wallet" variant="ghost" size="md" href={funding.uri} /> : null}
        </>
      ) : null}
      <div
        role="status"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--zk-space-12)",
          padding: "var(--zk-space-12) var(--zk-space-14)",
          borderRadius: "var(--zk-radius-lg)",
          background: paid ? "var(--zk-mint-tint)" : dead ? "var(--zk-red-tint)" : "var(--zk-surface)",
          border: `1px solid ${paid ? "rgb(var(--zk-mint-rgb) / .4)" : dead ? "rgb(var(--zk-red-rgb) / .4)" : "transparent"}`,
          transition: "background var(--zk-dur-base) var(--zk-ease-out)",
        }}
      >
        {paid ? (
          <span
            style={{
              width: 22,
              height: 22,
              flex: "none",
              borderRadius: "50%",
              background: "var(--zk-mint)",
              color: "var(--zk-mint-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "zk-pop var(--zk-dur-pop) var(--zk-ease-spring) both",
            }}
          >
            <Icon icon="check" size={14} stroke={3} />
          </span>
        ) : dead ? (
          <span
            style={{
              width: 22,
              height: 22,
              flex: "none",
              borderRadius: "50%",
              background: "var(--zk-red)",
              color: "var(--zk-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon="close" size={14} stroke={3} />
          </span>
        ) : (
          <Spinner />
        )}
        <div style={{ font: "var(--zk-type-small)" }}>{statusText}</div>
      </div>
    </>
  );

  const sendExactly = (
    <p style={{ margin: 0, font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>
      Scan from any Zcash wallet and send exactly{" "}
      <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-gold)", whiteSpace: "nowrap" }}>{formatZec(amountZat, 8)} ZEC</span>
      {feeZat > 0 ? <> (that includes a {formatZec(feeZat, 8)} ZEC network fee, a tiny fee the Zcash network charges).</> : "."}
    </p>
  );

  const qrToggle = (
    <button
      type="button"
      aria-expanded={showQr}
      onClick={() => setQrOpen((o) => !o)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--zk-space-10)",
        width: "100%",
        minHeight: 52,
        padding: "var(--zk-space-14) var(--zk-space-16)",
        borderRadius: "var(--zk-radius-lg)",
        background: "var(--zk-surface)",
        border: "1px solid var(--zk-border)",
        color: "var(--zk-text)",
        font: "var(--zk-type-body-strong)",
        textAlign: "left",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)" }}>
        <span style={{ color: "var(--zk-text-muted)", display: "flex" }}>
          <Icon icon="camera" size={18} />
        </span>
        Or send from another Zcash wallet
      </span>
      <Icon
        icon="back"
        size={18}
        stroke={2.6}
        style={{
          color: "var(--zk-text-muted)",
          transform: showQr ? "rotate(90deg)" : "rotate(-90deg)",
          transition: "transform var(--zk-dur-base) var(--zk-ease-out)",
        }}
      />
    </button>
  );

  const foldedQr = showQr ? (
    <>
      {sendExactly}
      {qrBlock}
      <Button label={checking ? "Checking…" : "I’ve sent it"} variant="ghost" size="md" disabled={checking} onClick={onSent} />
    </>
  ) : null;

  const simulateBtn = testMode ? (
    <Button
      label={simulating ? "Simulating…" : "Simulate payment (test mode)"}
      icon="bolt"
      variant="secondary"
      size="md"
      disabled={simulating}
      onClick={onSimulate}
    />
  ) : null;

  const holds = (
    <>
      <p style={{ margin: "calc(var(--zk-space-4) * -1) 0 0", font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>
        Your stash holds
      </p>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--zk-space-10)", flexWrap: "wrap" }}>
        <span style={{ font: "var(--zk-type-mono-lg)", fontSize: "var(--zk-fs-26)", color: "var(--zk-gold)" }}>
          {formatZec(chargeZat, 8)} ZEC
        </span>
        <span style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>~{formatUsd(stash.usd)}</span>
      </div>
    </>
  );

  /* ── one-tap path: enough ZEC in the ZECKED wallet ── */
  if (payPath) {
    return (
      <>
        <h1 style={H1}>Fund it.</h1>
        {holds}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)", marginTop: "var(--zk-space-4)" }}>
          {walletLoading ? (
            <div
              aria-busy="true"
              style={{
                height: "var(--zk-h-btn-lg)",
                borderRadius: "var(--zk-radius-2xl)",
                background: "var(--zk-surface)",
                animation: "zk-glow 1.6s ease-in-out infinite",
              }}
            >
              <span className="zk-sr-only">Checking your ZECKED wallet…</span>
            </div>
          ) : (
            <Button
              label={paying ? "Paying…" : "Pay from my ZECKED wallet"}
              icon="wallet"
              variant="primary"
              size="lg"
              disabled={paying}
              onClick={onPayFromBalance}
              style={{ font: "var(--zk-type-btn-md)" }}
            />
          )}
          <div style={{ textAlign: "center", font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
            {walletLoading || walletBalance == null ? (
              " "
            ) : (
              <>
                Balance <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-gold)" }}>{formatZec(walletBalance, 4)} test ZEC</span>
              </>
            )}
          </div>
        </div>
        {qrToggle}
        {foldedQr}
        <RefundNote type={stash.type} />
        {simulateBtn ? <div style={CTA}>{simulateBtn}</div> : null}
      </>
    );
  }

  /* ── not enough in the wallet (a first run on testnet starts at 0): test ZEC is free ── */
  if (lowPath && walletBalance != null) {
    const empty = walletBalance <= 0;
    return (
      <>
        <h1 style={H1}>Fund it.</h1>
        {holds}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--zk-space-12)",
            padding: "var(--zk-space-16)",
            borderRadius: "var(--zk-radius-2xl)",
            background: "var(--zk-surface)",
            border: "1px solid rgb(var(--zk-gold-rgb) / .35)",
            marginTop: "var(--zk-space-4)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
            <span
              aria-hidden="true"
              style={{
                width: 44,
                height: 44,
                flex: "none",
                borderRadius: "var(--zk-radius-lg)",
                background: "var(--zk-gold-tint)",
                color: "var(--zk-gold)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon icon="wallet" size={22} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "var(--zk-type-h4)" }}>{empty ? "Your wallet is empty" : "Almost there"}</div>
              <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                You have <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text)" }}>{fmtBal(walletBalance)}</span> test
                ZEC · needs <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-gold)" }}>{formatZec(chargeZat, 4)}</span>
              </div>
            </div>
          </div>
          <p style={{ margin: 0, font: "var(--zk-type-small)", color: "var(--zk-text)" }}>
            Test ZEC is free (no real value). Add some to your ZECKED wallet, then come back: your stash waits right here.
          </p>
          {walletPending > 0 ? (
            <div role="status" style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)", font: "var(--zk-type-small)", color: "var(--zk-mint)" }}>
              <Spinner size={16} />
              <span>
                {formatZec(walletPending, 4)} test ZEC is on its way. This updates by itself.
              </span>
            </div>
          ) : null}
          <Button label="Add free test ZEC" icon="plus" variant="primary" size="lg" href="/wallet?action=add" />
        </div>
        {qrToggle}
        {foldedQr}
        <RefundNote type={stash.type} />
        <div style={CTA}>
          {simulateBtn}
          {canGoBack && walletBalance > 0 ? (
            <Button label="Make the prize smaller" variant="ghost" size="md" onClick={onSmaller} />
          ) : null}
        </div>
      </>
    );
  }

  /* ── QR path: no wallet info, or already paid / expired ── */
  return (
    <>
      <h1 style={H1}>Fund it.</h1>
      <p style={{ margin: "calc(var(--zk-space-4) * -1) 0 0", font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>
        Scan from any Zcash wallet and send exactly
      </p>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--zk-space-10)", flexWrap: "wrap" }}>
        <span style={{ font: "var(--zk-type-mono-lg)", fontSize: "var(--zk-fs-26)", color: "var(--zk-gold)" }}>
          {formatZec(amountZat, 8)} ZEC
        </span>
        <span style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>~{formatUsd(stash.usd)}</span>
      </div>
      {open && feeZat > 0 ? (
        <p style={{ margin: "calc(var(--zk-space-6) * -1) 0 0", font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
          Includes a {formatZec(feeZat, 8)} ZEC network fee (a tiny fee the Zcash network charges).
        </p>
      ) : null}
      {qrBlock}
      {open ? <RefundNote type={stash.type} /> : null}
      <div style={CTA}>
        {dead ? (
          <Button label="Hide a new stash" variant="primary" size="lg" onClick={onStartOver} />
        ) : paid ? (
          <Button label="Go live" variant="success" size="lg" onClick={onGoLive} />
        ) : (
          <>
            <Button label={checking ? "Checking…" : "I’ve sent it"} variant="primary" size="lg" disabled={checking} onClick={onSent} />
            {simulateBtn}
          </>
        )}
      </div>
    </>
  );
}

/* ───────────────────────── step 4b · live ───────────────────────── */

function ShareCardPreview({
  stash,
  riddleText,
  match,
  kind,
  host,
}: {
  stash: PublicStash;
  riddleText: string;
  match: Match | undefined;
  kind: PredictionKind;
  host: string;
}) {
  const zec = formatZec(stash.amountZat);
  const usd = formatUsd(stash.usd);
  const riddleShort = riddleText.length > 70 ? riddleText.slice(0, 68) + "…" : riddleText;
  const isRiddle = stash.type === "riddle";
  const link = `${host || "zecked.com"}/s/${stash.id}`;
  // The card is laid out at its real size (354×199, like the image people will see) and scaled down
  // as a whole on narrow phones, so the text never reflows into itself.
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth || 354) / 354));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} style={{ width: "100%", maxWidth: 354, height: 199 * scale }}>
    <div
      style={{
        width: 354,
        height: 199,
        borderRadius: "var(--zk-radius-xl)",
        overflow: "hidden",
        position: "relative",
        background: isRiddle ? "var(--zk-bg-share-riddle)" : "var(--zk-bg-share-prediction)",
        border: "1px solid var(--zk-border-strong)",
        boxShadow: "var(--zk-shadow-float)",
        // Scale from the top-left corner (it fills the box), tilt around the middle (as before).
        transform: `scale(${scale}) translate(177px, 99.5px) rotate(-2deg) translate(-177px, -99.5px)`,
        transformOrigin: "0 0",
      }}
    >
      <div style={{ position: "absolute", left: 16, top: 14 }}>
        <Logo variant="wordmark" size={18} />
      </div>
      {isRiddle ? (
        <>
          <div
            style={{
              position: "absolute",
              left: 16,
              top: 44,
              right: 120,
              font: "var(--zk-fw-black) var(--zk-fs-20)/1.08 var(--zk-font-display)",
            }}
          >
            Crack my riddle and ZECK <span style={{ color: "var(--zk-gold)" }}>{zec} ZEC</span> 🔐
          </div>
          <div
            style={{
              position: "absolute",
              left: 16,
              bottom: 14,
              right: 120,
              font: "var(--zk-fw-semibold) var(--zk-fs-11)/1.3 var(--zk-font-body)",
              color: "var(--zk-text-muted)",
            }}
          >
            “{riddleShort}”
          </div>
        </>
      ) : (
        <>
          <div
            style={{
              position: "absolute",
              left: 16,
              top: 44,
              right: 120,
              font: "var(--zk-fw-black) var(--zk-fs-18)/1.08 var(--zk-font-display)",
            }}
          >
            {kind === "winner" ? (
              <>
                First to call the {match?.home.code ?? "?"} vs {match?.away.code ?? "?"} winner{" "}
              </>
            ) : (
              <>
                First to call {match?.home.code ?? "?"} vs {match?.away.code ?? "?"} exactly{" "}
              </>
            )}
            <span style={{ color: "var(--zk-gold)" }}>ZECKS {usd}</span> ⚽
          </div>
          {match ? (
            <div style={{ position: "absolute", left: 16, bottom: 12, right: 120, display: "flex", alignItems: "center", gap: "var(--zk-space-8)" }}>
              <div style={{ display: "flex", flex: "none" }}>
                <TeamBadge code={match.home.code} color={match.home.color} ink={match.home.ink} logo={match.home.logo} name={match.home.name} size={26} />
                <div style={{ marginLeft: -6 }}>
                  <TeamBadge code={match.away.code} color={match.away.color} ink={match.away.ink} logo={match.away.logo} name={match.away.name} size={26} />
                </div>
              </div>
              <span
                style={{
                  font: "var(--zk-fw-bold) var(--zk-fs-10)/1.2 var(--zk-font-mono)",
                  color: "var(--zk-text-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {formatKickoff(match.kickoff).toUpperCase()}
              </span>
            </div>
          ) : null}
        </>
      )}
      <div
        style={{
          position: "absolute",
          right: 14,
          top: 44,
          width: 96,
          height: 96,
          borderRadius: "var(--zk-radius-2xl)",
          background: "var(--zk-grad-tile-gold)",
          boxShadow: "var(--zk-shadow-chip-active)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--zk-space-2)",
          color: "var(--zk-gold-ink)",
          transform: "rotate(4deg)",
        }}
      >
        <span style={{ font: "var(--zk-fw-black) var(--zk-fs-26)/1 var(--zk-font-display)" }}>{usd}</span>
        <span style={{ font: "var(--zk-fw-bold) var(--zk-fs-10)/1 var(--zk-font-mono)" }}>FIRST WINS</span>
      </div>
      <div
        style={{
          position: "absolute",
          right: 14,
          bottom: 12,
          maxWidth: 110,
          font: "var(--zk-fw-bold) var(--zk-fs-10)/1 var(--zk-font-mono)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {link}
      </div>
    </div>
    </div>
  );
}

function LiveStep({
  stash,
  riddleText,
  match,
  kind,
  origin,
  host,
  testnet,
  paidFromWallet,
  onCopyLink,
  onDone,
}: {
  stash: PublicStash;
  riddleText: string;
  match: Match | undefined;
  kind: PredictionKind;
  origin: string;
  host: string;
  /** Not mainnet: the prize is test ZEC, and the post should say so. */
  testnet: boolean;
  /** Just paid with one tap: say so here (a toast would sit on top of the headline). */
  paidFromWallet: boolean;
  onCopyLink: (url: string) => void;
  onDone: () => void;
}) {
  const url = `${origin}/s/${stash.id}`;
  const home = match?.home.code ?? "";
  const away = match?.away.code ?? "";
  const zec = `${formatZec(stash.amountZat)} ${testnet ? "test ZEC" : "ZEC"}`;
  const prize = testnet ? zec : formatUsd(stash.usd);
  const text =
    stash.type === "riddle"
      ? `Crack my riddle and ZECK ${zec} 🔐 First one wins.`
      : kind === "winner"
        ? `First to call the ${home} vs ${away} winner ZECKS ${prize} ⚽`
        : `First to call ${home} vs ${away} exactly ZECKS ${prize} ⚽`;
  const enc = encodeURIComponent;
  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
  // The phone's own share sheet (WhatsApp, Messages, anything); without one, the link goes on the clipboard.
  const share = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "ZECKED", text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    onCopyLink(url);
  };
  const half: CSSProperties = { padding: "0 var(--zk-space-8)" };

  return (
    <>
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", overflow: "hidden" }}>
        <Confetti count={50} seed={11} />
      </div>
      <div
        style={{
          flex: 1,
          position: "relative",
          zIndex: 6,
          display: "flex",
          flexDirection: "column",
          gap: "var(--zk-space-14)",
          paddingTop: "var(--zk-space-12)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)", alignItems: "center", textAlign: "center" }}>
          <LiveBadge size="md" label="Live · prize verified" />
          <h1
            style={{
              margin: 0,
              font: "var(--zk-fw-black) var(--zk-fs-40)/1 var(--zk-font-display)",
              letterSpacing: "var(--zk-track-tight)",
            }}
          >
            Your stash is LIVE 🎉
          </h1>
          <p style={{ margin: 0, font: "var(--zk-type-body)", fontSize: "var(--zk-fs-15)", color: "var(--zk-text-muted)", maxWidth: 300 }}>
            Now go stir up trouble. Share it where your people hang out.
          </p>
          {paidFromWallet ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--zk-space-6)",
                padding: "var(--zk-space-6) var(--zk-space-12)",
                borderRadius: "var(--zk-radius-pill)",
                background: "var(--zk-mint-tint)",
                color: "var(--zk-mint)",
                font: "var(--zk-type-caption)",
                fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"],
              }}
            >
              <Icon icon="check" size={14} stroke={3} />
              Paid from your ZECKED wallet
            </span>
          ) : null}
        </div>
        <div style={{ marginTop: "var(--zk-space-14)" }}>
          <div
            style={{
              font: "var(--zk-type-label)",
              letterSpacing: "var(--zk-track-badge)",
              color: "var(--zk-text-muted)",
              marginBottom: "var(--zk-space-8)",
            }}
          >
            SHARE CARD PREVIEW
          </div>
          <ShareCardPreview stash={stash} riddleText={riddleText} match={match} kind={kind} host={host} />
        </div>
        <div style={{ ...CTA, paddingTop: "var(--zk-space-14)" }}>
          <Button label="Share" icon="share" variant="primary" size="lg" onClick={() => void share()} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--zk-space-10)" }}>
            <Button
              label="Post on X"
              variant="light"
              size="md"
              style={half}
              onClick={() => open(`https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`)}
            />
            <Button
              label="Telegram"
              variant="sky"
              size="md"
              style={half}
              onClick={() => open(`https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`)}
            />
          </div>
          <button
            type="button"
            onClick={() => onCopyLink(url)}
            aria-label="Copy link"
            style={{
              height: "var(--zk-h-btn-md)",
              borderRadius: "var(--zk-radius-lg)",
              border: "1.5px solid var(--zk-border-strong)",
              background: "transparent",
              color: "var(--zk-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--zk-space-10)",
              padding: "0 var(--zk-space-16)",
              font: "var(--zk-fw-medium) var(--zk-fs-14)/1 var(--zk-font-mono)",
              cursor: "pointer",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {host}/s/{stash.id}
            </span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--zk-space-4)",
                flex: "none",
                font: "var(--zk-type-body-strong)",
                color: "var(--zk-gold)",
              }}
            >
              <Icon icon="copy" size={16} />
              Copy
            </span>
          </button>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--zk-space-10)" }}>
            <Button label="View my stash" variant="ghost" size="md" style={half} href={`/s/${stash.id}`} />
            <Button label="Done" variant="ghost" size="md" style={half} onClick={onDone} />
          </div>
        </div>
      </div>
    </>
  );
}

/* ───────────────────────── the flow ───────────────────────── */

interface ToastState {
  id: number;
  text: string;
  variant: ToastVariant;
  icon?: string;
  sound?: false;
}

const STEP_BG: Record<Step, string> = {
  type: "var(--zk-bg)",
  riddle: "var(--zk-bg)",
  prediction: "var(--zk-bg)",
  amount: "var(--zk-bg-hero-gold)",
  fund: "var(--zk-bg)",
  live: "var(--zk-bg-live)",
};
const STEP_ORDER: Record<Step, number> = { type: 0, riddle: 1, prediction: 1, amount: 2, fund: 3, live: 4 };

/** Step slide + top toast drop (reduced motion is handled app-wide in globals.css). */
const FLOW_CSS =
  "@keyframes zkh-step-fwd{from{opacity:0;transform:translateX(24px)}}" +
  "@keyframes zkh-step-back{from{opacity:0;transform:translateX(-24px)}}" +
  "@keyframes zkh-toast-in{from{opacity:0;transform:translateY(-12px)}}";

/** Next.js patches history.pushState once the router mounts; history writes wait for that (never more than ~1s). */
function whenRouterReady(fn: () => void, tries = 20) {
  if (Object.prototype.hasOwnProperty.call(window.history, "pushState") || tries <= 0) fn();
  else setTimeout(() => whenRouterReady(fn, tries - 1), 50);
}

export function HideFlow({ resumeId }: { resumeId?: string | null }) {
  const router = useRouter();
  const appBack = useAppBack("/feed");
  const [s, dispatch] = useReducer(flowReducer, INITIAL_FLOW);
  const patch = useCallback((p: Partial<Draft>) => dispatch({ t: "patch", patch: p }), []);

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resuming, setResuming] = useState(!!resumeId);
  const [fundedZat, setFundedZat] = useState(0);
  const [checking, setChecking] = useState(false);
  const [simulating, setSimulating] = useState(false);
  /** Hiding needs an account: "unknown" (couldn't check) lets the flow run and the server decides. */
  const [auth, setAuth] = useState<"loading" | "in" | "out" | "unknown">("loading");
  // ZECKED wallet balance for one-tap funding (null = no wallet info). Refunds go back to this wallet.
  const [walletBal, setWalletBal] = useState<number | null>(null);
  const [walletPending, setWalletPending] = useState(0);
  const [walletLoading, setWalletLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [paidFromWallet, setPaidFromWallet] = useState(false);
  const [qr, setQr] = useState<{ uri: string; src: string } | null>(null);
  const [qrFailedFor, setQrFailedFor] = useState<string | null>(null);
  const [loc, setLoc] = useState({ origin: "", host: "" });
  const [toast, setToast] = useState<ToastState | null>(null);
  /** The saved draft (if any) is back in place; only then is it written again. */
  const [hydrated, setHydrated] = useState(false);
  /** A saved draft came back on step 1: offer "Start fresh". */
  const [restoredDraft, setRestoredDraft] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollBusy = useRef(false);
  /** Stash ids this component created or resumed, so a ?resume= URL update for them is a no-op. */
  const knownIds = useRef(new Set<string>());
  /** The draft saved in this tab when the flow opened (brings the draft back on ?resume= of its stash). */
  const savedRef = useRef<SavedDraft | null>(null);
  /** The unfunded stash the draft already made, so the same draft doesn't make a second one. */
  const reuseRef = useRef<{ stashId: string; stashKey: string } | null>(null);
  /** Latest state for the popstate listener. */
  const sRef = useRef(s);
  /**
   * This entry's place in the flow. Next.js can rewrite an entry's history.state (it refetches the
   * page after a reload, then replaces the state without our key), so we keep it here and put it back.
   */
  const posRef = useRef<HistPos | null>(null);
  const keepPos = useCallback(() => {
    const want = posRef.current;
    if (!want || window.location.pathname !== "/hide" || readHist()) return;
    window.history.replaceState({ ...((window.history.state as object | null) ?? {}), [HIST_KEY]: want }, "");
  }, []);
  useEffect(() => {
    sRef.current = s;
    keepPos();
  });
  const curPos = () => readHist() ?? posRef.current;
  const writePos = useCallback((mode: "push" | "replace", url: string, pos: HistPos) => {
    posRef.current = pos;
    writeHist(mode, url, pos);
  }, []);

  const showToast = useCallback((text: string, variant: ToastVariant = "default", icon?: string, sound?: false) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, variant, icon, sound });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    setLoc({ origin: window.location.origin, host: window.location.host });
  }, []);

  /* ── history: each step is an entry; `HistPos` says where this entry sits in the flow ── */
  const pushStep = useCallback(
    (step: Step, stashId?: string) => {
      const h = readHist() ?? posRef.current ?? { i: 0, from: cameFromApp() };
      writePos("push", stepUrl(step, stashId), { i: h.i + 1, from: h.from });
    },
    [writePos],
  );

  /** Leave the flow: back past its first entry when that came from inside the app, else to the feed. */
  const exitFlow = useCallback(
    (h: HistPos | null, slide = true) => {
      if (h?.from) {
        const at = window.location.href;
        goBackBy(h.i + 1, slide);
        // history.go() past the start of the tab is a silent no-op: then just go to the feed.
        setTimeout(() => {
          if (window.location.href === at) router.replace("/feed");
        }, 700);
      } else {
        router.replace("/feed");
      }
    },
    [router],
  );

  /** ✕ on step 1 (and the resumed fund step, which has nothing before it). */
  const closeFlow = () => {
    const h = curPos();
    if (h && h.i > 0) exitFlow(h);
    else appBack();
  };

  // Mount: bring the saved draft back, and give this history entry its place in the flow.
  useEffect(() => {
    const saved = loadSaved();
    savedRef.current = saved;
    if (saved?.stashId && saved.stashKey) reuseRef.current = { stashId: saved.stashId, stashKey: saved.stashKey };
    const { step, resume } = stepFromUrl();
    let fixUrl: string | null = null;
    if (!resume) {
      // No saved draft behind a ?step= link (new tab, cleared storage): that step starts empty.
      const draft = saved?.draft ?? { ...INITIAL_DRAFT, type: step === "prediction" ? "prediction" : "riddle" };
      const want = step ?? "type";
      const at = reachableStep(want, draft);
      if (saved || at !== "type") dispatch({ t: "restore", draft, step: at });
      if (at !== want) fixUrl = stepUrl(at);
      if (saved && at === "type" && draftHasContent(saved.draft)) setRestoredDraft(true);
    }
    const url = fixUrl;
    whenRouterReady(() => {
      let h = readHist();
      if (!h) {
        // A new flow starts at step 1; anything else lost its key to a Next.js rewrite: look it up.
        if (!resume && !step) forgetPos();
        else h = recallPos(hereUrl());
      }
      h ??= { i: 0, from: cameFromApp() };
      posRef.current = h;
      if (url) writeHist("replace", url, h);
      else {
        // Same URL: only our key changes, so keep Next's own state as it is.
        window.history.replaceState({ ...(window.history.state as object | null), [HIST_KEY]: h }, "");
        rememberPos(hereUrl(), h);
      }
    });
    setHydrated(true);
  }, []);

  // Keep the draft in this tab, so a reload, an accidental back or a trip to the wallet doesn't lose it.
  useEffect(() => {
    if (!hydrated || s.resumed || s.step === "live") return;
    const reuse = s.stash?.status === "awaiting_funding" && s.stashKey ? { stashId: s.stash.id, stashKey: s.stashKey } : reuseRef.current;
    const pristine = !draftHasContent(s.draft) && !reuse && JSON.stringify(s.draft) === JSON.stringify(INITIAL_DRAFT);
    saveDraft(pristine ? null : { draft: s.draft, stashId: reuse?.stashId ?? null, stashKey: reuse?.stashKey ?? null });
  }, [hydrated, s.draft, s.stash, s.stashKey, s.resumed, s.step]);

  // Live: the stash is out there, so the draft is done with.
  useEffect(() => {
    if (s.step !== "live") return;
    saveDraft(null);
    forgetPos();
    savedRef.current = null;
    reuseRef.current = null;
  }, [s.step]);

  // Browser back / forward / swipe-back between steps.
  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname !== "/hide") return;
      const cur = sRef.current;
      const { step, resume } = stepFromUrl();
      // Our key can be gone from an entry Next.js rewrote: the flow is linear, so work it out from the step.
      const target: Step = resume ? "fund" : (step ?? "type");
      const was = posRef.current;
      const h =
        readHist() ??
        recallPos(hereUrl()) ??
        (was ? { i: Math.max(0, was.i + STEP_ORDER[target] - STEP_ORDER[cur.step === "live" ? "fund" : cur.step]), from: was.from } : null);
      posRef.current = h;
      for (const ms of [300, 1000, 2500]) setTimeout(keepPos, ms);
      // A finished flow isn't replayed: going back from the live screen leaves the flow.
      if (cur.step === "live") {
        // (They already went back: no extra slide on top of the browser's own.)
        if (!(resume && cur.stash?.id === resume)) exitFlow(h, false);
        return;
      }
      if (resume) {
        if (cur.stash?.id === resume) dispatch({ t: "goto", step: "fund", dir: "fwd" });
        else knownIds.current.delete(resume); // the ?resume= effect below loads it
        return;
      }
      const want = step ?? "type";
      const at = reachableStep(want, cur.draft);
      dispatch({ t: "goto", step: at, dir: STEP_ORDER[at] < STEP_ORDER[cur.step] ? "back" : "fwd" });
      if (at !== want) writePos("replace", stepUrl(at), h ?? { i: 0, from: false });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [exitFlow, keepPos, writePos]);

  // App config: rate, min/max prize, test mode.
  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        /* the amount step falls back to $1–$100 and the server re-validates */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Account: guests see the sign-up gate instead of the flow.
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then(({ player }) => {
        if (!cancelled) setAuth(player.account ? (player.account.signedIn ? "in" : "out") : "unknown");
      })
      .catch((e) => {
        if (!cancelled) setAuth(errStatus(e) === 401 ? "out" : "unknown");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ?resume=<id>: jump straight to funding (or to the live screen if it is already funded). Needs sign-in.
  useEffect(() => {
    if (!resumeId || knownIds.current.has(resumeId)) {
      setResuming(false);
      return;
    }
    if (auth === "loading") return;
    if (auth === "out") {
      setResuming(false);
      return;
    }
    let cancelled = false;
    setResuming(true);
    const restart = () => writePos("replace", "/hide", readHist() ?? posRef.current ?? { i: 0, from: cameFromApp() });
    api
      .stash(resumeId)
      .then(({ stash }) => {
        if (cancelled) return;
        if (!stash.isMine) {
          showToast("Only the hider can fund this stash.", "error");
          restart();
        } else if (stash.status === "awaiting_funding" || isFunded(stash)) {
          knownIds.current.add(stash.id);
          // Back from the wallet (or a reload): the draft that made this stash comes back with it.
          const saved = savedRef.current;
          const mine = saved && saved.stashId === stash.id ? saved : null;
          dispatch({ t: "resume", stash, draft: mine?.draft, key: mine?.stashKey });
        } else {
          showToast("This stash can’t be funded anymore.", "error");
          restart();
        }
      })
      .catch((e) => {
        if (!cancelled) showToast(errMsg(e), "error");
      })
      .finally(() => {
        if (!cancelled) setResuming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resumeId, showToast, auth, writePos]);

  // Matches: load for the picker (and for the prize step of a prediction); refresh quietly while picking.
  const loadMatches = useCallback((quiet = false) => {
    if (!quiet) {
      setMatchesError(null);
      setMatches(null);
    }
    api
      .matches()
      .then((r) => {
        setMatches(r.matches);
        setMatchesError(null);
      })
      .catch((e) => {
        if (!quiet) setMatchesError(errMsg(e));
      });
  }, []);
  const matchesRequested = useRef(false);
  useEffect(() => {
    const need = s.step === "prediction" || (s.step === "amount" && s.draft.type === "prediction");
    if (!need) return;
    if (!matchesRequested.current) {
      matchesRequested.current = true;
      loadMatches();
    }
    if (s.step !== "prediction") return;
    const t = setInterval(() => loadMatches(true), MATCHES_REFRESH_MS);
    return () => clearInterval(t);
  }, [s.step, s.draft.type, loadMatches]);

  // Keep the prize inside the configured range.
  useEffect(() => {
    if (!config) return;
    const min = Math.max(1, Math.ceil(config.minStashUsd));
    const max = Math.max(min, Math.floor(config.maxStashUsd));
    if (s.draft.usd < min || s.draft.usd > max) patch({ usd: clamp(s.draft.usd, min, max) });
  }, [config, s.draft.usd, patch]);

  // Each step starts at the top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [s.step]);

  const selectedMatch = useMemo(
    () => s.stash?.prediction?.match ?? matches?.find((m) => m.id === s.draft.matchId),
    [s.stash, matches, s.draft.matchId],
  );

  /* ── forward / back ── */
  const goNext = () => {
    if (s.step === "type") {
      const next = detailsStep(s.draft);
      setRestoredDraft(false);
      pushStep(next);
      dispatch({ t: "goto", step: next, dir: "fwd" });
    } else if (s.step === "riddle" || s.step === "prediction") {
      pushStep("amount");
      dispatch({ t: "goto", step: "amount", dir: "fwd" });
    }
  };

  /** ← in the step header: the previous step (a real history step back when there is one). */
  const goPrev = () => {
    const prev: Step | null =
      s.step === "riddle" || s.step === "prediction"
        ? "type"
        : s.step === "amount"
          ? detailsStep(s.draft)
          : s.step === "fund" && !s.resumed
            ? "amount"
            : null;
    if (!prev) {
      closeFlow();
      return;
    }
    const h = curPos();
    if (h && h.i > 0) {
      window.history.back(); // the popstate listener shows the step
      return;
    }
    writePos("replace", stepUrl(prev), h ?? { i: 0, from: cameFromApp() });
    dispatch({ t: "goto", step: prev, dir: "back" });
  };

  /* ── step 3 → 4a: create the stash ── */
  const createStash = async () => {
    if (creating) return;
    const d = s.draft;
    const pickedMatch = matches?.find((m) => m.id === d.matchId);
    const body: Parameters<typeof api.create>[0] =
      d.type === "riddle"
        ? {
            type: "riddle",
            riddle: {
              text: d.riddle.trim(),
              answer: d.answer.trim(),
              ...(d.hintOpen && d.hint.trim() ? { hint: d.hint.trim() } : {}),
            },
            usd: d.usd,
            expiryHours: d.expiryHours,
          }
        : {
            type: "prediction",
            prediction: { matchId: d.matchId ?? "", kind: d.kind },
            usd: d.usd,
            expiryHours: pickedMatch ? hoursUntilFullTime(pickedMatch.kickoff) : 24,
          };
    // Prediction expiry drifts with the clock, so it is not part of the "same stash?" key.
    const key = JSON.stringify({ ...body, expiryHours: d.type === "riddle" ? body.expiryHours : 0 });
    if (s.stash && s.stashKey === key && s.stash.status === "awaiting_funding") {
      pushStep("fund", s.stash.id);
      dispatch({ t: "fund" });
      return;
    }
    setCreating(true);
    try {
      // Same draft as the unfunded stash from before (a reload or a trip to the wallet)? Use that one.
      const reuse = !s.stash && reuseRef.current?.stashKey === key ? reuseRef.current.stashId : null;
      if (reuse) {
        const prev = await api.stash(reuse).catch(() => null);
        if (prev && prev.stash.isMine && prev.stash.status === "awaiting_funding") {
          knownIds.current.add(prev.stash.id);
          setFundedZat(0);
          pushStep("fund", prev.stash.id);
          dispatch({ t: "created", stash: prev.stash, key });
          return;
        }
      }
      // No refund address: if nobody cracks it, the ZEC goes back to the hider's ZECKED wallet.
      const { stash } = await api.create(body);
      knownIds.current.add(stash.id);
      reuseRef.current = { stashId: stash.id, stashKey: key };
      setFundedZat(0);
      // Its own history entry: a reload (or coming back from the wallet) resumes funding, back goes to the prize.
      pushStep("fund", stash.id);
      dispatch({ t: "created", stash, key });
    } catch (e) {
      if (errStatus(e) === 401) setAuth("out");
      else showToast(errMsg(e), "error");
    } finally {
      setCreating(false);
    }
  };

  /* ── step 4a: QR, polling, simulate ── */
  const uri = s.stash?.funding?.uri;
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    (async () => {
      const mod = await import("qrcode");
      const toDataURL =
        (mod as { toDataURL?: typeof mod.toDataURL }).toDataURL ??
        (mod as unknown as { default: typeof mod }).default.toDataURL;
      const src = await toDataURL(uri, {
        errorCorrectionLevel: "H",
        margin: 1,
        width: 440,
        color: { dark: "#0E0B1F", light: "#FFFFFF" },
      });
      if (!cancelled) setQr({ uri, src });
    })().catch(() => {
      if (!cancelled) setQrFailedFor(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);
  const qrSrc = qr && uri && qr.uri === uri ? qr.src : null;

  const checkFunding = useCallback(
    async (id: string, manual: boolean) => {
      if (!manual && pollBusy.current) return;
      if (!manual) pollBusy.current = true;
      else setChecking(true);
      try {
        const res = await api.checkFunding(id);
        setFundedZat(res.fundedZat);
        dispatch({ t: "update", stash: res.stash });
        if (manual && res.stash.status === "awaiting_funding") {
          showToast("No ZEC yet. It can take a minute to arrive.", "default", "hourglass");
        }
      } catch (e) {
        if (manual) showToast(errMsg(e), "error");
      } finally {
        if (!manual) pollBusy.current = false;
        else setChecking(false);
      }
    },
    [showToast],
  );

  const stashId = s.stash?.id;
  const awaiting = s.stash?.status === "awaiting_funding";

  // The ZECKED wallet balance: a hint on the prize step, and on 4a it picks one-tap funding vs Add ZEC.
  const loadWallet = useCallback(async () => {
    try {
      const w = await api.wallet();
      setWalletBal(w.balanceZat);
      setWalletPending(w.pendingDepositZat || 0);
    } catch (e) {
      if (errStatus(e) === 401) setWalletBal(null);
      /* otherwise keep the last known balance; the QR flow always works */
    } finally {
      setWalletLoading(false);
    }
  }, []);
  const walletStep = s.step === "amount" || (s.step === "fund" && !!stashId && awaiting);
  useEffect(() => {
    if (!walletStep || auth === "out") return;
    void loadWallet();
    // Back from /wallet (added test ZEC) or from a wallet app: refresh the balance.
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadWallet();
    };
    document.addEventListener("visibilitychange", onVisible);
    // While funding, keep an eye on it: test ZEC from a faucet shows up on its own.
    const t = s.step === "fund" ? setInterval(() => void loadWallet(), WALLET_POLL_MS) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [walletStep, s.step, auth, loadWallet]);

  const payFromBalance = async () => {
    if (!s.stash || paying) return;
    const id = s.stash.id;
    setPaying(true);
    try {
      const res = await api.fundFromBalance(id);
      setWalletBal(res.wallet.balanceZat);
      dispatch({ t: "update", stash: res.stash });
      if (isFunded(res.stash)) {
        setPaidFromWallet(true); // said on the live screen itself, not in a toast over its headline
        dispatch({ t: "goto", step: "live", dir: "fwd" }); // straight to 4b, no need to wait for "ZEC detected"
      } else {
        void checkFunding(id, false);
      }
    } catch (e) {
      const status = errStatus(e);
      if (status === 401) setAuth("out");
      else if (status === 402) {
        showToast("Not enough test ZEC in your wallet yet. Add some (it’s free) or send from another wallet.", "error");
        void loadWallet();
      } else showToast(errMsg(e), "error");
    } finally {
      setPaying(false);
    }
  };

  useEffect(() => {
    if (s.step !== "fund" || !stashId || !awaiting) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      await checkFunding(stashId, false);
      if (!stopped) timer = setTimeout(loop, POLL_MS);
    };
    timer = setTimeout(loop, 0);
    // Coming back from the wallet app: check straight away.
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkFunding(stashId, false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [s.step, stashId, awaiting, checkFunding]);

  // ✓ ZEC detected → a coin, then the live screen after a beat (its confetti brings its own sound).
  const funded = !!s.stash && isFunded(s.stash);
  const wasFunded = useRef<boolean | null>(null);
  useEffect(() => {
    if (wasFunded.current === false && funded) sfx("coin");
    wasFunded.current = s.stash ? funded : null;
  }, [s.stash, funded]);
  useEffect(() => {
    if (s.step !== "fund" || !funded) return;
    const t = setTimeout(() => dispatch({ t: "goto", step: "live", dir: "fwd" }), ADVANCE_MS);
    return () => clearTimeout(t);
  }, [s.step, funded]);

  const simulate = async () => {
    if (!s.stash || simulating) return;
    const id = s.stash.id;
    setSimulating(true);
    try {
      const res = await api.simulateFund(id);
      dispatch({ t: "update", stash: res.stash });
      if (!isFunded(res.stash)) void checkFunding(id, false);
    } catch (e) {
      showToast(errMsg(e), "error");
    } finally {
      setSimulating(false);
    }
  };

  const copy = async (text: string, done: string) => {
    if (await copyText(text)) showToast(done, "success", "copy");
    else showToast("Couldn’t copy. Long-press to copy instead.", "error");
  };

  /** Throw the draft away and begin again at step 1 (this entry becomes step 1). */
  const startOver = () => {
    saveDraft(null);
    savedRef.current = null;
    reuseRef.current = null;
    setRestoredDraft(false);
    setFundedZat(0);
    writePos("replace", "/hide", curPos() ?? { i: 0, from: cameFromApp() });
    dispatch({ t: "reset" });
  };

  /* ── render ── */
  const n = STEP_NO[s.step];
  const toastLayer = toast ? (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        top: "calc(var(--zk-fixed-top) + var(--zk-space-10))",
        zIndex: 80,
        display: "flex",
        justifyContent: "center",
        padding: "0 var(--zk-screen-pad)",
        pointerEvents: "none",
      }}
    >
      <div
        key={toast.id}
        style={{ width: "100%", maxWidth: "calc(430px - 2 * var(--zk-screen-pad))", animation: "zkh-toast-in 220ms var(--zk-ease-out) both" }}
      >
        <Toast text={toast.text} variant={toast.variant} icon={toast.icon} sound={toast.sound} />
      </div>
    </div>
  ) : null;
  const flowCss = <style>{FLOW_CSS}</style>;

  if (resuming || auth === "loading" || !hydrated) {
    return (
      <main
        className="zk-screen"
        aria-busy="true"
        style={{ background: "var(--zk-bg)", alignItems: "center", justifyContent: "center", gap: "var(--zk-space-12)" }}
      >
        <Spinner size={28} />
        <span style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
          {resumeId ? "Opening your stash…" : "Opening the vault…"}
        </span>
        {toastLayer}
      </main>
    );
  }

  // Guests: step 1 shows the sign-up gate instead of the type cards (also for ?resume= links).
  if (auth === "out") {
    const next = resumeId ? encodeURIComponent(`/hide?resume=${resumeId}`) : "/hide";
    return (
      <main className="zk-screen" style={{ background: STEP_BG.type, gap: "var(--zk-space-12)" }}>
        {flowCss}
        <StepHeader n={1} onBack={closeFlow} close />
        <GateStep href={`/signin?next=${next}&reason=hide`} />
        {toastLayer}
      </main>
    );
  }

  let body: ReactNode;
  switch (s.step) {
    case "type":
      body = (
        <TypeStep
          type={s.draft.type}
          onPick={(type) => patch({ type })}
          onContinue={goNext}
          hasDraft={restoredDraft}
          onStartFresh={startOver}
        />
      );
      break;
    case "riddle":
      body = <RiddleStep draft={s.draft} patch={patch} onNext={goNext} />;
      break;
    case "prediction":
      body = (
        <PredictionStep
          draft={s.draft}
          patch={patch}
          matches={matches}
          matchesError={matchesError}
          onRetry={() => loadMatches()}
          onNext={goNext}
          onToast={showToast}
        />
      );
      break;
    case "amount":
      body = (
        <AmountStep
          draft={s.draft}
          patch={patch}
          config={config}
          creating={creating}
          walletBalance={walletLoading ? null : walletBal}
          match={s.draft.type === "prediction" ? matches?.find((m) => m.id === s.draft.matchId) : undefined}
          matchGone={
            s.draft.type === "prediction" &&
            matches !== null &&
            !matches.some((m) => m.id === s.draft.matchId && m.status === "scheduled")
          }
          onNext={() => void createStash()}
          onPickAnother={goPrev}
        />
      );
      break;
    case "fund":
      body = s.stash ? (
        <FundStep
          stash={s.stash}
          qrSrc={qrSrc}
          qrFailed={!!uri && qrFailedFor === uri}
          fundedZat={fundedZat}
          testMode={config ? config.network === "sim" : false}
          checking={checking}
          simulating={simulating}
          walletBalance={walletBal}
          walletPending={walletPending}
          walletLoading={walletLoading}
          paying={paying}
          canGoBack={!s.resumed}
          onPayFromBalance={() => void payFromBalance()}
          onCopyAddress={() => s.stash?.funding && void copy(s.stash.funding.address, "Address copied")}
          onSent={() => s.stash && void checkFunding(s.stash.id, true)}
          onSimulate={() => void simulate()}
          onGoLive={() => dispatch({ t: "goto", step: "live", dir: "fwd" })}
          onStartOver={startOver}
          onSmaller={goPrev}
        />
      ) : null;
      break;
    case "live":
      body = s.stash ? (
        <LiveStep
          stash={s.stash}
          riddleText={s.stash.riddle?.text ?? s.draft.riddle}
          match={selectedMatch}
          kind={s.stash.prediction?.kind ?? s.draft.kind}
          origin={loc.origin}
          host={loc.host}
          testnet={config ? config.network !== "mainnet" : true}
          paidFromWallet={paidFromWallet}
          onCopyLink={(url) => void copy(url, "Link copied")}
          onDone={() => exitFlow(curPos())}
        />
      ) : null;
      break;
  }

  const slide = s.dir === "fwd" ? "zkh-step-fwd" : s.dir === "back" ? "zkh-step-back" : null;
  return (
    <main className="zk-screen" style={{ background: STEP_BG[s.step], gap: "var(--zk-space-12)" }}>
      {flowCss}
      {s.step !== "live" ? <StepHeader n={n} onBack={s.step === "type" ? closeFlow : goPrev} close={s.step === "type"} /> : null}
      {s.step === "live" ? (
        body
      ) : (
        <div
          key={s.step}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "var(--zk-space-12)",
            animation: slide ? `${slide} 260ms var(--zk-ease-out) both` : undefined,
          }}
        >
          {body}
        </div>
      )}
      {toastLayer}
    </main>
  );
}

export default HideFlow;
