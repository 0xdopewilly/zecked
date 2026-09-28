import { useId } from "react";

/* Port of "ZK Logo": SVG Z mark (bolt + vault-handle hub) plus "ECKED" as live text. */

export type LogoVariant = "wordmark" | "icon" | "mark";

export interface LogoProps {
  variant?: LogoVariant;
  size?: number;
  /** Stroke color around the Z (mark variant only). */
  stroke?: string;
}

const Z_POINTS = "14,10 86,10 86,26 50,48 64,48 30,74 86,74 86,90 14,90 14,74 44,54 30,54 60,26 14,26";

export function Logo({ variant = "wordmark", size = 48, stroke }: LogoProps) {
  // SSR-safe unique gradient ids (useId output can contain characters that break url(#…)).
  const gid = "zkl" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gid2 = gid + "b";
  const s = size;
  const r = (x: number, m = 1) => Math.max(m, Math.round(x));
  const fs = s;
  const zs = r(s * 0.84);
  const sh = r(s * 0.07, 2);
  const glow = r(s * 0.22);
  const ir = r(s * 0.24);
  const ins = r(s * 0.035);
  const drop = r(s * 0.1);
  const markStroke = stroke ?? "none";

  if (variant === "mark") {
    return (
      <svg viewBox="0 0 100 100" width={fs} height={fs} role="img" aria-label="Z" style={{ display: "block", flex: "none", overflow: "visible" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--zk-gold-pale)" }} />
            <stop offset="1" style={{ stopColor: "var(--zk-gold)" }} />
          </linearGradient>
        </defs>
        <polygon points={Z_POINTS} fill={`url(#${gid})`} style={{ stroke: markStroke, strokeWidth: 5, strokeLinejoin: "round" }} />
        <circle cx="47" cy="51" r="8" style={{ fill: "var(--zk-bg)", stroke: "var(--zk-gold-pale)", strokeWidth: 4 }} />
      </svg>
    );
  }

  if (variant === "icon") {
    return (
      <div
        role="img"
        aria-label="ZECKED app icon"
        style={{
          width: `${fs}px`,
          height: `${fs}px`,
          borderRadius: `${ir}px`,
          position: "relative",
          flex: "none",
          overflow: "hidden",
          background: "radial-gradient(circle at 30% 18%,var(--zk-purple-light),var(--zk-purple-vivid) 50%,var(--zk-purple-shade))",
          boxShadow: `inset 0 ${ins}px 0 rgb(var(--zk-white-rgb) / .35),inset 0 -${ins}px 0 rgb(var(--zk-black-rgb) / .3),0 ${drop}px ${glow}px rgb(var(--zk-purple-rgb) / .45)`,
        }}
      >
        <svg viewBox="0 0 100 100" width={fs} height={fs} style={{ position: "absolute", inset: 0 }} aria-hidden="true">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--zk-gold-pale)" }} />
              <stop offset="1" style={{ stopColor: "var(--zk-gold)" }} />
            </linearGradient>
            <radialGradient id={gid2} cx="0.4" cy="0.3" r="0.8">
              <stop offset="0" style={{ stopColor: "var(--zk-icon-face-hi)" }} />
              <stop offset="1" style={{ stopColor: "var(--zk-icon-face-lo)" }} />
            </radialGradient>
          </defs>
          <circle cx="50" cy="52" r="37" style={{ fill: "var(--zk-icon-rim)" }} />
          <circle cx="50" cy="50" r="37" fill={`url(#${gid2})`} style={{ stroke: "var(--zk-gold)", strokeWidth: 5 }} />
          <path
            d="M47 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0M47 82a3 3 0 1 0 6 0a3 3 0 1 0-6 0M15 50a3 3 0 1 0 6 0a3 3 0 1 0-6 0M79 50a3 3 0 1 0 6 0a3 3 0 1 0-6 0"
            style={{ fill: "var(--zk-gold)" }}
          />
          <g transform="translate(29 29) scale(.42)">
            <polygon points={Z_POINTS} fill={`url(#${gid})`} />
            <circle cx="47" cy="51" r="8" style={{ fill: "var(--zk-icon-face-lo)", stroke: "var(--zk-gold-pale)", strokeWidth: 4 }} />
          </g>
        </svg>
      </div>
    );
  }

  // wordmark
  return (
    <div
      role="img"
      aria-label="ZECKED"
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--zk-font-display)",
        fontWeight: "var(--zk-fw-black)",
        fontSize: `${fs}px`,
        lineHeight: 1,
        letterSpacing: "-0.035em",
        color: "var(--zk-text)",
        textShadow: `0 ${sh}px 0 var(--zk-purple)`,
      }}
    >
      <svg
        viewBox="0 0 100 100"
        width={zs}
        height={zs}
        aria-hidden="true"
        style={{
          flex: "none",
          overflow: "visible",
          filter: `drop-shadow(0 ${sh}px 0 var(--zk-purple)) drop-shadow(0 0 ${glow}px rgb(var(--zk-gold-rgb) / .55))`,
        }}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--zk-gold-pale)" }} />
            <stop offset="0.55" style={{ stopColor: "var(--zk-gold)" }} />
            <stop offset="1" style={{ stopColor: "var(--zk-gold-amber-deep)" }} />
          </linearGradient>
        </defs>
        <polygon points={Z_POINTS} fill={`url(#${gid})`} />
        <circle cx="47" cy="51" r="8" style={{ fill: "var(--zk-bg)", stroke: "var(--zk-gold-pale)", strokeWidth: 4 }} />
      </svg>
      <span style={{ marginLeft: "-0.02em" }}>ECKED</span>
    </div>
  );
}
