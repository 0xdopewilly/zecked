"use client";
// A phone that renders real ZECKED UI at true 390×844 size, scaled to fit `width`.
import type { CSSProperties, ReactNode } from "react";

export function PhoneFrame({ children, width = 320, style, screenStyle }: { children: ReactNode; width?: number; style?: CSSProperties; screenStyle?: CSSProperties }) {
  const inner = width - 24; // frame padding
  const scale = inner / 390;
  return (
    <div className="zks-phone" style={{ width, ...style }}>
      <div className="zks-phone-screen" style={{ width: inner, height: 844 * scale, ...screenStyle }}>
        <div className="zks-phone-notch" style={{ transform: `translateX(-50%) scale(${Math.max(0.7, scale)})` }} />
        <div style={{ width: 390, height: 844, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute", inset: 0 }}>{children}</div>
      </div>
    </div>
  );
}
