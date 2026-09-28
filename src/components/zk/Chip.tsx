"use client";

import { useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from "react";
import { Icon, type IconProp } from "@/components/zk/Icon";

/* Port of "ZK Chip": filter chips (default · hover · pressed · active gold · active-pressed · disabled) and info chips. */

export type ChipVariant = "filter" | "info";
export type ChipSize = "md" | "sm";
export type ChipState = "default" | "hover" | "pressed" | "disabled";

export interface ChipProps {
  label?: ReactNode;
  active?: boolean;
  variant?: ChipVariant;
  size?: ChipSize;
  /** Force a visual state (style-guide use). */
  state?: ChipState;
  icon?: IconProp;
  iconColor?: string;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  /** Same as state="disabled". */
  disabled?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
}

export function Chip({
  label,
  active,
  variant = "filter",
  size = "md",
  state,
  icon,
  iconColor,
  onClick,
  disabled,
  ariaLabel,
  style,
}: ChipProps) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);

  const info = variant === "info";
  const sm = size === "sm";
  const forced = disabled ? "disabled" : state && state !== "default" ? state : null;
  const st: ChipState = forced || (press ? "pressed" : hover ? "hover" : "default");
  const on = !!active;
  const dis = st === "disabled";
  const interactive = !info && !dis;

  const css: CSSProperties = {
    flex: "none",
    height: info ? "auto" : sm ? "var(--zk-h-chip-sm)" : "var(--zk-h-chip)",
    padding: info ? "var(--zk-space-8) var(--zk-space-12)" : sm ? "0 var(--zk-space-14)" : "0 var(--zk-space-16)",
    margin: 0,
    boxSizing: "border-box",
    borderRadius: info ? "var(--zk-radius-lg)" : "var(--zk-radius-pill)",
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--zk-space-6)",
    background: info
      ? "var(--zk-surface-raised)"
      : on
        ? "var(--zk-gold)"
        : st === "hover" || st === "pressed"
          ? "var(--zk-surface-raised)"
          : "var(--zk-surface)",
    color: on ? "var(--zk-gold-ink)" : "var(--zk-text)",
    border: `1px solid ${on || info ? "transparent" : "var(--zk-border)"}`,
    boxShadow: on && st !== "pressed" ? "var(--zk-shadow-chip-active)" : "none",
    transform: st === "pressed" && interactive ? "translateY(2px)" : "none",
    opacity: dis ? ".4" : "1",
    font:
      info || sm
        ? "var(--zk-fw-bold) var(--zk-fs-12)/1 var(--zk-font-body)"
        : "var(--zk-fw-bold) var(--zk-fs-14)/1 var(--zk-font-body)",
    whiteSpace: "nowrap",
    cursor: interactive ? "pointer" : "default",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    appearance: "none",
    transition: "transform var(--zk-dur-fast) var(--zk-ease-out),background var(--zk-dur-fast) var(--zk-ease-out)",
    ...style,
  };

  const content = (
    <>
      {icon ? <Icon icon={icon} size={sm || info ? 14 : 16} stroke={2.2} color={iconColor ?? "currentColor"} /> : null}
      <span>{label ?? "Chip"}</span>
    </>
  );

  if (info) {
    return (
      <div style={css} aria-label={ariaLabel}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={ariaLabel}
      disabled={dis}
      onClick={(e) => {
        if (interactive && onClick) onClick(e);
      }}
      onPointerEnter={(e: PointerEvent<HTMLElement>) => {
        if (interactive && e.pointerType === "mouse") setHover(true);
      }}
      onPointerLeave={() => {
        setHover(false);
        setPress(false);
      }}
      onPointerDown={(e: PointerEvent<HTMLElement>) => {
        if (interactive && (e.pointerType !== "mouse" || e.button === 0)) setPress(true);
      }}
      onPointerUp={() => setPress(false)}
      onPointerCancel={() => {
        setHover(false);
        setPress(false);
      }}
      onBlur={() => setPress(false)}
      style={css}
    >
      {content}
    </button>
  );
}
