"use client";
// Screens 03 (riddle stash) and 04 (wrong answer), plus the extra states the design review asked for:
// too late (zecked by someone else), you zecked it, uncrackable (expired / refunded), not funded yet,
// out of tries, and the hider's own view of a live stash. Every ended state reveals the answer.
import { sfx } from "@/lib/sfx";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, formatUsd, formatZec } from "@/lib/api";
import { useAppBack } from "@/lib/nav";
import type { PublicStash, WinPayload } from "@/lib/types";
import { Button, Countdown, Emblem, Icon, Input, LiveBadge, Toast } from "@/components/zk";
import { TIER_LABEL } from "@/components/zk/Emblem";
import { TopToast, VICTORY_EVENT, VictoryNote, WIN_CLOSED_EVENT, friendlyError, noteWinKind, shareLink, winShareText } from "@/components/screens/WinMoment";

const MAX_TRIES = 3;
const POLL_MS = 20_000;
/** setTimeout fires immediately for delays above 2^31 − 1 ms. */
const MAX_TIMEOUT = 2_147_483_000;

export interface RiddleStashData {
  stash: PublicStash;
  myTries?: { left: number; resetsAt?: string };
  /** Present when the viewer won this stash earlier and hasn't claimed yet. */
  win?: WinPayload;
}

export interface RiddleStashProps {
  data: RiddleStashData;
  /** Called with the win payload when the viewer cracks the riddle. */
  onWin: (win: WinPayload) => void;
}

type Mode = "play" | "mine" | "zecked" | "won" | "expired" | "unfunded";

interface WrongGuess {
  /** The raw input value that was submitted (the input shows it struck through). */
  raw: string;
  /** The guess as quoted in the privacy toast (leading a/an/the dropped). */
  shown: string;
  verdict: string;
}

