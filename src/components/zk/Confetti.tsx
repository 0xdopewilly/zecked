import { useMemo, type CSSProperties } from "react";

const COLORS = [
  "var(--zk-gold)",
  "var(--zk-pink)",
  "var(--zk-mint)",
  "var(--zk-sky)",
  "var(--zk-purple)",
  "var(--zk-text)",
];

/** Pieces stop re-spawning after roughly this long; each finishes the fall it is on. */
const SPAWN_SECONDS = 3;

export interface ConfettiProps {
  /** Number of pieces, design range 10–150. */
  count?: number;
  /** Seed for the deterministic layout (same seed → same confetti on server and client). */
  seed?: number;
  size?: "md" | "sm";
  /** Change this value to rebuild the layer and replay the burst. */
  run?: number | string;
}

/**
 * Decorative confetti layer. Fills its (positioned) parent, ignores pointer events,
 * and is CSS-animated with `zk-fall`. Built once per count/seed/size/run.
 */
export function Confetti({ count = 70, seed = 7, size = "md", run }: ConfettiProps) {
  const pieces = useMemo(() => {
    const small = size === "sm";
    let s = Math.abs(Math.floor(seed)) % 2147483647 || 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => {
      const w = (small ? 5 : 6) + rnd() * (small ? 6 : 8);
      const h = (small ? 7 : 8) + rnd() * (small ? 7 : 10);
      const left = rnd() * 100 + "%";
      const background = COLORS[Math.floor(rnd() * 6)];
      const borderRadius = rnd() > 0.6 ? "50%" : "2px";
      const dur = Number((2.4 + rnd() * 2.2).toFixed(2));
      const delay = Number((-rnd() * 4).toFixed(2));
      // The design loops forever; instead, let each piece finish the fall it is on
      // at ~SPAWN_SECONDS and then stop (it rests hidden above the layer at top:-20px).
      const iterations = Math.floor((SPAWN_SECONDS - delay) / dur) + 1;
      const style: CSSProperties = {
        position: "absolute",
        left,
        top: -20,
        width: w,
        height: h,
        background,
        borderRadius,
        animation: `zk-fall ${dur.toFixed(2)}s linear ${delay.toFixed(2)}s ${iterations}`,
        willChange: "transform",
      };
      return <span key={i} style={style} />;
    });
  }, [count, seed, size]);

  return (
    <div
      key={"cf" + (run ?? 0)}
      aria-hidden
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 5 }}
    >
      {pieces}
    </div>
  );
}
