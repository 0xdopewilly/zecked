"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import type { Match, PublicStash, StashStatus, Team } from "@/lib/types";
import { formatUsd, formatZec } from "@/lib/api";
import { prefetchStash } from "@/lib/stashCache";
import { Chip } from "@/components/zk/Chip";
import { Countdown } from "@/components/zk/Countdown";
import { Icon } from "@/components/zk/Icon";
import { LiveBadge } from "@/components/zk/LiveBadge";
import { ReactionSummary } from "@/components/zk/Reactions";
import { TeamBadge } from "@/components/zk/TeamBadge";

export interface StashCardProps {
  stash: PublicStash;
  /** Wraps the card in a Next.js <Link>. */
  href?: string;
  onClick?: () => void;
  /** Mark the viewer's own stashes with a "YOURS" sticker (the feed; pointless on your own profile). */
  markMine?: boolean;
  /** "by @handle" opens the hider's profile (default). Off on that profile itself. */
  linkHider?: boolean;
}

const ENDED: readonly StashStatus[] = ["zecked", "expired", "refunded", "void"];

// On the narrowest cards (320px phones) the status pill uses its short label so "PREDICTION" still fits
// beside it. A container query, so it follows the card's width wherever the card is used.
const CARD_CSS =
  ".zk-sc{container-type:inline-size}.zk-sc-short{display:none}" +
  ".zk-sc-who:hover .zk-sc-who-name{text-decoration:underline;text-underline-offset:2px}" +
  "@container (max-width:279px){.zk-sc-short{display:contents}.zk-sc-long{display:none}}";
const URGENT_MS = 30 * 60 * 1000;
const TEASER_MAX = 70;

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

function reducedMotion(): boolean {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** A number that glides to its new value (tries, calls, cracking now) instead of jumping. The unit follows
 *  the number on screen ("1 try" → "2 tries"), not the target. */
function Num({ value, unit }: { value: number; unit?: [one: string, many: string] }) {
  const [shown, setShown] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    const from = cur.current;
    if (from === value) return;
    if (reducedMotion()) {
      cur.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    const dur = Math.min(900, 350 + Math.abs(value - from) * 60);
    let raf = requestAnimationFrame(function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const v = Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      cur.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{shown.toLocaleString("en-US")}</span>
      {unit ? ` ${shown === 1 ? unit[0] : unit[1]}` : null}
    </span>
  );
}

/** Gives its child a little bump whenever `value` goes up. */
function Bump({ value, children }: { value: number; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const up = value > prev.current;
    prev.current = value;
    if (!up || !ref.current?.animate || reducedMotion()) return;
    ref.current.animate([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], {
      duration: 380,
      easing: "cubic-bezier(.3,1.6,.5,1)",
    });
  }, [value]);
  return (
    <span ref={ref} style={{ display: "inline-flex", flex: "none" }}>
      {children}
    </span>
  );
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
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const scoreOf = (m: Match) =>
  m.homeScore != null && m.awayScore != null ? `${m.homeScore}–${m.awayScore}` : undefined;

/** Crest over the full team name (up to two lines, a size smaller for long names): never a code twice. */
function TeamSide({ team }: { team: Team }) {
  const n = team.name.trim() || team.code;
  const fs = n.length > 16 ? "var(--zk-fs-11)" : n.length > 11 ? "var(--zk-fs-12)" : "var(--zk-fs-13)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-6)", minWidth: 0 }}>
      <TeamBadge code={team.code} color={team.color} ink={team.ink} logo={team.logo} name={team.name} size={38} />
      <span
        lang="en"
        title={n}
        style={
          {
            font: `var(--zk-fw-bold) ${fs}/1.2 var(--zk-font-body)`,
            textAlign: "center",
            maxWidth: "100%",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            overflowWrap: "break-word",
            hyphens: "auto",
            textWrap: "balance",
          } as CSSProperties
        }
      >
        {n}
      </span>
    </div>
  );
}

const CENTER_LABEL_STYLE: CSSProperties = {
  font: "var(--zk-fw-black) var(--zk-fs-10)/1 var(--zk-font-body)",
  letterSpacing: "var(--zk-track-badge)",
  color: "var(--zk-text-muted)",
};

