"use client";

import { Fragment, useEffect, useRef, useState } from "react";

/* Port of "ZK Countdown": inline · pill · boxed; ticks every second when live; turns urgent under 30 min on auto tone. */

export type CountdownFormat = "hms" | "ms" | "human";
export type CountdownVariant = "inline" | "pill" | "boxed";
export type CountdownTone = "auto" | "default" | "urgent" | "gold" | "muted";
export type CountdownSize = "sm" | "md" | "lg";

export interface CountdownProps {
  /** Remaining seconds (ignored when `to` is set). Default 4965. */
  seconds?: number;
  /** Target time: ISO date string or epoch ms. Remaining seconds are computed from it. */
  to?: string | number;
  /** Tick every second (default true). */
  live?: boolean;
  /** hms → HH:MM:SS, ms → MM:SS, human → "5h 12m left" / "2d 3h left". */
  format?: CountdownFormat;
  /** Static text override (still ticks underneath for tone and onDone). */
  text?: string;
  variant?: CountdownVariant;
  /** "auto" (default when unset): urgent under 30 min, otherwise default. */
  tone?: CountdownTone;
  size?: CountdownSize;
  /** Fired once when the countdown reaches 0 (while live). */
  onDone?: () => void;
}

const URGENT_UNDER = 30 * 60;

const pad = (n: number) => String(n).padStart(2, "0");

function toTargetMs(to: string | number | undefined): number | null {
  if (to === undefined || to === null || to === "") return null;
  const ms = typeof to === "number" ? to : Date.parse(to);
  return Number.isFinite(ms) ? ms : null;
}

function clampSecs(s: number): number {
  return Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
}

function secsUntil(target: number): number {
  return Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

export function formatCountdown(s: number, fmt: CountdownFormat = "hms"): string {
  const t = Math.max(0, Math.floor(s));
  if (fmt === "ms") return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
  if (fmt === "human") {
    const d = Math.floor(t / 86400);
    const h = Math.floor(t / 3600) % 24;
    const m = Math.floor(t / 60) % 60;
    if (t >= 86400) return `${d}d ${h}h left`;
    if (t >= 3600) return `${Math.floor(t / 3600)}h ${m}m left`;
    if (t >= 60) return `${m}m left`;
    return `${t}s left`;
  }
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
}

export function Countdown({
  seconds,
  to,
  live = true,
  format = "hms",
  text,
  variant = "inline",
  tone,
  size = "md",
  onDone,
}: CountdownProps) {
  const target = toTargetMs(to);
  const initial = () => (target !== null ? secsUntil(target) : clampSecs(seconds ?? 4965));
  const [rem, setRem] = useState<number>(initial);

  // Reset when the source changes (render-phase derived state, no flash of stale value).
  const srcKey = target !== null ? `to:${target}` : `s:${seconds ?? 4965}`;
  const [prevKey, setPrevKey] = useState(srcKey);
  if (prevKey !== srcKey) {
    setPrevKey(srcKey);
    setRem(initial());
  }

  const done = rem <= 0;

  useEffect(() => {
    if (!live || done) return;
    // Re-sync immediately on mount (server-rendered value may be stale for `to`).
    if (target !== null) setRem(secsUntil(target));
    const t = setInterval(() => {
      if (target !== null) setRem(secsUntil(target));
      else setRem((r) => Math.max(0, r - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [live, done, target]);

  // onDone fires once per run.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  const firedRef = useRef(false);
  useEffect(() => {
    if (!done) {
      firedRef.current = false;
      return;
    }
    if (live && !firedRef.current) {
      firedRef.current = true;
      onDoneRef.current?.();
    }
  }, [done, live]);

  const shown = text ?? formatCountdown(rem, format);
  const t: Exclude<CountdownTone, "auto"> = !tone || tone === "auto" ? (rem < URGENT_UNDER ? "urgent" : "default") : tone;

  const font = size === "sm" ? "var(--zk-type-mono-sm)" : size === "lg" ? "var(--zk-type-mono-lg)" : "var(--zk-type-mono)";
  const fg =
    t === "urgent" ? "var(--zk-red)" : t === "gold" ? "var(--zk-gold)" : t === "muted" ? "var(--zk-text-muted)" : "var(--zk-text)";

  if (variant === "boxed") {
    const parts = shown.split(":");
    return (
      <div role="timer" suppressHydrationWarning style={{ display: "inline-flex", alignItems: "center", gap: "var(--zk-space-4)", font, color: fg }}>
        {parts.map((x, i) => (
          <Fragment key={i}>
            {i > 0 ? <span>:</span> : null}
            <span
              suppressHydrationWarning
              style={{
                background: "var(--zk-surface-raised)",
                padding: "var(--zk-space-6) var(--zk-space-8)",
                borderRadius: "var(--zk-radius-sm)",
                minWidth: "1.4em",
                textAlign: "center",
              }}
            >
              {x}
            </span>
          </Fragment>
        ))}
      </div>
    );
  }

  const pill = variant === "pill";
  return (
    <span
      role="timer"
      suppressHydrationWarning
      style={{
        display: "inline-flex",
        alignItems: "center",
        whiteSpace: "nowrap",
        font,
        color: fg,
        background: pill ? "var(--zk-bg)" : "transparent",
        padding: pill ? "var(--zk-space-4) var(--zk-space-10)" : "0",
        borderRadius: "var(--zk-radius-md)",
        letterSpacing: ".04em",
      }}
    >
      {shown}
    </span>
  );
}
