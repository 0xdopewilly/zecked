"use client";

/*
 * 09 · Hide a stash. One state machine for the whole flow:
 *
 *   type ──▶ riddle ─────┐
 *        └─▶ prediction ─┴─▶ amount ──(api.create)──▶ fund ──(funding detected)──▶ live
 *
 * `?resume=<stashId>` jumps straight to `fund` (awaiting_funding) or `live` (already funded).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
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
import { ZAT } from "@/lib/types";
import type { AppConfig, Match, PredictionKind, PublicStash, StashType } from "@/lib/types";

/* ───────────────────────── constants ───────────────────────── */

const POLL_MS = 5000;
const ADVANCE_MS = 1200;
const RIDDLE_MAX = 200;
const ANSWER_MAX = 80;
const HINT_MAX = 120;
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

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const pad2 = (n: number) => String(n).padStart(2, "0");
const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong. Try again.");
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

const looksLikeZcashAddress = (a: string) => /^(u1|utest1|zs1|ztestsapling1|t1|t3|tm|t2)[0-9a-z]{20,}$/i.test(a);

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
  draft: Draft;
  stash: PublicStash | null;
  /** Serialized create-body of `stash`, so going back and forward again reuses it. */
  stashKey: string | null;
  /** Arrived via ?resume: there is no draft to go back to. */
  resumed: boolean;
}

type FlowAction =
  | { t: "patch"; patch: Partial<Draft> }
  | { t: "next" }
  | { t: "back" }
  | { t: "fund" }
  | { t: "created"; stash: PublicStash; key: string }
  | { t: "resume"; stash: PublicStash }
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
const INITIAL_FLOW: Flow = { step: "type", draft: INITIAL_DRAFT, stash: null, stashKey: null, resumed: false };

function flowReducer(s: Flow, a: FlowAction): Flow {
  switch (a.t) {
    case "patch":
      return { ...s, draft: { ...s.draft, ...a.patch } };
    case "next":
      if (s.step === "type") return { ...s, step: s.draft.type === "riddle" ? "riddle" : "prediction" };
      if (s.step === "riddle" || s.step === "prediction") return { ...s, step: "amount" };
      if (s.step === "fund" && s.stash && isFunded(s.stash)) return { ...s, step: "live" };
      return s;
    case "back":
      if (s.step === "riddle" || s.step === "prediction") return { ...s, step: "type" };
      if (s.step === "amount") return { ...s, step: s.draft.type === "riddle" ? "riddle" : "prediction" };
      if (s.step === "fund" && !s.resumed) return { ...s, step: "amount" };
      return s;
    case "fund":
      return s.stash ? { ...s, step: "fund" } : s;
    case "created":
      return { ...s, stash: a.stash, stashKey: a.key, step: isFunded(a.stash) ? "live" : "fund" };
    case "resume":
      return {
        ...s,
        stash: a.stash,
        stashKey: null,
        resumed: true,
        draft: { ...s.draft, type: a.stash.type },
        step: isFunded(a.stash) ? "live" : "fund",
      };
    case "update":
      return s.stash && s.stash.id === a.stash.id ? { ...s, stash: a.stash } : s;
    case "reset":
      return INITIAL_FLOW;
  }
}

/* ───────────────────────── shared styles ───────────────────────── */

