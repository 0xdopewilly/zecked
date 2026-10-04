"use client";
// Screens 05 (prediction stash) + 06 (live match), plus the locked, full-time, refunded,
// called-off and awaiting-funding states. Polls the stash so every state stays in sync, and turns
// what changed between polls into moments: kickoff, goals, full time. Once funded, every state has the
// emoji reactions bar (the poll brings other people's in live); the hider's name opens their profile.
import Link from "next/link";
import { sfx } from "@/lib/sfx";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Chip, Countdown, Emblem, Icon, LiveBadge, TeamBadge, TIER_LABEL, Toast } from "@/components/zk";
import { Reactions } from "@/components/zk/Reactions";
import { api, formatUsd, formatZec } from "@/lib/api";
import { useAppBack } from "@/lib/nav";
import type { Match, MyCall, PublicStash, Reaction, RunnerCall, Team, WinPayload, WinnerPick } from "@/lib/types";
import {
  callMatches,
  callMatchesScore,
  closeness,
  eventLine,
  finalScore,
  formatCall,
  formatKickoff,
  formatScore,
  goalsAway,
  liveScore,
  matchProgress,
  parseMinute,
  prettyMinute,
  sortedEvents,
  tensionColor,
  tensionLabel,
} from "@/lib/predict";

type StashData = { stash: PublicStash; myCall?: MyCall; runners?: RunnerCall[]; win?: WinPayload; myReactions?: Reaction[] };

export interface PredictionStashProps {
  initial: StashData;
  onWin: (win: WinPayload) => void;
}

type Phase = "funding" | "open" | "locked" | "live" | "final" | "won" | "refunded" | "void";
type ToastState = { id: number; text: string; variant: "default" | "success" | "error" | "gold"; icon?: string };
type MomentKind = "goal" | "kickoff" | "fulltime";
type MomentState = { id: number; kind: MomentKind; title: string; line: string; meta?: string; note?: { text: string; good?: boolean }; team?: Team };

const LIVE_POLL_MS = 5_000; // in play, about to kick off, or waiting on the result
const OPEN_POLL_MS = 15_000; // calls open: keeps the calls count fresh
const SLOW_POLL_MS = 60_000; // settled
const SOON_MS = 60_000; // "about to kick off": poll fast from a minute out
const TOAST_MS = 2600;
const MOMENT_MS = 4200;
const MOMENT_EXIT_MS = 320;
const ARM_MS = 3000; // "Lock 2–1? Tap again to seal" window
// Test-league matches play a match minute every 4 real seconds (DEMO_MINUTE_SECONDS in lib/server/sports.ts).
const DEMO_MINUTE_MS = 4_000;
const RESOLVED = new Set(["zecked", "refunded", "expired", "void"]);

function phaseOf(s: PublicStash, kickedOff: boolean, hasWin: boolean): Phase {
  const m = s.prediction?.match;
  if (s.status === "awaiting_funding") return "funding";
  if (s.status === "void" || m?.status === "postponed" || m?.status === "canceled") return "void";
  if (s.status === "refunded" || s.status === "expired") return "refunded";
  if (s.status === "zecked") return s.result?.winnerIsYou && hasWin ? "won" : "final";
  if (m?.status === "final") return "final";
  if (m?.status === "live") return "live";
  if (s.status === "locked" || kickedOff) return "locked";
  return "open";
}

/* ---------- helpers ---------- */

function reducedMotion(): boolean {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** A one-off Web Animation (skipped under reduced motion). */
function play(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions) {
  if (!el || typeof el.animate !== "function" || reducedMotion()) return;
  try {
    el.animate(frames, opts);
  } catch {}
}

/** Error text a player can act on (never "Failed to fetch"). Server messages are already written for players. */
function friendlyError(e: unknown, fallback: string): string {
  if (e instanceof TypeError) return "Can’t reach ZECKED. Check your connection";
  const msg = e instanceof Error ? e.message : "";
  if (!msg || /^Request failed|fetch|network|load failed/i.test(msg)) return fallback;
  return msg;
}

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How a call reads inside a sentence: "2–1", "draw call", "ZFC win call". */
function callNoun(call: MyCall, match: Match): string {
  if (call.kind === "exact") return formatCall(call, match);
  return call.pick === "draw" ? "draw call" : `${formatCall(call, match)} call`;
}

/** What a goal did to the viewer's call: "Your 2–1 is spot on right now 🔥", "Closer! Your 2–1 is one ZFC goal away"… */
function goalNote(call: MyCall, match: Match, before: { home: number; away: number }): { text: string; good: boolean } {
  const { home, away } = liveScore(match);
  const noun = callNoun(call, match);
  if (callMatchesScore(call, home, away)) return { text: `Your ${noun} is spot on right now 🔥`, good: true };
  const was = goalsAway(call, before.home, before.away);
  const now = goalsAway(call, home, away);
  if (now.dead) return { text: was.dead ? `Your ${noun} is out of the running` : `Ouch. That knocks out your ${noun} 💀`, good: false };
  const label = lcFirst(tensionLabel(call, match));
  const phrase = label.startsWith("needs") ? label : `is ${label}`;
  if (now.needed < was.needed) return { text: `Closer! Your ${noun} ${phrase}`, good: true };
  return { text: `Uh oh. Your ${noun} ${phrase}`, good: false };
}

/* ---------- shared styles ---------- */

const S = {
  label: { font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-badge)", color: "var(--zk-text-muted)" },
  navLabel: { font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-sky)" },
  card: { background: "var(--zk-surface)", borderRadius: "var(--zk-radius-2xl)", padding: "var(--zk-space-16)" },
  cardTitle: { font: "var(--zk-type-h4)", fontSize: "var(--zk-fs-18)" },
  miniCard: {
    background: "var(--zk-surface-raised)",
    borderRadius: "var(--zk-radius-xl)",
    padding: "var(--zk-space-12) var(--zk-space-14)",
    minWidth: 0,
  },
  caption: { font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-bold)", color: "var(--zk-text-muted)" },
  teamName: {
    font: "var(--zk-type-body-strong)",
    textAlign: "center",
    overflowWrap: "break-word",
    hyphens: "auto",
    textWrap: "balance",
    maxWidth: "100%",
  },
  muted: { margin: 0, font: "var(--zk-type-body)", color: "var(--zk-text-muted)" },
} satisfies Record<string, CSSProperties>;

/*
 * Stepper sizing. The design's fixed 46/48/10px didn't fit a 390px screen (the right "+" hit the
 * card edge). These scale with the viewport: full design size from ~430px up, 44px at 390px, and
 * still fitting at 320px (where the button is drawn smaller but its tap area stays 44px).
 */
const STEP_BTN = "clamp(36px, 11.3vw, 46px)";
const STEP_HIT = `max(var(--zk-tap-min), ${STEP_BTN})`;
const STEP_HIT_MARGIN = `min(0px, calc((${STEP_BTN} - var(--zk-tap-min)) / 2))`;
const STEP_NUM = "clamp(32px, 11.3vw, 48px)";
const STEP_GAP = "clamp(var(--zk-space-4), calc(10vw - 33px), var(--zk-space-10))";
const STEP_FS = "clamp(40px, 13.3vw, var(--zk-fs-52))";

/* ---------- small pieces ---------- */

function useLocalKickoff(iso: string | undefined): string {
  // Local time differs between server and browser, so format after mount.
  const [text, setText] = useState("");
  useEffect(() => {
    setText(iso ? formatKickoff(iso) : "");
  }, [iso]);
  return text;
}

/**
 * The minute on the live clock. Test-league matches move a match minute every 4 real seconds, faster
 * than we poll, so between polls the clock ticks on by itself: one minute at a time, never backwards.
 * It runs from the kickoff time, kept inside the window each poll's (floored) minute allows, so a phone
 * clock that's off can't drift it. Real matches show the feed's minute ("67'", "HT", "45+2'").
 */
function useLiveMinute(match: Match | undefined): string {
  const raw = match?.status === "live" ? match.minute : undefined;
  const demoMin = match?.demo && raw && /^\s*\d+\s*'?\s*$/.test(raw) ? parseMinute(raw) : null;
  const [shown, setShown] = useState<number | null>(demoMin);
  // Where the match clock stood at time 0, in match minutes: somewhere in [lo, hi).
  const clock = useRef<{ lo: number; hi: number } | null>(null);

  useEffect(() => {
    if (demoMin === null) {
      clock.current = null;
      return;
    }
    const now = Date.now() / DEMO_MINUTE_MS;
    // The feed floors the minute, shows 1' from the first whistle and holds 90' through stoppage time.
    const lo = (demoMin <= 1 ? 0 : demoMin) - now;
    const hi = (demoMin <= 1 ? 2 : demoMin >= 90 ? Infinity : demoMin + 1) - now;
    const c = clock.current;
    const both = c ? { lo: Math.max(c.lo, lo), hi: Math.min(c.hi, hi) } : null;
    clock.current = both && both.lo < both.hi ? both : { lo, hi };
    setShown((s) => (s === null || Math.abs(demoMin - s) > 3 ? demoMin : s));
  }, [match, demoMin]);

  const ticking = demoMin !== null;
  const kickoffMs = match ? Date.parse(match.kickoff) : NaN;
  useEffect(() => {
    if (!ticking) return;
    const t = window.setInterval(() => {
      const c = clock.current;
      if (!c) return;
      const guess = Number.isFinite(kickoffMs) ? -kickoffMs / DEMO_MINUTE_MS : Number.isFinite(c.hi) ? (c.lo + c.hi) / 2 : c.lo;
      const at = Math.min(Math.max(guess, c.lo), c.hi - 1e-3) + Date.now() / DEMO_MINUTE_MS;
      const target = Math.max(1, Math.min(90, Math.floor(at)));
      setShown((s) => (s === null ? target : target > s ? s + 1 : s));
    }, 500);
    return () => window.clearInterval(t);
  }, [ticking, kickoffMs]);

  if (demoMin !== null && shown !== null) return `${shown}’`;
  return prettyMinute(raw);
}

function IconBtn({ icon, label, size, stroke, onClick }: { icon: string; label: string; size: number; stroke: number; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: "var(--zk-tap-min)",
        height: "var(--zk-tap-min)",
        flex: "none",
        borderRadius: "var(--zk-radius-lg)",
        background: "var(--zk-surface)",
        border: 0,
        padding: 0,
        color: "var(--zk-text)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
      }}
    >
      <Icon icon={icon} size={size} stroke={stroke} />
    </button>
  );
}

