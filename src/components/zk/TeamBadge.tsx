"use client";
/* Port of "ZK Team Badge". With a `logo` it shows the official crest (on a white disc ringed in the
   team colour, so dark crests stay visible) or a round-cropped flag; otherwise, or if the image fails,
   the design's colored circle + 3-letter code. */
import { useState } from "react";

export interface TeamBadgeProps {
  code?: string;
  /** Any CSS background: a color, a var(--zk-team-*) token, or a gradient. */
  color?: string;
  ink?: string;
  size?: number;
  /** Crest or flag image URL (see crestUrl in lib/server/sports). */
  logo?: string;
  /** Accessible name, e.g. "Barcelona". Falls back to the code. */
  name?: string;
}

export function TeamBadge({ code, color, ink, size, logo, name }: TeamBadgeProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const s = size ?? 40;
  const r = (x: number, m = 1) => Math.max(m, Math.round(x));
  const label = code ?? "BAR";
  const fs = r(s * 0.27);
  const bw = r(s * 0.05, 2);
  const d = r(s * 0.07, 2);
  const img = logo && failed !== logo ? logo : null;
  // ESPN draws every flag at ~460×320 on a 500px canvas; zooming 1.6× fills the circle.
  const flag = !!img && img.includes("/countries/");
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
        background: img ? (flag ? "var(--zk-surface-raised)" : "#fff") : (color ?? "var(--zk-purple)"),
        color: ink ?? "var(--zk-text)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `var(--zk-fw-black) ${fs}px/1 var(--zk-font-display)`,
        border: `${bw}px solid ${img && !flag ? (color ?? "var(--zk-text)") : "var(--zk-text)"}`,
        boxShadow: `0 ${d}px 0 rgb(var(--zk-black-rgb) / .4)`,
        boxSizing: "border-box",
        flex: "none",
      }}
    >
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element -- remote CDN crest, already resized
        <img
          src={img}
          alt=""
          width={s}
          height={s}
          loading="lazy"
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(img)}
          style={{
            width: flag ? "100%" : "74%",
            height: flag ? "100%" : "74%",
            objectFit: "contain",
            transform: flag ? "scale(1.6)" : undefined,
            display: "block",
            pointerEvents: "none",
          }}
        />
      ) : (
        label
      )}
    </div>
  );
}