const H1: CSSProperties = { margin: "var(--zk-space-8) 0 0", font: "var(--zk-type-h1)" };
const ICON_BTN: CSSProperties = {
  width: 40,
  height: 40,
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

/* ───────────────────────── header ───────────────────────── */

function StepHeader({ n, onBack }: { n: 1 | 2 | 3 | 4; onBack?: () => void }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        {onBack ? (
          <button type="button" aria-label="Back" onClick={onBack} style={ICON_BTN}>
            <Icon icon="back" size={20} stroke={2.6} />
          </button>
        ) : (
          <Link href="/feed" aria-label="Close" style={ICON_BTN}>
            <Icon icon="close" size={18} stroke={2.6} />
          </Link>
        )}
        <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-text-muted)" }}>STEP {n} / 4</span>
        <div style={{ width: 40 }} />
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

function TypeStep({ type, onPick, onContinue }: { type: StashType; onPick: (t: StashType) => void; onContinue: () => void }) {
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
              Pick a real match. First correct call takes it.
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
        <Button label="Continue" variant="primary" size="lg" onClick={onContinue} />
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

function RiddleStep({
  draft,
  patch,
  onNext,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  onNext: () => void;
}) {
  const [showAnswer, setShowAnswer] = useState(false);
  // Autofocus the hint only when it was just opened (not when coming back to this step).
  const [focusHint, setFocusHint] = useState(false);
  const strength = useMemo(() => riddleStrength(draft.riddle, draft.answer), [draft.riddle, draft.answer]);
  const canNext = draft.riddle.trim().length > 0 && words(draft.answer).length > 0;

  return (
    <>
      <h1 style={H1}>Make it tricky.</h1>
      <Input
        label="Your riddle"
        multiline
        height={132}
        font="display"
        value={draft.riddle}
        onChange={(v) => patch({ riddle: v.slice(0, RIDDLE_MAX) })}
        maxLength={RIDDLE_MAX}
        placeholder="I have cities, but no houses. Forests, but no trees. What am I?"
        message={`${draft.riddle.length} / ${RIDDLE_MAX}`}
      />
      <Input
        label="The answer"
        size="md"
        type={showAnswer ? "text" : "password"}
        value={draft.answer}
        onChange={(v) => patch({ answer: v.slice(0, ANSWER_MAX) })}
        maxLength={ANSWER_MAX}
        placeholder="Only you know it"
        autoComplete="off"
        spellCheck={false}
        message="Not case-sensitive. “a”, “an” and “the” are ignored."
        trailing={
          <button
            type="button"
            onClick={() => setShowAnswer((v) => !v)}
            aria-label={showAnswer ? "Hide answer" : "Show answer"}
            aria-pressed={showAnswer}
            style={{
              width: 30,
              height: 30,
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
            <Icon icon={showAnswer ? "eyeOff" : "eye"} size={16} stroke={3} />
          </button>
        }
      />
      <StrengthMeter strength={strength} />
      {draft.hintOpen ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <label htmlFor="zk-hide-hint" style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
              Bonus hint (unlocks later)
            </label>
            <button
              type="button"
              onClick={() => patch({ hintOpen: false, hint: "" })}
              style={{
                border: "none",
                background: "transparent",
                padding: "var(--zk-space-4) 0",
                font: "var(--zk-type-caption)",
                color: "var(--zk-text-muted)",
                cursor: "pointer",
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
            message={`${draft.hint.length} / ${HINT_MAX}`}
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
        <Button label="Next: set the prize" variant="primary" size="lg" disabled={!canNext} onClick={onNext} />
      </div>
    </>
  );
}

/* ───────────────────────── step 2b · prediction ───────────────────────── */

function MatchRow({ m, selected, onSelect }: { m: Match; selected: boolean; onSelect: () => void }) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={radioKeys(onSelect)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-10)",
        padding: "var(--zk-space-10) var(--zk-space-12)",
        borderRadius: "var(--zk-radius-xl)",
        background: selected ? "var(--zk-sky-tint)" : "var(--zk-surface)",
        border: `2px solid ${selected ? "var(--zk-sky)" : "transparent"}`,
        cursor: "pointer",
        flex: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ display: "flex", flex: "none" }}>
        <TeamBadge code={m.home.code} color={m.home.color} ink={m.home.ink} size={38} />
        <div style={{ marginLeft: -8 }}>
          <TeamBadge code={m.away.code} color={m.away.color} ink={m.away.ink} size={38} />
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", minWidth: 0 }}>
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
            color: "var(--zk-text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {m.leagueName} · {formatKickoff(m.kickoff)}
        </div>
      </div>
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
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  matches: Match[] | null;
  matchesError: string | null;
  onRetry: () => void;
  onNext: () => void;
}) {
  const [q, setQ] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const upcoming = useMemo(
    () =>
      (matches ?? [])
        .filter((m) => m.status === "scheduled")
        .sort((a, b) => Number(!!b.demo) - Number(!!a.demo) || Date.parse(a.kickoff) - Date.parse(b.kickoff)),
    [matches],
  );
  const shown = useMemo(() => upcoming.filter((m) => matchesQuery(m, q)), [upcoming, q]);
  const loading = matches === null && !matchesError;

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
        <Chip label="Try again" size="sm" onClick={onRetry} />
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
      <MatchRow key={m.id} m={m} selected={draft.matchId === m.id} onSelect={() => patch({ matchId: m.id })} />
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
        <Button label="Next: set the prize" variant="primary" size="lg" disabled={!draft.matchId} onClick={onNext} />
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
  onNext,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  config: AppConfig | null;
  creating: boolean;
  onNext: () => void;
}) {
  const min = Math.max(1, Math.ceil(config?.minStashUsd ?? FALLBACK_MIN_USD));
  const max = Math.max(min, Math.floor(config?.maxStashUsd ?? FALLBACK_MAX_USD));
  const usd = clamp(draft.usd, min, max);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");

  const zec = config?.zecUsd ? formatZec(Math.round((usd / config.zecUsd) * ZAT), 4) : "…";
  const active = customOpen ? "Custom" : (PRESETS.find((p) => p.usd === usd)?.label ?? "Custom");
  const isPrediction = draft.type === "prediction";

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
        <div style={{ display: "flex", gap: "var(--zk-space-8)", flexWrap: "wrap" }}>
          {EXPIRIES.map((x) => (
            <Chip
              key={x.hours}
              label={x.label}
              size="sm"
              active={draft.expiryHours === x.hours}
              onClick={() => patch({ expiryHours: x.hours })}
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
        <span>
          If nobody cracks it, the ZEC comes back to you. And you earn <b style={{ color: "var(--zk-text)" }}>Uncrackable</b>.
        </span>
      </div>
      <div style={CTA}>
        <Button
          label={creating ? "Hiding it…" : "Next: fund it"}
          variant="primary"
          size="lg"
          disabled={creating}
          onClick={onNext}
        />
      </div>
    </>
  );
}

/* ───────────────────────── step 4a · fund ───────────────────────── */

function FundStep({
  stash,
  qrSrc,
  qrFailed,
  fundedZat,
  testMode,
  checking,
  simulating,
  refund,
  setRefund,
  onCopyAddress,
  onSent,
  onSimulate,
  onGoLive,
  onStartOver,
}: {
  stash: PublicStash;
  qrSrc: string | null;
  qrFailed: boolean;
  fundedZat: number;
  testMode: boolean;
  checking: boolean;
  simulating: boolean;
  refund: string;
  setRefund: (v: string) => void;
  onCopyAddress: () => void;
  onSent: () => void;
  onSimulate: () => void;
  onGoLive: () => void;
  onStartOver: () => void;
}) {
  const funding = stash.funding;
  const paid = isFunded(stash);
  const dead = isDead(stash);
  const amountZat = funding?.amountZat ?? stash.amountZat;
  const partial = !paid && fundedZat > 0 && fundedZat < amountZat;
  const refundTrim = refund.trim();
  const refundState = !refundTrim ? undefined : looksLikeZcashAddress(refundTrim) ? "success" : "error";

  const statusText = paid
    ? "ZEC detected!"
    : dead
      ? "This stash expired before the ZEC arrived."
      : partial
        ? `Got ${formatZec(fundedZat, 8)} ZEC so far. Send the remaining ${formatZec(amountZat - fundedZat, 8)} ZEC.`
        : "Waiting for your ZEC… usually under a minute.";

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
              padding: "var(--zk-space-8) var(--zk-space-8) var(--zk-space-8) var(--zk-space-16)",
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
            <Button label="Copy" icon="copy" variant="secondary" size="sm" full={false} onClick={onCopyAddress} />
          </div>
          {!paid && !dead ? <Button label="Open in wallet" icon="wallet" variant="ghost" size="md" href={funding.uri} /> : null}
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
      {!paid && !dead ? (
        <Input
          label="Refund address (if nobody cracks it)"
          size="sm"
          font="mono"
          value={refund}
          onChange={(v) => setRefund(v.trim().slice(0, 256))}
          placeholder="u1… or zs…"
          autoComplete="off"
          spellCheck={false}
          state={refundState}
          message={refundState === "error" ? "That doesn’t look like a Zcash address." : undefined}
        />
      ) : null}
      <div style={CTA}>
        {dead ? (
          <Button label="Hide a new stash" variant="primary" size="lg" onClick={onStartOver} />
        ) : paid ? (
          <Button label="Go live" variant="success" size="lg" onClick={onGoLive} />
        ) : (
          <>
            <Button label={checking ? "Checking…" : "I’ve sent it"} variant="primary" size="lg" disabled={checking} onClick={onSent} />
            {testMode ? (
              <Button
                label={simulating ? "Simulating…" : "Simulate payment (test mode)"}
                icon="bolt"
                variant="secondary"
                size="md"
                disabled={simulating}
                onClick={onSimulate}
              />
            ) : null}
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
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 354,
        aspectRatio: "354 / 199",
        borderRadius: "var(--zk-radius-xl)",
        overflow: "hidden",
        position: "relative",
        background: isRiddle ? "var(--zk-bg-share-riddle)" : "var(--zk-bg-share-prediction)",
        border: "1px solid var(--zk-border-strong)",
        boxShadow: "var(--zk-shadow-float)",
        transform: "rotate(-2deg)",
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
                <TeamBadge code={match.home.code} color={match.home.color} ink={match.home.ink} size={26} />
                <div style={{ marginLeft: -6 }}>
                  <TeamBadge code={match.away.code} color={match.away.color} ink={match.away.ink} size={26} />
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
  );
}

function LiveStep({
  stash,
  riddleText,
  match,
  kind,
  origin,
  host,
  onCopyLink,
}: {
  stash: PublicStash;
  riddleText: string;
  match: Match | undefined;
  kind: PredictionKind;
  origin: string;
  host: string;
  onCopyLink: (url: string) => void;
}) {
  const url = `${origin}/s/${stash.id}`;
  const home = match?.home.code ?? "";
  const away = match?.away.code ?? "";
  const text =
    stash.type === "riddle"
      ? `Crack my riddle and ZECK ${formatZec(stash.amountZat)} ZEC 🔐 First one wins.`
      : kind === "winner"
        ? `First to call the ${home} vs ${away} winner ZECKS ${formatUsd(stash.usd)} ⚽`
        : `First to call ${home} vs ${away} exactly ZECKS ${formatUsd(stash.usd)} ⚽`;
  const enc = encodeURIComponent;
  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");

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
          <LiveBadge size="md" label="Live · verified by viewing key" />
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
          <Button
            label="Share on X"
            variant="light"
            size="md"
            onClick={() => open(`https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`)}
          />
          <Button
            label="Share on Telegram"
            variant="sky"
            size="md"
            onClick={() => open(`https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`)}
          />
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
          <Button label="View my stash" variant="ghost" size="md" href={`/s/${stash.id}`} />
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
}

const STEP_BG: Record<Step, string> = {
  type: "var(--zk-bg)",
  riddle: "var(--zk-bg)",
  prediction: "var(--zk-bg)",
  amount: "var(--zk-bg-hero-gold)",
  fund: "var(--zk-bg)",
  live: "var(--zk-bg-live)",
};

export function HideFlow({ resumeId }: { resumeId?: string | null }) {
  const router = useRouter();
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
  // Refund address: synced to the server (PATCH /stashes/:id/refund-address) once a stash exists.
  const [refund, setRefund] = useState("");
  const [qr, setQr] = useState<{ uri: string; src: string } | null>(null);
  const [qrFailedFor, setQrFailedFor] = useState<string | null>(null);
  const [loc, setLoc] = useState({ origin: "", host: "" });
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollBusy = useRef(false);
  /** Stash ids this component created or resumed, so a ?resume= URL update for them is a no-op. */
  const knownIds = useRef(new Set<string>());

  const showToast = useCallback((text: string, variant: ToastVariant = "default", icon?: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, variant, icon });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    setLoc({ origin: window.location.origin, host: window.location.host });
  }, []);

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

  // ?resume=<id>: jump straight to funding (or to the live screen if it is already funded).
  useEffect(() => {
    if (!resumeId || knownIds.current.has(resumeId)) {
      setResuming(false);
      return;
    }
    let cancelled = false;
    setResuming(true);
    api
      .stash(resumeId)
      .then(({ stash }) => {
        if (cancelled) return;
        if (!stash.isMine) {
          showToast("Only the hider can fund this stash.", "error");
        } else if (stash.status === "awaiting_funding" || isFunded(stash)) {
          knownIds.current.add(stash.id);
          dispatch({ t: "resume", stash });
        } else {
          showToast("This stash can’t be funded anymore.", "error");
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
  }, [resumeId, showToast]);

  // Matches: load when the prediction step opens.
  const loadMatches = useCallback(() => {
    setMatchesError(null);
    setMatches(null);
    api
      .matches()
      .then((r) => setMatches(r.matches))
      .catch((e) => setMatchesError(errMsg(e)));
  }, []);
  const matchesRequested = useRef(false);
  useEffect(() => {
    if (s.step !== "prediction" || matchesRequested.current) return;
    matchesRequested.current = true;
    loadMatches();
  }, [s.step, loadMatches]);

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
      dispatch({ t: "fund" });
      window.history.replaceState(null, "", `/hide?resume=${encodeURIComponent(s.stash.id)}`);
      return;
    }
    setCreating(true);
    try {
      const { stash } = await api.create(refund.trim() ? { ...body, refundAddress: refund.trim() } : body);
      knownIds.current.add(stash.id);
      setFundedZat(0);
      dispatch({ t: "created", stash, key });
      // A reload (or coming back from the wallet app) resumes funding.
      window.history.replaceState(null, "", `/hide?resume=${encodeURIComponent(stash.id)}`);
    } catch (e) {
      showToast(errMsg(e), "error");
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
  // Save the refund address to the stash (debounced) once it looks valid.
  useEffect(() => {
    const a = refund.trim();
    if (!stashId || !s.stash?.isMine || s.stash.status !== "awaiting_funding") return;
    if (a && !looksLikeZcashAddress(a)) return;
    const t = setTimeout(() => {
      api.setRefundAddress(stashId, a).catch(() => undefined);
    }, 700);
    return () => clearTimeout(t);
  }, [refund, stashId, s.stash?.isMine, s.stash?.status]);
  const awaiting = s.stash?.status === "awaiting_funding";
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

  // ✓ ZEC detected → the live screen after a beat.
  const funded = !!s.stash && isFunded(s.stash);
  useEffect(() => {
    if (s.step !== "fund" || !funded) return;
    const t = setTimeout(() => dispatch({ t: "next" }), ADVANCE_MS);
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

  /* ── navigation ── */
  const back = () => {
    if (s.step === "fund") {
      if (s.resumed) {
        router.push("/feed");
        return;
      }
      window.history.replaceState(null, "", "/hide");
    }
    dispatch({ t: "back" });
  };
  const startOver = () => {
    window.history.replaceState(null, "", "/hide");
    setRefund("");
    setFundedZat(0);
    dispatch({ t: "reset" });
  };

  /* ── render ── */
  const n = STEP_NO[s.step];
  const toastLayer = toast ? (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
        width: "min(394px, calc(100vw - 36px))",
        zIndex: 80,
        pointerEvents: "none",
      }}
    >
      <Toast key={toast.id} text={toast.text} variant={toast.variant} icon={toast.icon} />
    </div>
  ) : null;

  if (resuming) {
    return (
      <main
        className="zk-screen"
        aria-busy="true"
        style={{ background: "var(--zk-bg)", alignItems: "center", justifyContent: "center", gap: "var(--zk-space-12)" }}
      >
        <Spinner size={28} />
        <span style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>Opening your stash…</span>
      </main>
    );
  }

  let body: ReactNode;
  switch (s.step) {
    case "type":
      body = (
        <TypeStep type={s.draft.type} onPick={(type) => patch({ type })} onContinue={() => dispatch({ t: "next" })} />
      );
      break;
    case "riddle":
      body = <RiddleStep draft={s.draft} patch={patch} onNext={() => dispatch({ t: "next" })} />;
      break;
    case "prediction":
      body = (
        <PredictionStep
          draft={s.draft}
          patch={patch}
          matches={matches}
          matchesError={matchesError}
          onRetry={loadMatches}
          onNext={() => dispatch({ t: "next" })}
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
          onNext={() => void createStash()}
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
          testMode={!!(config?.testMode ?? s.stash.testMode)}
          checking={checking}
          simulating={simulating}
          refund={refund}
          setRefund={setRefund}
          onCopyAddress={() => s.stash?.funding && void copy(s.stash.funding.address, "Address copied")}
          onSent={() => s.stash && void checkFunding(s.stash.id, true)}
          onSimulate={() => void simulate()}
          onGoLive={() => dispatch({ t: "next" })}
          onStartOver={startOver}
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
          onCopyLink={(url) => void copy(url, "Link copied")}
        />
      ) : null;
      break;
  }

  return (
    <main className="zk-screen" style={{ background: STEP_BG[s.step], gap: "var(--zk-space-12)" }}>
      {s.step !== "live" ? <StepHeader n={n} onBack={s.step === "type" ? undefined : back} /> : null}
      {body}
      {toastLayer}
    </main>
  );
}

export default HideFlow;