function Nav({ center, onBack, onShare }: { center: ReactNode; onBack: () => void; onShare: () => void }) {
  return (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--zk-space-8)" }}>
      <IconBtn icon="back" label="Back" size={22} stroke={2.4} onClick={onBack} />
      {center}
      <IconBtn icon="share" label="Share" size={20} stroke={2.2} onClick={onShare} />
    </nav>
  );
}

/** "Hidden by @handle · Rookie · 3 stashes hidden", as on the riddle screen. Opens the hider's profile. */
function HiderRow({ stash }: { stash: PublicStash }) {
  const h = stash.hider;
  const handle = h.handle.startsWith("@") ? h.handle : `@${h.handle}`;
  const tier = `${TIER_LABEL[h.tier] ?? "Rookie"}${h.stashesHidden > 0 ? ` · ${plural(h.stashesHidden, "stash", "stashes")} hidden` : ""}`;
  return (
    <Link
      href={`/u/${encodeURIComponent(handle.slice(1))}`}
      transitionTypes={["nav-forward"]}
      aria-label={`Hidden by ${stash.isMine ? "you" : handle}. ${tier}. Open ${stash.isMine ? "your" : "their"} profile`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-10)",
        minHeight: "var(--zk-tap-min)",
        padding: "0 var(--zk-space-4)",
        color: "var(--zk-text)",
        textDecoration: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <Emblem tier={h.tier} size={30} style={{ flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-2)", minWidth: 0 }}>
          <span style={{ font: "var(--zk-type-body-strong)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            <span style={{ color: "var(--zk-text-muted)", fontWeight: "var(--zk-fw-semibold)" }}>Hidden by </span>
            {stash.isMine ? "you" : handle}
          </span>
          <span aria-hidden="true" style={{ display: "flex", flex: "none", color: "var(--zk-text-muted)", transform: "rotate(180deg)" }}>
            <Icon icon="back" size={14} stroke={2.6} />
          </span>
        </div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-gold)" }}>{tier}</div>
      </div>
    </Link>
  );
}

/** Status pill for a match that isn't in play ("Calls open", "Calls locked"): LiveBadge's shape, no pulsing dot. */
function StatusPill({ icon, label, tone, tint, border }: { icon: string; label: string; tone: string; tint: string; border: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--zk-space-6)",
        padding: "var(--zk-space-4) var(--zk-space-10) var(--zk-space-4) var(--zk-space-8)",
        borderRadius: "var(--zk-radius-pill)",
        background: tint,
        border: `1px solid ${border}`,
        color: tone,
        font: "var(--zk-fw-black) var(--zk-fs-10)/1 var(--zk-font-body)",
        letterSpacing: "var(--zk-track-badge)",
        whiteSpace: "nowrap",
        flex: "none",
        textTransform: "uppercase",
      }}
    >
      <Icon icon={icon} size={11} stroke={2.8} />
      {label}
    </div>
  );
}

const CallsOpenPill = () => <StatusPill icon="unlock" label="Calls open" tone="var(--zk-gold)" tint="var(--zk-gold-tint)" border="rgb(var(--zk-gold-rgb) / .3)" />;
const CallsLockedPill = () => (
  <StatusPill icon="lock" label="Calls locked" tone="var(--zk-purple-light)" tint="var(--zk-purple-tint)" border="rgb(var(--zk-purple-rgb) / .35)" />
);

/** Text that rolls up into place when it changes (the live minute). */
function Rolling({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(text);
  useEffect(() => {
    if (text === prev.current) return;
    prev.current = text;
    play(ref.current, [{ transform: "translateY(75%)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 340, easing: "cubic-bezier(.22,1,.36,1)" });
  }, [text]);
  return (
    <span style={{ display: "inline-block", overflow: "hidden", verticalAlign: "bottom", lineHeight: 1.2, margin: "-0.1em 0" }}>
      <span ref={ref} style={{ display: "inline-block", fontVariantNumeric: "tabular-nums" }}>
        {text}
      </span>
    </span>
  );
}

/** The live nav badge (LiveBadge solid · md) with a minute that rolls over instead of jumping. */
function LiveClock({ minute }: { minute: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--zk-space-8)",
        padding: "var(--zk-space-6) var(--zk-space-12) var(--zk-space-6) var(--zk-space-10)",
        borderRadius: "var(--zk-radius-pill)",
        background: "var(--zk-mint)",
        border: "1px solid var(--zk-mint)",
        color: "var(--zk-mint-ink)",
        font: "var(--zk-fw-black) var(--zk-fs-12)/1 var(--zk-font-body)",
        letterSpacing: "var(--zk-track-badge)",
        whiteSpace: "nowrap",
        flex: "none",
        textTransform: "uppercase",
      }}
    >
      <span aria-hidden style={{ position: "relative", width: 8, height: 8, flex: "none" }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--zk-mint-ink)", animation: "zk-glow 1s ease-in-out infinite" }} />
      </span>
      <span>
        Live
        {minute ? (
          <>
            {" · "}
            <Rolling text={minute} />
          </>
        ) : null}
      </span>
    </div>
  );
}

function DemoChip() {
  return <Chip variant="info" size="sm" icon="bolt" iconColor="var(--zk-gold)" label="TEST MATCH · plays out in minutes" />;
}

/** The pink rubber stamp a won stash gets everywhere in the app. Thumps down once (not under reduced motion). */
function ZeckedStamp() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    play(
      ref.current,
      [
        { transform: "scale(2.2) rotate(-8deg)", opacity: 0 },
        { transform: "scale(.92) rotate(-3deg)", opacity: 1, offset: 0.6 },
        { transform: "scale(1) rotate(-3deg)", opacity: 1 },
      ],
      { duration: 520, delay: 150, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" },
    );
  }, []);
  return (
    <div
      ref={ref}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--zk-space-8)",
        padding: "var(--zk-space-8) var(--zk-space-14)",
        borderRadius: "var(--zk-radius-md)",
        border: "3px solid var(--zk-pink)",
        background: "rgb(var(--zk-bg-rgb) / .85)",
        color: "var(--zk-pink)",
        font: "var(--zk-type-btn-md)",
        transform: "rotate(-3deg)",
      }}
    >
      <Icon icon="unlock" size={20} stroke={2.6} />
      ZECKED
    </div>
  );
}

function TeamCol({ team, size }: { team: Team; size: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-6)", minWidth: 0 }}>
      <TeamBadge code={team.code} color={team.color} ink={team.ink} logo={team.logo} name={team.name} size={size} />
      <span lang="en" style={S.teamName}>
        {team.name}
      </span>
    </div>
  );
}

