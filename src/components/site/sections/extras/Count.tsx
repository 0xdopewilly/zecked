"use client";
// Hydration-safe count-up (same look as fx CountUpInView). fx's version seeds its state from
// useReducedMotion() during render, so reduced-motion visitors get server "0" vs client "N" and a
// hydration failure. This one always renders 0 first and settles in an effect. Screen readers get
// the final value straight away.
import { animate, useInView } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EASE_OUT } from "../../fx";
import { srOnly, useReduced } from "./kit";

const fmt = (v: number, d: number) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export function Count({ to, decimals = 0, duration = 1.8, style }: { to: number; decimals?: number; duration?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReduced();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduce) {
      setV(to);
      return;
    }
    if (!inView) return;
    const c = animate(0, to, { duration, ease: EASE_OUT, onUpdate: setV });
    return () => c.stop();
  }, [inView, reduce, to, duration]);
  return (
    <span ref={ref} style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      <span style={srOnly}>{fmt(to, decimals)}</span>
      <span aria-hidden>{fmt(v, decimals)}</span>
    </span>
  );
}
