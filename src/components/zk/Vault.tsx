import { useId, type CSSProperties } from "react";

export type VaultMode = "closed" | "loop" | "open" | "spin";

export interface VaultProps {
  mode?: VaultMode;
  /** px, design range 60–400. */
  size?: number;
  style?: CSSProperties;
  className?: string;
}

let BOLTS = "";
for (let i = 0; i < 8; i++) {
  const a = (i * Math.PI) / 4 - Math.PI / 2,
    x = 50 + 37 * Math.cos(a),
    y = 50 + 37 * Math.sin(a);
  BOLTS += `M${(x - 3.2).toFixed(2)} ${y.toFixed(2)}a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0`;
}

const HANDLE_ROTATIONS = [undefined, "rotate(60 50 50)", "rotate(120 50 50)"];

/* Bricolage Grotesque ExtraBold "Z" (font units, 1000/em, advance 577) drawn as a path: SVG <text> gets its
   layout redone every frame inside the animated door, a path never does. Placed where the centred text sat. */
const Z_GLYPH = "M33 0V152L355 514V526H43V660H531V494L220 145V134H544V0Z";
const zAt = (cx: number, baseline: number, size: number) =>
  `translate(${(cx - (0.577 * size) / 2).toFixed(3)} ${baseline}) scale(${size / 1000} ${-size / 1000})`;

export function Vault({ mode = "loop", size = 260, style, className }: VaultProps) {
  const gid = "zkv" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const m = mode;
  const s = size;
  const r = Math.round;
  const glow = r(s * 0.35), rim = r(s * 0.04), ds = r(s * 0.1), dsb = r(s * 0.12);

  const doorTf = m === "open" ? "perspective(1000px) rotateY(-118deg)" : "none";
  const doorAnim = m === "loop" ? "zk-door var(--zk-dur-vault-cycle) var(--zk-ease-in-out) infinite" : "none";
  const dialAnim =
    m === "loop"
      ? "zk-dial var(--zk-dur-vault-cycle) var(--zk-ease-in-out) infinite"
      : m === "spin"
        ? "zk-dial 3s var(--zk-ease-in-out) infinite"
        : "none";
  const coreAnim = m === "loop" ? "zk-glow var(--zk-dur-vault-cycle) ease-in-out infinite" : "none";

  return (
    <div
      role="img"
      aria-label="Vault door"
      className={className}
      style={{ position: "relative", width: s, height: s, flex: "none", ...style }}
    >
      {/* Glowing core behind the door */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background:
            "radial-gradient(circle,var(--zk-vault-core) 0%,var(--zk-gold) 38%,var(--zk-vault-core-lo) 68%,var(--zk-surface-raised) 71%)",
          boxShadow: `0 0 ${glow}px rgb(var(--zk-gold-rgb) / .6),inset 0 0 0 ${rim}px var(--zk-surface-raised)`,
          animation: coreAnim,
          willChange: m === "loop" ? "opacity" : undefined,
        }}
      />
      {/* Coin stack inside */}
      <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <g style={{ stroke: "var(--zk-gold-deep)", strokeWidth: 1.2 }}>
          <ellipse cx="50" cy="66" rx="21" ry="6.5" style={{ fill: "var(--zk-gold-deep)" }} />
          <ellipse cx="50" cy="64" rx="21" ry="6.5" style={{ fill: "var(--zk-gold-light)" }} />
          <ellipse cx="50" cy="59" rx="18" ry="6" style={{ fill: "var(--zk-gold-deep)" }} />
          <ellipse cx="50" cy="57" rx="18" ry="6" style={{ fill: "var(--zk-gold-light)" }} />
          <ellipse cx="50" cy="52.5" rx="15" ry="5.5" style={{ fill: "var(--zk-gold-deep)" }} />
          <ellipse cx="50" cy="50.5" rx="15" ry="5.5" style={{ fill: "var(--zk-gold-pale)" }} />
        </g>
        <path d={Z_GLYPH} transform={zAt(50, 53, 7)} style={{ fill: "var(--zk-gold-deep)" }} />
      </svg>
      {/* Door (hinged on the left). The door, its shadow and the dial are separate layers so the
          animations only move pixels (GPU) and never re-rasterize the SVG or re-blur a filter. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: "0% 50%",
          willChange: m === "loop" ? "transform" : undefined,
          transform: doorTf,
          animation: doorAnim,
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: "0.5%",
            borderRadius: "50%",
            boxShadow: `0 ${ds}px ${dsb}px rgb(var(--zk-black-rgb) / .5)`,
          }}
        />
        <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: "absolute", inset: 0, display: "block", overflow: "visible" }}>
          <defs>
            <radialGradient id={`${gid}f`} cx="0.35" cy="0.28" r="0.8">
              <stop offset="0" style={{ stopColor: "var(--zk-vault-face-hi)" }} />
              <stop offset="1" style={{ stopColor: "var(--zk-vault-face-lo)" }} />
            </radialGradient>
            <linearGradient id={`${gid}g`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: "var(--zk-gold-pale)" }} />
              <stop offset="1" style={{ stopColor: "var(--zk-vault-bolt)" }} />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="49.5" style={{ fill: "var(--zk-vault-rim)" }} />
          <circle cx="50" cy="50" r="47" style={{ fill: "var(--zk-gold)" }} />
          <circle cx="50" cy="50" r="44" fill={`url(#${gid}f)`} />
          <path d={BOLTS} fill={`url(#${gid}g)`} style={{ stroke: "var(--zk-vault-bolt-edge)", strokeWidth: 0.6 }} />
          <circle
            cx="50"
            cy="50"
            r="29"
            style={{ fill: "none", stroke: "rgb(var(--zk-gold-rgb) / .35)", strokeWidth: 1.5, strokeDasharray: "3 3" }}
          />
        </svg>
        {/* Dial (handles + hub) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: "50% 50%",
            willChange: dialAnim !== "none" ? "transform" : undefined,
            animation: dialAnim,
          }}
        >
          <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ display: "block", overflow: "visible" }}>
            <defs>
              <linearGradient id={`${gid}h`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: "var(--zk-gold-pale)" }} />
                <stop offset="1" style={{ stopColor: "var(--zk-vault-bolt)" }} />
              </linearGradient>
            </defs>
            {HANDLE_ROTATIONS.map((tf, i) => (
              <rect key={i} x="23" y="47.3" width="54" height="5.4" rx="2.7" transform={tf} fill={`url(#${gid}h)`} />
            ))}
            <circle cx="50" cy="50" r="11.5" fill={`url(#${gid}h)`} style={{ stroke: "var(--zk-gold-deep)", strokeWidth: 1.2 }} />
            <path d={Z_GLYPH} transform={zAt(50, 54.5, 13)} style={{ fill: "var(--zk-vault-hub-ink)" }} />
          </svg>
        </div>
      </div>
    </div>
  );
}
