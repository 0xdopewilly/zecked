"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, HTMLInputTypeAttribute, KeyboardEvent, ReactNode } from "react";
import { Icon } from "@/components/zk/Icon";

/* Port of "ZK Input": default · focus (2px purple + ring) · error (red tint, red border, ✕) · success (mint, ✓) · disabled. */

export type InputState = "default" | "focus" | "error" | "success" | "disabled";
export type InputSize = "lg" | "md" | "sm";
export type InputFont = "body" | "mono" | "display";

export interface InputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  label?: string;
  message?: ReactNode;
  /** Forced state. When unset (or "default"), focus is tracked automatically. */
  state?: InputState;
  size?: InputSize;
  font?: InputFont;
  multiline?: boolean;
  /** Textarea height in px (multiline only). Default 132. */
  height?: number;
  /**
   * Trailing slot (single-line only).
   * - "auto" (default): ✕ on error, ✓ on success, nothing otherwise.
   * - "none": nothing.
   * - any other string: that icon name (e.g. "eyeOff") in the 30px circle.
   * - a React element: rendered on the right, vertically centered (interactive).
   */
  trailing?: ReactNode;
  strike?: boolean;
  /** Bump this number to replay the shake (alternates zk-shake-a / zk-shake-b). */
  shake?: number;
  shakeLoop?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  /** Called on Enter (single-line only; ignored during IME composition). */
  onEnter?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: HTMLInputTypeAttribute;
  /** Same as state="disabled". */
  disabled?: boolean;
  id?: string;
  name?: string;
  ariaLabel?: string;
  autoComplete?: string;
  spellCheck?: boolean;
}

const FONTS: Record<InputFont, string> = {
  body: "var(--zk-fw-semibold) var(--zk-fs-18)/1.2 var(--zk-font-body)",
  mono: "var(--zk-fw-medium) var(--zk-fs-14)/1.2 var(--zk-font-mono)",
  display: "var(--zk-fw-black) var(--zk-fs-20)/1.25 var(--zk-font-display)",
};
const SM_BODY = "var(--zk-fw-semibold) var(--zk-fs-15)/1.2 var(--zk-font-body)";

const TRANSITION = "border-color var(--zk-dur-fast) var(--zk-ease-out),box-shadow var(--zk-dur-fast) var(--zk-ease-out)";