/** Screen 05's big match card: league · kickoff, badge, both teams, and a footer row. */
function MatchCard({ match, badge, footer, children }: { match: Match; badge?: ReactNode; footer?: ReactNode; children?: ReactNode }) {
  const kickoff = useLocalKickoff(match.kickoff);
  return (
    <div
      style={{
        background: "linear-gradient(160deg,var(--zk-surface-navy),var(--zk-surface) 60%)",
        borderRadius: "var(--zk-radius-3xl)",
        padding: "var(--zk-space-16) var(--zk-space-18) var(--zk-space-18)",
        border: "1.5px solid rgb(var(--zk-sky-rgb) / .3)",
        boxShadow: "var(--zk-glow-sky)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--zk-space-8)" }}>
        <div style={{ ...S.caption, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--zk-space-2)" }}>
          <span>{match.leagueName}</span>
          {kickoff ? <span style={{ fontWeight: "var(--zk-fw-semibold)" }}>{kickoff}</span> : null}
        </div>
        {badge}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "start", marginTop: "var(--zk-space-14)" }}>
        <TeamCol team={match.home} size={68} />
        <div style={{ font: "var(--zk-type-h3)", color: "var(--zk-text-muted)", padding: "0 var(--zk-space-8)", height: 68, display: "flex", alignItems: "center" }}>VS</div>
        <TeamCol team={match.away} size={68} />
      </div>
      {footer ? (
        <div style={{ marginTop: "var(--zk-space-14)", display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--zk-space-8)", flexWrap: "wrap", textAlign: "center" }}>
          {footer}
        </div>
      ) : null}
      {children ? <div style={{ marginTop: "var(--zk-space-12)", display: "flex", justifyContent: "center" }}>{children}</div> : null}
    </div>
  );
}

/** A score digit that pops (and flashes gold) when it goes up. */
function PopNum({ value, color }: { value: number; color: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const [hot, setHot] = useState(false);
  useEffect(() => {
    const up = value > prev.current;
    prev.current = value;
    if (!up) return;
    setHot(true);
    play(
      ref.current,
      [
        { transform: "scale(1)" },
        { transform: "scale(1.5) translateY(-4%)", offset: 0.35 },
        { transform: "scale(.94)", offset: 0.7 },
        { transform: "scale(1)" },
      ],
      { duration: 700, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    const t = window.setTimeout(() => setHot(false), 1400);
    return () => window.clearTimeout(t);
  }, [value]);
  return (
    <span
      ref={ref}
      aria-hidden
      style={{
        display: "inline-block",
        color: hot ? "var(--zk-gold)" : color,
        textShadow: hot ? "0 0 24px rgb(var(--zk-gold-rgb) / .7)" : "none",
        transition: "color var(--zk-dur-meter) var(--zk-ease-out), text-shadow var(--zk-dur-meter) var(--zk-ease-out)",
      }}
    >
      {value}
    </span>
  );
}

/** Screen 06's score card: crests + names, big score, optional match-time bar and goal events. */
function ScoreCard({
  match,
  accent,
  top,
  bar,
  minute,
  scoreColor,
  lastEventNote,
  children,
}: {
  match: Match;
  accent: string;
  top?: ReactNode;
  bar?: boolean;
  /** The minute on the clock, when it runs ahead of the last poll (see useLiveMinute). */
  minute?: string;
  scoreColor?: string;
  lastEventNote?: string;
  children?: ReactNode;
}) {
  const { home, away } = liveScore(match);
  const events = sortedEvents(match.events);
  const lastGoal = lastEventNote ? events.map((e) => eventLine(e, match).goal).lastIndexOf(true) : -1;
  const shownMin = minute && match.status === "live" ? Math.min(90, parseMinute(minute)) : null;
  const pct = shownMin !== null ? Math.round((shownMin / 90) * 100) : matchProgress(match);
  const fg = scoreColor ?? "var(--zk-text)";
  const side = (t: Team) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-6)", minWidth: 0 }}>
      <TeamBadge code={t.code} color={t.color} ink={t.ink} logo={t.logo} name={t.name} size={58} />
      <span lang="en" style={{ ...S.teamName, font: "var(--zk-type-small)", fontWeight: "var(--zk-fw-bold)" }}>
        {t.name}
      </span>
    </div>
  );
  return (
    <div style={{ background: "var(--zk-surface)", borderRadius: "var(--zk-radius-3xl)", padding: "var(--zk-space-18)", border: `1.5px solid ${accent}` }}>
      {top ? <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--zk-space-8)", marginBottom: "var(--zk-space-14)" }}>{top}</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "start" }}>
        {side(match.home)}
        <div
          role="img"
          aria-label={`${match.home.name} ${home}, ${match.away.name} ${away}`}
          style={{
            font: "var(--zk-type-score-xl)",
            fontSize: "clamp(48px, 16vw, var(--zk-fs-64))",
            letterSpacing: "var(--zk-track-tight)",
            display: "flex",
            gap: "clamp(var(--zk-space-6), 3vw, var(--zk-space-12))",
            alignItems: "center",
            height: 58,
            padding: "0 var(--zk-space-4)",
          }}
        >
          <PopNum value={home} color={fg} />
          <span aria-hidden style={{ color: "var(--zk-text-muted)", fontSize: "0.62em" }}>–</span>
          <PopNum value={away} color={fg} />
        </div>
        {side(match.away)}
      </div>
      {bar ? (
        <div
          role="progressbar"
          aria-label="Match time"
          aria-valuemin={0}
          aria-valuemax={90}
          aria-valuenow={shownMin ?? Math.min(90, parseMinute(match.minute))}
          style={{ marginTop: "var(--zk-space-14)", height: 6, borderRadius: "var(--zk-radius-xs)", background: "var(--zk-surface-raised)", overflow: "hidden" }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: "var(--zk-mint)",
              borderRadius: "var(--zk-radius-xs)",
              transition: "width var(--zk-dur-meter) var(--zk-ease-out)",
            }}
          />
        </div>
      ) : null}
      {events.length > 0 ? (
        <div style={{ marginTop: "var(--zk-space-10)", display: "flex", flexDirection: "column", gap: "var(--zk-space-6)", font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
          {events.map((e, i) => {
            const line = eventLine(e, match);
            const hot = i === lastGoal;
            return (
              <span key={`${e.minute}-${e.side}-${i}`} style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", color: hot ? "var(--zk-mint)" : undefined }}>
                <Icon icon={line.goal ? "ball" : "flag"} size={13} />
                {hot ? `${line.text}. ${lastEventNote}` : line.text}
              </span>
            );
          })}
        </div>
      ) : null}
      {children ? <div style={{ marginTop: "var(--zk-space-12)", display: "flex", justifyContent: "center" }}>{children}</div> : null}
    </div>
  );
}

function PrizeRow({ title, stash }: { title: string; stash: PublicStash }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--zk-space-8)", padding: "0 var(--zk-space-4)" }}>
      <span style={{ font: "var(--zk-type-body-strong)" }}>{title}</span>
      <span style={{ font: "var(--zk-type-mono)", color: "var(--zk-gold)", whiteSpace: "nowrap" }}>
        {formatZec(stash.amountZat)} ZEC <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>~{formatUsd(stash.usd)}</span>
      </span>
    </div>
  );
}

function StepBtn({ icon, label, primary, disabled, dim, onClick }: { icon: "plus" | "minus"; label: string; primary: boolean; disabled: boolean; dim: boolean; onClick: () => void }) {
  const [down, setDown] = useState(false);
  const up = () => setDown(false);
  const shadow = primary
    ? down ? "var(--zk-shadow-btn-purple-pressed)" : "var(--zk-shadow-btn-purple)"
    : down ? "0 1px 0 var(--zk-bg)" : "0 3px 0 var(--zk-bg)";
  // The button is the 44px tap area; the drawn key inside it can be smaller on narrow phones.
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={() => !disabled && setDown(true)}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      style={{
        width: STEP_HIT,
        height: STEP_HIT,
        margin: STEP_HIT_MARGIN,
        flex: "none",
        border: 0,
        padding: 0,
        background: "transparent",
        color: "var(--zk-text)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
      }}
    >
      <span
        aria-hidden
        style={{
          width: STEP_BTN,
          height: STEP_BTN,
          flex: "none",
          borderRadius: "var(--zk-radius-lg)",
          background: primary ? "var(--zk-purple)" : "var(--zk-surface-raised)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: shadow,
          transform: down ? `translateY(${primary ? 4 : 2}px)` : "none",
          opacity: dim ? 0.45 : 1,
          transition: "transform var(--zk-dur-fast) var(--zk-ease-out), box-shadow var(--zk-dur-fast) var(--zk-ease-out), opacity var(--zk-dur-fast) var(--zk-ease-out)",
        }}
      >
        <Icon icon={icon} size={22} stroke={3} />
      </span>
    </button>
  );
}

