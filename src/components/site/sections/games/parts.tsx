"use client";
// Shared pieces for the two game cards: the tilting 3D card shell, springy button wrapper, floating tiles, chips.
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Chip, Icon } from "@/components/zk";
import { EASE_OUT, Float, Tilt } from "@/components/site/fx";

export const WIN_ZEC = 0.02;

export type Tone = "purple" | "sky";

/** Big interactive card: hover lift → pointer tilt with glare → 3D card with a tile floating in front of it. */
export function CardShell({
  tone,
  tile,
  deco,
  reduce,
  won = false,
  children,
  labelledBy,
}: {
  tone: Tone;
  tile: ReactNode;
  deco: ReactNode;
  reduce: boolean;
  won?: boolean;
  children: ReactNode;
  labelledBy: string;
}) {
  return (
    <motion.div className="zkg-lift" whileHover={reduce ? undefined : { y: -10 }} transition={{ type: "spring", stiffness: 260, damping: 20 }}>
      <Tilt max={reduce ? 0 : 6} radius={32} className="zkg-tilt">
        {/* The card stays flat (no preserve-3d inside it, so its layers never z-fight); the tile is a sibling
            in Tilt's 3D plane, lifted toward the viewer so it parallaxes as the card tilts. */}
        <article className={`zkg-card zkg-card--${tone}`} data-won={won} aria-labelledby={labelledBy}>
          <div aria-hidden className="zkg-deco">
            {deco}
          </div>
          {children}
        </article>
        <div aria-hidden className="zkg-tile">
          <Float amplitude={10} duration={4.6} rotate={tone === "purple" ? 8 : -8}>
            {tile}
          </Float>
        </div>
      </Tilt>
    </motion.div>
  );
}

/** Springy hover/tap wrapper for buttons. */
export function Springy({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <motion.div
      whileHover={{ scale: 1.025 }}
      whileTap={{ scale: 0.955 }}
      transition={{ type: "spring", stiffness: 420, damping: 16 }}
      style={{ width: "100%", ...style }}
    >
      {children}
    </motion.div>
  );
}

export function LockTile() {
  return (
    <div
      style={{
        width: 104,
        height: 104,
        borderRadius: 30,
        background: "linear-gradient(165deg, var(--zk-gold-pale), var(--zk-gold) 55%, var(--zk-gold-amber))",
        boxShadow: "0 9px 0 var(--zk-gold-shadow), 0 26px 50px rgb(var(--zk-gold-rgb) / .35), inset 0 3px 0 rgb(255 255 255 / .55)",
        color: "var(--zk-gold-ink)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon icon="lock" size={52} stroke={2.6} />
    </div>
  );
}

export function BallTile() {
  return (
    <div
      style={{
        width: 104,
        height: 104,
        borderRadius: "50%",
        background: "radial-gradient(circle at 34% 28%, #FFFFFF, var(--zk-silver-light) 45%, #B9C3D6)",
        boxShadow: "0 9px 0 #7E8AA3, 0 26px 50px rgb(var(--zk-sky-rgb) / .35), inset 0 -4px 0 rgb(0 0 0 / .08)",
        color: "#1B2238",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon icon="ball" size={60} stroke={2} />
    </div>
  );
}

export function RuleChips({ items }: { items: { icon: string; label: string; color: string }[] }) {
  return (
    <ul className="zkg-chips">
      {items.map((c) => (
        <li key={c.label}>
          <Chip variant="info" icon={c.icon} iconColor={c.color} label={c.label} />
        </li>
      ))}
    </ul>
  );
}

/** "+0.0000 → +0.02" slot-machine count (snaps to the clean amount at the end). */
export function ZecCounter({ run, reduce }: { run: number; reduce: boolean }) {
  const mv = useMotionValue(reduce ? WIN_ZEC : 0);
  const txt = useTransform(mv, (v) => (v >= WIN_ZEC - 0.00005 ? `+${WIN_ZEC}` : `+${v.toFixed(4)}`));
  useEffect(() => {
    if (reduce) {
      mv.set(WIN_ZEC);
      return;
    }
    mv.set(0);
    const c = animate(mv, WIN_ZEC, { duration: 1.3, ease: EASE_OUT, delay: 0.15 });
    return () => c.stop();
  }, [run, reduce, mv]);
  return <motion.span style={{ fontVariantNumeric: "tabular-nums" }}>{txt}</motion.span>;
}

/** Faint football pitch lines (portrait, like the cards) for the prediction card background. */
export function PitchLines() {
  return (
    <svg
      viewBox="0 0 300 460"
      preserveAspectRatio="xMidYMid slice"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity: 0.08,
        WebkitMaskImage: "linear-gradient(180deg, transparent 8%, #000 40%, #000 80%, transparent)",
        maskImage: "linear-gradient(180deg, transparent 8%, #000 40%, #000 80%, transparent)",
      }}
    >
      <g fill="none" stroke="#fff" strokeWidth="2">
        <rect x="14" y="14" width="272" height="432" rx="8" />
        <line x1="14" y1="230" x2="286" y2="230" />
        <circle cx="150" cy="230" r="46" />
        <circle cx="150" cy="230" r="3" fill="#fff" />
        <rect x="80" y="14" width="140" height="62" />
        <rect x="80" y="384" width="140" height="62" />
        <rect x="116" y="14" width="68" height="24" />
        <rect x="116" y="422" width="68" height="24" />
      </g>
    </svg>
  );
}
