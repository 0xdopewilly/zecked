/* Port of "ZK Live Badge": live soft (pulsing ring) · live solid (blinking dot) · ended. */

export type LiveBadgeSize = "sm" | "md" | "lg";
export type LiveBadgeVariant = "soft" | "solid";
export type LiveBadgeState = "live" | "ended";

export interface LiveBadgeProps {
  label?: string;
  size?: LiveBadgeSize;
  variant?: LiveBadgeVariant;
  state?: LiveBadgeState;
}

const SIZES: Record<LiveBadgeSize, { pad: string; fs: string; dot: string; gap: string }> = {
  sm: { pad: "var(--zk-space-4) var(--zk-space-10) var(--zk-space-4) var(--zk-space-8)", fs: "var(--zk-fs-10)", dot: "7px", gap: "var(--zk-space-6)" },
  md: { pad: "var(--zk-space-6) var(--zk-space-12) var(--zk-space-6) var(--zk-space-10)", fs: "var(--zk-fs-12)", dot: "8px", gap: "var(--zk-space-8)" },
  lg: { pad: "var(--zk-space-10) var(--zk-space-18) var(--zk-space-10) var(--zk-space-14)", fs: "var(--zk-fs-16)", dot: "11px", gap: "var(--zk-space-10)" },
};

export function LiveBadge({ label, size = "sm", variant = "soft", state = "live" }: LiveBadgeProps) {
  const sz = SIZES[size] || SIZES.sm;
  const ended = state === "ended";
  const solid = variant === "solid";
  const bg = ended ? "var(--zk-surface-raised)" : solid ? "var(--zk-mint)" : "var(--zk-mint-tint)";
  const bd = ended ? "var(--zk-border)" : solid ? "var(--zk-mint)" : "rgb(var(--zk-mint-rgb) / .3)";
  const fg = ended ? "var(--zk-text-muted)" : solid ? "var(--zk-mint-ink)" : "var(--zk-mint)";
  const dotC = ended ? "var(--zk-text-faint)" : solid ? "var(--zk-mint-ink)" : "var(--zk-mint)";
  const anim = ended || !solid ? "none" : "zk-glow 1s ease-in-out infinite";
  const ringAnim = ended || solid ? "none" : "zk-ping var(--zk-dur-pulse) ease-out infinite";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: sz.gap,
        padding: sz.pad,
        borderRadius: "var(--zk-radius-pill)",
        background: bg,
        border: `1px solid ${bd}`,
        color: fg,
        font: `var(--zk-fw-black) ${sz.fs}/1 var(--zk-font-body)`,
        letterSpacing: "var(--zk-track-badge)",
        whiteSpace: "nowrap",
        flex: "none",
        textTransform: "uppercase",
      }}
    >
      <span style={{ position: "relative", width: sz.dot, height: sz.dot, flex: "none" }} aria-hidden="true">
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            background: dotC,
            opacity: 0.7,
            animation: ringAnim,
            willChange: "transform,opacity",
          }}
        />
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: dotC, animation: anim }} />
      </span>
      {label ?? (ended ? "Ended" : "Live · verified")}
    </div>
  );
}
