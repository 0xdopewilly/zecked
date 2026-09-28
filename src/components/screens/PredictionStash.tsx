"use client";
// Screens 05 (prediction stash) + 06 (live match), plus the locked, full-time, refunded,
// called-off and awaiting-funding states. Polls the stash so every state stays in sync.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, Countdown, Icon, LiveBadge, TeamBadge, Toast } from "@/components/zk";
import { api, formatUsd, formatZec } from "@/lib/api";
import type { Match, MyCall, PublicStash, RunnerCall, Team, WinPayload, WinnerPick } from "@/lib/types";
import {
  callMatches,
  callMatchesScore,
  closeness,
  eventLine,
  finalScore,
  formatCall,
  formatKickoff,
  formatScore,
  liveScore,
  matchProgress,
  parseMinute,
  prettyMinute,
  sortedEvents,
  tensionColor,
  tensionLabel,
} from "@/lib/predict";

type StashData = { stash: PublicStash; myCall?: MyCall; runners?: RunnerCall[]; win?: WinPayload };

export interface PredictionStashProps {
  initial: StashData;
  onWin: (win: WinPayload) => void;
}

type Phase = "funding" | "open" | "locked" | "live" | "final" | "won" | "refunded" | "void";
type ToastState = { id: number; text: string; variant: "default" | "success" | "error" | "gold"; icon?: string };

const FAST_POLL_MS = 15_000;
const SLOW_POLL_MS = 60_000;
const TOAST_MS = 2600;
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
} satisfies Record<string, CSSProperties>;

/*
 * Stepper sizing. The design's fixed 46/48/10px didn't fit a 390px screen (the right "+" hit the
 * card edge). These scale with the viewport: full design size from ~430px up, 44px tap targets
 * at 390px, and still fitting at 320px.
 */
const STEP_BTN = "clamp(36px, 11.3vw, 46px)";
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

function Nav({ center, onBack, onShare }: { center: ReactNode; onBack: () => void; onShare?: () => void }) {
  return (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--zk-space-8)" }}>
      <IconBtn icon="back" label="Back" size={22} stroke={2.4} onClick={onBack} />
      {center}
      {onShare ? (
        <IconBtn icon="share" label="Share" size={20} stroke={2.2} onClick={onShare} />
      ) : (
        <div aria-hidden style={{ width: "var(--zk-tap-min)", flex: "none" }} />
      )}
    </nav>
  );
}

function DemoChip() {
  return <Chip variant="info" size="sm" icon="bolt" iconColor="var(--zk-gold)" label="TEST MATCH · plays out in minutes" />;
}

function TeamCol({ team, size }: { team: Team; size: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-6)", minWidth: 0 }}>
      <TeamBadge code={team.code} color={team.color} ink={team.ink} size={size} />
      <span style={{ font: "var(--zk-type-body-strong)", textAlign: "center", overflowWrap: "anywhere" }}>{team.name}</span>
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
        <span style={S.caption}>
          {match.leagueName}
          {kickoff ? ` · ${kickoff}` : ""}
        </span>
        {badge}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "center", marginTop: "var(--zk-space-14)" }}>
        <TeamCol team={match.home} size={68} />
        <div style={{ font: "var(--zk-type-h3)", color: "var(--zk-text-muted)", padding: "0 var(--zk-space-8)" }}>VS</div>
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

