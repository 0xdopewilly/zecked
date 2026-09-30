"use client";
// Screen 02 · Home feed. Header (wordmark, streak, wallet balance), live ticker, filter chips,
// stash list, floating "Hide a stash" button and the tab bar.
//  - Feels live: polls every 8s while visible; new stashes slide in at the top, or wait behind a
//    "↑ 2 new stashes" pill while you're scrolled down. Touch: pull down to refresh.
//  - Coming back is instant: the last feed, player, ticker, filter and scroll position live in memory
//    for the whole visit (the filter also survives a reload), then refresh in the background.
//  - The header slides away while you scroll down (the chips stay) and comes back on scroll up.
//  - New here (no practice riddle solved yet)? A dismissible "Try a free practice riddle" card sits at
//    the top of the list, or inside the empty state.
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { api, formatZec, type FeedFilter } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { warmStash } from "@/lib/stashCache";
import type { Player, PublicStash, TickerItem } from "@/lib/types";
import { Button, Chip, Countdown, Icon, Logo, StashCard, TabBar, Vault } from "@/components/zk";

const CHIPS: { label: string; filter: FeedFilter }[] = [
  { label: "All", filter: "all" },
  { label: "Riddles", filter: "riddles" },
  { label: "Predictions", filter: "predictions" },
  { label: "Ending soon", filter: "ending" },
  { label: "Biggest", filter: "biggest" },
];

const FEED_MS = 8_000;
const TICKER_MS = 15_000;
const ME_MS = 30_000;
const FILTER_KEY = "zk:feed-filter";
const LIST_GAP = 14; // px, = --zk-space-14 between cards
const PRACTICE_DONE = "zk:practice-done"; // set by the practice screen when you solve one
const PRACTICE_DISMISSED = "zk:practice-dismissed";
const PRACTICE_EVENT = "zk:practice";

type TickerState = { items: TickerItem[]; now: number; loaded: boolean };
/** The house's free drops, sent along with the feed: when the next one lands (null = none scheduled). */
type HouseStatus = { nextDropAt: string | null; liveId: string | null };
type FeedError = "offline" | "server";
type LoadWhy = "enter" | "poll" | "pull";

/* ---------- memory: returning to the feed is instant ---------- */

// Module scope lives for the whole visit. Only written from effects and handlers (never during render),
// so the server-side copy stays empty and the first hydration always matches the server HTML.
const mem: {
  visited: boolean;
  filter: FeedFilter;
  lists: Partial<Record<FeedFilter, PublicStash[]>>;
  player: Player | null;
  ticker: TickerState;
  house: HouseStatus | null;
  scrollY: number;
} = { visited: false, filter: "all", lists: {}, player: null, ticker: { items: [], now: 0, loaded: false }, house: null, scrollY: 0 };

// Back/forward (the ← button, the browser, an edge swipe) restores the scroll position; a fresh visit
// (tab bar, links) starts at the top like any other screen.
let poppedAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    poppedAt = Date.now();
  });
}

/* ---------- practice riddle card ---------- */