function Stepper({ code, value, onChange, readOnly }: { code: string; value: number; onChange: (v: number) => void; readOnly: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-8)", minWidth: 0 }}>
      <span style={S.label}>{code}</span>
      <div style={{ display: "flex", alignItems: "center", gap: STEP_GAP }}>
        <StepBtn icon="minus" label={`${code} minus`} primary={false} disabled={readOnly || value <= 0} dim={!readOnly && value <= 0} onClick={() => onChange(Math.max(0, value - 1))} />
        <div aria-live="polite" aria-label={`${code} ${value}`} style={{ width: STEP_NUM, textAlign: "center", font: "var(--zk-type-score)", fontSize: STEP_FS, flex: "none" }}>
          {value}
        </div>
        <StepBtn icon="plus" label={`${code} plus`} primary disabled={readOnly || value >= 9} dim={!readOnly && value >= 9} onClick={() => onChange(Math.min(9, value + 1))} />
      </div>
    </div>
  );
}

function ScoreSteppers({ match, home, away, setHome, setAway, readOnly }: { match: Match; home: number; away: number; setHome: (v: number) => void; setAway: (v: number) => void; readOnly: boolean }) {
  return (
    <div
      style={{
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-2xl)",
        padding: "var(--zk-space-14)",
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)",
        alignItems: "center",
        opacity: readOnly ? 0.55 : 1,
        transition: "opacity var(--zk-dur-base) var(--zk-ease-out)",
      }}
    >
      <Stepper code={match.home.code} value={home} onChange={setHome} readOnly={readOnly} />
      <div aria-hidden style={{ font: "var(--zk-type-h2)", color: "var(--zk-text-muted)", padding: "var(--zk-space-18) var(--zk-space-2) 0" }}>–</div>
      <Stepper code={match.away.code} value={away} onChange={setAway} readOnly={readOnly} />
    </div>
  );
}

function PickCard({ selected, readOnly, label, visual, onClick }: { selected: boolean; readOnly: boolean; label: string; visual: ReactNode; onClick: () => void }) {
  const [down, setDown] = useState(false);
  const up = () => setDown(false);
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={readOnly}
      onClick={onClick}
      onPointerDown={() => !readOnly && setDown(true)}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      style={{
        minWidth: 0,
        minHeight: 112,
        padding: "var(--zk-space-14) var(--zk-space-6) var(--zk-space-12)",
        borderRadius: "var(--zk-radius-xl)",
        border: `2px solid ${selected ? "var(--zk-gold)" : "transparent"}`,
        background: selected ? "var(--zk-gold-tint)" : "var(--zk-surface-raised)",
        color: selected ? "var(--zk-gold)" : "var(--zk-text)",
        boxShadow: down ? "0 1px 0 var(--zk-bg)" : selected ? "var(--zk-shadow-chip-active)" : "0 3px 0 var(--zk-bg)",
        transform: down ? "translateY(2px)" : "none",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--zk-space-10)",
        font: "var(--zk-type-body-strong)",
        cursor: readOnly ? "default" : "pointer",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
        transition: "transform var(--zk-dur-fast) var(--zk-ease-out), box-shadow var(--zk-dur-fast) var(--zk-ease-out), background var(--zk-dur-fast) var(--zk-ease-out)",
      }}
    >
      <div style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>{visual}</div>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

function WinnerPicks({ match, pick, setPick, readOnly }: { match: Match; pick: WinnerPick | null; setPick: (p: WinnerPick) => void; readOnly: boolean }) {
  const badge = (t: Team, size: number, style?: CSSProperties) => (
    <div style={style}>
      <TeamBadge code={t.code} color={t.color} ink={t.ink} logo={t.logo} name={t.name} size={size} />
    </div>
  );
  const options: { id: WinnerPick; label: string; visual: ReactNode }[] = [
    { id: "home", label: "Home win", visual: badge(match.home, 44) },
    {
      id: "draw",
      label: "Draw",
      visual: (
        <div style={{ display: "flex", alignItems: "center" }}>
          {badge(match.home, 32)}
          {badge(match.away, 32, { marginLeft: -12 })}
        </div>
      ),
    },
    { id: "away", label: "Away win", visual: badge(match.away, 44) },
  ];
  return (
    <div
      role="group"
      aria-label="Call the winner"
      style={{
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-2xl)",
        padding: "var(--zk-space-14)",
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0,1fr))",
        gap: "var(--zk-space-8)",
        opacity: readOnly ? 0.55 : 1,
        transition: "opacity var(--zk-dur-base) var(--zk-ease-out)",
      }}
    >
      {options.map((o) => (
        <PickCard key={o.id} selected={pick === o.id} readOnly={readOnly} label={o.label} visual={o.visual} onClick={() => setPick(o.id)} />
      ))}
    </div>
  );
}

function RuleChips() {
  return (
    <div style={{ display: "flex", gap: "var(--zk-space-8)", flexWrap: "wrap" }}>
      <Chip variant="info" icon="medal" label="First correct call wins" />
      <Chip variant="info" icon="signal" label="Results from live sports feed" />
      <Chip variant="info" icon="target" label="1 call per player" />
    </div>
  );
}

function SealedNote({ calls, tail }: { calls: number; tail?: string }) {
  const dot = (bg: string, first = false): CSSProperties => ({
    width: 28,
    height: 28,
    borderRadius: "50%",
    background: bg,
    border: "2px solid var(--zk-surface)",
    marginLeft: first ? 0 : -10,
    flex: "none",
  });
  return (
    <div
      style={{
        padding: "var(--zk-space-14) var(--zk-space-16)",
        borderRadius: "var(--zk-radius-xl)",
        background: "var(--zk-purple-tint)",
        border: "1px solid rgb(var(--zk-purple-rgb) / .3)",
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-12)",
      }}
    >
      <div aria-hidden style={{ display: "flex", flex: "none" }}>
        <span style={dot("var(--zk-pink)", true)} />
        <span style={dot("var(--zk-sky)")} />
        <span style={dot("var(--zk-mint)")} />
      </div>
      <div style={{ font: "var(--zk-type-small)" }}>
        <b>
          {calls} {calls === 1 ? "call" : "calls"} sealed 🔒.
        </b>
        {tail ? <span style={{ color: "var(--zk-text-muted)" }}> {tail}</span> : null}
      </div>
    </div>
  );
}

/** Two mini cards: something on the left (your call, or the calls on your stash) and the prize. */
function MiniCards({ label, children, stash }: { label: string; children: ReactNode; stash: PublicStash }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "var(--zk-space-10)" }}>
      <div style={S.miniCard}>
        <div style={S.label}>{label}</div>
        {children}
      </div>
      <div style={S.miniCard}>
        <div style={S.label}>PRIZE</div>
        <div style={{ font: "var(--zk-type-mono)", fontSize: "var(--zk-fs-18)", color: "var(--zk-gold)", marginTop: "var(--zk-space-10)", whiteSpace: "nowrap" }}>
          {formatZec(stash.amountZat)} ZEC
        </div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)" }}>~{formatUsd(stash.usd)}</div>
      </div>
    </div>
  );
}

const bigValue: CSSProperties = {
  font: "var(--zk-fw-black) clamp(22px, 7.4vw, var(--zk-fs-30))/1.1 var(--zk-font-display)",
  color: "var(--zk-gold)",
  marginTop: "var(--zk-space-4)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function CallPrizeCards({ call, empty, stash }: { call: string; empty: string; stash: PublicStash }) {
  return (
    <MiniCards label="YOUR CALL" stash={stash}>
      {call ? <div style={bigValue}>{call}</div> : <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-8)" }}>{empty}</div>}
    </MiniCards>
  );
}

/** The hider's version: how many calls their stash drew, and the prize. */
function OwnStashCards({ calls, stash }: { calls: number; stash: PublicStash }) {
  return (
    <MiniCards label="CALLS ON IT" stash={stash}>
      <div style={bigValue}>{calls}</div>
      <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)" }}>{calls === 1 ? "call sealed" : "calls sealed"}</div>
    </MiniCards>
  );
}

