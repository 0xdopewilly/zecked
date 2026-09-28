import { useId, type CSSProperties } from "react";
import type { TierId } from "@/lib/types";
import { Icon } from "@/components/zk/Icon";
import { Logo } from "@/components/zk/Logo";

/** Display names for each tier (design: ZK Emblem NAME map). */
export const TIER_LABEL: Record<TierId, string> = {
  rookie: "Rookie",
  cracker: "Cracker",
  safecracker: "Safecracker",
  vault: "Vault Breaker",
  oracle: "Oracle",
  legend: "Z-Legend",
};

const GLYPH = {
  rookie: "key",
  cracker: "clip",
  safecracker: "dial",
  vault: "vault",
  oracle: "orb",
  legend: "crown",
} as const;

const SHIELD = "M50 3C75 3 95 13 95 37C95 70 73 94 50 105C27 94 5 70 5 37C5 13 25 3 50 3Z";

export interface EmblemProps {
  tier?: TierId;
  /** Width in px (height is 1.12×). Design range 20–240. */
  size?: number;
  locked?: boolean;
  style?: CSSProperties;
  className?: string;
}

const r = (x: number, m = 1) => Math.max(m, Math.round(x));

export function Emblem({ tier: tierProp = "safecracker", size = 96, locked = false, style, className }: EmblemProps) {
  const gid = "zke" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tier: TierId = tierProp in GLYPH ? tierProp : "safecracker";
  const L = !!locked;
  const key = L ? "locked" : tier;
  const w = size;
  const v = (n: string) => `var(--zk-tier-${key}-${n})`;

  const h = r(w * 1.12);
  const hi = v("hi"), mid = v("mid"), lo = v("lo"), edge = v("edge"), ink = v("ink"), glow = v("glow");
  const glowR = r(w * 0.22), glowY = r(w * 0.04);
  const hl = L ? ".08" : ".6";
  const pb = r(w * 0.1);
  const isLegend = tier === "legend" && !L;
  const isGlyph = tier !== "legend" || L;
  const glyph = GLYPH[tier];
  const gs = r(w * 0.44), cs = r(w * 0.26), zs = r(w * 0.34), co = r(w * 0.04);
  const ls = r(w * 0.34, 18), lis = r(w * 0.18, 10);

  return (
    <div
      role="img"
      aria-label={`${TIER_LABEL[tier]} tier${L ? " (locked)" : ""}`}
      className={className}
      style={{
        width: w,
        height: h,
        position: "relative",
        flex: "none",
        filter: `drop-shadow(0 ${glowY}px ${glowR}px ${glow})`,
        ...style,
      }}
    >
      <svg viewBox="0 0 100 112" width={w} height={h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" style={{ stopColor: hi }} />
            <stop offset="0.55" style={{ stopColor: mid }} />
            <stop offset="1" style={{ stopColor: lo }} />
          </linearGradient>
        </defs>
        <path d={SHIELD} transform="translate(0 6)" style={{ fill: edge }} />
        <path d={SHIELD} fill={`url(#${gid})`} />
        <path
          d={SHIELD}
          transform="translate(10 11) scale(.8)"
          style={{ fill: "rgb(var(--zk-black-rgb) / .14)", stroke: "rgb(var(--zk-white-rgb) / .4)", strokeWidth: 3 }}
        />
        <ellipse cx="44" cy="17" rx="22" ry="6.5" style={{ fill: `rgb(var(--zk-white-rgb) / ${hl})` }} />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          paddingBottom: pb,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: ink,
        }}
      >
        {isLegend && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Icon icon="crown" size={cs} filled stroke={1.5} color="var(--zk-gold-pale)" />
            <div style={{ marginTop: -co }}>
              <Logo variant="mark" size={zs} stroke="var(--zk-tier-legend-edge)" />
            </div>
          </div>
        )}
        {isGlyph && <Icon icon={glyph} size={gs} stroke={2.4} />}
      </div>
      {L && (
        <div
          style={{
            position: "absolute",
            right: "-4%",
            bottom: 0,
            width: ls,
            height: ls,
            borderRadius: "50%",
            background: "var(--zk-surface-raised)",
            border: "2px solid var(--zk-bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--zk-text-muted)",
          }}
        >
          <Icon icon="lock" size={lis} stroke={2.4} />
        </div>
      )}
    </div>
  );
}
