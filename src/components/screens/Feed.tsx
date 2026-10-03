"use client";
// Screen 02 · Home feed. Header ("Hey 👋 @you", streak, wallet balance, notices bell), live ticker,
// filter chips, stash list and the nav dock (its big + hides a stash).
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
import { Avatar, Button, Chip, Countdown, Icon, Logo, StashCard, TabBar, Vault } from "@/components/zk";
import { formatDuration } from "@/components/zk/StashCard";
import { InstallNudge } from "@/components/zk/Install";
import { NOTICES_EVENT, NoticeBell } from "@/components/screens/NoticeBell";
import "@/styles/home.css";

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
const LIST_GAP = 16; // px, = --zk-space-16 between cards
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
// (tab bar, links) starts at the top like any other screen. lib/nav.ts marks a back with html[data-nav].
const cameBack = () => document.documentElement.getAttribute("data-nav") === "back";

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

/** One line of live activity under the greeting ("Someone just zecked 0.02 ZEC · 2m ago"), a new one
 *  every few seconds. Always the same height, loaded or not, so nothing below it moves. */
function LivePulse({ ticker }: { ticker: TickerState }) {
  const { items } = ticker;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2 || reducedMotion()) return;
    const t = setInterval(() => {
      if (!document.hidden) setI((n) => n + 1);
    }, 4200);
    return () => clearInterval(t);
  }, [items.length]);
  const t = items.length ? items[i % items.length] : null;
  let line: ReactNode;
  if (t) {
    const [before, bold, after] = splitBold(t.text);
    const look = tickerLook(t);
    line = (
      <span key={`${t.id}-${i}`} className="zk-pulse-line">
        <span style={{ color: look.color, display: "flex", flex: "none" }}>
          <Icon icon={look.icon} size={14} stroke={2.4} />
        </span>
        <span className="zk-pulse-text">
          {before}
          {bold && <b>{bold}</b>}
          {after} <span style={{ color: "var(--zk-text-faint)" }}>· {ago(t.at, Date.now())}</span>
        </span>
      </span>
    );
  } else if (ticker.loaded) {
    line = (
      <span className="zk-pulse-line">
        <span className="zk-pulse-text" style={{ color: "var(--zk-text-muted)" }}>
          All quiet. New stashes land here live.
        </span>
      </span>
    );
  } else {
    line = <span aria-hidden="true" style={{ width: 170, height: 10, borderRadius: "var(--zk-radius-sm)", background: "rgb(var(--zk-mint-rgb) / .14)" }} />;
  }
  return (
    <div className="zk-pulse" aria-label="Live activity">
      <span className="zk-pulse-dot" aria-hidden="true" />
      {line}
    </div>
  );
}

/* ---------- header ---------- */