/* ---------- small helpers ---------- */

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** "5h 12m", "2d 4h", "12m", "40s". */
function formatLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** "just now", "4m ago", "3h ago", "2d ago". */
function formatAgo(iso: string | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "4m 12s", "38s", "1h 5m". */
function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* ---------- styles ---------- */

const navBtn: CSSProperties = {
  width: "var(--zk-tap-min)",
  height: "var(--zk-tap-min)",
  borderRadius: "var(--zk-radius-lg)",
  background: "var(--zk-surface)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  padding: 0,
  color: "var(--zk-text)",
  cursor: "pointer",
  flex: "none",
};

const riddleText: CSSProperties = {
  margin: 0,
  font: "var(--zk-type-riddle)",
  letterSpacing: "-.01em",
  textWrap: "pretty",
  overflowWrap: "anywhere",
};

const metaItem: CSSProperties = { display: "flex", alignItems: "center", gap: "var(--zk-space-4)" };

const dot = (on: boolean): CSSProperties => ({
  width: 12,
  height: 12,
  borderRadius: "50%",
  flex: "none",
  background: on ? "var(--zk-gold)" : "rgb(var(--zk-red-rgb) / .35)",
});

/** Entrances for the answer reveal, a freshly unlocked hint and the locked panel. Instant under reduced motion. */
const CSS = `
@keyframes zk-rs-in { from { opacity: 0; transform: translateY(10px) scale(.97) } to { opacity: 1; transform: none } }
@keyframes zk-rs-reveal { 0% { opacity: 0; transform: scale(.7); filter: blur(10px) } 60% { opacity: 1; transform: scale(1.06); filter: blur(0) } 100% { transform: none } }
@keyframes zk-rs-glint { 0%, 100% { box-shadow: 0 0 0 0 rgb(var(--zk-gold-rgb) / 0) } 40% { box-shadow: 0 0 0 6px rgb(var(--zk-gold-rgb) / .28) } }
`;

/* ---------- component ---------- */

export function RiddleStash({ data, onWin }: RiddleStashProps) {
  const goBack = useAppBack("/feed");
  const [stash, setStash] = useState<PublicStash>(data.stash);
  const [triesLeft, setTriesLeft] = useState(data.myTries?.left ?? MAX_TRIES);
  const [resetsAt, setResetsAt] = useState<string | undefined>(data.myTries?.resetsAt);
  const [myWin, setMyWin] = useState<WinPayload | undefined>(data.win);
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState<WrongGuess | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [solved, setSolved] = useState(false);
  const [tip, setTip] = useState(false);
  const [hintNew, setHintNew] = useState(false);
  const [toast, setToast] = useState<{ text: string; variant: "success" | "error" | "default"; icon?: string; n: number } | null>(null);

  const busyRef = useRef(false);
  const inputWrap = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const endedRef = useRef<HTMLDivElement>(null);
  const hadHint = useRef(!!data.stash.riddle?.hint);

  const now = useNow(15_000);
  const id = stash.id;
  const r = stash.riddle;

  // A fresh payload from the route (e.g. a new id) replaces local state.
  useEffect(() => {
    setStash(data.stash);
    setTriesLeft(data.myTries?.left ?? MAX_TRIES);
    setResetsAt(data.myTries?.resetsAt);
    setMyWin(data.win);
  }, [data]);

  const showToast = useCallback((text: string, variant: "success" | "error" | "default" = "success", icon?: string) => {
    clearTimeout(toastTimer.current);
    setToast((t) => ({ text, variant, icon, n: (t?.n ?? 0) + 1 }));
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const refresh = useCallback(async () => {
    try {
      const d = await api.stash(id);
      setStash(d.stash);
      if (d.win) setMyWin(d.win);
      if (d.myTries && !busyRef.current) {
        setTriesLeft(d.myTries.left);
        setResetsAt(d.myTries.resetsAt);
      }
    } catch {
      /* keep what we have */
    }
  }, [id]);

  // Keep "N cracking now", tries and status fresh while the stash is open.
  const pollable = stash.status === "live" || stash.status === "awaiting_funding";
  useEffect(() => {
    if (!pollable) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [pollable, refresh]);

  // Fetch the hint text the moment it unlocks.
  const hintAt = r?.hasHint && !r.hint ? r.hintUnlocksAt : undefined;
  useEffect(() => {
    if (!hintAt) return;
    const ms = Date.parse(hintAt) - Date.now() + 800;
    if (!Number.isFinite(ms) || ms > MAX_TIMEOUT) return;
    const t = setTimeout(() => void refresh(), Math.max(0, ms));
    return () => clearTimeout(t);
  }, [hintAt, refresh]);

  // Tries come back 10 minutes after the first miss. Coming out of the locked state gets a chime.
  const triesRef = useRef(triesLeft);
  useEffect(() => {
    triesRef.current = triesLeft;
  }, [triesLeft]);
  useEffect(() => {
    if (!resetsAt) return;
    const ms = Date.parse(resetsAt) - Date.now() + 500;
    if (!Number.isFinite(ms) || ms > MAX_TIMEOUT) return;
    const t = setTimeout(() => {
      const wasLocked = triesRef.current <= 0;
      setTriesLeft(MAX_TRIES);
      setResetsAt(undefined);
      if (wasLocked) {
        setWrong(null);
        setAnswer("");
        showToast(`${MAX_TRIES} fresh tries. Go get it.`, "success", "key");
      }
      void refresh();
    }, Math.max(0, ms));
    return () => clearTimeout(t);
  }, [resetsAt, refresh, showToast]);

  // The bonus hint just unlocked while you're on it: chime (the toast's), a gold glint on the card.
  const hintText = r?.hint;
  useEffect(() => {
    if (hintText && !hadHint.current && !stash.isMine && stash.status === "live") {
      showToast("Bonus hint unlocked 💡", "default", "bulb");
      setHintNew(true);
    }
    hadHint.current = !!hintText;
  }, [hintText, stash.isMine, stash.status, showToast]);

  // A note saved in the win overlay lands on this screen too.
  useEffect(() => {
    const onVictory = (e: Event) => {
      const d = (e as CustomEvent<{ stashId: string; message: string }>).detail;
      if (d?.stashId !== id) return;
      setStash((s) => (s.result ? { ...s, result: { ...s.result, victoryMessage: d.message || undefined } } : s));
    };
    // Closing the win overlay hands focus to the zecked stash behind it.
    const onClosed = (e: Event) => {
      if ((e as CustomEvent<{ stashId: string }>).detail?.stashId !== id) return;
      requestAnimationFrame(() => endedRef.current?.focus({ preventScroll: true }));
    };
    window.addEventListener(VICTORY_EVENT, onVictory);
    window.addEventListener(WIN_CLOSED_EVENT, onClosed);
    return () => {
      window.removeEventListener(VICTORY_EVENT, onVictory);
      window.removeEventListener(WIN_CLOSED_EVENT, onClosed);
    };
  }, [id]);

  // Tooltip closes on outside tap or Escape.
  useEffect(() => {
    if (!tip) return;
    const onDown = (e: PointerEvent) => {
      if (!tipRef.current?.contains(e.target as Node)) setTip(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTip(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tip]);

  /* ---------- derived ---------- */

  const expiresMs = Date.parse(stash.expiresAt);
  const timedOut = stash.status === "live" && Number.isFinite(expiresMs) && expiresMs <= now;
  const mode: Mode =
    stash.status === "zecked"
      ? stash.result?.winnerIsYou || myWin
        ? "won"
        : "zecked"
      : stash.status === "expired" || stash.status === "refunded" || stash.status === "void" || timedOut
        ? "expired"
        : stash.status === "awaiting_funding"
          ? "unfunded"
          : stash.isMine
            ? "mine"
            : "play";

  const zec = formatZec(stash.amountZat);
  // The size the hider picked: "$5", not "$5.00".
  const usd = Number.isInteger(stash.usd) ? `$${stash.usd}` : formatUsd(stash.usd);
  const outOfTries = triesLeft <= 0;
  const strike = !!wrong && answer === wrong.raw;
  const timeLeft = Number.isFinite(expiresMs) ? formatLeft(expiresMs - now) : "";
  const tries = r?.tries ?? 0;
  // Other people on it right now (the server never counts you, or the hider).
  const cracking = r?.crackingNow ?? 0;
  // A signed-in win is already in the wallet; only a guest's unsettled win still needs a sign-up.
  const needsSignup = !!myWin && !myWin.credited;

  // Time ran out while open: ask the server to settle it (that also brings the answer).
  useEffect(() => {
    if (timedOut) void refresh();
  }, [timedOut, refresh]);

  /* ---------- actions ---------- */

  const focusInput = () => {
    requestAnimationFrame(() => inputWrap.current?.querySelector<HTMLInputElement>("input")?.focus());
  };

  const share = async () => {
    const url = `${window.location.origin}/s/${id}`;
    const text =
      mode === "won"
        ? winShareText(stash.amountZat, "riddle")
        : mode === "play" || mode === "mine"
          ? `Crack ${stash.isMine ? "my" : "this"} riddle and zeck ${zec} ZEC 🔐 First one wins.`
          : `A ${zec} ZEC riddle on ZECKED 🔐 Can you crack the next one?`;
    const res = await shareLink(url, text);
    if (res === "copied") showToast("Link copied", "success", "copy");
    else if (res === "failed") showToast(url, "default", "copy");
  };

  const tryAgain = () => {
    setAnswer("");
    setWrong(null);
    focusInput();
  };

  const submit = async () => {
    const v = answer.trim();
    if (mode !== "play" || busyRef.current || solved || outOfTries) return;
    if (!v) {
      focusInput();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await api.guess(id, v);
      if (res.alreadyZecked) {
        // Someone else got there first. Show the "too late" state.
        showToast(res.verdict || "Too late. Someone already zecked it.", "error", "lock");
        setWrong(null);
        await refresh();
        return;
      }
      setTriesLeft(res.triesLeft);
      setResetsAt(res.resetsAt);
      // Count your own guess in "N tries" right away (the poll catches up with everyone else's).
      setStash((s) => (s.riddle ? { ...s, riddle: { ...s.riddle, tries: s.riddle.tries + 1 } } : s));
      if (res.correct) {
        setSolved(true);
        setWrong(null);
        if (res.win) {
          setMyWin(res.win);
          noteWinKind(id, "riddle");
          onWin(res.win);
        }
        // Settle the screen behind the win overlay into the zecked state (with the answer).
        void refresh();
        return;
      }
      setWrong({ raw: answer, shown: v.replace(/^(a|an|the)\s+/i, "").trim() || v, verdict: res.verdict || "Nope! Try again 😏" });
      setShake((n) => n + 1);
      // The last try locks you out: a heavier sound for the locked state.
      sfx(res.triesLeft <= 0 ? "error" : "wrong");
    } catch (e) {
      showToast(friendlyError(e), "error");
      void refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const primary = () => {
    if (strike) tryAgain();
    else void submit();
  };

  /* ---------- pieces ---------- */

  const lockedOut = mode === "play" && outOfTries && !solved;
  const wrongLayout = mode === "play" && !!wrong && !lockedOut;
  const bg = wrongLayout || lockedOut ? "var(--zk-bg-hero-red)" : mode === "won" ? "var(--zk-bg-hero-gold)" : "var(--zk-bg-hero-purple)";

  const nav = (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <button type="button" aria-label="Back" onClick={goBack} style={navBtn}>
        <Icon icon="back" size={22} stroke={2.4} />
      </button>
      <span style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-pink)" }}>RIDDLE STASH</span>
      <button type="button" aria-label="Share" onClick={() => void share()} style={navBtn}>
        <Icon icon="share" size={20} stroke={2.2} />
      </button>
    </nav>
  );

  const hiderRow = (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
      <Emblem tier={stash.hider.tier} size={42} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            font: "var(--zk-type-body-strong)",
            fontSize: "var(--zk-fs-15)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {stash.hider.handle}
        </div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-gold)" }}>
          {TIER_LABEL[stash.hider.tier] ?? "Rookie"} · {plural(stash.hider.stashesHidden, "stash", "stashes")} hidden
        </div>
      </div>
      <div style={{ textAlign: "right", flex: "none" }}>
        {/* A touch smaller on 320px phones, so the hider's name and tier keep room. */}
        <div style={{ font: "var(--zk-type-mono-lg)", fontSize: "min(var(--zk-fs-22), 5.6vw)", color: "var(--zk-gold)", whiteSpace: "nowrap" }}>{zec} ZEC</div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>~{usd}</div>
      </div>
    </div>
  );

  const metaRow = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        columnGap: "var(--zk-space-14)",
        rowGap: "var(--zk-space-6)",
        font: "var(--zk-type-caption)",
        color: "var(--zk-text-muted)",
      }}
    >
      <span style={metaItem}>
        <Icon icon="key" size={14} />
        {plural(tries, "try", "tries")}
      </span>
      <span style={metaItem}>
        <Icon icon="eye" size={14} />
        {cracking > 0 ? `${plural(cracking, "other", "others")} cracking now` : "Just you right now"}
      </span>
      <span style={metaItem}>
        <Icon icon="hourglass" size={14} />
        {timeLeft}
      </span>
    </div>
  );

  // 03: the live riddle card with the "Prize verified" badge and its ⓘ explainer.
  const liveCard = (withMeta: boolean) => (
    <section
      aria-label="Riddle"
      style={{
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-3xl)",
        padding: "var(--zk-space-20)",
        border: "1.5px solid rgb(var(--zk-purple-rgb) / .35)",
        boxShadow: "var(--zk-glow-purple)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-14)",
      }}
    >
      <div ref={tipRef} style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-2)", position: "relative" }}>
        <LiveBadge label="Live · Prize verified" />
        {/* A 44px tap target around the small ⓘ; the negative margin keeps the row as tall as the badge. */}
        <button
          type="button"
          aria-label="What does Prize verified mean?"
          aria-expanded={tip}
          aria-controls={`zk-tip-${id}`}
          onClick={() => setTip((t) => !t)}
          data-sfx="tap"
          style={{
            width: "var(--zk-tap-min)",
            height: "var(--zk-tap-min)",
            margin: "-11px 0",
            background: "transparent",
            color: tip ? "var(--zk-text)" : "var(--zk-text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            padding: 0,
            cursor: "pointer",
            flex: "none",
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: tip ? "var(--zk-purple)" : "var(--zk-surface-raised)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon="info" size={16} />
          </span>
        </button>
        {tip && (
          <div
            id={`zk-tip-${id}`}
            role="tooltip"
            style={{
              position: "absolute",
              left: "clamp(0px, calc(100% - 248px), 96px)",
              top: 30,
              width: "min(248px, 100%)",
              padding: "var(--zk-space-12) var(--zk-space-14)",
              borderRadius: "var(--zk-radius-lg)",
              background: "var(--zk-text)",
              color: "var(--zk-surface)",
              font: "var(--zk-type-small)",
              boxShadow: "var(--zk-shadow-float)",
              zIndex: 5,
              animation: "zk-rs-in 160ms var(--zk-ease-out) both",
            }}
          >
            <div
              style={{
                font: "var(--zk-fw-black) var(--zk-fs-12)/1.3 var(--zk-font-body)",
                color: "var(--zk-purple)",
                marginBottom: "var(--zk-space-4)",
              }}
            >
              Prize verified
            </div>
            Anyone can check the ZEC is really in there, using the stash’s viewing key. It can look, but it can’t touch.
          </div>
        )}
      </div>
      <h2 style={riddleText}>{r?.text}</h2>
      {withMeta && metaRow}
    </section>
  );

  // Zecked / expired / not funded: the card dimmed, with an ended badge (and the ZECKED stamp once zecked).
  const endedCard = (badge: string, stamp: boolean) => (
    <section
      aria-label="Riddle"
      style={{
        position: "relative",
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-3xl)",
        padding: "var(--zk-space-20)",
        border: "1.5px solid var(--zk-border)",
      }}
    >
      <div style={{ opacity: 0.45, display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
        <div>
          <LiveBadge state="ended" label={badge} />
        </div>
        <h2 style={riddleText}>{r?.text}</h2>
      </div>
      {stamp && (
        <div
          aria-hidden="true"
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
          <Icon icon="unlock" size={20} stroke={2.6} />
          ZECKED
        </div>
      )}
    </section>
  );

  // Every ended riddle shows its answer (the server only sends it once the stash is over).
  const answerReveal = r?.answer ? (
    <section
      aria-label="The answer"
      style={{
        background: "var(--zk-surface)",
        border: "1.5px solid rgb(var(--zk-gold-rgb) / .45)",
        borderRadius: "var(--zk-radius-2xl)",
        padding: "var(--zk-space-14) var(--zk-space-16)",
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-14)",
        animation: "zk-rs-in 380ms var(--zk-ease-out) both, zk-rs-glint 1.2s var(--zk-ease-out) 700ms both",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "var(--zk-radius-lg)",
          background: "var(--zk-grad-tile-gold)",
          boxShadow: "0 3px 0 var(--zk-gold-deep)",
          color: "var(--zk-gold-ink)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <Icon icon="key" size={22} stroke={2.4} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-gold)" }}>THE ANSWER WAS</div>
        <div
          style={{
            font: "var(--zk-type-h2)",
            color: "var(--zk-text)",
            marginTop: "var(--zk-space-4)",
            overflowWrap: "anywhere",
            transformOrigin: "left center",
            animation: "zk-rs-reveal 700ms var(--zk-ease-out) 250ms both",
          }}
        >
          {r.answer}
        </div>
      </div>
    </section>
  ) : null;

  const triesRow = (withVerdict: boolean) => {
    const verdict = withVerdict && solved ? "Cracked! The vault is open." : "";
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--zk-space-8)",
          minHeight: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", minWidth: 0 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} aria-hidden="true" style={dot(i < triesLeft)} />
          ))}
          <span style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginLeft: "var(--zk-space-4)" }}>
            {resetsAt && triesLeft < MAX_TRIES ? (
              <>
                {plural(triesLeft, "try", "tries")} left · resets in <Countdown to={resetsAt} format="ms" size="sm" tone="gold" />
              </>
            ) : (
              // Nothing used yet: the rule, not a timer.
              <>{MAX_TRIES} tries every 10 minutes</>
            )}
          </span>
        </div>
        {verdict && (
          <span role="status" style={{ font: "var(--zk-type-small)", fontWeight: "var(--zk-fw-bold)", color: "var(--zk-mint)", flex: "none" }}>
            {verdict}
          </span>
        )}
      </div>
    );
  };

  const hintRow = r?.hasHint ? (
    r.hint ? (
      <div
        style={{
          background: "var(--zk-surface)",
          border: "1.5px solid rgb(var(--zk-gold-rgb) / .35)",
          borderRadius: "var(--zk-radius-xl)",
          padding: "var(--zk-space-14) var(--zk-space-16)",
          display: "flex",
          alignItems: "center",
          gap: "var(--zk-space-12)",
          animation: hintNew ? "zk-rs-in 380ms var(--zk-ease-spring) both, zk-rs-glint 1.2s var(--zk-ease-out) 300ms 2 both" : undefined,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--zk-radius-md)",
            background: "var(--zk-gold-tint)",
            color: "var(--zk-gold)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <Icon icon="bulb" size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--zk-type-body-strong)" }}>Bonus hint</div>
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text)", overflowWrap: "anywhere" }}>{r.hint}</div>
        </div>
        <span style={{ color: "var(--zk-gold)", flex: "none" }}>
          <Icon icon="unlock" size={18} />
        </span>
      </div>
    ) : (
      <div
        style={{
          background: "var(--zk-surface)",
          border: "1.5px dashed rgb(var(--zk-white-rgb) / .2)",
          borderRadius: "var(--zk-radius-xl)",
          padding: "var(--zk-space-14) var(--zk-space-16)",
          display: "flex",
          alignItems: "center",
          gap: "var(--zk-space-12)",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--zk-radius-md)",
            background: "var(--zk-surface-raised)",
            color: "var(--zk-text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: "none",
          }}
        >
          <Icon icon="bulb" size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--zk-type-body-strong)" }}>Bonus hint</div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-4)", font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
            {r.hintUnlocksAt ? (
              <>
                Hint unlocks in{" "}
                <Countdown
                  to={r.hintUnlocksAt}
                  format={Date.parse(r.hintUnlocksAt) - now > 3600_000 ? "hms" : "ms"}
                  size="sm"
                  tone="gold"
                />
              </>
            ) : (
              "Hint unlocks soon"
            )}
          </div>
        </div>
        <span style={{ color: "var(--zk-text-muted)", flex: "none" }}>
          <Icon icon="lock" size={18} />
        </span>
      </div>
    )
  ) : null;

  const shareGhost = <Button label="Share this stash" icon="share" variant="ghost" size="md" onClick={() => void share()} />;

  const privacyNote = wrong ? (
    <Toast variant="default" icon="eyeOff" sound={false} text={`Wrong guesses are private. Only you know you said “${wrong.shown}”.`} />
  ) : null;

  const answerBox = (
    <>
      <div ref={inputWrap}>
        <Input
          value={answer}
          onChange={(v) => setAnswer(v)}
          onEnter={primary}
          placeholder="Type your answer…"
          ariaLabel="Your answer"
          state={strike ? "error" : solved ? "success" : outOfTries ? "disabled" : "default"}
          strike={strike}
          shake={shake}
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <Button
        label={strike ? "TRY AGAIN" : "ZECK IT"}
        iconRight={strike ? undefined : "unlock"}
        variant="primary"
        size="lg"
        disabled={busy || outOfTries || solved}
        onClick={primary}
      />
    </>
  );

  // Out of tries: a clear locked state with the countdown to fresh tries.
  const lockedPanel = (
    <div
      role="status"
      style={{
        background: "var(--zk-surface)",
        border: "1.5px solid rgb(var(--zk-red-rgb) / .5)",
        borderRadius: "var(--zk-radius-2xl)",
        padding: "var(--zk-space-16)",
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-14)",
        animation: "zk-rs-in 320ms var(--zk-ease-spring) both",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: "var(--zk-radius-lg)",
          background: "var(--zk-red-tint)",
          border: "1.5px solid rgb(var(--zk-red-rgb) / .4)",
          color: "var(--zk-red)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <Icon icon="lock" size={26} stroke={2.4} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--zk-space-4)" }}>
        <div style={{ font: "var(--zk-type-h3)" }}>Out of tries</div>
        <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
          {resetsAt ? (
            <>
              {MAX_TRIES} fresh tries in <Countdown to={resetsAt} format="ms" size="sm" tone="gold" />. Keep thinking.
            </>
          ) : (
            "Fresh tries in a few minutes. Keep thinking."
          )}
        </div>
        <div style={{ display: "flex", gap: "var(--zk-space-6)", marginTop: "var(--zk-space-2)" }} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} style={dot(false)} />
          ))}
        </div>
      </div>
    </div>
  );

  const endedButton = (label: string, href: string, variant: "primary" | "ghost" = "primary", icon?: string) => (
    <Button label={label} icon={icon} iconRight={variant === "primary" && !icon ? "arrowRight" : undefined} variant={variant} size="lg" href={href} />
  );

  const bottom = (children: ReactNode) => (
    <div style={{ marginTop: "auto", paddingTop: "var(--zk-space-8)", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>{children}</div>
  );

  const victoryQuote = stash.result?.victoryMessage ? (
    <figure
      style={{
        margin: 0,
        background: "var(--zk-surface)",
        border: "1px solid var(--zk-border)",
        borderRadius: "var(--zk-radius-xl)",
        padding: "var(--zk-space-14) var(--zk-space-16)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-6)",
      }}
    >
      <figcaption style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-gold)" }}>
        {stash.isMine ? "THE WINNER SAYS" : "VICTORY MESSAGE"}
      </figcaption>
      <blockquote style={{ margin: 0, font: "var(--zk-type-body-lg)", fontWeight: "var(--zk-fw-semibold)", overflowWrap: "anywhere" }}>
        “{stash.result.victoryMessage}”
      </blockquote>
    </figure>
  ) : null;

  const crackStats = [
    tries ? plural(tries, "try", "tries") : "",
    stash.result?.crackSeconds ? `cracked in ${formatDuration(stash.result.crackSeconds)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const statusBlock = (title: ReactNode, sub?: ReactNode, color = "var(--zk-text)") => (
    <div
      ref={endedRef}
      tabIndex={-1}
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--zk-space-6)",
        padding: "var(--zk-space-10) 0 var(--zk-space-4)",
        textAlign: "center",
        outline: "none",
      }}
    >
      <div style={{ font: "var(--zk-type-h2)", color, textWrap: "balance" }}>{title}</div>
      {sub && <div style={{ font: "var(--zk-type-body)", fontSize: "var(--zk-fs-15)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>{sub}</div>}
    </div>
  );

  /* ---------- body per mode ---------- */

  let body: ReactNode;
  if (lockedOut) {
    // Out of tries: the riddle stays up (keep thinking), the hint and Share stay in reach.
    body = (
      <>
        {liveCard(true)}
        {lockedPanel}
        {hintRow}
        {privacyNote}
        {bottom(shareGhost)}
      </>
    );
  } else if (wrongLayout && wrong) {
    // 04: wrong answer. The hint (it helps most right now) and Share stay on screen.
    body = (
      <>
        <div style={{ background: "var(--zk-surface)", borderRadius: "var(--zk-radius-3xl)", padding: "var(--zk-space-20)", opacity: 0.75 }}>
          <h2 style={riddleText}>{r?.text}</h2>
        </div>
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--zk-space-6)",
            padding: "var(--zk-space-10) 0 var(--zk-space-4)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              font: "var(--zk-fw-black) var(--zk-fs-40)/1 var(--zk-font-display)",
              color: "var(--zk-red)",
              transform: "rotate(-3deg)",
              textShadow: "var(--zk-text-shadow-red)",
            }}
          >
            Nope!
          </div>
          <div style={{ font: "var(--zk-type-btn-md)" }}>{plural(triesLeft, "try", "tries")} left</div>
          <div style={{ font: "var(--zk-type-body)", fontSize: "var(--zk-fs-15)", color: "var(--zk-text-muted)" }}>{wrong.verdict}</div>
        </div>
        {answerBox}
        {triesRow(false)}
        {hintRow}
        {bottom(
          <>
            {privacyNote}
            {shareGhost}
          </>,
        )}
      </>
    );
  } else if (mode === "play") {
    // 03: live riddle.
    body = (
      <>
        {liveCard(true)}
        {answerBox}
        {triesRow(true)}
        {hintRow}
        {shareGhost}
      </>
    );
  } else if (mode === "mine") {
    const stats = [
      { v: String(tries), l: "tries so far", icon: "key" },
      // Nobody else on it right now: leave the tile out rather than show a sad "0".
      ...(cracking > 0 ? [{ v: String(cracking), l: "cracking now", icon: "eye" }] : []),
      { v: timeLeft, l: "time left", icon: "hourglass" },
    ];
    body = (
      <>
        {liveCard(false)}
        <section
          aria-label="Your stash"
          style={{
            background: "var(--zk-surface)",
            borderRadius: "var(--zk-radius-2xl)",
            padding: "var(--zk-space-16)",
            border: "2px solid rgb(var(--zk-gold-rgb) / .45)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--zk-space-12)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "var(--zk-radius-lg)",
                background: "var(--zk-grad-tile-gold)",
                boxShadow: "0 3px 0 var(--zk-gold-deep)",
                color: "var(--zk-gold-ink)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <Icon icon="vault" size={22} stroke={2.4} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "var(--zk-type-h4)", fontSize: "var(--zk-fs-18)" }}>This is your stash</div>
              <div style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-medium)", color: "var(--zk-text-muted)" }}>
                {cracking > 0 ? "People are on it. First one to crack it wins." : "Share it. First one to crack it wins."}
              </div>
            </div>
          </div>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`, gap: "var(--zk-space-8)" }}>
            {stats.map((s) => (
              <div
                key={s.l}
                style={{
                  background: "var(--zk-surface-raised)",
                  borderRadius: "var(--zk-radius-lg)",
                  padding: "var(--zk-space-10) var(--zk-space-8)",
                  display: "flex",
                  flexDirection: "column-reverse",
                  alignItems: "center",
                  gap: "var(--zk-space-4)",
                  textAlign: "center",
                }}
              >
                <dt style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", display: "flex", alignItems: "center", gap: "var(--zk-space-4)" }}>
                  <Icon icon={s.icon} size={12} />
                  {s.l}
                </dt>
                <dd style={{ margin: 0, font: "var(--zk-type-mono)", color: "var(--zk-gold)", whiteSpace: "nowrap" }}>{s.v}</dd>
              </div>
            ))}
          </dl>
        </section>
        {hintRow}
        <Button label="Share this stash" icon="share" variant="primary" size="lg" onClick={() => void share()} />
      </>
    );
  } else if (mode === "zecked") {
    const ago = formatAgo(stash.result?.zeckedAt, now);
    body = (
      <>
        {endedCard("Ended", true)}
        {statusBlock(
          stash.isMine ? (
            <>Your riddle got zecked{ago ? ` ${ago}` : ""}</>
          ) : (
            <>
              Zecked {ago ? `${ago} ` : ""}by {stash.result?.winnerLabel || "a mystery cracker"}
            </>
          ),
          crackStats || undefined,
          "var(--zk-pink)",
        )}
        {answerReveal}
        {victoryQuote}
        {bottom(stash.isMine ? endedButton("Hide another stash", "/hide") : endedButton("Find another stash", "/feed"))}
      </>
    );
  } else if (mode === "won") {
    const ago = formatAgo(stash.result?.zeckedAt, now);
    body = (
      <>
        {endedCard("Ended", true)}
        {statusBlock("You zecked this!", [ago ? `Zecked ${ago}` : "", crackStats].filter(Boolean).join(" · ") || undefined, "var(--zk-gold)")}
        {answerReveal}
        <VictoryNote id={id} initial={stash.result?.victoryMessage ?? ""} />
        {bottom(
          <>
            <Button label="Share my win" icon="share" variant="secondary" size="md" onClick={() => void share()} />
            {needsSignup
              ? endedButton("Sign up to keep my ZEC", `/signin?next=${encodeURIComponent(`/s/${id}`)}&reason=win`)
              : endedButton("It’s in your wallet", "/wallet", "primary", "wallet")}
          </>,
        )}
      </>
    );
  } else if (mode === "expired") {
    body = (
      <>
        {endedCard("Ended", false)}
        {statusBlock(
          "Uncrackable. Respect.",
          stash.isMine ? "Nobody cracked it. The ZEC went back to you." : "Nobody cracked it. The ZEC went back to the hider.",
          "var(--zk-purple-light)",
        )}
        {answerReveal}
        {r?.hint && hintRow}
        {bottom(stash.isMine ? endedButton("Hide another stash", "/hide") : endedButton("Find another stash", "/feed"))}
      </>
    );
  } else {
    // unfunded
    body = (
      <>
        {r?.text ? endedCard("Not live yet", false) : null}
        <div
          role="status"
          style={{
            background: "var(--zk-surface)",
            border: "1.5px dashed rgb(var(--zk-white-rgb) / .2)",
            borderRadius: "var(--zk-radius-xl)",
            padding: "var(--zk-space-14) var(--zk-space-16)",
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-12)",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "var(--zk-radius-md)",
              background: "var(--zk-surface-raised)",
              color: "var(--zk-gold)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
            }}
          >
            <Icon icon="hourglass" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0, font: "var(--zk-type-body-strong)" }}>
            This stash isn’t live yet. The hider still needs to fund it.
          </div>
        </div>
        {bottom(stash.isMine ? endedButton("Fund it", `/hide?resume=${encodeURIComponent(id)}`) : endedButton("Find another stash", "/feed", "ghost"))}
      </>
    );
  }

  return (
    <main className="zk-screen" style={{ background: bg, gap: "var(--zk-space-14)" }}>
      <style>{CSS}</style>
      {nav}
      {hiderRow}
      {body}
      {/* Toasts drop in from the top, clear of the buttons at the bottom. */}
      {toast && <TopToast key={toast.n} text={toast.text} variant={toast.variant} icon={toast.icon} />}
    </main>
  );
}

export default RiddleStash;
