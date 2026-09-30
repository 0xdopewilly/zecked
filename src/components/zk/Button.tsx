"use client";

import Link from "next/link";
import { useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from "react";
import { Icon, type IconProp } from "@/components/zk/Icon";
import type { Sound } from "@/lib/sfx";

/* Port of "ZK Button": 3D buttons with hover (-1px lift, bigger shadow), pressed (down 4px, 2px shadow), disabled. */

export type ButtonVariant = "primary" | "secondary" | "success" | "sky" | "light" | "ghost";
export type ButtonSize = "lg" | "md" | "sm";
export type ButtonState = "default" | "hover" | "pressed" | "disabled";

export interface ButtonProps {
  label?: ReactNode;
  /** Alternative to `label`; wins when both are given. */
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Force a visual state (style-guide use). `disabled` also blocks clicks. */
  state?: ButtonState;
  icon?: IconProp;
  iconRight?: IconProp;
  /** Full width (default true). */
  full?: boolean;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  type?: "button" | "submit" | "reset";
  /** Same as state="disabled". */
  disabled?: boolean;
  /** Renders a Next.js <Link> instead of a <button> (ignored while disabled). */
  href?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  /** Sound on tap (the app's <Sfx /> plays it). Default "pop"; "none" for silence. */
  sfx?: Sound | "none";
}

type VariantSpec = { bg: string; bgH?: string; bgP?: string; fg: string; bd?: string; sh: string; shH: string; shP: string; dy: number };

const V: Record<ButtonVariant, VariantSpec> = {
  primary: { bg: "var(--zk-grad-gold)", fg: "var(--zk-gold-ink)", sh: "var(--zk-shadow-btn-gold)", shH: "var(--zk-shadow-btn-gold-hover)", shP: "var(--zk-shadow-btn-gold-pressed)", dy: 4 },
  secondary: { bg: "var(--zk-purple)", fg: "var(--zk-text)", sh: "var(--zk-shadow-btn-purple)", shH: "var(--zk-shadow-btn-purple), var(--zk-glow-purple)", shP: "var(--zk-shadow-btn-purple-pressed)", dy: 4 },
  success: { bg: "var(--zk-mint)", fg: "var(--zk-mint-ink)", sh: "var(--zk-shadow-btn-mint)", shH: "var(--zk-shadow-btn-mint)", shP: "var(--zk-shadow-btn-mint-pressed)", dy: 4 },
  sky: { bg: "var(--zk-sky)", fg: "var(--zk-sky-ink)", sh: "var(--zk-shadow-btn-sky)", shH: "var(--zk-shadow-btn-sky)", shP: "var(--zk-shadow-btn-sky-pressed)", dy: 4 },
  light: { bg: "var(--zk-text)", fg: "var(--zk-bg)", sh: "var(--zk-shadow-btn-light)", shH: "var(--zk-shadow-btn-light)", shP: "var(--zk-shadow-btn-light-pressed)", dy: 4 },
  ghost: { bg: "transparent", bgH: "rgb(var(--zk-white-rgb) / .06)", bgP: "rgb(var(--zk-white-rgb) / .1)", fg: "var(--zk-text)", bd: "1.5px solid var(--zk-border-strong)", sh: "none", shH: "none", shP: "none", dy: 0 },
};

const S: Record<ButtonSize, { h: string; r: string; font: string; px: string; is: number }> = {
  lg: { h: "var(--zk-h-btn-lg)", r: "var(--zk-radius-2xl)", font: "var(--zk-type-btn-lg)", px: "var(--zk-space-24)", is: 22 },
  md: { h: "var(--zk-h-btn-md)", r: "var(--zk-radius-xl)", font: "var(--zk-type-btn-md)", px: "var(--zk-space-20)", is: 20 },
  sm: { h: "var(--zk-h-btn-sm)", r: "var(--zk-radius-lg)", font: "var(--zk-type-btn-sm)", px: "var(--zk-space-16)", is: 16 },
};

export function Button({
  label,
  children,
  variant = "primary",
  size = "lg",
  state,
  icon,
  iconRight,
  full,
  onClick,
  type = "button",
  disabled,
  href,
  ariaLabel,
  style,
  sfx = "pop",
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const [press, setPress] = useState(false);

  const v = V[variant] || V.primary;
  const s = S[size] || S.lg;
  const forced = disabled ? "disabled" : state && state !== "default" ? state : null;
  const st: ButtonState = forced || (press ? "pressed" : hover ? "hover" : "default");
  const dis = st === "disabled";
  const ghost = variant === "ghost";

  const bg = dis ? "var(--zk-surface-raised)" : st === "hover" && v.bgH ? v.bgH : st === "pressed" && v.bgP ? v.bgP : v.bg;
  const fg = dis ? "var(--zk-text-faint)" : v.fg;
  const bd = dis && !ghost ? "1.5px solid transparent" : v.bd || "1.5px solid transparent";
  const sh = dis ? "none" : st === "hover" ? v.shH : st === "pressed" ? v.shP : v.sh;
  const tf = dis ? "none" : st === "hover" ? "translateY(-1px)" : st === "pressed" ? (v.dy ? `translateY(${v.dy}px)` : "scale(.98)") : "none";

  const css: CSSProperties = {
    height: s.h,
    width: full === false ? "auto" : "100%",
    padding: `0 ${s.px}`,
    margin: 0,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--zk-space-8)",
    borderRadius: s.r,
    background: bg,
    color: fg,
    border: bd,
    boxShadow: sh,
    transform: tf,
    font: s.font,
    letterSpacing: ".01em",
    whiteSpace: "nowrap",
    cursor: dis ? "not-allowed" : "pointer",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    appearance: "none",
    textDecoration: "none",
    transition:
      "transform var(--zk-dur-fast) var(--zk-ease-out),box-shadow var(--zk-dur-fast) var(--zk-ease-out),background var(--zk-dur-fast) var(--zk-ease-out)",
    ...style,
  };

  const handlers = {
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse") setHover(true);
    },
    onPointerLeave: () => {
      setHover(false);
      setPress(false);
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (!dis && (e.pointerType !== "mouse" || e.button === 0)) setPress(true);
    },
    onPointerUp: () => setPress(false),
    onPointerCancel: () => {
      setHover(false);
      setPress(false);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!dis && (e.key === " " || e.key === "Enter")) setPress(true);
    },
    onKeyUp: () => setPress(false),
    onBlur: () => setPress(false),
  };

  const content = (
    <>
      {icon ? <Icon icon={icon} size={s.is} stroke={2.4} /> : null}
      <span>{children ?? label ?? "ZECK IT"}</span>
      {iconRight ? <Icon icon={iconRight} size={s.is} stroke={2.4} /> : null}
    </>
  );

  if (href && !dis) {
    return (
      <Link href={href} aria-label={ariaLabel} onClick={onClick} style={css} data-sfx={sfx} {...handlers}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      disabled={dis}
      aria-disabled={dis}
      aria-label={ariaLabel}
      data-sfx={sfx}
      onClick={(e) => {
        if (!dis && onClick) onClick(e);
      }}
      style={css}
      {...handlers}
    >
      {content}
    </button>
  );
}
