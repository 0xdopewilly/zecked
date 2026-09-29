"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Match, PublicStash, StashStatus, Team } from "@/lib/types";
import { formatUsd, formatZec } from "@/lib/api";
import { Chip } from "@/components/zk/Chip";
import { Countdown } from "@/components/zk/Countdown";
import { Icon } from "@/components/zk/Icon";
import { LiveBadge } from "@/components/zk/LiveBadge";
import { TeamBadge } from "@/components/zk/TeamBadge";

export interface StashCardProps {
  stash: PublicStash;
  /** Wraps the card in a Next.js <Link>. */
  href?: string;
  onClick?: () => void;
}

const ENDED: readonly StashStatus[] = ["zecked", "expired", "refunded", "void"];
const URGENT_MS = 30 * 60 * 1000;
const TEASER_MAX = 70;
const TEAM_NAME_MAX = 10;

/** Ticks every `ms` so time-left text and the progress bar stay current. */
function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function toTeaser(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= TEASER_MAX) return t;
  let cut = t.slice(0, TEASER_MAX);
  const sp = cut.lastIndexOf(" ");
  if (sp > TEASER_MAX * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s.,;:!?…—–-]+$/, "") + "…";
}

/** "5h 12m left", "18m left", "2d 4h left". */
function formatLeft(ms: number): string {
  if (ms <= 0) return "Time’s up";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "<1m left";
  const d = Math.floor(min / 1440),
    h = Math.floor((min % 1440) / 60),
    m = min % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}

/** "42s", "4m 12s", "2h 5m". */
function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const teamLabel = (t: Team) => (t.name.length > TEAM_NAME_MAX ? t.code : t.name);
const scoreOf = (m: Match) =>
  m.homeScore != null && m.awayScore != null ? `${m.homeScore}–${m.awayScore}` : undefined;

const TEAM_NAME_STYLE: CSSProperties = {
  font: "var(--zk-type-small)",
  fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"],
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
};

const CENTER_LABEL_STYLE: CSSProperties = {
  font: "var(--zk-fw-black) var(--zk-fs-10)/1 var(--zk-font-body)",
  letterSpacing: "var(--zk-track-badge)",
  color: "var(--zk-text-muted)",
};