/** Screen 06's score card: badges, big score, optional match-time bar and goal events. */
function ScoreCard({
  match,
  accent,
  top,
  bar,
  scoreColor,
  lastEventNote,
  children,
}: {
  match: Match;
  accent: string;
  top?: ReactNode;
  bar?: boolean;
  scoreColor?: string;
  lastEventNote?: string;
  children?: ReactNode;
}) {
  const { home, away } = liveScore(match);
  const events = sortedEvents(match.events);
  const lastGoal = lastEventNote ? events.map((e) => eventLine(e, match).goal).lastIndexOf(true) : -1;
  const pct = matchProgress(match);
  const fg = scoreColor ?? "var(--zk-text)";
  return (
    <div style={{ background: "var(--zk-surface)", borderRadius: "var(--zk-radius-3xl)", padding: "var(--zk-space-18)", border: `1.5px solid ${accent}` }}>
      {top ? <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--zk-space-8)", marginBottom: "var(--zk-space-14)" }}>{top}</div> : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", alignItems: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <TeamBadge code={match.home.code} color={match.home.color} ink={match.home.ink} size={58} />
        </div>
        <div
          aria-label={`${match.home.name} ${home}, ${match.away.name} ${away}`}
          style={{ font: "var(--zk-type-score-xl)", letterSpacing: "var(--zk-track-tight)", display: "flex", gap: "var(--zk-space-12)", alignItems: "center" }}
        >
          <span aria-hidden style={{ color: fg, transition: "color var(--zk-dur-base) var(--zk-ease-out)" }}>{home}</span>
          <span aria-hidden style={{ color: "var(--zk-text-muted)", fontSize: "var(--zk-fs-40)" }}>–</span>
          <span aria-hidden style={{ color: fg, transition: "color var(--zk-dur-base) var(--zk-ease-out)" }}>{away}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <TeamBadge code={match.away.code} color={match.away.color} ink={match.away.ink} size={58} />
        </div>
      </div>
      {bar ? (
        <div
          role="progressbar"
          aria-label="Match time"
          aria-valuemin={0}
          aria-valuemax={90}
          aria-valuenow={Math.min(90, parseMinute(match.minute))}
          style={{ marginTop: "var(--zk-space-12)", height: 6, borderRadius: "var(--zk-radius-xs)", background: "var(--zk-surface-raised)", overflow: "hidden" }}
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
        width: STEP_BTN,
        height: STEP_BTN,
        flex: "none",
        borderRadius: "var(--zk-radius-lg)",
        border: 0,
        padding: 0,
        background: primary ? "var(--zk-purple)" : "var(--zk-surface-raised)",
        color: "var(--zk-text)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: shadow,
        transform: down ? `translateY(${primary ? 4 : 2}px)` : "none",
        opacity: dim ? 0.45 : 1,
        cursor: disabled ? "default" : "pointer",
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
        transition: "transform var(--zk-dur-fast) var(--zk-ease-out), box-shadow var(--zk-dur-fast) var(--zk-ease-out), opacity var(--zk-dur-fast) var(--zk-ease-out)",
      }}
    >
      <Icon icon={icon} size={22} stroke={3} />
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
      <TeamBadge code={t.code} color={t.color} ink={t.ink} size={size} />
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

function CallPrizeCards({ call, empty, stash }: { call: string; empty: string; stash: PublicStash }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "var(--zk-space-10)" }}>
      <div style={S.miniCard}>
        <div style={S.label}>YOUR CALL</div>
        {call ? (
          <div style={{ font: "var(--zk-fw-black) var(--zk-fs-30)/1.1 var(--zk-font-display)", color: "var(--zk-gold)", marginTop: "var(--zk-space-4)", whiteSpace: "nowrap" }}>{call}</div>
        ) : (
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-8)" }}>{empty}</div>
        )}
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
  // "You" first, then the server's order.
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
      <div style={{ marginTop: "var(--zk-space-12)", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
        {shown.length === 0 ? (
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>Nobody’s still in the running.</div>
        ) : (
          shown.map((r, i) => {
            const color = r.isYou ? "var(--zk-gold)" : RUNNER_COLORS[other++ % RUNNER_COLORS.length];
            const initial = r.isYou ? "★" : (r.handle.replace(/^@/, "")[0] || "?").toUpperCase();
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
                  {initial}
                </span>
                <span style={{ flex: 1, minWidth: 0, font: "var(--zk-type-body-strong)", fontWeight: "var(--zk-fw-semibold)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.isYou ? "You" : r.handle}
                </span>
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
        <div style={{ font: "var(--zk-type-h3)", minWidth: 0 }}>{title}</div>
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

/* ---------- the screen ---------- */

export function PredictionStash({ initial, onWin }: PredictionStashProps) {
  const router = useRouter();
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

  /* --- kickoff clock (client only, so SSR and hydration agree) --- */
  const locksAt = pred?.locksAt;
  const [kickedOff, setKickedOff] = useState(false);
  useEffect(() => {
    const at = locksAt ? Date.parse(locksAt) : NaN;
    if (!Number.isFinite(at)) return;
    const ms = at - Date.now();
    if (ms <= 0) {
      setKickedOff(true);
      return;
    }
    setKickedOff(false);
    const t = window.setTimeout(() => setKickedOff(true), Math.min(ms, 2_147_000_000));
    return () => window.clearTimeout(t);
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
      }));
    } catch {
      // keep the last good state; the next poll retries
    } finally {
      inFlight.current = false;
    }
  }, [id]);

  const phase = phaseOf(stash, kickedOff, !!win);
  const fast =
    !!match && (match.status === "scheduled" || match.status === "live" || (match.status === "final" && !RESOLVED.has(stash.status)));

  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, fast ? FAST_POLL_MS : SLOW_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fast, refresh]);

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

  /* --- nav + share --- */
  const back = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push("/feed");
  }, [router]);

  const share = useCallback(async () => {
    const url = window.location.href;
    const text = match
      ? pred?.kind === "winner"
        ? `First to call the ${match.home.code} vs ${match.away.code} winner ZECKS ${formatUsd(stash.usd)} ⚽`
        : `First to call ${match.home.code} vs ${match.away.code} exactly ZECKS ${formatUsd(stash.usd)} ⚽`
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

  const lockCall = useCallback(async () => {
    if (busy || myCall || stash.isMine || !pred) return;
    const body = pred.kind === "exact" ? { home, away } : pick ? { pick } : null;
    if (!body) return;
    setBusy(true);
    mutation.current++;
    try {
      const r = await api.call(id, body);
      mutation.current++;
      setData((prev) => ({
        ...prev,
        myCall: r.myCall,
        stash: prev.stash.prediction ? { ...prev.stash, prediction: { ...prev.stash.prediction, calls: r.calls } } : prev.stash,
      }));
    } catch (e) {
      mutation.current++;
      showToast({ text: e instanceof Error ? e.message : "Couldn’t lock your call. Try again.", variant: "error" });
      void refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, myCall, stash.isMine, pred, home, away, pick, id, showToast, refresh]);

  const onLockDone = useCallback(() => {
    setKickedOff(true);
    void refresh();
  }, [refresh]);

  /* --- render --- */
  const toastEl = toast ? (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: "calc(env(safe-area-inset-bottom, 0px) + var(--zk-space-24))",
        transform: "translateX(-50%)",
        width: "min(394px, calc(100% - 2 * var(--zk-screen-pad)))",
        zIndex: 80,
        pointerEvents: "none",
      }}
    >
      <Toast key={toast.id} text={toast.text} variant={toast.variant} icon={toast.icon} />
    </div>
  ) : null;

  const screen = (bg: string, children: ReactNode) => (
    <main className="zk-screen" style={{ background: bg, gap: "var(--zk-space-12)" }}>
      {children}
      {toastEl}
    </main>
  );

  const title = <span style={S.navLabel}>PREDICTION STASH</span>;
  const findAnother = (variant: "primary" | "ghost" = "primary", pinned = true) => (
    <Button label="Find another stash" variant={variant} size="lg" href="/feed" style={pinned ? { marginTop: "auto" } : undefined} />
  );

  if (!pred || !match) {
    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        <Nav center={title} onBack={back} />
        <StateCard icon="info" tone="var(--zk-sky)" tint="var(--zk-sky-tint)" title="This stash isn’t a match call." />
        {findAnother()}
      </>,
    );
  }

  const callText = formatCall(myCall, match);
  const noCallText = stash.isMine ? "This is your stash." : "You didn’t call this one";

  /* 5 · awaiting funding */
  if (phase === "funding") {
    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        <Nav center={title} onBack={back} />
        <MatchCard match={match} />
        <StateCard icon="hourglass" tone="var(--zk-gold)" tint="var(--zk-gold-tint)" title="This stash isn’t live yet." />
        {stash.isMine ? <Button label="Fund it" variant="primary" size="lg" iconRight="arrowRight" href={`/hide?resume=${encodeURIComponent(id)}`} style={{ marginTop: "auto" }} /> : findAnother()}
      </>,
    );
  }

  /* 4d · postponed / canceled */
  if (phase === "void") {
    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        <Nav center={title} onBack={back} />
        <MatchCard match={match} badge={<LiveBadge state="ended" label={match.status === "postponed" ? "Postponed" : "Called off"} />} />
        <StateCard icon="flag" tone="var(--zk-text-muted)" tint="var(--zk-surface-raised)" title="Match called off.">
          <p style={{ margin: 0, font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>The ZEC went back to the hider.</p>
        </StateCard>
        {myCall ? <CallPrizeCards call={callText} empty={noCallText} stash={stash} /> : null}
        {findAnother()}
      </>,
    );
  }

  /* 4c · nobody called it */
  if (phase === "refunded") {
    const played = match.status === "final";
    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        <Nav center={title} onBack={back} />
        {played ? (
          <ScoreCard match={match} accent="var(--zk-border-strong)" top={<EndedTop match={match} label="Full time" />} />
        ) : (
          <MatchCard match={match} badge={<LiveBadge state="ended" label="Ended" />} />
        )}
        <StateCard icon="unlock" tone="var(--zk-purple-light)" tint="var(--zk-purple-tint)" title="Nobody called it.">
          <p style={{ margin: 0, font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>The ZEC went back to the hider.</p>
        </StateCard>
        {myCall ? <CallPrizeCards call={callText} empty={noCallText} stash={stash} /> : null}
        {findAnother()}
      </>,
    );
  }

  /* 4a / 4b · full time */
  if (phase === "won" || phase === "final") {
    const fs = finalScore(match, stash.result?.finalScore);
    const scoreText = fs ? formatScore(fs.home, fs.away) : stash.result?.finalScore ?? "";
    const headline = `Full time: ${match.home.code} ${scoreText} ${match.away.code}`;
    const resolved = stash.status === "zecked";
    const result = stash.result;
    const youRight = fs ? callMatchesScore(myCall, fs.home, fs.away) : false;
    const correct = result?.correctCalls;

    if (phase === "won" && win) {
      return screen(
        "var(--zk-bg-hero-gold)",
        <>
          <Nav center={title} onBack={back} onShare={share} />
          <ScoreCard match={match} accent="rgb(var(--zk-gold-rgb) / .45)" top={<EndedTop match={match} label="Full time" />} scoreColor="var(--zk-gold)" />
          <StateCard icon="trophy" tone="var(--zk-gold)" tint="var(--zk-gold-tint)" border="rgb(var(--zk-gold-rgb) / .35)" title={headline}>
            <Line icon="medal" color="var(--zk-gold)">Called it first: you</Line>
            {typeof correct === "number" ? <Line icon="target">{correct} correct {correct === 1 ? "call" : "calls"}</Line> : null}
          </StateCard>
          <CallPrizeCards call={callText} empty={noCallText} stash={stash} />
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>
            <Button label="You called it! Claim your ZEC" variant="primary" size="lg" icon="coin" onClick={() => onWinRef.current(win)} />
            {findAnother("ghost", false)}
          </div>
        </>,
      );
    }

    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        <Nav center={title} onBack={back} onShare={share} />
        <ScoreCard match={match} accent="var(--zk-border-strong)" top={<EndedTop match={match} label="Full time" />} scoreColor={youRight ? "var(--zk-mint)" : undefined} />
        <StateCard icon={resolved ? "trophy" : "hourglass"} tone="var(--zk-gold)" tint="var(--zk-gold-tint)" title={headline}>
          {resolved && result ? (
            <>
              <Line icon="medal">Called it first: {result.winnerIsYou ? "you" : result.winnerLabel}</Line>
              {typeof correct === "number" ? <Line icon="target">{correct} correct {correct === 1 ? "call" : "calls"}</Line> : null}
              {youRight && !result.winnerIsYou ? <Line icon="flame" color="var(--zk-pink)">You called it too, just not first 😤</Line> : null}
            </>
          ) : (
            <Line icon="clock">Checking the calls…</Line>
          )}
        </StateCard>
        <CallPrizeCards call={callText} empty={noCallText} stash={stash} />
        {findAnother()}
      </>,
    );
  }

  /* 3 · live (screen 06) */
  if (phase === "live") {
    const minute = prettyMinute(match.minute);
    const spotOn = callMatches(myCall, match);
    const value = closeness(myCall, match);
    return screen(
      "var(--zk-bg-hero-mint)",
      <>
        <Nav center={<LiveBadge variant="solid" size="md" label={minute ? `Live · ${minute}` : "Live"} />} onBack={back} />
        <ScoreCard
          match={match}
          accent="rgb(var(--zk-mint-rgb) / .3)"
          bar
          scoreColor={spotOn ? "var(--zk-mint)" : undefined}
          lastEventNote={spotOn ? "You’re calling it!" : undefined}
        >
          {match.demo ? <DemoChip /> : null}
        </ScoreCard>
        <CallPrizeCards call={callText} empty={noCallText} stash={stash} />
        {myCall ? <TensionMeter value={value} label={tensionLabel(myCall, match)} /> : null}
        {runners ? <Runners runners={runners} total={pred.calls} /> : null}
      </>,
    );
  }

  /* 2 · locked, kickoff any second */
  if (phase === "locked") {
    return screen(
      "var(--zk-bg-hero-sky)",
      <>
        <Nav center={title} onBack={back} onShare={share} />
        <MatchCard
          match={match}
          badge={<LiveBadge label="Live" />}
          footer={
            <>
              <Icon icon="lock" size={16} stroke={2.4} color="var(--zk-gold)" />
              <span style={{ font: "var(--zk-type-small)", fontWeight: "var(--zk-fw-bold)", color: "var(--zk-text-muted)" }}>Calls are locked. Kickoff any second…</span>
            </>
          }
        >
          {match.demo ? <DemoChip /> : null}
        </MatchCard>
        <CallPrizeCards call={callText} empty={noCallText} stash={stash} />
        <SealedNote calls={pred.calls} tail="Revealed at kickoff." />
      </>,
    );
  }

  /* 1 · open (screen 05) */
  const sealed = !!myCall;
  const shownHome = sealed && myCall?.kind === "exact" ? myCall.home ?? 0 : home;
  const shownAway = sealed && myCall?.kind === "exact" ? myCall.away ?? 0 : away;
  const shownPick = sealed && myCall?.kind === "winner" ? myCall.pick ?? null : pick;
  const exact = pred.kind === "exact";

  return screen(
    "var(--zk-bg-hero-sky)",
    <>
      <Nav center={title} onBack={back} onShare={share} />
      <MatchCard
        match={match}
        badge={<LiveBadge label="Live" />}
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
      {stash.isMine ? (
        <div style={{ ...S.card, padding: "var(--zk-space-18)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-14)", textAlign: "center" }}>
          <p style={{ margin: 0, font: "var(--zk-type-body-strong)", color: "var(--zk-text-muted)" }}>This is your stash. You can’t call your own match.</p>
          <Button label="Share your stash" variant="secondary" size="md" icon="share" onClick={share} />
        </div>
      ) : (
        <>
          {exact ? (
            <ScoreSteppers match={match} home={shownHome} away={shownAway} setHome={setHome} setAway={setAway} readOnly={sealed || busy} />
          ) : (
            <WinnerPicks match={match} pick={shownPick} setPick={setPick} readOnly={sealed || busy} />
          )}
          <Button
            label={sealed ? `CALL SEALED ${callText.toUpperCase()}` : busy ? "SEALING…" : "LOCK MY CALL"}
            variant={sealed ? "success" : "primary"}
            size="lg"
            iconRight="lock"
            onClick={sealed ? undefined : () => void lockCall()}
            disabled={!sealed && !exact && !pick}
            ariaLabel={sealed ? `Call sealed: ${callText}` : undefined}
          />
        </>
      )}
      <RuleChips />
      <SealedNote calls={pred.calls} tail="Revealed at kickoff." />
    </>,
  );
}


export default PredictionStash;