export function StashCard({ stash, href, onClick, markMine = false, linkHider = true }: StashCardProps) {
  const router = useRouter();
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);
  const now = useNow();
  const warmT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(warmT.current), []);

  const riddle = stash.type === "riddle";
  const status = stash.status;
  const cracked = ENDED.includes(status);
  const mine = stash.isMine;
  // Your own stash that still needs its ZEC: the whole card leads back to the funding step.
  const needsFunding = mine && status === "awaiting_funding";
  const link = href ? (needsFunding ? `/hide?resume=${encodeURIComponent(stash.id)}` : href) : undefined;
  const interactive = !!link || !!onClick;
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
  // The hider's handle opens their profile. The card itself is a link, so the handle is a span that
  // navigates on its own (a link inside a link isn't valid HTML) and keeps the card from reacting.
  const hiderHref = `/u/${encodeURIComponent(handle.replace(/^@+/, ""))}`;
  // Also cancels the card's stash prefetch (opening a stash counts you as "cracking now"), and keeps the
  // card link from taking focus (focusing it prefetches too).
  const keepToSelf = (e: SyntheticEvent) => {
    e.stopPropagation();
    if (e.type === "pointerdown" || e.type === "mousedown") e.preventDefault();
    cool();
  };
  const openHider = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    cool();
    router.push(hiderHref, { transitionTypes: ["nav-forward"] });
  };
  const sub: ReactNode = riddle ? (
    mine || !linkHider ? (
      `by ${mine ? "you" : handle}`
    ) : (
      <>
        <span style={{ flex: "none" }}>by&nbsp;</span>
        <span
          className="zk-sc-who"
          data-sfx="tap"
          onClick={openHider}
          onPointerDown={keepToSelf}
          onPointerUp={keepToSelf}
          onMouseDown={keepToSelf}
          style={{ position: "relative", display: "inline-flex", minWidth: 0, color: "var(--zk-text)", fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"], cursor: "pointer" }}
        >
          <span className="zk-sc-who-name" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {handle}
          </span>
          {/* A 44px-tall tap area around the small handle. */}
          <span aria-hidden="true" style={{ position: "absolute", inset: "-14px -6px" }} />
        </span>
      </>
    )
  ) : (
    `${pred?.kind === "winner" ? "Winner" : "Exact score"} · ${match?.leagueName ?? ""}`
  );
  const hasReactions = !!stash.reactions && Object.values(stash.reactions).some((n) => (n ?? 0) > 0);
  const tileBg = riddle ? "var(--zk-grad-tile-purple)" : "var(--zk-grad-tile-sky)";
  const tileEdge = riddle ? "var(--zk-purple-shade)" : "var(--zk-sky-shade)";
  const tileIcon = riddle ? "lock" : "ball";

  // Status pill. Ended stashes get the stamp instead (ZECKED, UNCRACKABLE…), never a "Cracked" pill.
  // Predictions: "Calls open" until kickoff, then "Calls locked" until it's settled; the LIVE badge (with
  // the minute) shows in the match strip only while the match is actually in play.
  const callsOpen = status === "live" && match?.status === "scheduled" && Date.parse(match.kickoff) > now;
  let badge: { state: "live" | "ended"; label: string; short: string } | null = null;
  if (status === "awaiting_funding") badge = { state: "ended", label: "Not live yet", short: "Not live" };
  else if (!cracked && riddle) badge = { state: "live", label: "Live · verified", short: "Live" };
  else if (!cracked)
    badge = callsOpen
      ? { state: "live", label: "Calls open", short: "Open" }
      : { state: "ended", label: "Calls locked", short: "Locked" };

  // ---------- Riddle time bar ----------
  const startMs = Date.parse(stash.liveAt ?? stash.createdAt);
  const endMs = Date.parse(stash.expiresAt);
  const totalMs = Math.max(1, endMs - startMs);
  let refMs = now;
  if (status === "zecked" && stash.result?.zeckedAt) refMs = Date.parse(stash.result.zeckedAt);
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
        : formatLeft(remainingMs);
  const crackingNow = status === "live" ? (stash.riddle?.crackingNow ?? 0) : 0;

  // ---------- Prize + meta ----------
  const zec = formatZec(stash.amountZat);
  const usd = formatUsd(stash.usd);
  const metaN = riddle ? (stash.riddle?.tries ?? 0) : (pred?.calls ?? 0);
  const metaUnit: [string, string] = riddle ? ["try", "tries"] : ["call", "calls"];
  const metaIcon = riddle ? "key" : "orb";

  // ---------- Stamp ----------
  const stamp =
    status === "zecked"
      ? { icon: "unlock" as const, text: "ZECKED" }
      : status === "void"
        ? { icon: "close" as const, text: "CALLED OFF" }
        : { icon: "shield" as const, text: riddle ? "UNCRACKABLE" : "NO WINNER" };

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
    if (link || !onClick) return;
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

  // Instant opening: start loading the stash as the finger lands (the stash screen picks the request up).
  // A touch that turns into a scroll gets a pointercancel within a few frames, so wait that long first:
  // opening a stash counts you as "cracking now", and scrolling past shouldn't.
  const prefetchable = !!link && link.startsWith("/s/");
  const warm = () => {
    clearTimeout(warmT.current);
    if (prefetchable) prefetchStash(stash.id);
  };
  const warmSoon = (ms: number) => {
    clearTimeout(warmT.current);
    if (prefetchable) warmT.current = setTimeout(warm, ms);
  };
  const cool = () => clearTimeout(warmT.current);

  const card = (
    <article
      className="zk-sc"
      onClick={handleClick}
      onKeyDown={handleKey}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role={!link && onClick ? "button" : undefined}
      tabIndex={!link && onClick ? 0 : undefined}
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
      <style href="zk-stash-card" precedence="zk-components">
        {CARD_CSS}
      </style>
      {/* Your own stash: a gold sticker on the top edge (left, so it never meets WHALE STASH on the right). */}
      {mine && markMine && (
        <div
          style={{
            position: "absolute",
            left: "var(--zk-space-14)",
            top: -11,
            transform: "rotate(-4deg)",
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-4)",
            padding: "var(--zk-space-4) var(--zk-space-10)",
            borderRadius: "var(--zk-radius-md)",
            background: "var(--zk-gold)",
            color: "var(--zk-gold-ink)",
            font: "var(--zk-type-btn-sm)",
            fontSize: "var(--zk-fs-12)",
            boxShadow: "0 4px 0 var(--zk-gold-deep)",
            zIndex: 2,
            pointerEvents: "none",
          }}
        >
          <Icon icon="user" size={13} stroke={2.6} />
          YOURS
        </div>
      )}
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
        {/* Header: tile, kind + sub, status pill */}
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
                ...(typeof sub === "string"
                  ? { overflow: "hidden", textOverflow: "ellipsis" }
                  : // The handle truncates itself, so its tap area isn't clipped here.
                    { display: "flex", minWidth: 0 }),
              }}
            >
              {sub}
            </div>
          </div>
          {/* Room for the stamp, so a long handle stops short of it instead of running under it. */}
          {cracked && <span aria-hidden="true" style={{ flex: "none", width: stamp.text.length > 7 ? 124 : 100 }} />}
          {badge && (
            <>
              <span className="zk-sc-long" style={{ flex: "none" }}>
                <LiveBadge state={badge.state} label={badge.label} />
              </span>
              <span className="zk-sc-short" style={{ flex: "none" }}>
                <LiveBadge state={badge.state} label={badge.short} />
              </span>
            </>
          )}
        </div>

        {/* Riddle teaser */}
        {riddle && (
          <div style={{ font: "var(--zk-type-h3)", textWrap: "pretty" } as CSSProperties}>
            “{toTeaser(stash.riddle?.text ?? "")}”
          </div>
        )}

        {/* Prediction match strip: crest over the full name on each side, kickoff / live / result in the middle */}
        {!riddle && match && (
          <div
            style={{
              background: "var(--zk-surface-raised)",
              borderRadius: "var(--zk-radius-xl)",
              padding: "var(--zk-space-12) var(--zk-space-10)",
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)",
              // Crests line up even when one name takes two lines; the centre sits level with them.
              alignItems: "start",
              columnGap: "var(--zk-space-4)",
            }}
          >
            <TeamSide team={match.home} />
            <div
              style={{
                textAlign: "center",
                minHeight: 38,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--zk-space-2)",
              }}
            >
              <MatchCenter match={match} finalScore={stash.result?.finalScore} now={now} />
            </div>
            <TeamSide team={match.away} />
          </div>
        )}

        {/* Prize + meta chip */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "var(--zk-space-8)" }}>
          <div style={{ flex: "none" }}>
            <div style={{ font: "var(--zk-type-mono-lg)", color: "var(--zk-gold)", whiteSpace: "nowrap" }}>{zec} ZEC</div>
            <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)" }}>
              ~{usd}
            </div>
          </div>
          <div style={{ flex: "1 1 auto", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--zk-space-10)", minWidth: 0 }}>
            {/* The top reactions, as many as fit beside the prize (none if even one doesn't): never pushes it. */}
            {hasReactions && (
              <ReactionSummary counts={stash.reactions} fit style={{ flex: "0 1 auto" }} />
            )}
            {/* "0 tries" says nothing: the count shows up once someone has a go. */}
            {!needsFunding && metaN > 0 && (
              <Bump value={metaN}>
                <Chip
                  variant="info"
                  icon={metaIcon}
                  label={<Num value={metaN} unit={metaUnit} />}
                />
              </Bump>
            )}
          </div>
        </div>

        {/* Your unfunded stash: one clear next step */}
        {needsFunding && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--zk-space-10)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", font: "var(--zk-type-small)", color: "var(--zk-text-muted)", minWidth: 0 }}>
              <Icon icon="hourglass" size={14} stroke={2.4} />
              <span>Add the ZEC to go live</span>
            </div>
            <span
              style={{
                flex: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--zk-space-6)",
                height: "var(--zk-h-btn-sm)",
                padding: "0 var(--zk-space-16)",
                borderRadius: "var(--zk-radius-lg)",
                background: "var(--zk-grad-gold)",
                color: "var(--zk-gold-ink)",
                font: "var(--zk-type-btn-sm)",
                boxShadow: st === "pressed" ? "var(--zk-shadow-btn-gold-pressed)" : "0 4px 0 var(--zk-gold-deep)",
              }}
            >
              <Icon icon="coin" size={16} stroke={2.4} />
              Fund it
            </span>
          </div>
        )}

        {/* Riddle time-left bar */}
        {riddle && !needsFunding && status !== "awaiting_funding" && (
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
              {crackingNow > 0 && (
                <span
                  style={{
                    marginLeft: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--zk-space-6)",
                    font: "var(--zk-type-caption)",
                    color: "var(--zk-pink)",
                  }}
                >
                  <span aria-hidden="true" style={{ position: "relative", width: 7, height: 7, flex: "none" }}>
                    <span
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        background: "var(--zk-pink)",
                        opacity: 0.7,
                        animation: "zk-ping var(--zk-dur-pulse) ease-out infinite",
                      }}
                    />
                    <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--zk-pink)" }} />
                  </span>
                  <span>
                    <Num value={crackingNow} /> cracking now
                  </span>
                </span>
              )}
            </div>
          </div>
        )}
        {riddle && status === "awaiting_funding" && !needsFunding && (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-4)", font: "var(--zk-type-mono-xs)", color: "var(--zk-text-muted)" }}>
            <Icon icon="hourglass" size={12} stroke={2.4} />
            <span>Not live yet</span>
          </div>
        )}
      </div>

      {/* Ended: the stamp sits where the status pill was, clear of the crests and the score. */}
      {cracked && (
        <div
          style={{
            position: "absolute",
            right: "var(--zk-space-12)",
            top: "var(--zk-space-18)",
            transform: "rotate(-7deg)",
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-6)",
            padding: "var(--zk-space-6) var(--zk-space-10)",
            borderRadius: "var(--zk-radius-md)",
            border: "3px solid var(--zk-pink)",
            background: "rgb(var(--zk-bg-rgb) / .9)",
            color: "var(--zk-pink)",
            font: `var(--zk-fw-black) ${stamp.text.length > 7 ? "var(--zk-fs-13)" : "var(--zk-fs-15)"}/1 var(--zk-font-display)`,
            letterSpacing: ".02em",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          <Icon icon={stamp.icon} size={16} stroke={2.6} />
          {stamp.text}
        </div>
      )}
    </article>
  );

  if (!link) return card;
  return (
    <Link
      href={link}
      transitionTypes={["nav-forward"]}
      // Full prefetch while the card is on screen: the stash route (dynamic, per-stash metadata) is ready
      // before the tap, so opening one doesn't wait on a server round trip.
      prefetch
      onPointerDown={(e) => (e.pointerType === "mouse" ? warm() : warmSoon(70))}
      onPointerUp={warm}
      onPointerCancel={cool}
      onMouseEnter={() => warmSoon(120)}
      onMouseLeave={cool}
      onFocus={warm}
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
  // Under a day: ticking HH:MM:SS (turns urgent under 30 min). Further out: "2d 4h". Past kickoff while the
  // score feed catches up: "Kicking off".
  const secondsToKickoff = Math.floor((Date.parse(match.kickoff) - now) / 1000);
  if (secondsToKickoff <= 0) {
    return (
      <>
        <span style={CENTER_LABEL_STYLE}>KICKING OFF</span>
        <Countdown text="0–0" live={false} size="md" tone="muted" />
      </>
    );
  }
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