export function Input({
  value,
  onChange,
  placeholder,
  label,
  message,
  state,
  size = "lg",
  font,
  multiline = false,
  height,
  trailing,
  strike = false,
  shake,
  shakeLoop = false,
  maxLength,
  autoFocus,
  onEnter,
  onKeyDown,
  inputMode,
  type = "text",
  disabled,
  id,
  name,
  ariaLabel,
  autoComplete,
  spellCheck,
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? "zki" + autoId.replace(/[^a-zA-Z0-9_-]/g, "");
  const msgId = inputId + "-msg";
  const [focused, setFocused] = useState(false);

  // Shake: flip between zk-shake-a / zk-shake-b on every change of `shake`, so the animation always restarts.
  const shakeN = shake ?? 0;
  const [shakeTrack, setShakeTrack] = useState({ prev: shakeN, flip: shakeN % 2 === 1 });
  if (shakeTrack.prev !== shakeN) setShakeTrack({ prev: shakeN, flip: !shakeTrack.flip });

  const st: InputState = disabled ? "disabled" : state && state !== "default" ? state : focused ? "focus" : "default";
  const err = st === "error";
  const ok = st === "success";
  const foc = st === "focus";
  const dis = st === "disabled";
  const sm = size === "sm";
  const md = size === "md";

  // Trailing slot
  const trail = trailing ?? "auto";
  let trailIcon: string | null = null;
  let customTrail: ReactNode = null;
  if (typeof trail === "string") {
    trailIcon = trail === "auto" ? (err ? "close" : ok ? "check" : null) : trail === "none" ? null : trail;
  } else if (trail !== null && trail !== false && trail !== true) {
    customTrail = trail;
  }
  const hasTrail = !!trailIcon && !multiline;
  const hasCustom = !!customTrail && !multiline;

  // Measure a custom trailing node so the text never runs under it.
  const trailRef = useRef<HTMLDivElement>(null);
  const [customW, setCustomW] = useState(0);
  useLayoutEffect(() => {
    const el = trailRef.current;
    if (!hasCustom || !el) return;
    const measure = () => setCustomW(el.offsetWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasCustom]);

  const h = sm ? "50px" : md ? "var(--zk-h-input-md)" : "var(--zk-h-input-lg)";
  const r = sm ? "var(--zk-radius-lg)" : "var(--zk-radius-xl)";
  const fontCss = sm ? (font && FONTS[font]) || SM_BODY : (font && FONTS[font]) || FONTS.body;
  const bg = err ? "var(--zk-red-tint)" : "var(--zk-surface)";
  const bd = err
    ? "2px solid var(--zk-red)"
    : ok
      ? "2px solid var(--zk-mint)"
      : foc
        ? "2px solid var(--zk-purple)"
        : "1.5px solid var(--zk-border-strong)";
  const sh = err ? "var(--zk-ring-error)" : ok ? "var(--zk-ring-success)" : foc ? "var(--zk-ring-focus)" : "none";
  const fg = err ? "var(--zk-red-soft)" : "var(--zk-text)";
  const op = dis ? ".45" : "1";
  const pr = hasTrail ? "56px" : hasCustom ? `calc(var(--zk-space-14) + var(--zk-space-8) + ${customW || 42}px)` : "var(--zk-space-18)";
  const trailBg = err ? "var(--zk-red)" : ok ? "var(--zk-mint)" : "transparent";
  const trailFg = err ? "var(--zk-text)" : ok ? "var(--zk-mint-ink)" : "var(--zk-text-muted)";
  const msgC = err ? "var(--zk-red)" : ok ? "var(--zk-mint)" : "var(--zk-text-muted)";

  const anim = shakeLoop
    ? "zk-shake-loop 2.4s var(--zk-ease-in-out) infinite"
    : shakeN > 0
      ? `${shakeTrack.flip ? "zk-shake-a" : "zk-shake-b"} var(--zk-dur-shake) var(--zk-ease-in-out)`
      : "none";

  const hasMsg = message !== undefined && message !== null && message !== "" && message !== false;

  const common = {
    id: inputId,
    name,
    value: value ?? "",
    placeholder: placeholder ?? "",
    disabled: dis,
    maxLength,
    autoFocus,
    spellCheck,
    autoComplete,
    "aria-label": ariaLabel ?? (label ? undefined : placeholder || undefined),
    "aria-describedby": hasMsg ? msgId : undefined,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    height: h,
    margin: 0,
    borderRadius: r,
    background: bg,
    border: bd,
    boxShadow: sh,
    padding: `0 ${pr} 0 var(--zk-space-18)`,
    font: fontCss,
    color: fg,
    opacity: op,
    outline: "none",
    textDecoration: strike ? "line-through" : "none",
    textDecorationColor: "var(--zk-red)",
    appearance: "none",
    transition: TRANSITION,
  };

  const textareaStyle: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    height: `${height ?? 132}px`,
    margin: 0,
    resize: "none",
    display: "block",
    borderRadius: r,
    background: bg,
    border: bd,
    boxShadow: sh,
    padding: "var(--zk-space-14) var(--zk-space-16)",
    font: fontCss,
    color: fg,
    opacity: op,
    outline: "none",
    appearance: "none",
    transition: TRANSITION,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-6)", animation: anim }}>
      {label ? (
        <label htmlFor={inputId} style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
          {label}
        </label>
      ) : null}
      <div style={{ position: "relative" }}>
        {multiline ? (
          <textarea
            {...common}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={(e) => onKeyDown?.(e)}
            style={textareaStyle}
          />
        ) : (
          <input
            {...common}
            type={type}
            inputMode={inputMode}
            aria-invalid={err}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={(e) => {
              onKeyDown?.(e);
              if (e.defaultPrevented) return;
              if (e.key === "Enter" && onEnter && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onEnter(e.currentTarget.value);
              }
            }}
            style={inputStyle}
          />
        )}
        {hasTrail ? (
          <div
            style={{
              position: "absolute",
              right: "var(--zk-space-14)",
              top: "50%",
              marginTop: "-15px",
              width: "30px",
              height: "30px",
              borderRadius: "50%",
              background: trailBg,
              color: trailFg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <Icon icon={trailIcon || "close"} size={16} stroke={3} />
          </div>
        ) : null}
        {hasCustom ? (
          <div
            ref={trailRef}
            style={{
              position: "absolute",
              right: "var(--zk-space-14)",
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              color: trailFg,
            }}
          >
            {customTrail}
          </div>
        ) : null}
      </div>
      {hasMsg ? (
        <span id={msgId} style={{ font: "var(--zk-type-caption)", color: msgC }}>
          {message}
        </span>
      ) : null}
    </div>
  );
}