const headerChip: CSSProperties = {
  position: "relative",
  height: 40,
  borderRadius: "var(--zk-radius-pill)",
  background: "var(--zk-surface-raised)",
  border: "2px solid var(--zk-ink)",
  boxShadow: "inset 0 1.5px 0 rgb(var(--zk-white-rgb) / .08), 0 3px 0 var(--zk-ink)",
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

function Header({ player, scrolled }: { player: Player | null; scrolled: boolean }) {
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
  const tipOpen = tip && !scrolled;

  const coin = (
    <span
      className="zk-hello-coin"
      style={{
        width: 26,
        height: 26,
        borderRadius: "50%",
        background: "var(--zk-grad-tile-gold)",
        border: "2px solid var(--zk-ink)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--zk-gold-ink)",
      }}
    >
      <Logo variant="mark" size={12} stroke="var(--zk-gold-ink)" />
    </span>
  );
  const balanceStyle: CSSProperties = {
    ...headerChip,
    padding: "0 var(--zk-space-12) 0 var(--zk-space-4)",
    font: "var(--zk-fw-bold) var(--zk-fs-14)/1 var(--zk-font-mono)",
    color: "var(--zk-gold)",
    textDecoration: "none",
  };
  // Signed in: your ZECKED wallet balance → /wallet. Guests: "Sign up" (they have no wallet yet).
  const signedIn = player?.account?.signedIn;
  const balanceZat = player?.balanceZat ?? 0;
  const handle = player?.handle.replace(/^@+/, "");

  return (
    <div style={{ position: "relative", padding: "0 var(--zk-screen-pad)", display: "flex", alignItems: "center", gap: "var(--zk-space-10)" }}>
      {/* You: avatar + "Hey 👋 @you" → your profile. */}
      <Link
        href="/me"
        transitionTypes={["tab"]}
        aria-label={handle ? `Your profile, @${handle}` : "Your profile"}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "var(--zk-space-10)", color: "var(--zk-text)" }}
      >
        {player ? (
          <Avatar handle={player.handle} src={player.avatarUrl} className="zk-hello-avatar" />
        ) : (
          <span aria-hidden="true" className="zk-hello-avatar is-empty" />
        )}
        <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ font: "var(--zk-fw-semibold) var(--zk-fs-13)/1 var(--zk-font-body)", color: "var(--zk-text-muted)" }}>
            Hey <span aria-hidden="true">👋</span>
          </span>
          {handle ? (
            <span
              style={{
                font: "var(--zk-fw-black) clamp(17px, 5.2vw, 21px)/1.1 var(--zk-font-display)",
                letterSpacing: "-.01em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              @{handle}
            </span>
          ) : (
            <span aria-hidden="true" style={{ width: 110, height: 18, borderRadius: 6, background: "var(--zk-surface-raised)" }} />
          )}
        </span>
      </Link>

      <div ref={groupRef} style={{ display: "flex", gap: "var(--zk-space-8)", alignItems: "center", flex: "none" }}>
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
              padding: "0 var(--zk-space-10)",
              gap: 3,
              font: "var(--zk-type-btn-sm)",
              color: "var(--zk-text)",
              cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            <Icon icon="flame" size={15} filled stroke={1.5} color="var(--zk-pink)" />
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
          <Link href="/wallet" transitionTypes={["tab"]} aria-label={`Your ZEC: ${formatZec(balanceZat, 8)} ZEC. Open your wallet`} style={balanceStyle}>
            {coin}
            {compactZec(balanceZat)}
            <span aria-hidden="true" style={HIT_SLOP_36} />
          </Link>
        ) : (
          <Link
            href="/signin?next=/feed"
            aria-label="Sign up to get your own ZECKED wallet"
            style={{ ...balanceStyle, font: "var(--zk-type-btn-sm)", color: "var(--zk-gold)" }}
          >
            {coin}
            Sign up
            <span aria-hidden="true" style={HIT_SLOP_36} />
          </Link>
        )}
        <NoticeBell hidden={scrolled} />
      </div>

      {tipOpen && (
        <div
          id="zk-streak-tip"
          role="status"
          style={{
            position: "absolute",
            top: "calc(100% + var(--zk-space-10))",
            right: "var(--zk-screen-pad)",
            width: 236,
            zIndex: 20,
            padding: "var(--zk-space-12) var(--zk-space-14)",
            borderRadius: "var(--zk-radius-lg)",
            background: "var(--zk-surface-raised)",
            border: "2.5px solid var(--zk-ink)",
            boxShadow: "0 4px 0 var(--zk-ink), var(--zk-shadow-card)",
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

/** "All" has nothing live (only finished stashes, or just the house drop up top). */
function NothingLive({ hasDrop }: { hasDrop: boolean }) {
  return (
    <StateCard>
      <StateTile icon="vault" grad="var(--zk-grad-tile-purple)" edge="var(--zk-purple-shade)" />
      <div style={{ font: "var(--zk-type-h3)" }}>{hasDrop ? "The free drop is the only one live." : "Nothing live right now."}</div>
      <div style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)", marginTop: "calc(-1 * var(--zk-space-6))", textWrap: "balance" } as CSSProperties}>
        Hide one and get it going. New stashes pop up here the moment they’re hidden.
      </div>
      <div style={{ marginTop: "var(--zk-space-4)" }}>
        <Button label="Hide a stash" icon="plus" variant="primary" size="md" full={false} href="/hide" />
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
    <div ref={ref} className="zk-feed-item" style={{ flex: "none" }}>
      <StashCard stash={stash} href={`/s/${stash.id}`} markMine />
    </div>
  );
}

/* ---------- home sections ---------- */

/**
 * The top of home: the house's free drop, big (tap to crack it), or a countdown to the next one. Nothing
 * when the house isn't dropping (the live list starts right away).
 */
function HomeHero({ drop, nextAt, onDue }: { drop: PublicStash | null; nextAt: string | null; onDue: () => void }) {
  if (drop) {
    const cracking = drop.riddle?.crackingNow ?? 0;
    return (
      <Link
        href={`/s/${drop.id}`}
        transitionTypes={["nav-forward"]}
        prefetch
        data-sfx="pop"
        className="zk-hero"
        onPointerDown={() => warmStash(drop.id)}
        aria-label={`Free drop from the house: ${drop.riddle?.text ?? "a riddle"}. Crack it`}
      >
        <span aria-hidden="true" className="zk-hero-vault">
          <Vault mode="loop" size={76} />
        </span>
        <span className="zk-hero-sticker">
          <Icon icon="sparkle" size={13} stroke={2.8} />
          FREE DROP
        </span>
        <span className="zk-hero-kicker">From the house · first to crack it keeps it</span>
        <span className="zk-hero-riddle">“{drop.riddle?.text ?? ""}”</span>
        <span className="zk-hero-foot">
          <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            <span className="zk-hero-zec">{formatZec(drop.amountZat)} ZEC</span>
            <span className="zk-hero-sub">
              {cracking > 0 ? (
                <>
                  <span className="zk-live-dot" aria-hidden="true" />
                  {cracking} cracking now
                </>
              ) : (
                `~$${drop.usd} · free to play`
              )}
            </span>
          </span>
          <span className="zk-hero-cta">
            Crack it
            <Icon icon="arrowRight" size={17} stroke={3} />
          </span>
        </span>
      </Link>
    );
  }
  if (!nextAt || Date.parse(nextAt) <= Date.now()) return null;
  const secs = (Date.parse(nextAt) - Date.now()) / 1000;
  const far = secs >= 86_400 ? `${Math.floor(secs / 86_400)}d ${Math.floor((secs % 86_400) / 3600)}h` : undefined;
  return (
    <div className="zk-hero is-wait">
      <span aria-hidden="true" className="zk-hero-vault">
        <Vault mode="closed" size={76} />
      </span>
      <span className="zk-hero-sticker is-wait">
        <Icon icon="clock" size={13} stroke={2.8} />
        NEXT FREE DROP
      </span>
      <span className="zk-hero-count">
        <Countdown to={nextAt} format="hms" text={far} tone="gold" size="lg" onDone={onDue} />
      </span>
      <span className="zk-hero-kicker" style={{ marginTop: 6 }}>
        The house hides free ZEC every few hours. First to crack it keeps it.
      </span>
    </div>
  );
}

function SectionHead({ title, count, id }: { title: string; count?: number; id: string }) {
  return (
    <div className="zk-sec-head">
      <h2 id={id} className="zk-sec-title">
        {title}
      </h2>
      {count ? <span className="zk-sec-count">{count}</span> : null}
    </div>
  );
}

/** A finished stash, small: it's over, so it shouldn't take a full card. Tap to see how it went. */
function EndedRow({ stash }: { stash: PublicStash }) {
  const riddle = stash.type === "riddle";
  const m = stash.prediction?.match;
  const zecked = stash.status === "zecked";
  const title = riddle ? `“${stash.riddle?.text ?? ""}”` : m ? `${m.home.name} vs ${m.away.name}` : "Match call";
  const secs = stash.result?.crackSeconds;
  const how = zecked
    ? riddle
      ? secs != null
        ? `Cracked in ${formatDuration(secs)}`
        : "Cracked"
      : `Called it${stash.result?.finalScore ? ` · ${stash.result.finalScore}` : ""}`
    : stash.status === "void"
      ? "Called off"
      : riddle
        ? "Nobody cracked it"
        : "Nobody called it";
  return (
    <Link href={`/s/${stash.id}`} transitionTypes={["nav-forward"]} className="zk-ended">
      <span aria-hidden="true" className={riddle ? "zk-ended-tile" : "zk-ended-tile is-match"}>
        <Icon icon={riddle ? (zecked ? "unlock" : "lock") : "ball"} size={18} stroke={2.4} />
      </span>
      <span className="zk-ended-main">
        <span className="zk-ended-title">{title}</span>
        <span className="zk-ended-sub">
          {how} · <span style={{ color: "var(--zk-gold)" }}>{formatZec(stash.amountZat)} ZEC</span>
        </span>
      </span>
      <span className={zecked ? "zk-ended-stamp" : "zk-ended-stamp is-safe"}>{zecked ? "ZECKED" : stash.status === "void" ? "OFF" : "SAFE"}</span>
    </Link>
  );
}

const ENDED_STATUS = new Set(["zecked", "expired", "refunded", "void"]);
const ENDED_SHOWN = 6;

/** Arrived through a friend's invite link (/i/<code> → /feed?invite=<code>): who invited you, and the
 *  way in. Shown to guests only; once read, the code leaves the address bar (the cookie keeps it). */
let inviteCode: string | null | undefined;

function InviteWelcome({ signedIn }: { signedIn: boolean | undefined }) {
  const [from, setFrom] = useState<{ handle: string; avatarUrl: string | null } | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    // Read once per page load: the code leaves the address bar right away, and a second run of this
    // effect (React's dev double-run, a remount) must still find it.
    if (inviteCode === undefined) inviteCode = new URLSearchParams(window.location.search).get("invite");
    const code = inviteCode;
    if (!code) return;
    if (window.location.search) window.history.replaceState(window.history.state, "", "/feed");
    let alive = true;
    api
      .inviter(code)
      .then(({ inviter }) => alive && inviter && setFrom(inviter))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!from || gone || signedIn) return null;
  return (
    <div className="zk-invite-hello" role="status">
      <Avatar handle={from.handle} src={from.avatarUrl} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--zk-type-h4)" }}>
          {from.handle} invited you <span aria-hidden="true">🎉</span>
        </div>
        <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: 2 }}>Sign up and get free test ZEC to play with.</div>
      </div>
      <Link href="/signin?next=/feed" className="zk-invite-cta" data-sfx="pop">
        Sign up
      </Link>
      <button type="button" aria-label="Close" data-sfx="tap" className="zk-invite-x" onClick={() => setGone(true)}>
        <Icon icon="close" size={13} stroke={2.8} />
      </button>
    </div>
  );
}