function TensionMeter({ value, label }: { value: number; label: string }) {
  // Start at the left edge and spring to the value, so the pointer moves on first paint too.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(value));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [value]);
  const pos = Math.min(98, Math.max(2, shown));
  return (
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--zk-space-8)" }}>
        <span style={S.cardTitle}>Tension meter</span>
        <span style={{ font: "var(--zk-type-small)", fontWeight: "var(--zk-fw-black)", color: tensionColor(value), textAlign: "right" }}>{label}</span>
      </div>
      <div
        role="meter"
        aria-label="Tension meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={label}
        style={{
          marginTop: "var(--zk-space-12)",
          height: 18,
          borderRadius: "var(--zk-radius-pill)",
          background: "var(--zk-grad-tension)",
          position: "relative",
          boxShadow: "inset 0 -3px 0 rgb(var(--zk-black-rgb) / .2)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -6,
            left: `${pos}%`,
            width: 30,
            height: 30,
            marginLeft: -15,
            borderRadius: "50%",
            background: "var(--zk-text)",
            border: "4px solid var(--zk-bg)",
            boxSizing: "border-box",
            boxShadow: "0 0 18px rgb(var(--zk-white-rgb) / .6)",
            transition: "left var(--zk-dur-meter) var(--zk-ease-spring)",
          }}
        />
      </div>
      <div style={{ marginTop: "var(--zk-space-10)", display: "flex", justifyContent: "space-between", font: "var(--zk-type-tab)", color: "var(--zk-text-muted)" }}>
        <span>Cold</span>
        <span>Warm</span>
        <span>Sweaty</span>
        <span>On fire</span>
      </div>
    </div>
  );
}

const RUNNER_COLORS = ["var(--zk-sky)", "var(--zk-pink)", "var(--zk-mint)", "var(--zk-purple-light)"];
const RUNNERS_SHOWN = 5;

