"use client";
/* Port of "ZK Team Badge": colored circle + 3-letter code. With a `logo` the official crest fades in over
   it once loaded (white disc ringed in the team colour, so dark crests stay visible), or a round-cropped
   flag for national teams. Until the image arrives, or if it fails, the code badge shows. */
import { useEffect, useRef, useState } from "react";
import { crestSized } from "@/lib/crest";

export interface TeamBadgeProps {
  code?: string;
  /** Any CSS background: a color, a var(--zk-team-*) token, or a gradient. */
  color?: string;
  ink?: string;
  size?: number;
  /** Crest or flag image URL (see lib/crest). */
  logo?: string;
  /** Accessible name, e.g. "Barcelona". Falls back to the code. */
  name?: string;
}

function lum(c?: string) {
  const m = c?.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

export function TeamBadge({ code, color, ink, size, logo, name }: TeamBadgeProps) {
  const [loaded, setLoaded] = useState<string | null>(null);
  const s = size ?? 40;
  const r = (x: number, m = 1) => Math.max(m, Math.round(x));
  const label = code ?? "BAR";
  const fs = r(s * 0.27);
  const bw = r(s * 0.05, 2);
  const d = r(s * 0.07, 2);
  // ESPN draws every flag at ~460×320 on a 500px canvas; zooming 1.6× fills the circle.
  const flag = !!logo && logo.includes("/countries/");
  const shown = !!logo && loaded === logo;
  // Ring in the team colour; white kits (Real Madrid…) borrow their ink so the ring still reads.
  const ring = flag ? "var(--zk-text)" : (lum(color) ?? 0) > 0.82 ? ((lum(ink) ?? 1) < 0.6 ? ink! : "var(--zk-purple)") : (color ?? "var(--zk-text)");
  // Server-rendered crests can finish loading before React attaches onLoad, so also ask the image
  // itself: decode() resolves once it is ready, however early that happened.
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = imgRef.current;
    if (!el || !logo) return;
    let live = true;
    const done = () => live && setLoaded(logo);
    if (el.complete && el.naturalWidth > 0) done();
    else el.decode().then(done, () => {});
    return () => {
      live = false;
    };
  }, [logo]);
  return (
    <div
      role="img"
      aria-label={name || label}
      title={name}
      style={{
        position: "relative",
        width: `${s}px`,
        height: `${s}px`,
        borderRadius: "50%",
        overflow: "hidden",
        background: color ?? "var(--zk-purple)",
        color: ink ?? "var(--zk-text)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `var(--zk-fw-black) ${fs}px/1 var(--zk-font-display)`,
        border: `${bw}px solid ${shown ? ring : "var(--zk-text)"}`,
        boxShadow: `0 ${d}px 0 rgb(var(--zk-black-rgb) / .4)`,
        boxSizing: "border-box",
        flex: "none",
        transition: "border-color .25s",
      }}
    >
      <span aria-hidden>{label}</span>
      {logo ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: flag ? "var(--zk-surface-raised)" : "#fff",
            opacity: shown ? 1 : 0,
            transition: "opacity .25s",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- remote CDN crest, already resized */}
          <img
            ref={imgRef}
            src={logo}
            srcSet={`${crestSized(logo, 128)} 128w, ${crestSized(logo, 256)} 256w`}
            sizes={`${s}px`}
            alt=""
            width={s}
            height={s}
            loading="lazy"
            decoding="async"
            draggable={false}
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(logo)}
            style={{
              width: flag ? "100%" : "74%",
              height: flag ? "100%" : "74%",
              objectFit: "contain",
              transform: flag ? "scale(1.6)" : undefined,
              display: "block",
              pointerEvents: "none",
            }}
          />
        </span>
      ) : null}
    </div>
  );
}
