"use client";
// Radial confetti pop from the centre of its (positioned) parent. Bump `fire` to replay.
// Only renders after an interaction, and every burst is seeded, so there is nothing random in render.
import { motion } from "motion/react";
import { useMemo } from "react";
import { seeded } from "./kit";

const COLORS = ["var(--zk-gold)", "var(--zk-pink)", "var(--zk-mint)", "var(--zk-sky)", "var(--zk-purple-light)", "#fff"];

export function Burst({ fire, count = 30, spread = 1 }: { fire: number; count?: number; spread?: number }) {
  const parts = useMemo(() => {
    const r = seeded(97 + fire * 131);
    return Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + (r() - 0.5) * 0.6;
      const d = (100 + r() * 130) * spread;
      const coin = r() > 0.8;
      const w = coin ? 14 : 6 + r() * 7;
      return {
        x: Math.cos(a) * d,
        y: Math.sin(a) * d * 0.7 - 20,
        rot: (r() - 0.5) * 900,
        w,
        h: coin ? 14 : 8 + r() * 10,
        c: coin ? "var(--zk-gold)" : COLORS[Math.floor(r() * COLORS.length)],
        round: coin || r() > 0.65,
        coin,
        dur: 0.85 + r() * 0.5,
      };
    });
  }, [fire, count, spread]);

  if (!fire) return null;
  return (
    <div key={fire} aria-hidden style={{ position: "absolute", left: "50%", top: "50%", width: 0, height: 0, pointerEvents: "none", zIndex: 4 }}>
      {parts.map((p, i) => (
        <motion.span
          key={i}
          initial={{ x: 0, y: 0, scale: 0.2, rotate: 0, opacity: 1 }}
          animate={{ x: [0, p.x * 0.85, p.x], y: [0, p.y, p.y + 80], scale: [0.2, 1, 0.7], rotate: [0, p.rot * 0.6, p.rot], opacity: [1, 1, 0] }}
          transition={{ duration: p.dur, times: [0, 0.55, 1], ease: ["easeOut", "easeIn"] }}
          style={{
            position: "absolute",
            left: -p.w / 2,
            top: -p.h / 2,
            width: p.w,
            height: p.h,
            background: p.c,
            borderRadius: p.round ? "50%" : 2,
            boxShadow: p.coin ? "inset 0 0 0 2.5px var(--zk-gold-deep)" : undefined,
            willChange: "transform, opacity",
          }}
        />
      ))}
    </div>
  );
}