function Runners({ runners, total }: { runners: RunnerCall[]; total: number }) {
  // "You" first, then the server's order. Everyone else comes back as "Caller N" (their place in
  // the queue): calls stay anonymous.
  const sorted = [...runners.filter((r) => r.isYou), ...runners.filter((r) => !r.isYou)];
  const shown = sorted.slice(0, RUNNERS_SHOWN);
  const more = sorted.length - shown.length;
  let other = 0;
  return (
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--zk-space-8)" }}>
        <span style={S.cardTitle}>Still in the running</span>
        <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-mint)", whiteSpace: "nowrap" }}>
          {runners.length} / {Math.max(total, runners.length)}
        </span>
      </div>
      <div style={{ ...S.caption, fontWeight: "var(--zk-fw-semibold)", marginTop: "var(--zk-space-2)" }}>Other callers stay anonymous</div>
      <div style={{ marginTop: "var(--zk-space-12)", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
        {shown.length === 0 ? (
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>Nobody’s still in the running.</div>
        ) : (
          shown.map((r, i) => {
            const color = r.isYou ? "var(--zk-gold)" : RUNNER_COLORS[other++ % RUNNER_COLORS.length];
            const name = r.isYou ? "You" : r.handle.replace(/^@/, "");
            return (
              <div
                key={`${r.handle}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--zk-space-10)",
                  padding: "var(--zk-space-8) var(--zk-space-10)",
                  borderRadius: "var(--zk-radius-lg)",
                  background: r.isYou ? "var(--zk-gold-tint)" : "var(--zk-surface-raised)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 28,
                    height: 28,
                    flex: "none",
                    borderRadius: "50%",
                    background: color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "var(--zk-type-label)",
                    color: "var(--zk-bg)",
                  }}
                >
                  {r.isYou ? "★" : <Icon icon="mask" size={17} stroke={2.4} />}
                </span>
                <span style={{ flex: 1, minWidth: 0, font: "var(--zk-type-body-strong)", fontWeight: "var(--zk-fw-semibold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {name}
                </span>
                {r.matchesNow ? (
                  <span style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-bold)", color: "var(--zk-mint)", whiteSpace: "nowrap" }}>spot on</span>
                ) : null}
                <span style={{ font: "var(--zk-type-h4)", color: r.matchesNow ? "var(--zk-mint)" : "var(--zk-text)", whiteSpace: "nowrap" }}>{r.label}</span>
              </div>
            );
          })
        )}
        {more > 0 ? <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", textAlign: "center" }}>+{more} more</div> : null}
      </div>
    </div>
  );
}

/** A state card in the screens' visual language: icon tile, headline, body. */
function StateCard({ icon, tone, tint, title, children, border }: { icon: string; tone: string; tint: string; title: ReactNode; children?: ReactNode; border?: string }) {
  return (
    <div
      role="status"
      style={{
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-2xl)",
        padding: "var(--zk-space-18)",
        border: `1px solid ${border ?? "var(--zk-border)"}`,
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-10)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
        <div style={{ width: 40, height: 40, flex: "none", borderRadius: "var(--zk-radius-md)", background: tint, color: tone, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon icon={icon} size={20} stroke={2.4} />
        </div>
        <div style={{ font: "var(--zk-type-h3)", minWidth: 0, textWrap: "balance" }}>{title}</div>
      </div>
      {children}
    </div>
  );
}

function Line({ icon, color, children }: { icon: string; color?: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-8)", font: "var(--zk-type-body-strong)", color: color ?? "var(--zk-text-muted)" }}>
      <Icon icon={icon} size={16} stroke={2.2} />
      <span style={{ minWidth: 0 }}>{children}</span>
    </div>
  );
}

function EndedTop({ match, label }: { match: Match; label: string }) {
  return (
    <>
      <span style={S.caption}>{match.leagueName}</span>
      <LiveBadge state="ended" label={label} />
    </>
  );
}

/* ---------- moments: kickoff, goal, full time ---------- */

const MOMENT_LOOK: Record<MomentKind, { fg: string; rgb: string; icon: string }> = {
  goal: { fg: "var(--zk-mint)", rgb: "var(--zk-mint-rgb)", icon: "ball" },
  kickoff: { fg: "var(--zk-sky)", rgb: "var(--zk-sky-rgb)", icon: "ball" },
  fulltime: { fg: "var(--zk-gold)", rgb: "var(--zk-gold-rgb)", icon: "flag" },
};

/** A banner that springs down from the top of the screen for a big match moment, then slides away. Tap to dismiss. */
function MomentBanner({ m, onDone }: { m: MomentState; onDone: () => void }) {
  const [shown, setShown] = useState(false);
  const titleRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  const exit = useRef<number | undefined>(undefined);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const close = useCallback(() => {
    if (exit.current !== undefined) return;
    setShown(false);
    exit.current = window.setTimeout(() => doneRef.current(), MOMENT_EXIT_MS);
  }, []);
  useEffect(() => {
    // Two frames so the off-screen position paints before the slide-in starts.
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setShown(true));
    });
    play(
      titleRef.current,
      [
        { transform: "scale(.4)", opacity: 0 },
        { transform: "scale(1.2)", opacity: 1, offset: 0.55 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 620, delay: 140, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" },
    );
    const t = window.setTimeout(close, MOMENT_MS);
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
      window.clearTimeout(t);
      window.clearTimeout(exit.current);
    };
  }, [close]);
  const look = MOMENT_LOOK[m.kind];
  return (
    <div
      role="alert"
      onClick={close}
      style={{
        pointerEvents: "auto",
        cursor: "pointer",
        transform: shown ? "none" : "translateY(calc(-100% - 80px))",
        opacity: shown ? 1 : 0,
        transition: shown
          ? "transform 480ms var(--zk-ease-spring), opacity var(--zk-dur-base) var(--zk-ease-out)"
          : `transform ${MOMENT_EXIT_MS}ms var(--zk-ease-in-out), opacity ${MOMENT_EXIT_MS}ms var(--zk-ease-in-out)`,
        background: `linear-gradient(135deg, rgb(${look.rgb} / .22), rgb(${look.rgb} / .05) 70%), var(--zk-surface-raised)`,
        border: `1.5px solid rgb(${look.rgb} / .55)`,
        borderRadius: "var(--zk-radius-2xl)",
        boxShadow: `var(--zk-shadow-float), 0 0 36px rgb(${look.rgb} / .3)`,
        padding: "var(--zk-space-14)",
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-12)",
        color: "var(--zk-text)",
        fontFamily: "var(--zk-font-body)",
      }}
    >
      <div style={{ flex: "none" }}>
        {m.team ? (
          <TeamBadge code={m.team.code} color={m.team.color} ink={m.team.ink} logo={m.team.logo} name={m.team.name} size={48} />
        ) : (
          <div style={{ width: 48, height: 48, borderRadius: "var(--zk-radius-lg)", background: `rgb(${look.rgb} / .16)`, color: look.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon icon={look.icon} size={26} stroke={2.4} />
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--zk-space-2)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--zk-space-8)" }}>
          <div
            ref={titleRef}
            style={{ font: "var(--zk-fw-black) var(--zk-fs-30)/1 var(--zk-font-display)", letterSpacing: "var(--zk-track-tight)", color: look.fg, transformOrigin: "left center" }}
          >
            {m.title}
          </div>
          {m.meta ? <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-text-muted)", flex: "none" }}>{m.meta}</span> : null}
        </div>
        <div style={{ font: "var(--zk-type-body-strong)", overflowWrap: "break-word" }}>{m.line}</div>
        {m.note ? (
          <div style={{ font: "var(--zk-type-small)", fontWeight: "var(--zk-fw-bold)", color: m.note.good === undefined ? "var(--zk-text-muted)" : m.note.good ? "var(--zk-mint)" : "var(--zk-pink)" }}>
            {m.note.text}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Drops a toast in from above. */
function DropIn({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    play(ref.current, [{ transform: "translateY(-16px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 280, easing: "cubic-bezier(.22,1,.36,1)" });
  }, []);
  return <div ref={ref}>{children}</div>;
}

/* ---------- the screen ---------- */

export function PredictionStash({ initial, onWin }: PredictionStashProps) {
  const [data, setData] = useState<StashData>(initial);

  // A different stash in the same instance: start over from the new initial data.
  const [initialId, setInitialId] = useState(initial.stash.id);
  if (initial.stash.id !== initialId) {
    setInitialId(initial.stash.id);
    setData(initial);
  }

  const { stash, myCall, runners, win } = data;
  const id = stash.id;
  const pred = stash.prediction;
  const match = pred?.match;
  const mine = stash.isMine;

  /* --- kickoff clock (client only, so SSR and hydration agree) --- */
  const locksAt = pred?.locksAt;
  const [kickedOff, setKickedOff] = useState(false);
  const [soon, setSoon] = useState(false);
  useEffect(() => {
    const at = locksAt ? Date.parse(locksAt) : NaN;
    if (!Number.isFinite(at)) return;
    const timers: number[] = [];
    const after = (ms: number, fn: () => void) => {
      if (ms <= 0) fn();
      else timers.push(window.setTimeout(fn, Math.min(ms, 2_147_000_000)));
    };
    setKickedOff(false);
    setSoon(false);
    after(at - SOON_MS - Date.now(), () => setSoon(true));
    after(at - Date.now(), () => setKickedOff(true));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [locksAt]);

  /* --- polling --- */
  const inFlight = useRef(false);
  const mutation = useRef(0); // bumps around a call so a stale poll can't undo it
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const seq = mutation.current;
    try {
      const r = await api.stash(id);
      if (seq !== mutation.current) return;
      setData((prev) => ({
        stash: r.stash,
        myCall: r.myCall ?? prev.myCall,
        runners: r.runners ?? prev.runners,
        win: r.win ?? prev.win,
        myReactions: r.myReactions ?? [],
      }));
    } catch {
      // keep the last good state; the next poll retries
    } finally {
      inFlight.current = false;
    }
  }, [id]);

  const phase = phaseOf(stash, kickedOff, !!win);
  const settled = RESOLVED.has(stash.status);
  // Fast while the match is on (or about to be), slower while calls are open, slow once it's settled.
  const pollMs =
    !match || settled
      ? SLOW_POLL_MS
      : match.status === "live" || match.status === "final" || phase === "locked" || soon
        ? LIVE_POLL_MS
        : match.status === "scheduled"
          ? OPEN_POLL_MS
          : SLOW_POLL_MS;

  useEffect(() => {
    // Paused while the tab is hidden; catches up the moment it's visible again.
    let t: number | undefined;
    const start = () => {
      window.clearInterval(t);
      t = window.setInterval(() => void refresh(), pollMs);
    };
    const onVisible = () => {
      if (document.hidden) {
        window.clearInterval(t);
        t = undefined;
      } else {
        void refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pollMs, refresh]);

  /* --- win: hand off once --- */
  const onWinRef = useRef(onWin);
  useEffect(() => {
    onWinRef.current = onWin;
  });
  const winFired = useRef(false);
  const youWon = !!stash.result?.winnerIsYou && !!win;
  useEffect(() => {
    if (youWon && win && !winFired.current) {
      winFired.current = true;
      onWinRef.current(win);
    }
  }, [youWon, win]);

  /* --- toast --- */
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback((t: Omit<ToastState, "id">) => setToast({ ...t, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* --- moments: kickoff, goals, full time (only for changes seen while this screen is open) --- */
  const [moment, setMoment] = useState<MomentState | null>(null);
  const seen = useRef<{ phase: Phase; home: number; away: number } | null>(null);
  useEffect(() => {
    if (!match) return;
    const home = match.homeScore ?? 0;
    const away = match.awayScore ?? 0;
    const prev = seen.current;
    seen.current = { phase, home, away };
    if (!prev) return;
    const scoreLine = `${match.home.name} ${formatScore(home, away)} ${match.away.name}`;
    const show = (m: Omit<MomentState, "id">) => setMoment({ ...m, id: Date.now() });
    const scored = home > prev.home || away > prev.away;

    // Kickoff: straight from "calls open/locked" into play (not when we've been away for half the match).
    if ((prev.phase === "open" || prev.phase === "locked") && phase === "live" && !scored && parseMinute(match.minute) <= 5) {
      sfx("whoosh");
      show({
        kind: "kickoff",
        title: "Kickoff!",
        line: "Calls are locked 🔒",
        note: mine ? { text: "Your stash is in play. Nobody can call it now." } : myCall ? { text: `Your ${callNoun(myCall, match)} is sealed. Come on!`, good: true } : { text: "Watch it play out right here" },
      });
      return;
    }

    // Full time (a win gets the big win screen instead).
    if (prev.phase === "live" && (phase === "final" || phase === "refunded")) {
      const right = callMatchesScore(myCall, home, away);
      sfx(right ? "success" : "select");
      show({
        kind: "fulltime",
        title: "Full time!",
        line: scoreLine,
        note: myCall ? (right ? { text: `Your ${callNoun(myCall, match)} was spot on 🔥`, good: true } : { text: `Your ${callNoun(myCall, match)} missed this time`, good: false }) : undefined,
      });
      return;
    }

    // Goal(s).
    if (scored && (match.status === "live" || match.status === "final")) {
      const both = home > prev.home && away > prev.away;
      const many = home - prev.home + (away - prev.away) > 1;
      const team = both ? undefined : home > prev.home ? match.home : match.away;
      const last = sortedEvents(match.events).filter((e) => eventLine(e, match).goal).pop();
      let note: MomentState["note"];
      if (mine) {
        const spot = (runners ?? []).filter((r) => r.matchesNow).length;
        note = spot
          ? { text: `${spot === 1 ? "1 caller is" : `${spot} callers are`} spot on right now 😬`, good: false }
          : { text: "Nobody’s spot on right now. Your stash is safe 😌", good: true };
      } else if (myCall) {
        note = goalNote(myCall, match, prev);
      }
      sfx("notify");
      show({
        kind: "goal",
        title: many ? "GOALS!" : "GOAL!",
        meta: !many && last ? prettyMinute(last.minute) : undefined,
        line: team && !many ? `${team.name} scores · ${formatScore(home, away)}` : scoreLine,
        note,
        team,
      });
    }
  }, [data, phase, match, mine, myCall, runners]);

  /* --- nav + share --- */
  const back = useAppBack("/feed");

  const share = useCallback(async () => {
    const url = window.location.href;
    const text = match
      ? pred?.kind === "winner"
        ? `First to call the ${match.home.name} vs ${match.away.name} winner ZECKS ${formatUsd(stash.usd)} ⚽`
        : `First to call ${match.home.name} vs ${match.away.name} exactly ZECKS ${formatUsd(stash.usd)} ⚽`
      : "ZECKED";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "ZECKED", text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        // fall through to copying the link
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast({ text: "Link copied", variant: "success", icon: "copy" });
    } catch {
      showToast({ text: "Couldn’t copy the link. Copy it from the address bar.", variant: "error" });
    }
  }, [match, pred?.kind, stash.usd, showToast]);

  /* --- making a call --- */
  const [home, setHome] = useState(0);
  const [away, setAway] = useState(0);
  const [pick, setPick] = useState<WinnerPick | null>(null);
  const [busy, setBusy] = useState(false);
  // Sealing is final, so it takes two taps: "Lock 2–1?" then "Tap again to seal".
  const [armed, setArmed] = useState(false);
  const armBar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!armed) return;
    play(armBar.current, [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: ARM_MS, easing: "linear", fill: "forwards" });
    const t = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(t);
  }, [armed]);
  const editHome = (v: number) => {
    setHome(v);
    setArmed(false);
  };
  const editAway = (v: number) => {
    setAway(v);
    setArmed(false);
  };
  const editPick = (p: WinnerPick) => {
    setPick(p);
    setArmed(false);
  };

  const lockCall = useCallback(async () => {
    if (busy || myCall || mine || !pred) return;
    const body = pred.kind === "exact" ? { home, away } : pick ? { pick } : null;
    if (!body) return;
    setBusy(true);
    mutation.current++;
    try {
      const r = await api.call(id, body);
      mutation.current++;
      sfx("lock");
      setData((prev) => ({
        ...prev,
        myCall: r.myCall,
        stash: prev.stash.prediction ? { ...prev.stash, prediction: { ...prev.stash.prediction, calls: r.calls } } : prev.stash,
      }));
    } catch (e) {
      mutation.current++;
      showToast({ text: friendlyError(e, "Couldn’t lock your call. Try again."), variant: "error" });
      void refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, myCall, mine, pred, home, away, pick, id, showToast, refresh]);

  const onLockTap = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    void lockCall();
  };

  const onLockDone = useCallback(() => {
    setKickedOff(true);
    setArmed(false);
    void refresh();
  }, [refresh]);

  const liveMinute = useLiveMinute(match);

  /* --- render --- */
  const topLayer =
    moment || toast ? (
      <div
        style={{
          position: "fixed",
          top: "calc(var(--zk-fixed-top) + var(--zk-space-10))",
          left: "var(--zk-col-x)",
          transform: "translateX(-50%)",
          width: "calc(min(var(--zk-col-w), 430px) - 2 * var(--zk-space-12))",
          zIndex: 80,
          display: "flex",
          flexDirection: "column",
          gap: "var(--zk-space-8)",
          pointerEvents: "none",
        }}
      >
        {moment ? <MomentBanner key={moment.id} m={moment} onDone={() => setMoment(null)} /> : null}
        {toast ? (
          <DropIn key={toast.id}>
            <Toast text={toast.text} variant={toast.variant} icon={toast.icon} />
          </DropIn>
        ) : null}
      </div>
    ) : null;

  const screen = (bg: string, children: ReactNode) => (
    <main className="zk-screen" style={{ background: bg, gap: "var(--zk-space-12)" }}>
      {children}
      {topLayer}
    </main>
  );

  const title = (
    <span style={{ ...S.navLabel, display: "inline-flex", alignItems: "center", gap: "var(--zk-space-6)" }}>
      {stash.private ? <Icon icon="eyeOff" size={14} stroke={2.4} /> : null}
      {stash.private ? "PRIVATE PREDICTION" : "PREDICTION STASH"}
    </span>
  );
  const nav = (center: ReactNode = title) => <Nav center={center} onBack={back} onShare={() => void share()} />;
  const findAnother = (variant: "primary" | "ghost" = "primary", pinned = true) => (
    <Button label="Find another stash" variant={variant} size="lg" href="/feed" style={pinned ? { marginTop: "auto" } : undefined} />
  );
  // The hider's way out of a finished stash: hide another, or check the wallet the ZEC came back to.
  const hiderEnd = (withWallet: boolean) => (
    <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>
      <Button label="Hide another stash" variant="primary" size="lg" icon="plus" href="/hide" />
      {withWallet ? <Button label="Open your wallet" variant="ghost" size="lg" icon="wallet" href="/wallet" /> : null}
    </div>
  );
  const ownNote = <Line icon="info">It’s your stash, so you can’t call it. Enjoy the match 🍿</Line>;
  // Anyone can react once it's funded (guests too). Called-off matches can't take them.
  const reactions = (
    <Reactions stashId={id} counts={stash.reactions} mine={data.myReactions} onError={(text) => showToast({ text, variant: "error" })} />
  );

  if (!pred || !match) {
    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        {nav()}
        <StateCard icon="info" tone="var(--zk-sky)" tint="var(--zk-sky-tint)" title="This stash isn’t a match call." />
        {findAnother()}
      </>,
    );
  }

  const callText = formatCall(myCall, match);
  const noCallText = "You didn’t call this one";
  const zec = formatZec(stash.amountZat);

  /* 5 · awaiting funding */
  if (phase === "funding") {
    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        {nav()}
        <HiderRow stash={stash} />
        <MatchCard match={match} />
        <StateCard icon="hourglass" tone="var(--zk-gold)" tint="var(--zk-gold-tint)" title={mine ? "Your stash isn’t live yet." : "This stash isn’t live yet."}>
          <p style={S.muted}>{mine ? "Add the prize and it opens for calls." : "The hider hasn’t added the prize yet. Check back soon."}</p>
        </StateCard>
        {mine ? <Button label="Fund it" variant="primary" size="lg" iconRight="arrowRight" href={`/hide?resume=${encodeURIComponent(id)}`} style={{ marginTop: "auto" }} /> : findAnother()}
      </>,
    );
  }

  /* 4d · postponed / canceled */
  if (phase === "void") {
    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        {nav()}
        <HiderRow stash={stash} />
        <MatchCard match={match} badge={<LiveBadge state="ended" label={match.status === "postponed" ? "Postponed" : "Called off"} />} />
        <StateCard icon="flag" tone="var(--zk-text-muted)" tint="var(--zk-surface-raised)" title={mine ? "Match called off: your ZEC came back" : "Match called off."}>
          <p style={S.muted}>{mine ? `Your ${zec} ZEC is back in your ZECKED wallet.` : "The ZEC went back to the hider."}</p>
        </StateCard>
        {mine ? <OwnStashCards calls={pred.calls} stash={stash} /> : myCall ? <CallPrizeCards call={callText} empty={noCallText} stash={stash} /> : null}
        {mine ? hiderEnd(true) : findAnother()}
      </>,
    );
  }

  /* 4c · nobody called it */
  if (phase === "refunded") {
    const played = match.status === "final";
    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        {nav()}
        <HiderRow stash={stash} />
        {played ? (
          <ScoreCard match={match} accent="var(--zk-border-strong)" top={<EndedTop match={match} label="Full time" />} />
        ) : (
          <MatchCard match={match} badge={<LiveBadge state="ended" label="Ended" />} />
        )}
        <StateCard icon="unlock" tone="var(--zk-purple-light)" tint="var(--zk-purple-tint)" title={mine ? "Nobody called it: your ZEC came back" : "Nobody called it."}>
          <p style={S.muted}>{mine ? `Your ${zec} ZEC is back in your ZECKED wallet. Uncrackable 🛡️` : "The ZEC went back to the hider."}</p>
        </StateCard>
        {mine ? <OwnStashCards calls={pred.calls} stash={stash} /> : myCall ? <CallPrizeCards call={callText} empty={noCallText} stash={stash} /> : null}
        {reactions}
        {mine ? hiderEnd(true) : findAnother()}
      </>,
    );
  }

  /* 4a / 4b · full time */
  if (phase === "won" || phase === "final") {
    const fs = finalScore(match, stash.result?.finalScore);
    const scoreText = fs ? formatScore(fs.home, fs.away) : stash.result?.finalScore ?? "";
    const headline = `Full time: ${match.home.name} ${scoreText} ${match.away.name}`;
    const resolved = stash.status === "zecked";
    const result = stash.result;
    const youRight = fs ? callMatchesScore(myCall, fs.home, fs.away) : false;
    const correct = result?.correctCalls;
    const correctLine = typeof correct === "number" ? <Line icon="target">{plural(correct, "correct call", "correct calls")}</Line> : null;

    if (phase === "won" && win) {
      return screen(
        "var(--zk-bg-hero-gold)",
        <>
          {nav()}
          <HiderRow stash={stash} />
          <ScoreCard match={match} accent="rgb(var(--zk-gold-rgb) / .45)" top={<EndedTop match={match} label="Full time" />} scoreColor="var(--zk-gold)">
            <ZeckedStamp />
          </ScoreCard>
          <StateCard icon="trophy" tone="var(--zk-gold)" tint="var(--zk-gold-tint)" border="rgb(var(--zk-gold-rgb) / .35)" title={headline}>
            <Line icon="medal" color="var(--zk-gold)">Called it first: you</Line>
            {correctLine}
          </StateCard>
          <CallPrizeCards call={callText} empty={noCallText} stash={stash} />
          {reactions}
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>
            <Button label="You called it! Claim your ZEC" variant="primary" size="lg" icon="coin" onClick={() => onWinRef.current(win)} />
            {findAnother("ghost", false)}
          </div>
        </>,
      );
    }

    // Winners stay anonymous: "a mystery caller" (the server's label is written for riddles).
    const firstBy = result?.winnerIsYou ? "you" : "a mystery caller";

    if (mine) {
      return screen(
        "var(--zk-bg-hero-sky)",
        <>
          {nav()}
          <HiderRow stash={stash} />
          <ScoreCard match={match} accent="var(--zk-border-strong)" top={<EndedTop match={match} label="Full time" />}>
            {resolved ? <ZeckedStamp /> : null}
          </ScoreCard>
          {resolved ? (
            <StateCard icon="unlock" tone="var(--zk-pink)" tint="rgb(var(--zk-pink-rgb) / .14)" border="rgb(var(--zk-pink-rgb) / .35)" title="Someone called it: your stash got ZECKED">
              <Line icon="medal">Called it first: a mystery caller</Line>
              {correctLine}
            </StateCard>
          ) : (
            <StateCard icon="hourglass" tone="var(--zk-gold)" tint="var(--zk-gold-tint)" title={headline}>
              <Line icon="clock">Checking the calls…</Line>
            </StateCard>
          )}
          <OwnStashCards calls={pred.calls} stash={stash} />
          {reactions}
          {resolved ? hiderEnd(false) : null}
        </>,
      );
    }

    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        {nav()}
        <HiderRow stash={stash} />
        <ScoreCard match={match} accent="var(--zk-border-strong)" top={<EndedTop match={match} label="Full time" />} scoreColor={youRight ? "var(--zk-mint)" : undefined}>
          {resolved ? <ZeckedStamp /> : null}
        </ScoreCard>
        <StateCard icon={resolved ? "trophy" : "hourglass"} tone="var(--zk-gold)" tint="var(--zk-gold-tint)" title={headline}>
          {resolved && result ? (
            <>
              <Line icon="medal">Called it first: {firstBy}</Line>
              {correctLine}
              {youRight && !result.winnerIsYou ? <Line icon="flame" color="var(--zk-pink)">You called it too, just not first 😤</Line> : null}
            </>
          ) : youRight ? (
            <Line icon="flame" color="var(--zk-mint)">Your call is right! Checking who called it first…</Line>
          ) : (
            <Line icon="clock">Checking the calls…</Line>
          )}
        </StateCard>
        <CallPrizeCards call={callText} empty={noCallText} stash={stash} />
        {reactions}
        {findAnother()}
      </>,
    );
  }

  /* 3 · live (screen 06) */
  if (phase === "live") {
    const spotOn = callMatches(myCall, match);
    const value = closeness(myCall, match);
    return screen(
      "var(--zk-bg-hero-mint)",
      <>
        {nav(<LiveClock minute={liveMinute} />)}
        <HiderRow stash={stash} />
        <ScoreCard
          match={match}
          accent="rgb(var(--zk-mint-rgb) / .3)"
          bar
          minute={liveMinute}
          scoreColor={spotOn ? "var(--zk-mint)" : undefined}
          lastEventNote={spotOn ? "You’re calling it!" : undefined}
        >
          {match.demo ? <DemoChip /> : null}
        </ScoreCard>
        {mine ? (
          <>
            <OwnStashCards calls={pred.calls} stash={stash} />
            {ownNote}
          </>
        ) : (
          <CallPrizeCards call={callText} empty={noCallText} stash={stash} />
        )}
        {reactions}
        {myCall ? <TensionMeter value={value} label={tensionLabel(myCall, match)} /> : null}
        {runners ? <Runners runners={runners} total={pred.calls} /> : null}
      </>,
    );
  }

  /* 2 · locked: kicked off, waiting for the feed to show the match in play */
  if (phase === "locked") {
    const future = !!locksAt && Date.parse(locksAt) > Date.now();
    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        {nav()}
        <HiderRow stash={stash} />
        <MatchCard
          match={match}
          badge={<CallsLockedPill />}
          footer={
            future ? (
              <>
                <span style={{ font: "var(--zk-type-small)", fontWeight: "var(--zk-fw-bold)", color: "var(--zk-text-muted)" }}>Calls locked · kicks off in</span>
                <Countdown to={pred.locksAt} format="hms" variant="pill" size="md" tone="auto" />
              </>
            ) : (
              <>
                <Icon icon="lock" size={16} stroke={2.4} color="var(--zk-gold)" />
                <span style={{ font: "var(--zk-type-small)", fontWeight: "var(--zk-fw-bold)", color: "var(--zk-text-muted)" }}>Calls are locked. Kickoff any second…</span>
              </>
            )
          }
        >
          {match.demo ? <DemoChip /> : null}
        </MatchCard>
        {mine ? (
          <>
            <OwnStashCards calls={pred.calls} stash={stash} />
            {ownNote}
          </>
        ) : (
          <CallPrizeCards call={callText} empty={noCallText} stash={stash} />
        )}
        {runners ? <Runners runners={runners} total={pred.calls} /> : <SealedNote calls={pred.calls} tail="Revealed at kickoff." />}
        {reactions}
      </>,
    );
  }

  /* 1 · open (screen 05) */
  const sealed = !!myCall;
  const shownHome = sealed && myCall?.kind === "exact" ? myCall.home ?? 0 : home;
  const shownAway = sealed && myCall?.kind === "exact" ? myCall.away ?? 0 : away;
  const shownPick = sealed && myCall?.kind === "winner" ? myCall.pick ?? null : pick;
  const exact = pred.kind === "exact";
  const draft = exact ? formatScore(home, away) : pick ? formatCall({ kind: "winner", pick }, match) : "";
  const isArmed = armed && !sealed && !busy;

  const lockLabel: ReactNode = sealed ? (
    `CALL SEALED ${callText.toUpperCase()}`
  ) : busy ? (
    "SEALING…"
  ) : isArmed ? (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-4)", lineHeight: 1 }}>
      <span>LOCK {draft.toUpperCase()}?</span>
      <span style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-bold)", opacity: 0.9 }}>Tap again to seal. No changes after.</span>
    </span>
  ) : (
    "LOCK MY CALL"
  );

  return screen(
    "var(--zk-bg-hero-sky)",
    <>
      {nav()}
      <HiderRow stash={stash} />
      <MatchCard
        match={match}
        badge={<CallsOpenPill />}
        footer={
          <>
            <span style={{ font: "var(--zk-type-small)", fontWeight: "var(--zk-fw-bold)", color: "var(--zk-text-muted)" }}>Calls lock in</span>
            <Countdown to={pred.locksAt} format="hms" variant="pill" size="md" tone="auto" onDone={onLockDone} />
          </>
        }
      >
        {match.demo ? <DemoChip /> : null}
      </MatchCard>
      <PrizeRow title={exact ? "Call the exact score" : "Call the winner"} stash={stash} />
      {mine ? (
        <div style={{ ...S.card, padding: "var(--zk-space-18)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-10)", textAlign: "center" }}>
          <div style={S.label}>YOUR STASH</div>
          <div style={{ font: "var(--zk-fw-black) var(--zk-fs-40)/1 var(--zk-font-display)", color: "var(--zk-gold)" }}>{pred.calls}</div>
          <div style={{ font: "var(--zk-type-body-strong)", marginTop: "calc(-1 * var(--zk-space-4))" }}>{pred.calls === 1 ? "call sealed so far" : "calls sealed so far"}</div>
          <p style={{ ...S.muted, maxWidth: 300 }}>
            {stash.private ? "Only people with the link can call it. Send it to your friend." : "You can’t call your own stash. Share it so more people take a shot."}
          </p>
          <Button label="Share your stash" variant="secondary" size="md" icon="share" onClick={() => void share()} />
        </div>
      ) : (
        <>
          {exact ? (
            <ScoreSteppers match={match} home={shownHome} away={shownAway} setHome={editHome} setAway={editAway} readOnly={sealed || busy} />
          ) : (
            <WinnerPicks match={match} pick={shownPick} setPick={editPick} readOnly={sealed || busy} />
          )}
          <div style={{ position: "relative" }}>
            <Button
              label={lockLabel}
              variant={sealed ? "success" : isArmed ? "secondary" : "primary"}
              size="lg"
              iconRight="lock"
              onClick={sealed ? undefined : onLockTap}
              disabled={!sealed && !exact && !pick}
              ariaLabel={sealed ? `Call sealed: ${callText}` : isArmed ? `Lock ${draft}? Tap again to seal it` : undefined}
              sfx={isArmed ? "none" : sealed ? "none" : "select"}
            />
            {isArmed ? (
              <div aria-hidden style={{ position: "absolute", left: "var(--zk-space-18)", right: "var(--zk-space-18)", bottom: -9, height: 4, borderRadius: "var(--zk-radius-pill)", background: "rgb(var(--zk-white-rgb) / .12)", overflow: "hidden" }}>
                <div ref={armBar} style={{ height: "100%", background: "var(--zk-purple-light)", transformOrigin: "left center" }} />
              </div>
            ) : null}
          </div>
        </>
      )}
      <RuleChips />
      {mine ? null : <SealedNote calls={pred.calls} tail="Revealed at kickoff." />}
      {reactions}
    </>,
  );
}

export default PredictionStash;