/* ---------- memory across launches ---------- */

// The last home you saw, so opening the app shows it straight away (then refreshes).
const HOME_KEY = "zk:home";
const HOME_MAX_AGE = 6 * 3600_000;
type HomeSnap = { at: number; all: PublicStash[]; player: Player | null; house: HouseStatus | null; ticker: TickerItem[] };
function readHome(): HomeSnap | null {
  try {
    const v = JSON.parse(localStorage.getItem(HOME_KEY) || "null") as HomeSnap | null;
    return v && Date.now() - v.at < HOME_MAX_AGE ? v : null;
  } catch {
    return null;
  }
}
function writeHome(v: Omit<HomeSnap, "at">) {
  try {
    localStorage.setItem(HOME_KEY, JSON.stringify({ ...v, at: Date.now() }));
  } catch {}
}

/** Tells the launch splash the home has something to show (it waits a moment for it). */
function markReady() {
  const w = window as Window & { __zkReady?: boolean };
  if (w.__zkReady) return;
  w.__zkReady = true;
  window.dispatchEvent(new Event("zk:ready"));
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
  const [scrolled, setScrolled] = useState(false); // past the greeting: close its popovers
  const [stuck, setStuck] = useState(false); // the filter chips are pinned to the top
  const [refreshing, setRefreshing] = useState(false);
  const practice = useSyncExternalStore(subscribePractice, practiceWanted, noPractice);

  const mainRef = useRef<HTMLElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<HTMLDivElement>(null);
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

  // First visit this session (a reload, a fresh tab, opening the app): pick the filter back up and show
  // the last home straight away, before the network answers (before paint, so no skeleton flash).
  useLayoutEffect(() => {
    if (mem.visited) return;
    mem.visited = true;
    try {
      const f = sessionStorage.getItem(FILTER_KEY) as FeedFilter | null;
      if (f && f !== "all" && CHIPS.some((c) => c.filter === f)) setFilter(f);
    } catch {}
    const snap = readHome();
    if (!snap) return;
    setLists((p) => (p.all ? p : { ...p, all: snap.all }));
    setPlayer((p) => p ?? snap.player);
    setHouse((h) => h ?? snap.house);
    setTicker((t) => (t.loaded ? t : { items: snap.ticker, now: Date.now(), loaded: snap.ticker.length > 0 }));
  }, []);

  // Keep that snapshot fresh (a moment after things settle, not on every poll tick).
  useEffect(() => {
    if (!lists.all) return;
    const t = window.setTimeout(() => writeHome({ all: lists.all!.slice(0, 30), player, house, ticker: ticker.items.slice(0, 12) }), 1200);
    return () => window.clearTimeout(t);
  }, [lists.all, player, house, ticker.items]);

  // Coming back (←, browser back, swipe): the list is already rendered from memory, so jump straight to
  // where you were, before the first paint.
  useLayoutEffect(() => {
    if (!cameBack()) return;
    const y = mem.scrollY;
    if (y > 0 && (listsRef.current[filterRef.current]?.length ?? 0) > 0) window.scrollTo(0, y);
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
    // A notice (ZEC landed, stash zecked…) means the balance just changed.
    const onNotice = () => void loadMe();
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener(NOTICES_EVENT, onNotice);
    return () => {
      clearInterval(tt);
      clearInterval(tm);
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener(NOTICES_EVENT, onNotice);
    };
  }, [loadTicker, loadMe]);

  // One scroll listener: remembers the position, notes when you're past the greeting, and shows held
  // stashes once you're back at the top.
  useEffect(() => {
    let raf = 0;
    const run = () => {
      raf = 0;
      if (!mainRef.current?.isConnected) return;
      const y = Math.max(0, window.scrollY);
      mem.scrollY = y;
      setScrolled(y > 40);
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

  // The house's live drop leads the page (from the full list, whatever the filter), so "All" skips it below.
  const drop = (house?.liveId && lists.all?.find((s) => s.id === house.liveId && s.status === "live")) || null;
  const live = shown?.filter((s) => !ENDED_STATUS.has(s.status) && !(filter === "all" && drop && s.id === drop.id));
  const ended = shown?.filter((s) => ENDED_STATUS.has(s.status)).slice(0, ENDED_SHOWN);

  // Warm the top few live stashes in the background (a "peek" that doesn't count as viewing them),
  // so tapping one opens instantly. Re-warmed as the list changes; the cache drops stale reads.
  const warmKey = [drop, ...(live || [])].filter((s): s is PublicStash => !!s).slice(0, 4).map((s) => s.id).join(",");
  useEffect(() => {
    if (!warmKey) return;
    const t = window.setTimeout(() => warmKey.split(",").forEach((id) => warmStash(id)), 900);
    return () => window.clearTimeout(t);
  }, [warmKey]);
  const waiting = list ? list.filter((s) => heldSet.has(s.id)).length : 0;
  // The whole feed is empty (not just this filter): the teaser, with its own single primary button.
  const feedEmpty = !!list && list.length === 0 && (filter === "all" || lists.all?.length === 0);

  // Something to show (or a clear error): the launch splash can step aside.
  const settled = !!list || !!error;
  useEffect(() => {
    if (settled) markReady();
  }, [settled]);
  useLayoutEffect(() => {
    const w = window as Window & { __zkReady?: boolean };
    if (!w.__zkReady && !listsRef.current[filterRef.current]) w.__zkReady = false;
  }, []);

  // The chips show a pinned look once they reach the top (a zero-height marker just above them scrolls away).
  useEffect(() => {
    const pin = pinRef.current;
    const chips = chipsRef.current;
    if (!pin || !chips) return;
    const top = parseFloat(getComputedStyle(chips).top) || 0;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < top + 1), {
      rootMargin: `${-Math.ceil(top) - 1}px 0px 0px 0px`,
    });
    io.observe(pin);
    return () => io.disconnect();
  }, [feedEmpty]);

  // Shown with the list (never over the loading skeletons), so it never pushes the cards down later.
  const practiceCard = practice ? <PracticeCard /> : null;
  const dropAt = house?.nextDropAt && Date.parse(house.nextDropAt) > Date.now() ? house.nextDropAt : null;
  const onDue = () => void loadFeed(filter, "poll");

  let body: ReactNode;
  if (live && live.length > 0) {
    body = (
      <>
        {error && <StaleBanner kind={error} onRetry={retry} />}
        {practiceCard}
        {live.map((s) => (
          <FeedItem key={s.id} stash={s} animate={freshSet.has(s.id)} />
        ))}
      </>
    );
  } else if (list) {
    body = (
      <>
        {practiceCard}
        {filter === "all" ? <NothingLive hasDrop={!!drop} /> : <FilterEmpty filter={filter as Exclude<FeedFilter, "all">} onAll={() => pick("all")} />}
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
      <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-16)" }}>
        <span className="zk-sr-only">Loading stashes…</span>
        <SkeletonCard />
        <SkeletonCard delay={0.2} />
      </div>
    );
  }

  const at = (i: number) => ({ ["--i" as string]: i }) as CSSProperties;

  return (
    <main ref={mainRef} className="zk-screen has-tabs" style={{ background: "var(--zk-bg-hero-purple)", paddingTop: 0, paddingLeft: 0, paddingRight: 0 }}>
      {/* Covers the status bar (notch) once the page scrolls under it. Zero-height when there's no inset. */}
      <div aria-hidden="true" className="zk-notch-cover" />

      {/* Pull-to-refresh indicator, revealed in the gap as the page is pulled down. */}
      <div
        ref={pullRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "calc(var(--zk-top-inset) + 8px)",
          left: "50%",
          marginLeft: -22,
          width: 44,
          height: 44,
          borderRadius: "var(--zk-radius-md)",
          background: "var(--zk-grad-tile-gold)",
          border: "2.5px solid var(--zk-ink)",
          boxShadow: "var(--zk-inset-gloss), 0 3px 0 var(--zk-ink)",
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

      {/* Everything below follows the finger on pull-to-refresh. On launch, each block rises in as the splash
          steps aside (globals.css: .zk-home-stagger). */}
      <div ref={listRef} className="zk-home-stagger">
        <div style={{ ...at(0), paddingTop: "calc(var(--zk-top-inset) + var(--zk-space-18))" }}>
          <Header player={player} scrolled={scrolled} />
        </div>
        <div style={at(1)}>
          <LivePulse ticker={ticker} />
        </div>
        <div style={at(2)}>
          <InviteWelcome signedIn={player ? !!player.account?.signedIn : undefined} />
        </div>

        {!feedEmpty && (drop || dropAt) && (
          <div className="zk-home-block" style={at(2)}>
            <HomeHero drop={drop} nextAt={dropAt} onDue={onDue} />
          </div>
        )}

        {/* Phones in a browser tab: one tap to put ZECKED on the Home Screen (renders nothing once installed). */}
        <InstallNudge style={{ ...at(3), margin: "var(--zk-space-20) var(--zk-space-16) 0" }} />

        {feedEmpty ? (
          <div className="zk-home-block" style={at(2)}>
            <EmptyFeed practice={practice} nextDrop={dropAt ? <NextDrop at={dropAt} onDone={onDue} /> : undefined} />
          </div>
        ) : (
          <div className="zk-home-lists" style={at(3)}>
            <section aria-labelledby="zk-live-title">
              <SectionHead id="zk-live-title" title="Live now" count={live?.length} />
              <div ref={pinRef} aria-hidden="true" />
              {/* Pinned under the notch while you scroll. The "new stashes" pill hangs just below it. */}
              <div ref={chipsRef} className={stuck ? "zk-chips is-stuck" : "zk-chips"}>
                <div role="group" aria-label="Filter stashes" className="zk-scroll-x zk-chips-row">
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
                {waiting > 0 && (
                  <div className="zk-new-pill-wrap">
                    <button type="button" onClick={onPill} data-sfx="tap" className="zk-new-pill">
                      <Icon icon="back" size={16} stroke={2.8} style={{ transform: "rotate(90deg)" }} />
                      {waiting} new {waiting === 1 ? "stash" : "stashes"}
                    </button>
                  </div>
                )}
              </div>
              <div className="zk-home-list">{body}</div>
            </section>

            {ended && ended.length > 0 && (
              <section aria-labelledby="zk-ended-title" style={{ marginTop: "var(--zk-space-32)" }}>
                <SectionHead id="zk-ended-title" title="Recently zecked" />
                <div className="zk-ended-list">
                  {ended.map((s) => (
                    <EndedRow key={s.id} stash={s} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <TabBar active="home" />
    </main>
  );
}
