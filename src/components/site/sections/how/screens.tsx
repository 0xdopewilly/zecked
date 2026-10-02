"use client";
// The four mini app screens shown inside the HowItWorks phone, drawn on the app's true 390×844 canvas.
// Each takes `t` (0 → 1), the local progress of its step, and scrubs its own little story from it.
// With t pinned at 1 (reduced motion) every screen shows its final state.
import { AnimatePresence, motion, useTransform, type MotionValue } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Badge, Button, Chip, Confetti, CountUp, Emblem, Icon, Input, LiveBadge, Toast, Vault } from "@/components/zk";
import { useMotionState } from "./hooks";
import { HIDE_USD, PlaneGlyph, POP, RIDDLE, SHARE_LINK, ShareTile, StatusBar, WIN_ZEC, XGlyph } from "./bits";

export type ScreenProps = { t: MotionValue<number>; active: boolean; run: number; detached?: boolean };

const ANSWER = "a map";

function Screen({ bg, children }: { bg: string; children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: bg,
        color: "var(--zk-text)",
        fontFamily: "var(--zk-font-body)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}

const pad: CSSProperties = { padding: "0 18px" };
const label: CSSProperties = { font: "var(--zk-type-small)", color: "var(--zk-text-muted)", margin: "0 0 6px" };
const roundBtn: CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 14,
  background: "rgb(255 255 255 / .06)",
  border: "1px solid var(--zk-border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--zk-text)",
  flex: "none",
};

/* ------------------------------------------------------------------ 1 · Hide it */

export function HideScreen({ t }: ScreenProps) {
  const n = useTransform(t, [0.04, 0.5], [0, RIDDLE.length]);
  const typed = useTransform(n, (v) => RIDDLE.slice(0, Math.round(v)));
  const counter = useTransform(n, (v) => `${Math.round(v)} / 200`);
  const phOpacity = useTransform(n, [0, 1], [1, 0]);
  const caretOpacity = useTransform(t, [0.5, 0.51], [1, 0]);
  const ansN = useTransform(t, [0.52, 0.6], [0, ANSWER.length]);
  const ansTxt = useTransform(ansN, (v) => "•".repeat(Math.round(v)));
  const ansPh = useTransform(ansN, [0, 0.6], [1, 0]);
  const seg2 = useTransform(t, [0.04, 0.5], [0, 1]);
  const seg3 = useTransform(t, [0.52, 0.66], [0, 1]);
  const seg4 = useTransform(t, [0.7, 0.88], [0, 1]);
  const typedDone = useMotionState(t, (v) => v >= 0.5);
  const picked = useMotionState(t, (v) => v >= 0.64);
  const ready = useMotionState(t, (v) => v >= 0.7);
  const pressed = useMotionState(t, (v) => v >= 0.84 && v < 0.9);
  const hidden = useMotionState(t, (v) => v >= 0.88);

  return (
    <Screen bg="var(--zk-bg-hero-purple)">
      <StatusBar />
      <div style={{ ...pad, marginTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={roundBtn}>
          <Icon icon="close" size={20} stroke={2.4} />
        </div>
        <span style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-pink)" }}>HIDE A STASH</span>
        <div style={{ width: 44 }} />
      </div>
      <div style={{ ...pad, marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {[null, seg2, seg3, seg4].map((s, i) => (
          <div key={i} style={{ height: 6, borderRadius: 3, background: "rgb(255 255 255 / .1)", overflow: "hidden" }}>
            <motion.div style={{ height: "100%", background: "var(--zk-gold)", borderRadius: 3, transformOrigin: "0 50%", scaleX: s ?? 1 }} />
          </div>
        ))}
      </div>
      <div style={{ ...pad, marginTop: 18, font: "var(--zk-type-h1)", letterSpacing: "var(--zk-track-tight)" }}>Make it tricky.</div>

      <div style={{ ...pad, marginTop: 14 }}>
        <div style={label}>Your riddle</div>
        <div
          style={{
            position: "relative",
            height: 132,
            borderRadius: 20,
            background: "var(--zk-surface)",
            border: "2px solid var(--zk-purple)",
            boxShadow: "var(--zk-ring-focus)",
            padding: "14px 16px",
            font: "800 19px/1.3 var(--zk-font-display)",
          }}
        >
          <motion.span style={{ position: "absolute", left: 16, top: 14, right: 16, color: "var(--zk-text-faint)", opacity: phOpacity }}>
            Write something only the sharp ones get…
          </motion.span>
          <motion.span>{typed}</motion.span>
          <motion.span className="zkh-caret" style={{ opacity: caretOpacity }} />
        </div>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
          <motion.span>{counter}</motion.span>
          <motion.span
            animate={{ opacity: typedDone ? 1 : 0, scale: typedDone ? 1 : 0.6 }}
            transition={POP}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--zk-gold)", font: "var(--zk-type-btn-sm)" }}
          >
            <Icon icon="flame" size={14} stroke={2.6} /> Tricky
          </motion.span>
        </div>
      </div>

      <div style={{ ...pad, marginTop: 12 }}>
        <div style={label}>The answer</div>
        <div
          style={{
            position: "relative",
            height: 54,
            borderRadius: 18,
            background: "var(--zk-surface)",
            border: "1.5px solid var(--zk-border-strong)",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            font: "700 20px/1 var(--zk-font-body)",
            letterSpacing: ".14em",
          }}
        >
          <motion.span style={{ position: "absolute", left: 16, color: "var(--zk-text-faint)", font: "600 16px/1 var(--zk-font-body)", letterSpacing: 0, opacity: ansPh }}>
            Only you know this
          </motion.span>
          <motion.span>{ansTxt}</motion.span>
          <span style={{ marginLeft: "auto", color: "var(--zk-text-muted)" }}>
            <Icon icon="eyeOff" size={20} stroke={2.2} />
          </span>
        </div>
      </div>

      <div style={{ ...pad, marginTop: 16 }}>
        <div style={label}>How much is inside?</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 70 }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={picked ? "on" : "off"}
              initial={{ scale: 0.4, rotate: -10, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: picked ? 1 : 0.3 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={POP}
              style={{ font: "800 64px/1 var(--zk-font-display)", color: "var(--zk-gold)", textShadow: picked ? "var(--zk-text-shadow-gold)" : "none", transformOrigin: "0% 60%" }}
            >
              {picked ? `$${HIDE_USD}` : "$0"}
            </motion.div>
          </AnimatePresence>
          <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", textAlign: "right" }}>
            paid in ZEC
            <br />
            comes back if uncracked
          </span>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <Chip label="$5" />
          <motion.div animate={{ scale: picked ? [1, 1.18, 1] : 1 }} transition={{ duration: 0.45 }}>
            <Chip label={`$${HIDE_USD}`} active={picked} />
          </motion.div>
          <Chip label="$20" />
          <Chip label="Custom" />
        </div>
      </div>

      <div style={{ flex: 1 }} />
      <motion.div
        animate={{ y: hidden ? 0 : 40, opacity: hidden ? 1 : 0, scale: hidden ? 1 : 0.9 }}
        transition={POP}
        style={{ position: "absolute", left: 18, right: 18, bottom: 112 }}
      >
        <Toast variant="gold" icon="vault" text="Stash hidden. Now go share it." />
      </motion.div>
      <div style={{ ...pad, paddingBottom: 34, position: "relative" }}>
        {ready && !hidden && <span className="zkh-pulse" aria-hidden />}
        <Button label="Hide it" icon="lock" state={pressed ? "pressed" : undefined} />
      </div>
    </Screen>
  );
}

/* ------------------------------------------------------------------ 2 · Share it */

export function ShareScreen({ t, detached }: ScreenProps) {
  const cy = useTransform(t, [0, 0.3], [260, 0]);
  const cr = useTransform(t, [0, 0.3], [-14, -2]);
  const cs = useTransform(t, [0, 0.3], [0.8, 1]);
  // When the site shows the flying copy of this card (desktop), the in-screen card hands off to it at t≈0.3.
  const co = useTransform(t, detached ? [0, 0.1, 0.29, 0.31] : [0, 0.1], detached ? [0, 1, 1, 0] : [0, 1]);
  const xPop = useMotionState(t, (v) => v >= 0.44);
  const tgPop = useMotionState(t, (v) => v >= 0.6);
  const xPressed = useMotionState(t, (v) => v >= 0.38 && v < 0.44);
  const tgPressed = useMotionState(t, (v) => v >= 0.54 && v < 0.6);
  const copied = useMotionState(t, (v) => v >= 0.76);

  return (
    <Screen bg="var(--zk-bg-welcome)">
      <div
        aria-hidden
        className="zkh-spin"
        style={{
          position: "absolute",
          left: -255,
          top: -170,
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: "var(--zk-sunburst-gold)",
        }}
      />
      <StatusBar />
      <div style={{ ...pad, marginTop: 20, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", position: "relative" }}>
        <LiveBadge label="Live · prize verified" />
        <div style={{ marginTop: 14, font: "var(--zk-type-hero)", letterSpacing: "var(--zk-track-tight)" }}>
          Your stash is <span style={{ color: "var(--zk-gold)", textShadow: "var(--zk-text-shadow-gold)" }}>LIVE</span>
        </div>
        <div style={{ marginTop: 10, font: "var(--zk-type-body)", fontSize: 15, color: "var(--zk-text-muted)", maxWidth: 300 }}>
          Now go stir up trouble. Share it where your people hang out.
        </div>
      </div>
      {/* Card centred on the canvas (its centre sits at the phone's centre, so the flying copy lines up). */}
      <div style={{ position: "absolute", left: 18, top: 290, font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-badge)", color: "var(--zk-text-muted)" }}>
        SHARE CARD PREVIEW
      </div>
      {detached && (
        <div aria-hidden style={{ position: "absolute", left: 18, top: 322, width: 354, height: 199, borderRadius: 22, border: "2px dashed rgb(255 255 255 / .14)" }} />
      )}
      <motion.div style={{ position: "absolute", left: 18, top: 322, y: cy, rotate: cr, scale: cs, opacity: co }}>
        <ShareTile xPop={xPop} tgPop={tgPop} />
      </motion.div>

      <div style={{ flex: 1 }} />
      <div style={{ ...pad, paddingBottom: 34, display: "flex", flexDirection: "column", gap: 10, position: "relative" }}>
        <Button variant="light" size="md" state={xPressed ? "pressed" : undefined}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <XGlyph size={18} /> Share on X
          </span>
        </Button>
        <Button variant="sky" size="md" state={tgPressed ? "pressed" : undefined}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <PlaneGlyph size={20} /> Share on Telegram
          </span>
        </Button>
        <div
          style={{
            height: 52,
            borderRadius: 16,
            border: "1.5px solid var(--zk-border-strong)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 10px 0 16px",
            font: "500 14px/1 var(--zk-font-mono)",
          }}
        >
          <span>{SHARE_LINK}</span>
          <motion.span
            animate={{ scale: copied ? [1, 1.2, 1] : 1 }}
            transition={{ duration: 0.4 }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 12,
              background: copied ? "var(--zk-mint)" : "var(--zk-purple)",
              color: copied ? "var(--zk-mint-ink)" : "#fff",
              font: "var(--zk-type-btn-sm)",
              transition: "background .2s, color .2s",
            }}
          >
            <Icon icon={copied ? "check" : "copy"} size={14} stroke={2.8} />
            {copied ? "Copied!" : "Copy"}
          </motion.span>
        </div>
      </div>
    </Screen>
  );
}

/* ------------------------------------------------------------------ 3 · Crack it */

const G1 = "a globe";
const G2 = ANSWER;

/** 0 idle · 1 typing a wrong guess · 2 wrong · 3 clearing · 4 typing the answer · 5 cracked */
function crackPhase(v: number) {
  return v < 0.06 ? 0 : v < 0.28 ? 1 : v < 0.52 ? 2 : v < 0.58 ? 3 : v < 0.76 ? 4 : 5;
}
function crackText(v: number) {
  const ph = crackPhase(v);
  if (ph === 1) return G1.slice(0, Math.ceil(Math.min(1, (v - 0.06) / 0.18) * G1.length));
  if (ph === 2) return G1;
  if (ph === 4) return G2.slice(0, Math.ceil(Math.min(1, (v - 0.58) / 0.14) * G2.length));
  if (ph === 5) return G2;
  return "";
}

export function CrackScreen({ t }: ScreenProps) {
  const phase = useMotionState(t, crackPhase);
  const text = useMotionState(t, crackText);
  const pressed = useMotionState(t, (v) => (v >= 0.25 && v < 0.28) || (v >= 0.73 && v < 0.76));
  const [shake, setShake] = useState(0);
  const prev = useRef(phase);
  useEffect(() => {
    if (phase === 2 && prev.current < 2) setShake((s) => s + 1);
    prev.current = phase;
  }, [phase]);

  const wrong = phase === 2;
  const cracked = phase === 5;
  const triesLeft = phase >= 2 ? 2 : 3;

  return (
    <Screen bg="var(--zk-bg-hero-purple)">
      <motion.div aria-hidden animate={{ opacity: wrong ? 1 : 0 }} transition={{ duration: 0.3 }} style={{ position: "absolute", inset: 0, background: "var(--zk-bg-hero-red)" }} />
      <motion.div aria-hidden animate={{ opacity: cracked ? 1 : 0 }} transition={{ duration: 0.4 }} style={{ position: "absolute", inset: 0, background: "var(--zk-bg-hero-mint)" }} />
      <StatusBar />
      <div style={{ ...pad, marginTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
        <div style={roundBtn}>
          <Icon icon="back" size={20} stroke={2.4} />
        </div>
        <span style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-pink)" }}>RIDDLE STASH</span>
        <div style={roundBtn}>
          <Icon icon="share" size={18} stroke={2.4} />
        </div>
      </div>
      <div style={{ ...pad, marginTop: 14, display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        <Emblem tier="safecracker" size={42} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--zk-type-body-strong)", fontSize: 15 }}>@satoshisghost</div>
          <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-gold)" }}>Safecracker</div>
        </div>
        <div style={{ font: "var(--zk-type-mono-lg)", color: "var(--zk-gold)" }}>{WIN_ZEC} ZEC</div>
      </div>
      <div
        style={{
          margin: "14px 18px 0",
          padding: 18,
          borderRadius: 24,
          background: "rgb(var(--zk-surface-rgb) / .8)",
          border: "1px solid rgb(var(--zk-purple-rgb) / .35)",
          position: "relative",
        }}
      >
        <LiveBadge label="Live · prize verified" />
        <div style={{ marginTop: 12, font: "var(--zk-type-riddle)", fontSize: 28 }}>{RIDDLE}</div>
        <div style={{ marginTop: 12, display: "flex", gap: 16, font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon icon="key" size={14} stroke={2.4} /> 3 tries / 10 min
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon icon="eyeOff" size={14} stroke={2.4} /> Guesses stay private
          </span>
        </div>
      </div>

      <div style={{ height: 88, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <AnimatePresence mode="popLayout">
          {wrong && (
            <motion.div
              key="nope"
              initial={{ scale: 0.3, rotate: -14, opacity: 0 }}
              animate={{ scale: 1, rotate: -3, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.15 } }}
              transition={POP}
              style={{ textAlign: "center" }}
            >
              <div style={{ font: "800 50px/1 var(--zk-font-display)", color: "var(--zk-red)", textShadow: "var(--zk-text-shadow-red)" }}>Nope!</div>
              <div style={{ marginTop: 6, font: "var(--zk-type-body-strong)" }}>Bold guess. Wrong, but bold.</div>
            </motion.div>
          )}
          {cracked && (
            <motion.div
              key="yes"
              initial={{ scale: 0.3, rotate: 12, opacity: 0 }}
              animate={{ scale: 1, rotate: 2, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={POP}
              style={{ textAlign: "center" }}
            >
              <div style={{ font: "800 50px/1 var(--zk-font-display)", color: "var(--zk-mint)", textShadow: "0 4px 0 var(--zk-mint-deep)" }}>Cracked!</div>
              <div style={{ marginTop: 6, font: "var(--zk-type-body-strong)" }}>First right answer wins.</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ ...pad, position: "relative" }}>
        <Input
          value={text}
          placeholder="Type your answer…"
          ariaLabel="Answer"
          state={wrong ? "error" : cracked ? "success" : phase === 1 || phase === 4 ? "focus" : "default"}
          shake={shake}
        />
        <div style={{ marginTop: 12 }}>
          <Button
            label={cracked ? "ZECKED!" : wrong ? "TRY AGAIN" : "ZECK IT"}
            icon={cracked ? "check" : undefined}
            iconRight={cracked ? undefined : "unlock"}
            variant={cracked ? "success" : "primary"}
            state={pressed ? "pressed" : undefined}
          />
        </div>
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              animate={{ scale: i < triesLeft ? 1 : 0.75, opacity: i < triesLeft ? 1 : 0.35 }}
              transition={POP}
              style={{ width: 11, height: 11, borderRadius: "50%", background: i < triesLeft ? "var(--zk-gold)" : "var(--zk-red-deep)" }}
            />
          ))}
          <span style={{ marginLeft: 4 }}>{triesLeft} tries left (resets in 10 min)</span>
        </div>
      </div>
    </Screen>
  );
}

/* ------------------------------------------------------------------ 4 · Get Zecked */

export function WinScreen({ active, run }: ScreenProps) {
  return (
    <Screen bg="var(--zk-bg-win)">
      <div
        aria-hidden
        className="zkh-spin"
        style={{
          position: "absolute",
          left: -255,
          top: -274,
          width: 900,
          height: 900,
          borderRadius: "50%",
          background: "repeating-conic-gradient(rgb(var(--zk-gold-rgb) / .16) 0 9deg, transparent 9deg 22deg)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 65,
          top: 46,
          width: 260,
          height: 260,
          borderRadius: "50%",
          border: "3px solid rgb(var(--zk-gold-rgb) / .6)",
          animation: "zk-ring var(--zk-dur-ring) var(--zk-ease-out) infinite",
        }}
      />
      <motion.div
        key={`v${run}`}
        initial={{ scale: 0.35, rotate: -40, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 240, damping: 13 }}
        style={{ position: "absolute", left: 95, top: 76 }}
      >
        <Vault mode="open" size={200} />
      </motion.div>
      {active && <Confetti count={80} seed={11} run={run} />}
      <StatusBar />

      <div style={{ position: "relative", zIndex: 6, padding: "286px 18px 0", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <motion.div
          key={`t${run}`}
          initial={{ scale: 0.2, rotate: -16, opacity: 0 }}
          animate={{ scale: 1, rotate: -3, opacity: 1 }}
          transition={{ type: "spring", stiffness: 380, damping: 12, delay: 0.18 }}
          style={{ font: "800 54px/0.92 var(--zk-font-display)", color: "var(--zk-gold)", letterSpacing: "-0.02em", textShadow: "var(--zk-text-shadow-gold)" }}
        >
          <span style={{ display: "block", whiteSpace: "nowrap" }}>YOU ZECKED</span>
          <span style={{ display: "block" }}>IT!</span>
        </motion.div>
        <div style={{ marginTop: 18, font: "var(--zk-type-mono-xl)", whiteSpace: "nowrap" }}>
          <CountUp to={WIN_ZEC} decimals={4} prefix="+" suffix=" ZEC" run={run} />
        </div>
        <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, font: "var(--zk-type-body-strong)", color: "var(--zk-mint)" }}>
          <Icon icon="shieldCheck" size={16} stroke={2.6} /> Straight to your private wallet
        </div>
      </div>

      <div style={{ position: "relative", zIndex: 6, margin: "18px 18px 0" }}>
        <motion.div
          key={`b${run}`}
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 20, delay: 0.55 }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: 14,
            borderRadius: 22,
            background: "rgb(var(--zk-surface-rgb) / .85)",
            border: "1.5px solid rgb(var(--zk-gold-rgb) / .4)",
          }}
        >
          <div style={{ position: "relative", width: 60, height: 60, flex: "none", perspective: 400 }}>
            <motion.div
              key={`l${run}`}
              initial={{ opacity: 1, scale: 1 }}
              animate={{ opacity: 0, scale: 0.5, rotate: -25 }}
              transition={{ delay: 1.05, duration: 0.22 }}
              style={{ position: "absolute", inset: 0 }}
            >
              <Badge badge="first-crack" size={60} locked />
            </motion.div>
            <motion.div
              key={`u${run}`}
              initial={{ opacity: 0, scale: 0.3, rotateY: 180 }}
              animate={{ opacity: 1, scale: 1, rotateY: 0 }}
              transition={{ delay: 1.15, type: "spring", stiffness: 260, damping: 12 }}
              style={{ position: "absolute", inset: 0 }}
            >
              <Badge badge="first-crack" size={60} />
            </motion.div>
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <div style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-gold)" }}>BADGE UNLOCKED</div>
            <div style={{ font: "var(--zk-type-h3)", marginTop: 2 }}>First Crack</div>
            <div style={{ font: "var(--zk-type-caption)", fontWeight: 500, color: "var(--zk-text-muted)" }}>Your first stash. Many more to come.</div>
          </div>
        </motion.div>
        <motion.div
          key={`p${run}`}
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 20, delay: 0.75 }}
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 20,
            background: "rgb(var(--zk-surface-rgb) / .85)",
            border: "1px solid rgb(var(--zk-mint-rgb) / .35)",
          }}
        >
          <div style={{ width: 38, height: 38, borderRadius: 12, background: "var(--zk-mint-tint)", color: "var(--zk-mint)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
            <Icon icon="mask" size={20} stroke={2.4} />
          </div>
          <div style={{ textAlign: "left", font: "var(--zk-type-small)" }}>
            <div style={{ fontWeight: 800 }}>Shielded. Nobody sees who won.</div>
            <div style={{ color: "var(--zk-text-muted)", fontWeight: 500 }}>The hider just sees “a mystery cracker”.</div>
          </div>
        </motion.div>
      </div>

      <div style={{ position: "absolute", left: 18, right: 18, bottom: 34, zIndex: 6 }}>
        <Button label="Claim my ZEC" iconRight="arrowRight" />
      </div>
    </Screen>
  );
}

export const SCREENS = [HideScreen, ShareScreen, CrackScreen, WinScreen] as const;
