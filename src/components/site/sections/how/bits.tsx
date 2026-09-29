"use client";
// Small visual pieces used inside the HowItWorks phone screens (and the flying share card).
import { AnimatePresence, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { Icon, Logo, TeamBadge } from "@/components/zk";
import { DEMO_BARCELONA } from "@/lib/crest";
import { Sticker } from "@/components/site/fx";

export const RIDDLE = "I have cities, but no houses. Forests, but no trees. Water, but no fish. What am I?";
/** Amounts used by the story. Demo values only. */
export const HIDE_USD = 30;
export const WIN_ZEC = 0.02;
export const SHARE_LINK = "zecked.com/s/k7Q2";

export const POP = { type: "spring", stiffness: 520, damping: 14, mass: 0.7 } as const;

/** Phone status bar (9:41 · signal · 5G · battery), drawn at 390px canvas scale. */
export function StatusBar() {
  return (
    <div
      style={{
        height: 50,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 30px 0 36px",
        font: "700 16px/1 var(--zk-font-body)",
        color: "var(--zk-text)",
        position: "relative",
        zIndex: 8,
      }}
    >
      <span>9:41</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={i * 4.6} y={9 - i * 3} width="3.2" height={3 + i * 3} rx="1" fill="currentColor" />
          ))}
        </svg>
        <span style={{ font: "700 13px/1 var(--zk-font-body)" }}>5G</span>
        <svg width="26" height="13" viewBox="0 0 26 13" aria-hidden>
          <rect x="0.75" y="0.75" width="22" height="11.5" rx="3.5" fill="none" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.5" />
          <rect x="2.75" y="2.75" width="16" height="7.5" rx="2" fill="currentColor" />
          <rect x="24" y="4.25" width="1.6" height="4.5" rx="0.8" fill="currentColor" fillOpacity=".45" />
        </svg>
      </span>
    </div>
  );
}

/** The X mark. */
export function XGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block", flex: "none" }}>
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  );
}

/** A paper plane (Telegram-style). */
export function PlaneGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block", flex: "none" }}>
      <path fill="currentColor" d="M21.6 3.1 2.9 10.3c-1.3.5-1.3 1.2-.2 1.6l4.8 1.5 1.8 5.6c.2.7.4.9.9.9.4 0 .6-.2.9-.5l2.4-2.3 4.9 3.6c.9.5 1.5.2 1.8-.8l3.2-15c.3-1.3-.5-1.9-1.5-1.3zM9.9 14.3l-.5 4.2-1.3-4.4 10-6.3z" />
    </svg>
  );
}