// Read from localStorage as an external store: the server (and hydration) always says "no card", the
// client re-renders with the real answer straight after, and a later client visit knows it on the first
// render (so a restored scroll position lands in the right place).
function practiceWanted(): boolean {
  try {
    return !localStorage.getItem(PRACTICE_DONE) && !localStorage.getItem(PRACTICE_DISMISSED);
  } catch {
    return false;
  }
}
function subscribePractice(onChange: () => void) {
  window.addEventListener(PRACTICE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PRACTICE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
const noPractice = () => false;
function dismissPractice() {
  try {
    localStorage.setItem(PRACTICE_DISMISSED, new Date().toISOString());
  } catch {}
  window.dispatchEvent(new Event(PRACTICE_EVENT));
}

function reducedMotion(): boolean {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** No status = the request never reached us (offline, DNS, CORS…). */
function errorKind(e: unknown): FeedError {
  return (e as { status?: number } | null)?.status ? "server" : "offline";
}

const ERROR_COPY: Record<FeedError, { title: string; body: string }> = {
  offline: { title: "Can’t reach ZECKED.", body: "Check your connection and try again." },
  server: { title: "ZECKED is taking a breather.", body: "Give it a few seconds and try again." },
};

// Tap targets: the visual chip stays compact, an invisible slop grows the hit area to 44px.
const HIT_SLOP_36: CSSProperties = { position: "absolute", inset: "-4px -2px" };
const HIT_SLOP_38: CSSProperties = { position: "absolute", inset: "-4px -2px" }; // inside a 1px border

/* ---------- ticker helpers ---------- */

// The design bolds one phrase per line in gold ("just ZECKED 0.02 ZEC", "called BAR 2–1", "hid 0.5 ZEC").
const BOLD_PATTERNS = [
  /ZECKED/,
  /\b[A-Z]{2,4} \d+\s?[–-]\s?\d+\b/,
  /\b[A-Z]{2,4} win\b/,
  /\bdraw\b/i,
  /\d[\d.,]*\s?ZEC\b/,
  /\buncrackable\b/i,
];

function splitBold(text: string): [string, string, string] {
  for (const re of BOLD_PATTERNS) {
    const m = re.exec(text);
    if (m) return [text.slice(0, m.index), m[0], text.slice(m.index + m[0].length)];
  }
  return [text, "", ""];
}

function tickerLook(t: TickerItem): { icon: string; color: string } {
  if (/uncrackable/i.test(t.text)) return { icon: "shield", color: "var(--zk-purple-light)" };
  if (t.kind === "zecked") return { icon: "unlock", color: "var(--zk-mint)" };
  if (t.kind === "called") return { icon: "ball", color: "var(--zk-sky)" };
  return { icon: "lock", color: "var(--zk-pink)" };
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// The strip always takes its 36px (+12px margin), loaded or not, so nothing below it moves.
const TICKER_STRIP: CSSProperties = {
  marginTop: "var(--zk-space-12)",
  height: 36,
  flex: "none",
  overflow: "hidden",
  background: "rgb(var(--zk-mint-rgb) / .07)",
  borderTop: "1px solid rgb(var(--zk-mint-rgb) / .18)",
  borderBottom: "1px solid rgb(var(--zk-mint-rgb) / .18)",
  display: "flex",
  alignItems: "center",
  paddingLeft: "var(--zk-space-16)",
};

function Ticker({ items, now }: { items: TickerItem[]; now: number }) {
  const [paused, setPaused] = useState(false);
  // Each half must be at least as wide as the column for the −50% loop to be seamless.
  let half = items;
  while (half.length < 4) half = half.concat(items);
  const pause = () => setPaused(true);
  const resume = () => setPaused(false);

  const renderHalf = (hidden: boolean) => (
    <span aria-hidden={hidden || undefined} style={{ display: "flex" }}>
      {half.map((t, i) => {
        const [before, bold, after] = splitBold(t.text);
        const look = tickerLook(t);
        return (
          <span
            key={`${t.id}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--zk-space-6)",
              marginRight: "var(--zk-space-28)",
            }}
          >
            <span style={{ color: look.color, display: "flex" }}>
              <Icon icon={look.icon} size={14} stroke={2.4} />
            </span>
            <span>
              {before}
              {bold && <b style={{ color: "var(--zk-gold)" }}>{bold}</b>}
              {after} · <span style={{ color: "var(--zk-text-muted)" }}>{ago(t.at, now)}</span>
            </span>
          </span>
        );
      })}
    </span>
  );

  return (
    <div
      aria-label="Live activity"
      role="marquee"
      onTouchStart={pause}
      onTouchEnd={resume}
      onTouchCancel={resume}
      onMouseEnter={pause}
      onMouseLeave={resume}
      style={TICKER_STRIP}
    >
      <div
        style={{
          display: "flex",
          whiteSpace: "nowrap",
          width: "max-content",
          animation: "zk-marquee var(--zk-dur-ticker) linear infinite",
          animationDuration: `calc(var(--zk-dur-ticker) * ${half.length / 4})`,
          animationPlayState: paused ? "paused" : "running",
          font: "var(--zk-type-small)",
        }}
      >
        {renderHalf(false)}
        {renderHalf(true)}
      </div>
    </div>
  );
}

function TickerSlot({ ticker }: { ticker: TickerState }) {
  if (ticker.items.length > 0) return <Ticker items={ticker.items} now={ticker.now} />;
  if (!ticker.loaded) {
    return (
      <div aria-hidden="true" style={TICKER_STRIP}>
        <div style={{ width: 180, height: 10, borderRadius: "var(--zk-radius-sm)", background: "rgb(var(--zk-mint-rgb) / .12)" }} />
      </div>
    );
  }
  return (
    <div style={{ ...TICKER_STRIP, gap: "var(--zk-space-6)", font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
      <span style={{ color: "var(--zk-mint)", display: "flex" }}>
        <Icon icon="sparkle" size={14} stroke={2.4} />
      </span>
      <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", paddingRight: "var(--zk-space-16)" }}>
        All quiet. New stashes land here live.
      </span>
    </div>
  );
}

/* ---------- header ---------- */

const headerChip: CSSProperties = {
  position: "relative",
  height: 36,
  borderRadius: "var(--zk-radius-pill)",
  background: "var(--zk-surface)",
  display: "flex",
  alignItems: "center",
  gap: "var(--zk-space-6)",
};

/** Wallet balance for the header chip: "0.05", "0.0503", "12.3", "1.2k" (rounded down, never up). */
function compactZec(zat: number): string {
  const zec = Math.max(0, zat) / 100_000_000;
  if (zec >= 1000) return `${Math.floor(zec / 100) / 10}k`;
  if (zec >= 100) return String(Math.floor(zec));
  if (zec >= 10) return (Math.floor(zec * 10) / 10).toFixed(1);
  return formatZec(Math.floor(Math.max(0, zat) / 10_000) * 10_000, 4);
}

function Header({ player, collapsed }: { player: Player | null; collapsed: boolean }) {
  const streak = player?.stats.streak ?? 0;
  const [tip, setTip] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  // The streak explainer closes on any outside tap, Escape, after a few seconds, or when the header hides.
  useEffect(() => {
    if (!tip) return;
    const outside = (e: PointerEvent) => {
      if (!groupRef.current?.contains(e.target as Node)) setTip(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTip(false);
    };
    const t = setTimeout(() => setTip(false), 6000);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [tip]);
  const tipOpen = tip && !collapsed;

  const coin = (
    <span
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "var(--zk-grad-tile-gold)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--zk-gold-ink)",
      }}
    >
      <Logo variant="mark" size={14} stroke="var(--zk-gold-ink)" />
    </span>
  );
  const balanceStyle: CSSProperties = {
    ...headerChip,
    padding: "0 var(--zk-space-12) 0 var(--zk-space-4)",
    font: "var(--zk-type-mono-sm)",
    color: "var(--zk-gold)",
    textDecoration: "none",
  };
  // Signed in: your ZECKED wallet balance → /wallet. Guests: "Sign up" (they have no wallet yet).
  const signedIn = player?.account?.signedIn;
  const balanceZat = player?.balanceZat ?? 0;

  return (
    <div style={{ padding: "0 var(--zk-screen-pad)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Logo variant="wordmark" size={28} />
      <div ref={groupRef} style={{ position: "relative", display: "flex", gap: "var(--zk-space-8)", alignItems: "center" }}>
        {/* A 0 streak says nothing: the chip shows up once you've played. */}
        {streak > 0 && (
          <button
            type="button"
            aria-expanded={tipOpen}
            aria-controls="zk-streak-tip"
            aria-label={`${streak} day streak. What’s this?`}
            onClick={() => setTip((v) => !v)}
            style={{
              ...headerChip,
              padding: "0 var(--zk-space-12)",
              font: "var(--zk-type-btn-sm)",
              color: "var(--zk-text)",
              border: 0,
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            <Icon icon="flame" size={16} filled stroke={1.5} color="var(--zk-pink)" />
            {streak}
            <span aria-hidden="true" style={HIT_SLOP_36} />
          </button>
        )}
        {!player ? (
          <div aria-busy="true" aria-label="Loading your ZEC" style={balanceStyle}>
            {coin}
            <span style={{ color: "var(--zk-text-faint)" }}>…</span>
          </div>
        ) : signedIn ? (
          <Link href="/wallet" aria-label={`Your ZEC: ${formatZec(balanceZat, 8)} ZEC. Open your wallet`} style={balanceStyle}>
            {coin}
            {compactZec(balanceZat)}
            <span aria-hidden="true" style={HIT_SLOP_36} />
          </Link>
        ) : (
          <Link
            href="/signin?next=/feed"
            aria-label="Sign up to get your own ZECKED wallet"
            style={{ ...balanceStyle, font: "var(--zk-type-btn-sm)" }}
          >
            {coin}
            Sign up
            <span aria-hidden="true" style={HIT_SLOP_36} />
          </Link>
        )}

        {tipOpen && (
          <div
            id="zk-streak-tip"
            role="status"
            style={{
              position: "absolute",
              top: "calc(100% + var(--zk-space-10))",
              right: 0,
              width: 236,
              zIndex: 20,
              padding: "var(--zk-space-12) var(--zk-space-14)",
              borderRadius: "var(--zk-radius-lg)",
              background: "var(--zk-surface-raised)",
              border: "1px solid var(--zk-border-strong)",
              boxShadow: "var(--zk-shadow-card)",
              animation: "zk-vt-rise 180ms var(--zk-ease-out) both",
            }}
          >
            <div style={{ font: "var(--zk-type-h4)" }}>
              {streak}-day streak <span aria-hidden="true">🔥</span>
            </div>
            <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-4)" }}>
              {streak === 1
                ? "You played today. Crack a riddle or make a call tomorrow to make it 2."
                : `You’ve played ${streak} days in a row. Crack a riddle or make a call every day to keep it going.`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- list states ---------- */

const bar = (w: number | string, h: number, extra?: CSSProperties): CSSProperties => ({
  width: w,
  height: h,
  borderRadius: "var(--zk-radius-sm)",
  background: "var(--zk-surface-raised)",
  ...extra,
});

function SkeletonCard({ delay = 0 }: { delay?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        flex: "none",
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-2xl)",
        border: "1.5px solid var(--zk-border)",
        padding: "var(--zk-space-16)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-14)",
        animation: `zk-glow 1.6s ease-in-out ${delay}s infinite`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)" }}>
        <div style={bar("var(--zk-tile-md)", 44, { height: "var(--zk-tile-md)", borderRadius: "var(--zk-radius-md)" })} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
          <div style={bar(64, 10)} />
          <div style={bar(140, 12)} />
        </div>
        <div style={bar(96, 22, { borderRadius: "var(--zk-radius-pill)" })} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
        <div style={bar("92%", 20)} />
        <div style={bar("64%", 20)} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
          <div style={bar(120, 22)} />
          <div style={bar(40, 10)} />
        </div>
        <div style={bar(84, 32, { borderRadius: "var(--zk-radius-pill)" })} />
      </div>
      <div style={bar("100%", 8, { borderRadius: "var(--zk-radius-xs)" })} />
    </div>
  );
}

function StateCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-2xl)",
        border: "1.5px dashed var(--zk-border-strong)",
        padding: "var(--zk-space-28) var(--zk-space-20)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--zk-space-12)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function StateTile({ icon, grad, edge }: { icon: string; grad: string; edge: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 64,
        height: 64,
        borderRadius: "var(--zk-radius-lg)",
        background: grad,
        boxShadow: `var(--zk-inset-gloss), 0 4px 0 ${edge}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--zk-text)",
        marginBottom: "var(--zk-space-4)",
      }}
    >
      <Icon icon={icon} size={30} stroke={2.4} />
    </div>
  );
}

const STEPS: { icon: string; grad: string; edge: string; title: string; text: string }[] = [
  { icon: "vault", grad: "var(--zk-grad-tile-purple)", edge: "var(--zk-purple-shade)", title: "Hide", text: "ZEC behind a riddle or a match" },
  { icon: "share", grad: "var(--zk-grad-tile-sky)", edge: "var(--zk-sky-shade)", title: "Share", text: "the link with your friends" },
  { icon: "unlock", grad: "var(--zk-grad-tile-gold)", edge: "var(--zk-gold-deep)", title: "Zeck it", text: "first to crack it keeps it" },
];

/** "Next free stash drops in 01:12:09", only when the server has actually scheduled one. */
function NextDrop({ at, onDone }: { at: string; onDone: () => void }) {
  const secs = (Date.parse(at) - Date.now()) / 1000;
  const far = secs >= 86_400 ? `${Math.floor(secs / 86_400)}d ${Math.floor((secs % 86_400) / 3600)}h` : undefined;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--zk-space-8)",
        padding: "var(--zk-space-8) var(--zk-space-14)",
        borderRadius: "var(--zk-radius-pill)",
        background: "var(--zk-gold-tint)",
        border: "1px solid rgb(var(--zk-gold-rgb) / .3)",
        font: "var(--zk-type-small)",
        color: "var(--zk-text)",
      }}
    >
      <Icon icon="clock" size={16} stroke={2.4} color="var(--zk-gold)" />
      Next free stash drops in
      <Countdown to={at} format="hms" text={far} tone="gold" size="sm" onDone={onDone} />
    </div>
  );
}

/**
 * "New here? Try a free practice riddle →": the whole card opens /practice, ✕ puts it away for good.
 * In the list it folds away (with the gap below it) so nothing jumps; `fold={false}` just swaps it out.
 */
function PracticeCard({ fold = true, style }: { fold?: boolean; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  const dismiss = () => {
    if (leaving.current) return;
    leaving.current = true;
    const el = ref.current;
    if (!fold || !el?.animate || reducedMotion()) {
      dismissPractice();
      return;
    }
    el.style.overflow = "hidden";
    const anim = el.animate(
      [
        { height: `${el.offsetHeight}px`, opacity: 1, marginBottom: "0px" },
        { height: "0px", opacity: 0, marginBottom: `-${LIST_GAP}px` },
      ],
      { duration: 260, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" }
    );
    anim.onfinish = dismissPractice;
    anim.oncancel = dismissPractice;
  };
  return (
    <div ref={ref} style={{ flex: "none", position: "relative", ...style }}>
      <Link
        href="/practice"
        transitionTypes={["nav-forward"]}
        data-sfx="pop"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--zk-space-12)",
          padding: "var(--zk-space-12) var(--zk-space-14) var(--zk-space-14)",
          borderRadius: "var(--zk-radius-2xl)",
          background:
            "radial-gradient(90% 120% at 0% 0%, rgb(var(--zk-purple-rgb) / .38), transparent 70%), radial-gradient(70% 100% at 100% 100%, rgb(var(--zk-pink-rgb) / .16), transparent 70%), var(--zk-surface)",
          border: "1.5px solid rgb(var(--zk-purple-rgb) / .5)",
          color: "var(--zk-text)",
          textAlign: "left",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 44,
            height: 44,
            flex: "none",
            borderRadius: "var(--zk-radius-lg)",
            background: "var(--zk-grad-tile-gold)",
            boxShadow: "var(--zk-inset-gloss), 0 3px 0 var(--zk-gold-deep)",
            color: "var(--zk-gold-ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon icon="key" size={22} stroke={2.4} />
        </span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--zk-space-2)" }}>
          {/* The label row is as tall as the ✕, so the lines below can run the full width under it. */}
          <span
            style={{
              minHeight: 24,
              paddingRight: 30,
              display: "flex",
              alignItems: "center",
              font: "var(--zk-type-label)",
              letterSpacing: "var(--zk-track-label)",
              color: "var(--zk-pink)",
            }}
          >
            NEW HERE?
          </span>
          <span style={{ font: "var(--zk-type-h4)", fontSize: "clamp(14px, 4.3vw, var(--zk-fs-16))", textWrap: "balance" } as CSSProperties}>
            Try a free practice{" "}
            <span style={{ whiteSpace: "nowrap" }}>
              riddle
              <span style={{ display: "inline-block", verticalAlign: "-2px", marginLeft: "var(--zk-space-6)" }}>
                <Icon icon="arrowRight" size={16} stroke={2.8} color="var(--zk-gold)" />
              </span>
            </span>
          </span>
          <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", textWrap: "balance" } as CSSProperties}>
            No ZEC, no sign-up, just for fun.
          </span>
        </span>
      </Link>
      <button
        type="button"
        aria-label="No thanks, hide this"
        data-sfx="tap"
        onClick={dismiss}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: "var(--zk-tap-min)",
          height: "var(--zk-tap-min)",
          border: 0,
          padding: 0,
          background: "transparent",
          color: "var(--zk-text-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          touchAction: "manipulation",
        }}
      >
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: "rgb(var(--zk-bg-rgb) / .5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon icon="close" size={13} stroke={2.8} />
        </span>
      </button>
    </div>
  );
}

