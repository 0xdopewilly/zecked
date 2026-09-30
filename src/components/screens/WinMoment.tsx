"use client";
// Screen 07 · Win moment. Full-screen overlay over the app column: sunburst, open vault, confetti,
// "YOU ZECKED IT!", ZEC/USD count-up, unlocked badges, the tier XP bar filling, a note for the hider,
// Share, and the CTA: signed-in winners see "Added to your ZECKED wallet"; guests are asked to sign up
// to keep it. ✕ (or Escape) closes it and reveals the zecked stash behind.
// Also home to the win bits the stash and claim screens reuse: the share line, share-or-copy, and the
// victory note input.
import { sfx } from "@/lib/sfx";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api, formatZec } from "@/lib/api";
import type { BadgeId, StashType, WinPayload } from "@/lib/types";
import { ZAT } from "@/lib/types";
import { Badge, Button, Confetti, CountUp, Emblem, Icon, Input, Toast, Vault } from "@/components/zk";
import { BADGE_META } from "@/components/zk/Badge";
import { TIER_LABEL } from "@/components/zk/Emblem";

export interface WinMomentProps {
  win: WinPayload;
  /** Picks the share line ("crack the next one" / "call the next one"). */
  kind?: StashType;
  /** Called after ✕ / Escape closes the overlay (it hides itself either way). */
  onClose?: () => void;
  /** @deprecated Kept so older callers still compile. The CTAs now link to /wallet or /signin directly. */
  onClaim?: () => void;
}

/** Fired on window when the overlay closes, so the screen behind can take focus. detail: { stashId }. */
export const WIN_CLOSED_EVENT = "zk:win-closed";
/** Fired on window when a victory note is saved. detail: { stashId, message }. */
export const VICTORY_EVENT = "zk:victory";

/* ---------- shared win helpers ---------- */

/** Stash type per won stash, noted by the stash screen just before the overlay opens (for callers that don't pass `kind`). */
const winKinds = new Map<string, StashType>();
export function noteWinKind(stashId: string, kind: StashType) {
  winKinds.set(stashId, kind);
}

export const VICTORY_MAX = 80;

/** First-person share line. Winners stay anonymous: no handle, ever. */
export function winShareText(amountZat: number, kind?: StashType): string {
  const next = kind === "prediction" ? "Can you call the next one?" : kind === "riddle" ? "Can you crack the next one?" : "Can you zeck the next one?";
  return `I just zecked ${formatZec(amountZat)} ZEC on ZECKED 🔓 ${next}`;
}

function copyFallback(text: string): boolean {
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

/** The share sheet where there is one; otherwise the link goes on the clipboard. */
export async function shareLink(url: string, text: string): Promise<"shared" | "cancelled" | "copied" | "failed"> {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "ZECKED", text, url });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return copyFallback(url) ? "copied" : "failed";
  }
}

/** Friendly copy for a failed request (never a raw "Failed to fetch"). */
export function friendlyError(e: unknown, fallback = "Something went wrong. Try again."): string {
  const msg = e instanceof Error ? e.message : "";
  if (e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return "Can’t reach ZECKED. Check your connection.";
  }
  return msg || fallback;
}

/** A toast pinned to the top of the app column (never over the bottom buttons). */
export function TopToast({ text, variant = "success", icon, zIndex = 60 }: { text: string; variant?: "success" | "error" | "default" | "gold"; icon?: string; zIndex?: number }) {
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        top: "calc(var(--zk-fixed-top) + var(--zk-space-10))",
        zIndex,
        display: "flex",
        justifyContent: "center",
        padding: "0 var(--zk-screen-pad)",
        pointerEvents: "none",
      }}
    >
      <style>{"@keyframes zk-toast-drop { from { opacity: 0; transform: translateY(-12px) } to { opacity: 1; transform: none } }"}</style>
      <div style={{ width: "100%", maxWidth: "calc(430px - 2 * var(--zk-screen-pad))", animation: "zk-toast-drop 220ms var(--zk-ease-out) both" }}>
        <Toast text={text} variant={variant} icon={icon} />
      </div>
    </div>
  );
}