export function StashCard({ stash, href, onClick }: StashCardProps) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  const now = useNow();

  const riddle = stash.type === "riddle";
  const status = stash.status;
  const cracked = ENDED.includes(status);
  const isLive = status === "live" || status === "locked";
  const interactive = !!href || !!onClick;
  const st: "default" | "hover" | "pressed" | "cracked" = cracked
    ? "cracked"
    : press
      ? "pressed"
      : hover
        ? "hover"
        : "default";

  // ---------- Header ----------
  const kind = riddle ? "RIDDLE" : "PREDICTION";
  const kindC = riddle ? "var(--zk-pink)" : "var(--zk-sky)";
  const handle = stash.hider.handle.startsWith("@") ? stash.hider.handle : `@${stash.hider.handle}`;
  const pred = stash.prediction;
  const match = pred?.match;
  const sub = riddle
    ? `by ${handle}`
    : `${pred?.kind === "winner" ? "Winner" : "Exact score"} · ${match?.leagueName ?? ""}`;
  const tileBg = riddle ? "var(--zk-grad-tile-purple)" : "var(--zk-grad-tile-sky)";
  const tileEdge = riddle ? "var(--zk-purple-shade)" : "var(--zk-sky-shade)";
  const tileIcon = riddle ? "lock" : "ball";

  const liveState = isLive ? "live" : "ended";
  const liveLabel = isLive
    ? "Live · verified"
    : status === "zecked"
      ? "Cracked"
      : status === "void"
        ? "Called off"
        : status === "awaiting_funding"
          ? "Not live yet"
          : "Ended";

  // ---------- Riddle time bar ----------
  const startMs = Date.parse(stash.liveAt ?? stash.createdAt);
  const endMs = Date.parse(stash.expiresAt);
  const totalMs = Math.max(1, endMs - startMs);
  let refMs = now;
  if (status === "zecked" && stash.result?.zeckedAt) refMs = Date.parse(stash.result.zeckedAt);
  if (status === "awaiting_funding") refMs = startMs;
  const remainingMs = status === "expired" || status === "refunded" ? 0 : Math.max(0, endMs - refMs);
  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
  const urgent = status === "live" && remainingMs > 0 && remainingMs < URGENT_MS;
  const bar = urgent
    ? "var(--zk-grad-progress-urgent)"
    : pct > 80
      ? "var(--zk-grad-progress-calm)"
      : "var(--zk-grad-progress)";
  const leftC = urgent ? "var(--zk-red)" : "var(--zk-text-muted)";
  const timeLeft =
    status === "zecked"
      ? stash.result?.crackSeconds != null
        ? `Cracked in ${formatDuration(stash.result.crackSeconds)}`
        : "Cracked"
      : status === "void"
        ? "Called off"
        : status === "awaiting_funding"
          ? "Not live yet"
          : formatLeft(remainingMs);

  // ---------- Prize + meta ----------
  const zec = formatZec(stash.amountZat);
  const usd = formatUsd(stash.usd);
  const meta = riddle ? plural(stash.riddle?.tries ?? 0, "try", "tries") : plural(pred?.calls ?? 0, "call", "calls");
  const metaIcon = riddle ? "key" : "orb";

  // ---------- Stamp ----------
  const stamp =
    status === "zecked"
      ? { icon: "unlock" as const, text: "ZECKED" }
      : status === "void"
        ? { icon: "close" as const, text: "CALLED OFF" }
        : { icon: "shield" as const, text: "UNCRACKABLE" };

  // ---------- Card chrome ----------
  const bd = stash.whale
    ? "rgb(var(--zk-pink-rgb) / .55)"
    : st === "hover"
      ? "rgb(var(--zk-purple-rgb) / .5)"
      : "var(--zk-border)";
  const sh =
    st === "hover" ? "var(--zk-shadow-card-hover)" : st === "pressed" || st === "cracked" ? "none" : "var(--zk-shadow-card)";
  const tf = st === "hover" ? "translateY(-2px)" : st === "pressed" ? "translateY(2px) scale(.99)" : "none";

  const handleClick = () => {
    if (onClick && !cracked) onClick();
  };
  const handleKey = (e: KeyboardEvent<HTMLElement>) => {
    if (href || !onClick) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };
  const onEnter = (e: PointerEvent<HTMLElement>) => {
    if (!cracked && e.pointerType === "mouse") setHover(true);
  };
  const onLeave = () => {
    setHover(false);
    setPress(false);
  };
  const onDown = () => {
    if (!cracked && interactive) setPress(true);
  };
  const onUp = () => setPress(false);

  const card = (
    <article
      onClick={handleClick}
      onKeyDown={handleKey}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role={!href && onClick ? "button" : undefined}
      tabIndex={!href && onClick ? 0 : undefined}
      style={{
        flex: "none",
        position: "relative",
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-2xl)",
        padding: "var(--zk-space-16)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-14)",
        border: `1.5px solid ${bd}`,
        boxShadow: sh,
        transform: tf,
        cursor: interactive ? "pointer" : "default",
        transition: "transform var(--zk-dur-fast) var(--zk-ease-out),box-shadow var(--zk-dur-fast) var(--zk-ease-out)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {stash.whale && (
        <div
          style={{
            position: "absolute",
            right: "var(--zk-space-14)",
            top: -12,
            transform: "rotate(5deg)",
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-4)",
            padding: "var(--zk-space-4) var(--zk-space-10)",
            borderRadius: "var(--zk-radius-md)",
            background: "var(--zk-pink)",
            color: "var(--zk-text)",
            font: "var(--zk-type-btn-sm)",
            fontSize: "var(--zk-fs-12)",
            boxShadow: "var(--zk-shadow-sticker-pink)",
            zIndex: 2,
          }}
        >
          <Icon icon="whale" size={14} stroke={2.4} />
          WHALE STASH
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)", opacity: cracked ? 0.45 : 1 }}>
        {/* Header: tile, kind + sub, live badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)" }}>
          <div
            style={{
              width: "var(--zk-tile-md)",
              height: "var(--zk-tile-md)",
              borderRadius: "var(--zk-radius-md)",
              background: tileBg,
              boxShadow: `var(--zk-inset-gloss),0 3px 0 ${tileEdge}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--zk-text)",
              flex: "none",
            }}
          >
            <Icon icon={tileIcon} size={22} stroke={2.4} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: kindC }}>{kind}</div>
            <div
              style={{
                font: "var(--zk-type-small)",
                fontWeight: "var(--zk-fw-medium)" as CSSProperties["fontWeight"],
                color: "var(--zk-text-muted)",
                marginTop: "var(--zk-space-4)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {sub}
            </div>
          </div>
          <LiveBadge state={liveState} label={liveLabel} />
        </div>

        {/* Riddle teaser */}
        {riddle && (
          <div style={{ font: "var(--zk-type-h3)", textWrap: "pretty" } as CSSProperties}>
            “{toTeaser(stash.riddle?.text ?? "")}”
          </div>
        )}

        {/* Prediction match strip */}
        {!riddle && match && (
          <div
            style={{
              background: "var(--zk-surface-raised)",
              borderRadius: "var(--zk-radius-xl)",
              padding: "var(--zk-space-12) var(--zk-space-14)",
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-8)", minWidth: 0 }}>
              <TeamBadge code={match.home.code} color={match.home.color} ink={match.home.ink} logo={match.home.logo} name={match.home.name} size={40} />
              <span style={TEAM_NAME_STYLE} title={match.home.name}>
                {teamLabel(match.home)}
              </span>
            </div>
            <div
              style={{
                textAlign: "center",
                padding: "0 var(--zk-space-6)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--zk-space-2)",
              }}
            >
              <MatchCenter match={match} finalScore={stash.result?.finalScore} now={now} />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--zk-space-8)",
                justifyContent: "flex-end",
                minWidth: 0,
              }}
            >
              <span style={TEAM_NAME_STYLE} title={match.away.name}>
                {teamLabel(match.away)}
              </span>
              <TeamBadge code={match.away.code} color={match.away.color} ink={match.away.ink} logo={match.away.logo} name={match.away.name} size={40} />
            </div>
          </div>
        )}

        {/* Prize + meta chip */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ font: "var(--zk-type-mono-lg)", color: "var(--zk-gold)" }}>{zec} ZEC</div>
            <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)" }}>
              ~{usd}
            </div>
          </div>
          <Chip variant="info" icon={metaIcon} label={meta} />
        </div>

        {/* Riddle time-left bar */}
        {riddle && (
          <div>
            <div
              style={{
                height: 8,
                borderRadius: "var(--zk-radius-xs)",
                background: "var(--zk-surface-raised)",
                overflow: "hidden",
              }}
            >
              <div
                suppressHydrationWarning
                style={{ height: "100%", width: `${pct}%`, background: bar, borderRadius: "var(--zk-radius-xs)" }}
              />
            </div>
            <div
              style={{
                marginTop: "var(--zk-space-8)",
                display: "flex",
                alignItems: "center",
                gap: "var(--zk-space-4)",
                font: "var(--zk-type-mono-xs)",
                color: leftC,
              }}
            >
              <Icon icon="hourglass" size={12} stroke={2.4} />
              <span suppressHydrationWarning>{timeLeft}</span>
            </div>
          </div>
        )}
      </div>

      {cracked && (
        <div
          style={{
            position: "absolute",
            right: "var(--zk-space-18)",
            top: "50%",
            marginTop: -26,
            transform: "rotate(-8deg)",
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-8)",
            padding: "var(--zk-space-8) var(--zk-space-14)",
            borderRadius: "var(--zk-radius-md)",
            border: "3px solid var(--zk-pink)",
            background: "rgb(var(--zk-bg-rgb) / .85)",
            color: "var(--zk-pink)",
            font: "var(--zk-type-btn-md)",
          }}
        >
          <Icon icon={stamp.icon} size={20} stroke={2.6} />
          {stamp.text}
        </div>
      )}
    </article>
  );

  if (!href) return card;
  return (
    <Link
      href={href}
      style={{
        display: "block",
        flex: "none",
        color: "var(--zk-text)",
        textDecoration: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {card}
    </Link>
  );
}

/** Centre column of the match strip: kickoff countdown, live minute + score, or the result. */
function MatchCenter({ match, finalScore, now }: { match: Match; finalScore?: string; now: number }) {
  const score = finalScore ?? scoreOf(match);

  if (match.status === "live") {
    return (
      <>
        <LiveBadge variant="solid" label={match.minute ? `Live ${match.minute}` : "Live"} />
        {score && <Countdown text={score} live={false} size="md" />}
      </>
    );
  }
  if (match.status === "final") {
    return (
      <>
        <span style={CENTER_LABEL_STYLE}>FULL TIME</span>
        <Countdown text={score ?? "FT"} live={false} size="md" />
      </>
    );
  }
  if (match.status === "postponed" || match.status === "canceled") {
    return (
      <>
        <span style={CENTER_LABEL_STYLE}>{match.status === "postponed" ? "POSTPONED" : "CANCELED"}</span>
        <Countdown text={match.status === "postponed" ? "TBC" : "OFF"} live={false} size="md" tone="muted" />
      </>
    );
  }
  // Under a day: ticking HH:MM:SS (turns urgent under 30 min). Further out: "2d 4h".
  const secondsToKickoff = Math.floor((Date.parse(match.kickoff) - now) / 1000);
  const farText =
    secondsToKickoff >= 86_400
      ? `${Math.floor(secondsToKickoff / 86_400)}d ${Math.floor((secondsToKickoff % 86_400) / 3600)}h`
      : undefined;
  return (
    <>
      <span style={CENTER_LABEL_STYLE}>KICKOFF IN</span>
      <Countdown to={match.kickoff} format="hms" text={farText} tone="auto" size="md" />
    </>
  );
}