/**
 * The whole feed is empty (the first thing players see on a fresh network): a teaser, not a dead end.
 * `nextDrop` is the spot for a "Next drop in…" line once the server schedules house drops; `practice`
 * shows the practice-riddle card to first-timers (in place of the steps).
 */
function EmptyFeed({ nextDrop, practice }: { nextDrop?: ReactNode; practice?: boolean }) {
  return (
    <section
      aria-labelledby="zk-empty-title"
      style={{
        position: "relative",
        overflow: "hidden",
        background:
          "radial-gradient(70% 45% at 50% 0%, rgb(var(--zk-gold-rgb) / .16), transparent 70%), radial-gradient(60% 40% at 100% 100%, rgb(var(--zk-purple-rgb) / .22), transparent 70%), var(--zk-surface)",
        borderRadius: "var(--zk-radius-2xl)",
        border: "1.5px solid var(--zk-border)",
        padding: "var(--zk-space-20) var(--zk-space-16) var(--zk-space-18)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <Vault mode="loop" size={84} />
      <div style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-gold)", marginTop: "var(--zk-space-14)" }}>
        THE VAULT IS EMPTY
      </div>
      <h2 id="zk-empty-title" style={{ font: "var(--zk-type-h2)", margin: "var(--zk-space-8) 0 0", textWrap: "balance" } as CSSProperties}>
        No stashes yet. Hide the first one.
      </h2>
      <p style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)", margin: "var(--zk-space-6) 0 0", maxWidth: 300 }}>
        It’s test ZEC (no real value), so go wild.
      </p>

      {/* First-timers get the practice riddle here instead: it teaches the game by playing it. */}
      {practice ? (
        <PracticeCard fold={false} style={{ width: "100%", marginTop: "var(--zk-space-16)" }} />
      ) : (
        <ol
          aria-label="How it works"
          style={{
            listStyle: "none",
            margin: "var(--zk-space-16) 0 0",
            padding: 0,
            width: "100%",
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: "var(--zk-space-8)",
          }}
        >
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--zk-space-4)",
                padding: "var(--zk-space-10) var(--zk-space-6)",
                borderRadius: "var(--zk-radius-lg)",
                background: "rgb(var(--zk-bg-rgb) / .45)",
                border: "1px solid var(--zk-border)",
                minWidth: 0,
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  width: 36,
                  height: 36,
                  marginBottom: "var(--zk-space-2)",
                  borderRadius: "var(--zk-radius-md)",
                  background: s.grad,
                  boxShadow: `var(--zk-inset-gloss), 0 3px 0 ${s.edge}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: i === 2 ? "var(--zk-gold-ink)" : "var(--zk-text)",
                }}
              >
                <Icon icon={s.icon} size={18} stroke={2.4} />
              </div>
              <div style={{ font: "var(--zk-type-h4)" }}>
                <span className="zk-sr-only">{i + 1}. </span>
                {s.title}
              </div>
              <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", textWrap: "balance" } as CSSProperties}>{s.text}</div>
            </li>
          ))}
        </ol>
      )}

      {nextDrop ? <div style={{ marginTop: "var(--zk-space-14)" }}>{nextDrop}</div> : null}

      <div style={{ width: "100%", marginTop: "var(--zk-space-16)", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
        <Button label="Hide the first stash" icon="plus" variant="primary" size="lg" href="/hide" />
        <Button label="Get free test ZEC" icon="coin" variant="ghost" size="md" href="/wallet?action=add" sfx="tap" />
      </div>
    </section>
  );
}

const FILTER_EMPTY: Record<Exclude<FeedFilter, "all">, { icon: string; title: string }> = {
  riddles: { icon: "lock", title: "No riddles live right now." },
  predictions: { icon: "ball", title: "No match calls open right now." },
  ending: { icon: "hourglass", title: "Nothing’s ending soon." },
  biggest: { icon: "coin", title: "No live stashes to rank yet." },
};

function FilterEmpty({ filter, onAll }: { filter: Exclude<FeedFilter, "all">; onAll: () => void }) {
  const c = FILTER_EMPTY[filter];
  return (
    <StateCard>
      <StateTile icon={c.icon} grad="var(--zk-grad-tile-purple)" edge="var(--zk-purple-shade)" />
      <div style={{ font: "var(--zk-type-h3)" }}>{c.title}</div>
      <div style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)", marginTop: "calc(-1 * var(--zk-space-6))" }}>
        New ones pop up here the moment they’re hidden.
      </div>
      <div style={{ marginTop: "var(--zk-space-4)" }}>
        <Button label="See all stashes" variant="secondary" size="md" full={false} onClick={onAll} sfx="tap" />
      </div>
    </StateCard>
  );
}

function ErrorState({ kind, onRetry }: { kind: FeedError; onRetry: () => void }) {
  const c = ERROR_COPY[kind];
  return (
    <StateCard>
      <StateTile icon="signal" grad="var(--zk-grad-tile-sky)" edge="var(--zk-sky-shade)" />
      <div style={{ font: "var(--zk-type-h3)" }}>{c.title}</div>
      <div style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)", marginTop: "calc(-1 * var(--zk-space-6))" }}>{c.body}</div>
      <div style={{ marginTop: "var(--zk-space-4)" }}>
        <Button label="Try again" variant="secondary" size="md" full={false} onClick={onRetry} />
      </div>
    </StateCard>
  );
}

/** Cards are still on screen but the last refresh failed: say so without throwing them away. */
function StaleBanner({ kind, onRetry }: { kind: FeedError; onRetry: () => void }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-10)",
        padding: "var(--zk-space-6) var(--zk-space-6) var(--zk-space-6) var(--zk-space-14)",
        borderRadius: "var(--zk-radius-lg)",
        background: "var(--zk-sky-tint)",
        border: "1px solid rgb(var(--zk-sky-rgb) / .3)",
      }}
    >
      <span style={{ color: "var(--zk-sky)", display: "flex" }}>
        <Icon icon="signal" size={18} stroke={2.4} />
      </span>
      <div style={{ flex: 1, minWidth: 0, font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
        <b style={{ color: "var(--zk-text)" }}>{ERROR_COPY[kind].title}</b> Showing the last stashes we saw.
      </div>
      <Button label="Retry" variant="ghost" size="sm" full={false} onClick={onRetry} style={{ height: 44 }} />
    </div>
  );
}

/** One feed row. A stash that just appeared makes room, then pops in. */
function FeedItem({ stash, animate }: { stash: PublicStash; animate: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const atMount = useRef(animate);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!atMount.current || !el?.animate || reducedMotion()) return;
    const h = el.offsetHeight;
    el.style.overflow = "hidden";
    const grow = el.animate([{ height: "0px", marginBottom: `-${LIST_GAP}px` }, { height: `${h}px`, marginBottom: "0px" }], {
      duration: 320,
      easing: "cubic-bezier(.22,1,.36,1)",
    });
    const done = () => {
      el.style.overflow = "";
    };
    grow.onfinish = done;
    grow.oncancel = done;
    const pop = (el.firstElementChild as HTMLElement | null)?.animate(
      [
        { opacity: 0, transform: "translateY(-16px) scale(.92)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 560, delay: 100, easing: "cubic-bezier(.3,1.6,.5,1)", fill: "backwards" }
    );
    return () => {
      grow.cancel();
      pop?.cancel();
    };
  }, []);
  return (
    <div ref={ref} style={{ flex: "none" }}>
      <StashCard stash={stash} href={`/s/${stash.id}`} markMine />
    </div>
  );
}

/* ---------- screen ---------- */

export default function Feed() {
  const [filter, setFilter] = useState<FeedFilter>(() => mem.filter);
  const [lists, setLists] = useState<Partial<Record<FeedFilter, PublicStash[]>>>(() => mem.lists);
  const [errors, setErrors] = useState<Partial<Record<FeedFilter, FeedError>>>({});
  const [player, setPlayer] = useState<Player | null>(() => mem.player);
  const [ticker, setTicker] = useState<TickerState>(() => mem.ticker);
  const [house, setHouse] = useState<HouseStatus | null>(() => mem.house);
  const [held, setHeld] = useState<string[]>([]); // new stashes waiting behind the pill
  const [fresh, setFresh] = useState<string[]>([]); // new stashes that animate in
  const [collapsed, setCollapsed] = useState(false);
  const [lift, setLift] = useState(0);
  const [headerH, setHeaderH] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const practice = useSyncExternalStore(subscribePractice, practiceWanted, noPractice);

  const mainRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const insetRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pullRef = useRef<HTMLDivElement>(null);
  const pullIconRef = useRef<HTMLDivElement>(null);

  // Latest values for async callbacks and listeners.
  const listsRef = useRef(lists);
  const filterRef = useRef(filter);
  const heldRef = useRef(held);
  const inflight = useRef<Partial<Record<FeedFilter, boolean>>>({});
  const touching = useRef(false); // a finger/mouse is on the screen: don't slide cards in under it
  const freshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    listsRef.current = lists;
    filterRef.current = filter;
    heldRef.current = held;
  });

  // Remember everything for the next visit.
  useEffect(() => {
    mem.lists = lists;
  }, [lists]);
  useEffect(() => {
    mem.player = player;
  }, [player]);
  useEffect(() => {
    mem.ticker = ticker;
  }, [ticker]);
  useEffect(() => {
    mem.filter = filter;
  }, [filter]);
  useEffect(() => {
    mem.house = house;
  }, [house]);

  // First visit this session (a reload, a fresh tab): pick the filter back up.
  useEffect(() => {
    if (mem.visited) return;
    mem.visited = true;
    try {
      const f = sessionStorage.getItem(FILTER_KEY) as FeedFilter | null;
      if (f && f !== "all" && CHIPS.some((c) => c.filter === f)) setFilter(f);
    } catch {}
  }, []);

  // Coming back (←, browser back, swipe): the list is already rendered from memory, so jump straight to
  // where you were, before the first paint.
  useLayoutEffect(() => {
    if (Date.now() - poppedAt > 2500) return;
    const y = mem.scrollY;
    if (y > 0 && (listsRef.current[filterRef.current]?.length ?? 0) > 0) window.scrollTo(0, y);
  }, []);

  // The header's height, for placing the "new stashes" pill right under it.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderH(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showFresh = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setFresh((f) => [...f, ...ids]);
    clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => setFresh([]), 1500);
  }, []);
  useEffect(() => () => clearTimeout(freshTimer.current), []);

  const reveal = useCallback(() => {
    const ids = heldRef.current;
    if (!ids.length) return;
    heldRef.current = [];
    setHeld([]);
    showFresh(ids);
  }, [showFresh]);

  const loadFeed = useCallback(
    async (f: FeedFilter, why: LoadWhy) => {
      if (inflight.current[f] && why === "poll") return;
      inflight.current[f] = true;
      try {
        // The feed also says when the house's next free drop lands (not in api.ts's type yet).
        const res = (await api.feed(f)) as { stashes: PublicStash[]; house?: HouseStatus | null };
        const stashes = res.stashes;
        if (res.house !== undefined) setHouse(res.house);
        const prev = listsRef.current[f];
        if (prev && f === filterRef.current) {
          const known = new Set(prev.map((s) => s.id));
          const added = stashes.filter((s) => !known.has(s.id) && (s.status === "live" || s.status === "locked")).map((s) => s.id);
          if (added.length) {
            // At the very top they slide straight in; further down (or mid-tap) they wait behind the
            // pill so the list never jumps under your thumb.
            if (window.scrollY > 2 || touching.current) setHeld((h) => [...h, ...added.filter((id) => !h.includes(id))]);
            else showFresh(added);
            if (why !== "enter" && !document.hidden) sfx("notify");
          }
        }
        setLists((p) => ({ ...p, [f]: stashes }));
        setErrors((p) => (p[f] ? { ...p, [f]: undefined } : p));
      } catch (e) {
        setErrors((p) => ({ ...p, [f]: errorKind(e) }));
      } finally {
        inflight.current[f] = false;
      }
    },
    [showFresh]
  );

  const loadTicker = useCallback(async () => {
    try {
      const { items } = await api.ticker();
      setTicker({ items, now: Date.now(), loaded: true });
    } catch {
      /* keep the last ticker */
    }
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const { player } = await api.me();
      setPlayer(player);
    } catch {
      /* keep the last player */
    }
  }, []);

  // Feed: load on filter change (from memory first), refresh every 8s while the tab is visible.
  useEffect(() => {
    void loadFeed(filter, "enter");
    const t = setInterval(() => {
      if (!document.hidden) void loadFeed(filter, "poll");
    }, FEED_MS);
    const onBack = () => {
      if (!document.hidden) void loadFeed(filter, "poll");
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("online", onBack);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("online", onBack);
    };
  }, [filter, loadFeed]);

  // Ticker (15s) and player: balance + streak (30s), both paused while hidden.
  useEffect(() => {
    void loadTicker();
    void loadMe();
    const tt = setInterval(() => {
      if (!document.hidden) void loadTicker();
    }, TICKER_MS);
    const tm = setInterval(() => {
      if (!document.hidden) void loadMe();
    }, ME_MS);
    const onBack = () => {
      if (document.hidden) return;
      void loadTicker();
      void loadMe();
    };
    document.addEventListener("visibilitychange", onBack);
    return () => {
      clearInterval(tt);
      clearInterval(tm);
      document.removeEventListener("visibilitychange", onBack);
    };
  }, [loadTicker, loadMe]);

  // One scroll listener: remembers the position, slides the header away on the way down (back on the way
  // up), and shows held stashes once you're back at the top.
  useEffect(() => {
    let lastY = window.scrollY;
    let acc = 0;
    let raf = 0;
    const run = () => {
      raf = 0;
      if (!mainRef.current?.isConnected) return;
      const y = Math.max(0, window.scrollY);
      mem.scrollY = y;
      const dy = y - lastY;
      lastY = y;
      if (y < 80) {
        acc = 0;
        setCollapsed(false);
      } else if (dy > 0) {
        acc = Math.max(0, acc) + dy;
        if (acc > 24) {
          setLift(Math.max(0, (topRef.current?.offsetHeight ?? 0) - (insetRef.current?.offsetHeight ?? 0)));
          setCollapsed(true);
        }
      } else if (dy < 0) {
        acc = Math.min(0, acc) + dy;
        if (acc < -24) setCollapsed(false);
      }
      if (y <= 2 && heldRef.current.length && !touching.current) reveal();
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(run);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [reveal]);

  // While a finger is down nothing slides in; once it lifts (and we're at the top) held stashes appear.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const down = () => {
      clearTimeout(t);
      touching.current = true;
    };
    const up = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        touching.current = false;
        if (window.scrollY <= 2 && heldRef.current.length) reveal();
      }, 400);
    };
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    window.addEventListener("pointercancel", up, { passive: true });
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [reveal]);

  // Pull to refresh (touch only). The list follows the finger with some resistance, the vault spins
  // while we reload, then everything springs back. Only starts at the very top on a downward drag, so
  // ordinary scrolling and the sideways chip row are untouched.
  const refreshAll = useRef<() => Promise<void>>(async () => {});
  useLayoutEffect(() => {
    refreshAll.current = async () => {
      await Promise.all([loadFeed(filterRef.current, "pull"), loadTicker(), loadMe()]);
    };
  });
  useEffect(() => {
    const main = mainRef.current;
    const list = listRef.current;
    const ind = pullRef.current;
    const icon = pullIconRef.current;
    if (!main || !list || !ind || !icon) return;
    const TH = 64;
    const MAX = 120;
    const HOLD = 60;
    let y0 = 0;
    let x0 = 0;
    let tracking = false;
    let decided = false;
    let dist = 0;
    let busy = false;

    const paint = (d: number, animate: boolean) => {
      const tr = animate ? "transform 340ms var(--zk-ease-out), opacity 240ms ease-out" : "none";
      list.style.transition = tr;
      list.style.transform = d > 0 ? `translate3d(0, ${d}px, 0)` : "";
      const k = Math.min(1, d / TH);
      ind.style.transition = tr;
      ind.style.opacity = String(k);
      ind.style.transform = `translate3d(0, ${d / 2 - 22}px, 0) scale(${0.6 + 0.4 * k})`;
      if (!busy) icon.style.transform = `rotate(${d * 3}deg)`;
    };
    const onStart = (e: TouchEvent) => {
      tracking = false;
      if (busy || e.touches.length !== 1 || window.scrollY > 0) return;
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
      tracking = true;
      decided = false;
      dist = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dy = e.touches[0].clientY - y0;
      const dx = e.touches[0].clientX - x0;
      if (!decided) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        decided = true;
        if (dy < 0 || Math.abs(dx) > Math.abs(dy)) {
          tracking = false;
          return;
        }
      }
      if (window.scrollY > 0) {
        tracking = false;
        paint(0, true);
        return;
      }
      dist = MAX * (1 - Math.exp(-Math.max(0, dy - 8) / MAX));
      paint(dist, false);
    };
    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!decided) return;
      if (dist < TH) {
        paint(0, true);
        return;
      }
      busy = true;
      sfx("whoosh");
      setRefreshing(true);
      paint(HOLD, true);
      icon.style.animation = "zk-spin .8s linear infinite";
      const t0 = Date.now();
      void refreshAll.current().finally(() => {
        setTimeout(() => {
          busy = false;
          icon.style.animation = "";
          setRefreshing(false);
          paint(0, true);
        }, Math.max(0, 650 - (Date.now() - t0)));
      });
    };
    const onCancel = () => {
      if (!tracking) return;
      tracking = false;
      if (!busy) paint(0, true);
    };
    main.addEventListener("touchstart", onStart, { passive: true });
    main.addEventListener("touchmove", onMove, { passive: true });
    main.addEventListener("touchend", onEnd);
    main.addEventListener("touchcancel", onCancel);
    return () => {
      main.removeEventListener("touchstart", onStart);
      main.removeEventListener("touchmove", onMove);
      main.removeEventListener("touchend", onEnd);
      main.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  const pick = (f: FeedFilter) => {
    if (f === filter) {
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
      return;
    }
    heldRef.current = [];
    setHeld([]);
    setFilter(f);
    try {
      sessionStorage.setItem(FILTER_KEY, f);
    } catch {}
    if (window.scrollY > 0) window.scrollTo(0, 0);
  };

  const onPill = () => {
    const smooth = !reducedMotion() && window.scrollY > 0;
    window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    // The scroll listener reveals them as soon as we're at the top; this covers a scroll that never lands.
    setTimeout(reveal, smooth ? 700 : 0);
  };

  const list = lists[filter];
  const error = errors[filter];
  const retry = () => {
    setErrors((p) => ({ ...p, [filter]: undefined }));
    void loadFeed(filter, "poll");
  };

  const heldSet = new Set(held);
  const freshSet = new Set(fresh);
  const shown = list?.filter((s) => !heldSet.has(s.id));

  // Warm the top few live stashes in the background (a "peek" that doesn't count as viewing them),
  // so tapping one opens instantly. Re-warmed as the list changes; the cache drops stale reads.
  const warmKey = (shown || []).filter((s) => s.status === "live" || s.status === "locked").slice(0, 4).map((s) => s.id).join(",");
  useEffect(() => {
    if (!warmKey) return;
    const t = window.setTimeout(() => warmKey.split(",").forEach((id) => warmStash(id)), 900);
    return () => window.clearTimeout(t);
  }, [warmKey]);
  const waiting = list ? list.filter((s) => heldSet.has(s.id)).length : 0;
  // The whole feed is empty (not just this filter): the teaser, with its own single primary button.
  const feedEmpty = !!list && list.length === 0 && (filter === "all" || lists.all?.length === 0);

  // Shown with the list (never over the loading skeletons), so it never pushes the cards down later.
  const practiceCard = practice ? <PracticeCard /> : null;

  let body: ReactNode;
  if (shown && shown.length > 0) {
    body = (
      <>
        {error && <StaleBanner kind={error} onRetry={retry} />}
        {practiceCard}
        {shown.map((s) => (
          <FeedItem key={s.id} stash={s} animate={freshSet.has(s.id)} />
        ))}
      </>
    );
  } else if (feedEmpty) {
    const dropAt = house?.nextDropAt && Date.parse(house.nextDropAt) > Date.now() ? house.nextDropAt : null;
    body = <EmptyFeed practice={practice} nextDrop={dropAt ? <NextDrop at={dropAt} onDone={() => void loadFeed(filter, "poll")} /> : undefined} />;
  } else if (list) {
    body = (
      <>
        {practiceCard}
        <FilterEmpty filter={filter as Exclude<FeedFilter, "all">} onAll={() => pick("all")} />
      </>
    );
  } else if (error) {
    body = (
      <>
        {practiceCard}
        <ErrorState kind={error} onRetry={retry} />
      </>
    );
  } else {
    body = (
      <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
        <span className="zk-sr-only">Loading stashes…</span>
        <SkeletonCard />
        <SkeletonCard delay={0.2} />
        <SkeletonCard delay={0.4} />
      </div>
    );
  }

  return (
    <main
      ref={mainRef}
      className="zk-screen has-tabs"
      style={{ background: "var(--zk-bg)", paddingTop: 0, paddingLeft: 0, paddingRight: 0 }}
    >
      {/* Covers the status bar (notch) while the header is slid away. Zero-height when there's no inset. */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          top: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          maxWidth: 430,
          height: "var(--zk-top-inset)",
          background: "var(--zk-bg)",
          zIndex: 6,
          pointerEvents: "none",
        }}
      />

      {/* Header, ticker and chips stay pinned while the list scrolls; the top part slides away on the
          way down (a transform, so nothing below reflows) and the chips stay. */}
      <div
        ref={headerRef}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: "var(--zk-bg)",
          transform: collapsed && lift > 0 ? `translate3d(0, ${-lift}px, 0)` : "none",
          transition: "transform 260ms var(--zk-ease-out)",
        }}
      >
        <div ref={topRef} aria-hidden={collapsed || undefined} inert={collapsed || undefined}>
          <div ref={insetRef} style={{ height: "var(--zk-top-inset)" }} />
          <div style={{ paddingTop: "var(--zk-space-14)" }}>
            <Header player={player} collapsed={collapsed} />
            <TickerSlot ticker={ticker} />
          </div>
        </div>
        <div
          role="group"
          aria-label="Filter stashes"
          className="zk-scroll-x"
          style={{
            display: "flex",
            gap: "var(--zk-space-8)",
            padding: "var(--zk-space-12) var(--zk-space-16) var(--zk-space-8)",
            flex: "none",
          }}
        >
          {CHIPS.map((c) => (
            <Chip
              key={c.filter}
              active={filter === c.filter}
              onClick={() => pick(c.filter)}
              style={{ position: "relative" }}
              label={
                <>
                  {c.label}
                  <span aria-hidden="true" style={HIT_SLOP_38} />
                </>
              }
            />
          ))}
        </div>

      </div>

      {/* New stashes that arrived while you were scrolled down. Outside the header: its transform would
          otherwise pin this to the header instead of the screen. */}
      {waiting > 0 && (
        <div
          style={{
            position: "fixed",
            top: (collapsed ? headerH - lift : headerH) + 10,
            left: 0,
            right: 0,
            margin: "0 auto",
            maxWidth: 430,
            zIndex: 7,
            display: "flex",
            justifyContent: "center",
            pointerEvents: "none",
            transition: "top 260ms var(--zk-ease-out)",
          }}
        >
          <button
            type="button"
            onClick={onPill}
            data-sfx="tap"
            style={{
              pointerEvents: "auto",
              minHeight: 44,
              padding: "0 var(--zk-space-18) 0 var(--zk-space-14)",
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--zk-space-6)",
              border: 0,
              borderRadius: "var(--zk-radius-pill)",
              background: "var(--zk-purple)",
              color: "var(--zk-text)",
              font: "var(--zk-type-btn-sm)",
              boxShadow: "0 4px 0 var(--zk-purple-shade), 0 10px 24px rgb(var(--zk-black-rgb) / .4)",
              cursor: "pointer",
              touchAction: "manipulation",
              animation: "zk-vt-rise 220ms var(--zk-ease-out) both",
            }}
          >
            <Icon icon="back" size={16} stroke={2.8} style={{ transform: "rotate(90deg)" }} />
            {waiting} new {waiting === 1 ? "stash" : "stashes"}
          </button>
        </div>
      )}

      <div style={{ position: "relative" }}>
        {/* Pull-to-refresh indicator, revealed in the gap as the list is pulled down. */}
        <div
          ref={pullRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            marginLeft: -22,
            width: 44,
            height: 44,
            borderRadius: "var(--zk-radius-md)",
            background: "var(--zk-grad-tile-gold)",
            boxShadow: "var(--zk-inset-gloss), 0 3px 0 var(--zk-gold-deep)",
            color: "var(--zk-gold-ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0,
            transform: "translate3d(0, -22px, 0) scale(.6)",
            pointerEvents: "none",
          }}
        >
          <div ref={pullIconRef} style={{ display: "flex" }}>
            <Icon icon="vault" size={24} stroke={2.4} />
          </div>
        </div>
        <span className="zk-sr-only" role="status">
          {refreshing ? "Refreshing stashes…" : ""}
        </span>

        <div
          ref={listRef}
          style={{
            // 16px on top so a card's sticker (WHALE STASH) never tucks under the header.
            padding: "var(--zk-space-16) var(--zk-space-16) 72px",
            display: "flex",
            flexDirection: "column",
            gap: "var(--zk-space-14)",
          }}
        >
          {body}
        </div>
      </div>

      {!feedEmpty && (
        <div
          style={{
            position: "fixed",
            right: "max(var(--zk-space-16), calc((100vw - 430px) / 2 + var(--zk-space-16)))",
            bottom: "calc(var(--zk-tabbar-h) + var(--zk-space-16))",
            zIndex: 10,
          }}
        >
          <Button label="Hide a stash" icon="plus" variant="primary" size="md" full={false} href="/hide" />
        </div>
      )}

      <TabBar active="home" />
    </main>
  );
}