/* ---------- victory note ---------- */

const NOTE_HELP = "Shown on the stash card. Your handle stays hidden.";

/** "Leave a note for the hider": the winner's victory message, saved with api.victory. */
export function VictoryNote({ id, initial = "" }: { id: string; initial?: string }) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [shake, setShake] = useState(0);

  const clean = draft.trim().slice(0, VICTORY_MAX);
  const dirty = clean !== saved;

  // A note saved somewhere else (the win overlay) shows up here, unless you're mid-edit.
  if (initial !== seen) {
    setSeen(initial);
    setSaved(initial);
    if (!dirty) setDraft(initial);
  }

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError("");
    try {
      await api.victory(id, clean);
      setSaved(clean);
      setDraft(clean);
      setJustSaved(true);
      sfx("success");
      window.dispatchEvent(new CustomEvent(VICTORY_EVENT, { detail: { stashId: id, message: clean } }));
    } catch (e) {
      setError(friendlyError(e, "Couldn’t save that. Try again."));
      setShake((n) => n + 1);
      sfx("error");
    } finally {
      setSaving(false);
    }
  };

  const count = draft.length >= VICTORY_MAX - 20 ? ` ${draft.length}/${VICTORY_MAX}` : "";
  const message = error
    ? error
    : justSaved && !dirty
      ? clean
        ? "Saved. The hider sees it on the stash card."
        : "Removed from the stash card."
      : NOTE_HELP + count;

  return (
    <Input
      label="Leave a note for the hider"
      value={draft}
      onChange={(v) => {
        setDraft(v.slice(0, VICTORY_MAX));
        setJustSaved(false);
        if (error) setError("");
      }}
      onEnter={() => void save()}
      placeholder="Say something to the hider…"
      size="md"
      maxLength={VICTORY_MAX}
      state={error ? "error" : justSaved && !dirty && clean ? "success" : "default"}
      message={message}
      shake={shake}
      trailing={
        <Button
          label={saving ? "Saving…" : !dirty && saved ? "Saved" : "Save"}
          icon={!dirty && saved && !saving ? "check" : undefined}
          variant="secondary"
          size="sm"
          full={false}
          disabled={!dirty || saving}
          onClick={() => void save()}
          style={{ height: "var(--zk-tap-min)" }}
        />
      }
    />
  );
}

/* ---------- overlay ---------- */

/** Celebratory lines for the "Badge unlocked" card (falls back to the badge's unlock rule). */
const WIN_LINE: Partial<Record<BadgeId, string>> = {
  "first-crack": "Your first stash. Many more to come.",
  "speed-demon": "Cracked in under 60 seconds.",
  oracle: "3 exact scores called.",
};

