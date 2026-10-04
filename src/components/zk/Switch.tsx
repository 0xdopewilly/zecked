"use client";
/* ZK Switch: an on/off toggle in the sticker style (ink border, hard drop), gold when on. For options in
   flows and settings: "Lock it with a question", "Only people with the link can see this". The visible
   label sits next to it; `label` is what screen readers announce. */
import type { CSSProperties } from "react";

export interface SwitchProps {
  on: boolean;
  onChange: (on: boolean) => void;
  /** What the switch controls, for screen readers. */
  label: string;
  disabled?: boolean;
  id?: string;
  style?: CSSProperties;
}

const W = 48;
const H = 28;
const BORDER = 2;
const PAD = 3;
const KNOB = H - 2 * (BORDER + PAD); // 18
const TRAVEL = W - 2 * (BORDER + PAD) - KNOB; // 20

export function Switch({ on, onChange, label, disabled, id, style }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        width: W,
        height: H,
        flex: "none",
        boxSizing: "border-box",
        padding: PAD,
        borderRadius: "var(--zk-radius-pill)",
        border: `${BORDER}px solid var(--zk-ink)`,
        background: on ? "var(--zk-gold)" : "var(--zk-surface-raised)",
        boxShadow: "0 3px 0 var(--zk-ink)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--zk-dur-fast) var(--zk-ease-out)",
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "block",
          width: KNOB,
          height: KNOB,
          boxSizing: "border-box",
          borderRadius: "50%",
          background: "#fff",
          border: `${BORDER}px solid var(--zk-ink)`,
          transform: on ? `translateX(${TRAVEL}px)` : "none",
          transition: "transform var(--zk-dur-fast) var(--zk-ease-spring)",
        }}
      />
    </button>
  );
}
