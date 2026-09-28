"use client";

import { useEffect, useState } from "react";

export interface CountUpProps {
  from?: number;
  to?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Thousands separators; rounds to a whole number (design behaviour). */
  grouping?: boolean;
  /** ms */
  duration?: number;
  loop?: boolean;
  /** ms to hold the final value before looping */
  hold?: number;
  /** Change this value to replay the count. */
  run?: number | string;
}

function formatValue(v: number, decimals: number, grouping: boolean): string {
  return grouping ? Math.round(v).toLocaleString("en-US") : v.toFixed(decimals);
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Counts from `from` to `to` with easing 1 − (1 − t)³ on its own requestAnimationFrame loop.
 * Only this span re-renders, and only when the formatted number changes.
 * Under prefers-reduced-motion it shows the final value straight away.
 */
export function CountUp({
  from = 0,
  to = 0.02,
  decimals = 4,
  prefix = "",
  suffix = "",
  grouping = false,
  duration = 1800,
  loop = false,
  hold = 1200,
  run,
}: CountUpProps) {
  const [e, setE] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion() || !(duration > 0)) {
      setE(1);
      return;
    }
    let raf = 0;
    let pause: ReturnType<typeof setTimeout> | undefined;
    let last = "";
    const text = (x: number) => formatValue(from + (to - from) * x, decimals, grouping);

    const start = () => {
      const t0 = performance.now();
      last = text(0);
      setE(0);
      const step = (t: number) => {
        const p = Math.min(1, Math.max(0, (t - t0) / duration));
        const eased = 1 - Math.pow(1 - p, 3);
        const next = text(eased);
        if (next !== last || p === 1) {
          last = next;
          setE(eased);
        }
        if (p < 1) raf = requestAnimationFrame(step);
        else if (loop) pause = setTimeout(start, hold);
      };
      raf = requestAnimationFrame(step);
    };
    start();

    return () => {
      cancelAnimationFrame(raf);
      if (pause) clearTimeout(pause);
    };
  }, [from, to, decimals, grouping, duration, loop, hold, run]);

  const v = from + (to - from) * e;
  return (
    <span style={{ font: "inherit", color: "inherit", fontVariantNumeric: "tabular-nums" }}>
      {`${prefix}${formatValue(v, decimals, grouping)}${suffix}`}
    </span>
  );
}