const card: CSSProperties = {
  background: "var(--zk-scrim)",
  borderRadius: "var(--zk-radius-2xl)",
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Vault size and position for the screen. The open door swings out ~0.57× the vault's width to the
 *  left, so the vault sits right of centre by half of that and door + vault stay on screen. */
function stage(w: number, h: number) {
  const size = h < 640 ? 150 : w < 360 ? 170 : 200;
  const top = h < 640 ? 40 : h < 760 ? 54 : 104;
  return { size, top, dx: Math.round(size * 0.285), content: top + size + 26 };
}

/** Staggered entrance (badges, XP, note) under the count-up. Instant under reduced motion. */
const rise = (reduced: boolean, delayMs: number): CSSProperties =>
  reduced ? {} : { animation: `zk-win-rise 420ms var(--zk-ease-spring) ${delayMs}ms both` };

const CSS = `
@keyframes zk-win-rise { from { opacity: 0; transform: translateY(14px) scale(.96) } to { opacity: 1; transform: none } }
@keyframes zk-win-vault { 0% { transform: scale(.55) rotate(-14deg); opacity: 0 } 55% { transform: scale(1.08) rotate(3deg); opacity: 1 } 100% { transform: none } }
@keyframes zk-win-nudge { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(4px) } }
`;

export function WinMoment({ win, kind, onClose }: WinMomentProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(true);
  const [filled, setFilled] = useState(false);
  const [more, setMore] = useState(false);
  const [toast, setToast] = useState<{ text: string; variant: "success" | "default"; icon?: string; n: number } | null>(null);
  // Only ever mounted on the client (after a win), so reading window up front is safe.
  const [reduced] = useState(() => {
    try {
      return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  const [st] = useState(() => (typeof window === "undefined" ? stage(390, 844) : stage(Math.min(430, window.innerWidth), window.innerHeight)));
  const run = 1;

  // Kept in refs so an inline onClose from the page never re-runs the focus/inert effect below.
  const onCloseRef = useRef(onClose);
  const openRef = useRef(true);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    window.dispatchEvent(new CustomEvent(WIN_CLOSED_EVENT, { detail: { stashId: win.stashId } }));
    onCloseRef.current?.();
  }, [win.stashId]);

  // Celebration timeline: fanfare now, a coin as the ZEC count-up lands, a chime as the badges pop
  // (skipped if the overlay was already closed).
  useEffect(() => {
    const t = setTimeout(() => setFilled(true), 60);
    sfx("win");
    const later = (name: "coin" | "select", ms: number) => setTimeout(() => openRef.current && sfx(name), ms);
    const coin = later("coin", reduced ? 450 : 1850);
    const chime = win.badgesUnlocked.length ? later("select", reduced ? 800 : 2250) : undefined;
    return () => {
      clearTimeout(t);
      clearTimeout(coin);
      clearTimeout(chime);
      clearTimeout(toastTimer.current);
    };
    // Once per win.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While open: no page scroll behind, focus inside, Tab stays inside, Escape closes, the screen behind is inert.
  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root?.focus({ preventScroll: true });
    const behind = root?.parentElement
      ? Array.from(root.parentElement.children).filter((el): el is HTMLElement => el !== root && el instanceof HTMLElement && el.tagName === "MAIN" && !el.inert)
      : [];
    behind.forEach((el) => (el.inert = true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      if (!items.length) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      behind.forEach((el) => (el.inert = false));
    };
  }, [open, close]);

  // Scroll hint: a nudge above the buttons while there's more below them.
  useEffect(() => {
    const el = scrollRef.current;
    if (!open || !el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 16);
    check();
    const t = setTimeout(check, 700);
    el.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      clearTimeout(t);
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [open]);

  const showToast = (text: string, variant: "success" | "default" = "success", icon?: string) => {
    clearTimeout(toastTimer.current);
    setToast((t) => ({ text, variant, icon, n: (t?.n ?? 0) + 1 }));
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const share = async () => {
    const url = `${window.location.origin}/s/${win.stashId}`;
    const r = await shareLink(url, winShareText(win.amountZat, kind ?? winKinds.get(win.stashId)));
    if (r === "copied") showToast("Link copied", "success", "copy");
    else if (r === "failed") showToast(url, "default", "copy");
  };

  if (!open) return null;

  const zec = win.amountZat / ZAT;
  const p = win.player;
  const newXp = p.xp;
  const oldXp = Math.max(0, newXp - win.xpGained);
  const start = p.xpTierStart;
  const end = p.xpForNext;
  const pct = (x: number) => (end && end > start ? Math.min(100, Math.max(0, ((x - start) / (end - start)) * 100)) : 100);
  const fromPct = pct(oldXp);
  const toPct = pct(newXp);
  const signUpHref = `/signin?next=${encodeURIComponent(`/s/${win.stashId}`)}&reason=win`;
  const badges = win.badgesUnlocked;
  const vaultCx = `calc(50% + ${st.dx}px)`;
  const vaultCy = st.top + st.size / 2;
  const ring = Math.round(st.size * 1.3);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="You zecked it"
      tabIndex={-1}
      style={{
        position: "fixed",
        top: 0,
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: 430,
        zIndex: 80,
        background: "var(--zk-bg-win)",
        color: "var(--zk-text)",
        fontFamily: "var(--zk-font-body)",
        outline: "none",
        containerType: "inline-size",
      }}
    >
      <style>{CSS}</style>
      {/* ✕ sits outside the scroller so it never scrolls away; first in the DOM so Tab reaches it first. */}
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        style={{
          position: "absolute",
          top: "calc(var(--zk-fixed-top) + var(--zk-space-8))",
          right: "var(--zk-space-12)",
          zIndex: 10,
          width: "var(--zk-tap-min)",
          height: "var(--zk-tap-min)",
          borderRadius: "50%",
          border: "1px solid var(--zk-border-strong)",
          background: "rgb(var(--zk-bg-rgb) / .55)",
          color: "var(--zk-text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <Icon icon="close" size={20} stroke={2.6} />
      </button>

      <div ref={scrollRef} style={{ position: "absolute", inset: 0, overflowX: "hidden", overflowY: "auto", overscrollBehavior: "contain" }}>
        <div style={{ position: "relative", minHeight: "100%", display: "flex", flexDirection: "column" }}>
          {/* The decor is clipped to the column, so nothing can scroll the overlay sideways (focusing the note did). */}
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
            {/* Sunburst, ring and vault share one centre: the vault's (a little right of the column's middle, for the door). */}
            <div
              style={{
                position: "absolute",
                left: `calc(${vaultCx} - 450px)`,
                top: vaultCy - 450,
                width: 900,
                height: 900,
                borderRadius: "50%",
                background: "repeating-conic-gradient(rgb(var(--zk-gold-rgb) / .16) 0 9deg, transparent 9deg 22deg)",
                willChange: "transform",
                animation: reduced ? "none" : "zk-spin var(--zk-dur-sunburst) linear infinite",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `calc(${vaultCx} - ${ring / 2}px)`,
                top: vaultCy - ring / 2,
                width: ring,
                height: ring,
                borderRadius: "50%",
                border: "3px solid rgb(var(--zk-gold-rgb) / .6)",
                willChange: "transform, opacity",
                animation: reduced ? "none" : "zk-ring var(--zk-dur-ring) var(--zk-ease-out) infinite",
                opacity: reduced ? 0.5 : undefined,
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `calc(${vaultCx} - ${st.size / 2}px)`,
                top: st.top,
                width: st.size,
                height: st.size,
                animation: reduced ? "none" : "zk-win-vault 650ms var(--zk-ease-spring) both",
              }}
            >
              <Vault mode="open" size={st.size} />
            </div>
            <div style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", overflow: "hidden" }}>
              <Confetti count={70} seed={7} run={run} sound={false} />
            </div>
          </div>

          <div
            style={{
              flex: 1,
              position: "relative",
              zIndex: 6,
              display: "flex",
              flexDirection: "column",
              gap: "var(--zk-space-12)",
              // No bottom padding here: the sticky CTA block below carries the safe-area inset itself.
              padding: `${st.content}px var(--zk-screen-pad) 0`,
            }}
          >
            <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-8)", textAlign: "center" }}>
              <h1
                style={{
                  margin: 0,
                  font: "var(--zk-type-hero)",
                  // One line on phones (it wrapped to two and pushed everything below the fold).
                  fontSize: "min(var(--zk-fs-52), 11.6cqi)",
                  whiteSpace: "nowrap",
                  color: "var(--zk-gold)",
                  letterSpacing: "var(--zk-track-tight)",
                  textShadow: "var(--zk-text-shadow-gold)",
                  animation: reduced ? "none" : "zk-pop var(--zk-dur-pop) var(--zk-ease-spring) both",
                  transform: reduced ? "rotate(-3deg)" : undefined,
                }}
              >
                YOU ZECKED IT!
              </h1>
              <div style={{ font: "var(--zk-type-mono-xl)", marginTop: "var(--zk-space-4)", whiteSpace: "nowrap" }}>
                <CountUp to={zec} decimals={4} prefix="+" suffix=" ZEC" run={run} />
              </div>
              <div style={{ font: "var(--zk-type-body-strong)", fontSize: "var(--zk-fs-16)", color: "var(--zk-gold-pale)" }}>
                <CountUp to={win.usd} decimals={2} prefix="~$" run={run} />
              </div>
              {win.credited && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--zk-space-6)",
                    marginTop: "var(--zk-space-2)",
                    padding: "var(--zk-space-6) var(--zk-space-12)",
                    borderRadius: "var(--zk-radius-pill)",
                    background: "var(--zk-mint-tint)",
                    border: "1px solid rgb(var(--zk-mint-rgb) / .4)",
                    color: "var(--zk-mint)",
                    font: "var(--zk-type-small)",
                    fontWeight: "var(--zk-fw-bold)",
                    whiteSpace: "nowrap",
                    ...rise(reduced, 1700),
                  }}
                >
                  <Icon icon="check" size={14} stroke={3} />
                  Added to your ZECKED wallet
                </span>
              )}
            </div>

            {badges.length === 1 ? (
              <div
                style={{
                  ...card,
                  marginTop: "var(--zk-space-4)",
                  padding: "var(--zk-space-12) var(--zk-space-14)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--zk-space-14)",
                  border: "1.5px solid rgb(var(--zk-gold-rgb) / .4)",
                  ...rise(reduced, 2100),
                }}
              >
                <Badge badge={badges[0]} size={56} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-gold)" }}>BADGE UNLOCKED</div>
                  <div style={{ font: "var(--zk-type-h3)", marginTop: "var(--zk-space-2)" }}>{BADGE_META[badges[0]]?.name ?? badges[0]}</div>
                  <div style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-medium)", color: "var(--zk-text-muted)" }}>
                    {WIN_LINE[badges[0]] ?? BADGE_META[badges[0]]?.desc}
                  </div>
                </div>
              </div>
            ) : badges.length > 1 ? (
              // Two or more: compact chips, so the buttons never sit on top of a badge.
              <section aria-label="Badges unlocked" style={{ marginTop: "var(--zk-space-4)", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
                <div style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-gold)", textAlign: "center", ...rise(reduced, 2000) }}>
                  {badges.length} BADGES UNLOCKED
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--zk-space-8)" }}>
                  {badges.map((b, i) => (
                    <div
                      key={b}
                      style={{
                        ...card,
                        borderRadius: "var(--zk-radius-xl)",
                        padding: "var(--zk-space-8) var(--zk-space-10)",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--zk-space-8)",
                        border: "1.5px solid rgb(var(--zk-gold-rgb) / .4)",
                        ...rise(reduced, 2100 + i * 140),
                      }}
                    >
                      <Badge badge={b} size={40} />
                      <span style={{ font: "var(--zk-type-h4)", fontSize: "var(--zk-fs-15)", minWidth: 0, overflowWrap: "anywhere" }}>{BADGE_META[b]?.name ?? b}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <div style={{ ...card, padding: "var(--zk-space-12) var(--zk-space-16)", ...rise(reduced, 300) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--zk-space-8)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-8)", minWidth: 0 }}>
                  <Emblem tier={p.tier} size={26} />
                  <span style={{ font: "var(--zk-type-h4)", whiteSpace: "nowrap" }}>{TIER_LABEL[p.tier]}</span>
                </div>
                <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-mint)", whiteSpace: "nowrap" }}>+{win.xpGained} XP</span>
              </div>
              <div
                role="progressbar"
                aria-label="XP"
                aria-valuemin={start}
                aria-valuenow={newXp}
                aria-valuemax={end ?? newXp}
                style={{
                  marginTop: "var(--zk-space-10)",
                  height: 14,
                  borderRadius: "var(--zk-radius-pill)",
                  background: "var(--zk-bg)",
                  overflow: "hidden",
                  boxShadow: "inset 0 2px 0 rgb(var(--zk-black-rgb) / .4)",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${filled ? toPct : fromPct}%`,
                    borderRadius: "var(--zk-radius-pill)",
                    background: "var(--zk-grad-xp)",
                    boxShadow: "inset 0 -3px 0 rgb(var(--zk-black-rgb) / .18)",
                    transition: filled ? "width var(--zk-dur-countup) cubic-bezier(.33,1,.68,1)" : "none",
                  }}
                />
              </div>
              {/* Design review fix: this line must never wrap. */}
              <div
                style={{
                  marginTop: "var(--zk-space-6)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "var(--zk-space-12)",
                  font: "var(--zk-fw-semibold) var(--zk-fs-11)/1 var(--zk-font-body)",
                  color: "var(--zk-text-muted)",
                }}
              >
                <span style={{ whiteSpace: "nowrap", flex: "none" }}>
                  <CountUp from={oldXp} to={newXp} grouping run={run} />
                  {end ? ` / ${end.toLocaleString("en-US")} XP` : " XP"}
                </span>
                {p.nextTier && (
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
                    Next: {TIER_LABEL[p.nextTier]}
                  </span>
                )}
              </div>
            </div>

            <div style={{ ...card, padding: "var(--zk-space-12) var(--zk-space-14) var(--zk-space-10)", ...rise(reduced, 450) }}>
              <VictoryNote id={win.stashId} />
            </div>

            {/* Sticky so it stays reachable on short screens; safe-area inset keeps it off the home indicator.
                The backdrop turns solid before the first button, so nothing scrolling underneath shows through. */}
            <div
              style={{
                marginTop: "auto",
                marginLeft: "calc(-1 * var(--zk-screen-pad))",
                marginRight: "calc(-1 * var(--zk-screen-pad))",
                padding: "var(--zk-space-20) var(--zk-screen-pad) calc(env(safe-area-inset-bottom, 0px) + var(--zk-space-16))",
                position: "sticky",
                bottom: 0,
                zIndex: 2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--zk-space-10)",
                background: "linear-gradient(180deg, rgb(var(--zk-bg-rgb) / 0), rgb(var(--zk-bg-rgb)) var(--zk-space-18))",
              }}
            >
              {more && (
                <button
                  type="button"
                  aria-label="Scroll for more"
                  data-sfx="tap"
                  onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reduced ? "auto" : "smooth" })}
                  style={{
                    position: "absolute",
                    top: -20,
                    left: "50%",
                    marginLeft: -22,
                    width: "var(--zk-tap-min)",
                    height: "var(--zk-tap-min)",
                    border: "none",
                    padding: 0,
                    background: "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "var(--zk-surface-raised)",
                      border: "1px solid var(--zk-border-strong)",
                      color: "var(--zk-gold)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "var(--zk-shadow-float)",
                      animation: reduced ? "none" : "zk-win-nudge 1.4s var(--zk-ease-in-out) infinite",
                    }}
                  >
                    <span style={{ display: "flex", transform: "rotate(180deg)" }}>
                      <Icon icon="arrowUp" size={16} stroke={2.6} />
                    </span>
                  </span>
                </button>
              )}
              {win.credited ? (
                <>
                  <Button label="Share my win" icon="share" variant="primary" size="lg" onClick={() => void share()} />
                  <div style={{ display: "flex", gap: "var(--zk-space-10)", width: "100%" }}>
                    <Button label="My wallet" icon="wallet" variant="ghost" size="md" href="/wallet" style={{ padding: "0 var(--zk-space-12)" }} />
                    <Button label="Keep playing" variant="ghost" size="md" href="/feed" style={{ padding: "0 var(--zk-space-12)" }} />
                  </div>
                </>
              ) : (
                <>
                  {/* md type size: the long label must fit a 320px phone on the big lg button. */}
                  <Button
                    label="Sign up to keep your ZEC"
                    iconRight="arrowRight"
                    variant="primary"
                    size="lg"
                    href={signUpHref}
                    style={{ font: "var(--zk-type-btn-md)" }}
                  />
                  <Button label="Share my win" icon="share" variant="ghost" size="md" onClick={() => void share()} />
                  <span style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-medium)", color: "var(--zk-text-muted)", textAlign: "center" }}>
                    Guests can play. Winners sign up to keep it.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Fixed inside the transformed dialog = pinned to the dialog's top edge. */}
      {toast && <TopToast key={toast.n} text={toast.text} variant={toast.variant} icon={toast.icon} zIndex={20} />}
    </div>
  );
}

export default WinMoment;
