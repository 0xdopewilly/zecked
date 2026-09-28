import { useId, type CSSProperties } from "react";
import type { BadgeId } from "@/lib/types";
import { Icon } from "@/components/zk/Icon";

/** Names and unlock rules for each badge (design: ZK Badge + style-guide badge list). */
export const BADGE_META: Record<BadgeId, { name: string; desc: string }> = {
  "first-crack": { name: "First Crack", desc: "Crack your first stash." },
  uncrackable: { name: "Uncrackable", desc: "Hide a stash nobody cracks." },
  oracle: { name: "Oracle", desc: "Call 3 exact scores." },
  "speed-demon": { name: "Speed Demon", desc: "Crack a stash in under 60s." },
  "whale-hider": { name: "Whale Hider", desc: "Hide a stash over $100." },
  shielded: { name: "Shielded", desc: "Claim to your first private wallet." },
  "birthday-og": { name: "Birthday OG", desc: "Play during Zcash’s 10th birthday week." },
};

/** BadgeId → the design's badge id (used by the --zk-badge-{id}-* tokens) and its glyph. */
const B = {
  "first-crack": { token: "first", glyph: "unlock" },
  uncrackable: { token: "uncrackable", glyph: "shield" },
  oracle: { token: "oracle", glyph: "orb" },
  "speed-demon": { token: "speed", glyph: "bolt" },
  "whale-hider": { token: "whale", glyph: "whale" },
  shielded: { token: "shielded", glyph: "mask" },
  "birthday-og": { token: "bday", glyph: "cake" },
} as const satisfies Record<BadgeId, { token: string; glyph: string }>;

let RAYS = "";
for (let i = 0; i < 18; i++) {
  const a = (i * 20 * Math.PI) / 180,
    d = (4.5 * Math.PI) / 180;
  const p = (t: number) => `${(50 + 50 * Math.cos(t)).toFixed(1)} ${(50 + 50 * Math.sin(t)).toFixed(1)}`;
  RAYS += `M50 50L${p(a - d)}L${p(a + d)}Z`;
}

export interface BadgeProps {
  badge?: BadgeId;
  /** px, design range 24–200. */
  size?: number;
  locked?: boolean;
  style?: CSSProperties;
  className?: string;
}

const r = (x: number, m = 1) => Math.max(m, Math.round(x));

export function Badge({ badge = "first-crack", size = 80, locked = false, style, className }: BadgeProps) {
  const gid = "zkb" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const id: BadgeId = badge in B ? badge : "first-crack";
  const b = B[id];
  const L = !!locked;
  const key = L ? "locked" : b.token;
  const s = size;
  const v = (n: string) => `var(--zk-badge-${key}-${n})`;

  const ringA = L ? ".06" : ".45";
  const hl = L ? ".06" : ".6";
  const ink = L ? "var(--zk-text-faint)" : "var(--zk-text)";
  const gf = L ? "none" : "drop-shadow(0 2px 0 rgb(0 0 0 / .3))";
  const gs = r(s * 0.38), ls = r(s * 0.32, 18), lis = r(s * 0.16, 10);

  return (
    <div
      role="img"
      aria-label={`${BADGE_META[id].name} badge${L ? " (locked)" : ""}`}
      className={className}
      style={{ width: s, height: s, position: "relative", flex: "none", ...style }}
    >
      <svg viewBox="0 0 100 100" width={s} height={s} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" style={{ stopColor: v("hi") }} />
            <stop offset="0.55" style={{ stopColor: v("mid") }} />
            <stop offset="1" style={{ stopColor: v("lo") }} />
          </linearGradient>
        </defs>
        <path d={RAYS} style={{ fill: v("ray") }} />
        <circle cx="50" cy="54" r="37" style={{ fill: v("edge") }} />
        <circle cx="50" cy="50" r="37" fill={`url(#${gid})`} />
        <circle
          cx="50"
          cy="50"
          r="30"
          style={{ fill: "none", stroke: `rgb(var(--zk-white-rgb) / ${ringA})`, strokeWidth: 2.5 }}
        />
        <ellipse cx="45" cy="25" rx="17" ry="5.5" style={{ fill: `rgb(var(--zk-white-rgb) / ${hl})` }} />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: ink,
          filter: gf,
        }}
      >
        <Icon icon={b.glyph} size={gs} stroke={2.4} />
      </div>
      {L && (
        <div
          style={{
            position: "absolute",
            right: "4%",
            bottom: "4%",
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