/** Round badge that springs in (with a ring burst) when `on` flips true. */
export function PopBubble({ on, bg, fg, children, style, size = 52 }: { on: boolean; bg: string; fg: string; children: ReactNode; style?: CSSProperties; size?: number }) {
  return (
    <div style={{ position: "absolute", width: size, height: size, ...style }}>
      <AnimatePresence>
        {on && (
          <motion.div
            key="b"
            initial={{ scale: 0, rotate: -50, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            exit={{ scale: 0, rotate: 30, opacity: 0, transition: { duration: 0.2 } }}
            transition={POP}
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: bg,
              color: fg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 5px 0 rgb(0 0 0 / .35), 0 14px 30px rgb(0 0 0 / .4)",
              border: "3px solid var(--zk-bg)",
            }}
          >
            {children}
            <motion.span
              aria-hidden
              initial={{ scale: 0.8, opacity: 0.7 }}
              animate={{ scale: 2.1, opacity: 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              style={{ position: "absolute", inset: -3, borderRadius: "50%", border: `3px solid ${bg}` }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Mini version of the app's riddle share card (354×199 at canvas scale), with X / Telegram pops on its corners. */
export function ShareTile({ xPop, tgPop }: { xPop: boolean; tgPop: boolean }) {
  return (
    <div style={{ position: "relative", width: 354, height: 199 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 22,
          overflow: "hidden",
          background: "var(--zk-bg-share-riddle)",
          border: "1px solid var(--zk-border-strong)",
          boxShadow: "0 26px 60px rgb(0 0 0 / .55), inset 0 1px 0 rgb(255 255 255 / .1)",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: -120,
            top: -150,
            width: 360,
            height: 360,
            borderRadius: "50%",
            background: "repeating-conic-gradient(rgb(var(--zk-gold-rgb) / .14) 0 9deg, transparent 9deg 22deg)",
          }}
        />
        <div style={{ position: "absolute", left: 16, top: 14 }}>
          <Logo variant="wordmark" size={18} />
        </div>
        <div style={{ position: "absolute", left: 16, top: 46, right: 132, font: "800 20px/1.08 var(--zk-font-display)", letterSpacing: "-0.01em" }}>
          Crack my riddle and ZECK <span style={{ color: "var(--zk-gold)" }}>{WIN_ZEC} ZEC</span>
        </div>
        <div style={{ position: "absolute", left: 16, bottom: 14, right: 132, font: "600 11px/1.3 var(--zk-font-body)", color: "var(--zk-text-muted)" }}>
          “I have cities, but no houses. Forests, but no trees…”
        </div>
        <div
          style={{
            position: "absolute",
            right: 20,
            top: 34,
            width: 96,
            height: 96,
            borderRadius: 20,
            transform: "rotate(6deg)",
            background: "linear-gradient(170deg, var(--zk-gold-pale), var(--zk-gold) 60%, var(--zk-gold-amber))",
            boxShadow: "0 7px 0 var(--zk-gold-shadow), 0 18px 30px rgb(var(--zk-gold-rgb) / .35), inset 0 2px 0 rgb(255 255 255 / .5)",
            color: "var(--zk-gold-ink)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <Icon icon="lock" size={30} stroke={2.6} />
          <span style={{ font: "700 13px/1 var(--zk-font-mono)" }}>{WIN_ZEC} ZEC</span>
          <span style={{ font: "700 10px/1 var(--zk-font-body)", opacity: 0.75 }}>inside</span>
        </div>
        <div
          style={{
            position: "absolute",
            right: 14,
            bottom: 12,
            padding: "6px 9px",
            borderRadius: 9,
            background: "#fff",
            color: "#0B0918",
            font: "700 10px/1 var(--zk-font-mono)",
          }}
        >
          {SHARE_LINK}
        </div>
      </div>
      <PopBubble on={xPop} bg="#FFFFFF" fg="#0B0918" style={{ right: -18, top: -22 }}>
        <XGlyph size={22} />
      </PopBubble>
      <PopBubble on={tgPop} bg="var(--zk-sky)" fg="#FFFFFF" style={{ left: -18, bottom: -24 }}>
        <PlaneGlyph size={24} />
      </PopBubble>
    </div>
  );
}

type Tone = "pink" | "sky" | "mint" | "purple" | "gold" | "red" | "light";
const TONE: Record<Tone, { bg: string; fg: string; edge: string }> = {
  pink: { bg: "var(--zk-pink)", fg: "#fff", edge: "var(--zk-pink-deep)" },
  sky: { bg: "var(--zk-sky)", fg: "var(--zk-sky-ink)", edge: "var(--zk-sky-deep)" },
  mint: { bg: "var(--zk-mint)", fg: "var(--zk-mint-ink)", edge: "var(--zk-mint-deep)" },
  purple: { bg: "var(--zk-purple)", fg: "#fff", edge: "var(--zk-purple-deep)" },
  gold: { bg: "var(--zk-gold)", fg: "var(--zk-gold-ink)", edge: "var(--zk-gold-deep)" },
  red: { bg: "var(--zk-red)", fg: "#fff", edge: "var(--zk-red-deep)" },
  light: { bg: "var(--zk-text)", fg: "var(--zk-bg)", edge: "var(--zk-light-edge)" },
};

export type StickerSpec = { tone: Tone; icon: string; label: string; rotate: number; crest?: typeof DEMO_BARCELONA };

/** A brand sticker pill with an icon. */
export function StorySticker({ spec, small = false }: { spec: StickerSpec; small?: boolean }) {
  const t = TONE[spec.tone];
  return (
    <Sticker bg={t.bg} fg={t.fg} edge={t.edge} rotate={spec.rotate} style={small ? { padding: "8px 12px", gap: 6, fontSize: 13 } : undefined}>
      {spec.crest ? <TeamBadge {...spec.crest} size={small ? 18 : 22} /> : <Icon icon={spec.icon} size={small ? 14 : 16} stroke={2.6} />}
      {spec.label}
    </Sticker>
  );
}
