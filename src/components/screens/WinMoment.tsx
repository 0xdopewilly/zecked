"use client";
// Screen 07 · Win moment. Full-screen overlay over the app column: sunburst, open vault, confetti,
// "YOU ZECKED IT!", ZEC/USD count-up, unlocked badges, the tier XP bar filling, and the CTA:
// signed-in winners see "Added to your ZECKED wallet"; guests are asked to sign up to keep it.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { BadgeId, WinPayload } from "@/lib/types";
import { ZAT } from "@/lib/types";
import { Badge, Button, Confetti, CountUp, Emblem, Icon, Vault } from "@/components/zk";
import { BADGE_META } from "@/components/zk/Badge";
import { TIER_LABEL } from "@/components/zk/Emblem";

export interface WinMomentProps {
  win: WinPayload;
  /** @deprecated Kept so older callers still compile. The CTAs now link to /wallet or /signin directly. */
  onClaim?: () => void;
}

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

export function WinMoment({ win }: WinMomentProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [filled, setFilled] = useState(false);
  // Only ever mounted on the client (after a win), so reading window up front is safe.
  const [reduced] = useState(() => {
    try {
      return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  });
  const [compact] = useState(() => typeof window !== "undefined" && window.innerHeight < 760);
  const run = 1;

  useEffect(() => {
    const t = setTimeout(() => setFilled(true), 60);
    try {
      navigator.vibrate?.([40, 60, 120]);
    } catch {
      /* no haptics */
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Short screens pull the vault and the content up a little.
  const shift = compact ? -56 : 0;

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
        overflowX: "hidden",
        overflowY: "auto",
        overscrollBehavior: "contain",
        outline: "none",
      }}
    >
      <div style={{ position: "relative", minHeight: "100%", display: "flex", flexDirection: "column" }}>
        {/* Sunburst, ring and vault are centered on the column (design: centre x=195 of 390, y=210). */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "calc(50% - 450px)",
            top: -240 + shift,
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
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "calc(50% - 130px)",
            top: 80 + shift,
            width: 260,
            height: 260,
            borderRadius: "50%",
            border: "3px solid rgb(var(--zk-gold-rgb) / .6)",
            willChange: "transform, opacity",
            animation: reduced ? "none" : "zk-ring var(--zk-dur-ring) var(--zk-ease-out) infinite",
            opacity: reduced ? 0.5 : undefined,
            pointerEvents: "none",
          }}
        />
        <div aria-hidden="true" style={{ position: "absolute", left: "calc(50% - 100px)", top: 110 + shift, width: 200, height: 200 }}>
          <Vault mode="open" size={200} />
        </div>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", overflow: "hidden" }}>
          <Confetti count={70} seed={7} run={run} />
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
            padding: `${338 + shift}px var(--zk-screen-pad) 0`,
          }}
        >
          <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-8)", textAlign: "center" }}>
            <h1
              style={{
                margin: 0,
                font: "var(--zk-type-hero)",
                color: "var(--zk-gold)",
                letterSpacing: "var(--zk-track-tight)",
                textShadow: "var(--zk-text-shadow-gold)",
                animation: reduced ? "none" : "zk-pop var(--zk-dur-pop) var(--zk-ease-spring) both",
                transform: reduced ? "rotate(-3deg)" : undefined,
              }}
            >
              YOU ZECKED IT!
            </h1>
            <div style={{ font: "var(--zk-type-mono-xl)", marginTop: "var(--zk-space-8)", whiteSpace: "nowrap" }}>
              <CountUp to={zec} decimals={4} prefix="+" suffix=" ZEC" run={run} />
            </div>
            <div style={{ font: "var(--zk-type-body-strong)", fontSize: "var(--zk-fs-16)", color: "var(--zk-gold-pale)" }}>
              <CountUp to={win.usd} decimals={2} prefix="~$" run={run} />
            </div>
          </div>

          {win.badgesUnlocked.map((b, i) => (
            <div
              key={b}
              style={{
                ...card,
                marginTop: i === 0 ? "var(--zk-space-12)" : 0,
                padding: "var(--zk-space-14)",
                display: "flex",
                alignItems: "center",
                gap: "var(--zk-space-14)",
                border: "1.5px solid rgb(var(--zk-gold-rgb) / .4)",
              }}
            >
              <Badge badge={b} size={60} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-gold)" }}>BADGE UNLOCKED</div>
                <div style={{ font: "var(--zk-type-h3)", marginTop: "var(--zk-space-2)" }}>{BADGE_META[b]?.name ?? b}</div>
                <div style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-medium)", color: "var(--zk-text-muted)" }}>
                  {WIN_LINE[b] ?? BADGE_META[b]?.desc}
                </div>
              </div>
            </div>
          ))}

          <div style={{ ...card, padding: "var(--zk-space-14) var(--zk-space-16)", marginTop: win.badgesUnlocked.length ? 0 : "var(--zk-space-12)" }}>
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

          {/* Sticky so it stays reachable on short screens; safe-area inset keeps it off the home indicator.
              The fade keeps the pill, ghost button and caption readable over cards scrolling underneath. */}
          <div
            style={{
              marginTop: "auto",
              marginLeft: "calc(-1 * var(--zk-screen-pad))",
              marginRight: "calc(-1 * var(--zk-screen-pad))",
              padding: "var(--zk-space-20) var(--zk-screen-pad) calc(env(safe-area-inset-bottom, 0px) + var(--zk-space-18))",
              position: "sticky",
              bottom: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--zk-space-10)",
              background: "linear-gradient(180deg, transparent, rgb(var(--zk-bg-rgb) / .92) var(--zk-space-24))",
            }}
          >
            {win.credited ? (
              <>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--zk-space-6)",
                    padding: "var(--zk-space-8) var(--zk-space-14)",
                    borderRadius: "var(--zk-radius-pill)",
                    background: "var(--zk-mint-tint)",
                    border: "1px solid rgb(var(--zk-mint-rgb) / .4)",
                    color: "var(--zk-mint)",
                    font: "var(--zk-type-body-strong)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <Icon icon="check" size={16} stroke={3} />
                  Added to your ZECKED wallet
                </span>
                <Button label="View my wallet" icon="wallet" variant="primary" size="lg" href="/wallet" />
                <Button label="Keep playing" variant="ghost" size="md" href="/feed" />
              </>
            ) : (
              <>
                {/* md type size: the long label must fit a 360px phone on the big lg button. */}
                <Button
                  label="Sign up to keep your ZEC"
                  iconRight="arrowRight"
                  variant="primary"
                  size="lg"
                  href={signUpHref}
                  style={{ font: "var(--zk-type-btn-md)" }}
                />
                <span style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-medium)", color: "var(--zk-text-muted)", textAlign: "center" }}>
                  Guests can play. Winners sign up to keep it.
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WinMoment;
