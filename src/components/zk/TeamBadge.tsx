/* Port of "ZK Team Badge": colored circle + 3-letter code. Never club crests. */

export interface TeamBadgeProps {
  code?: string;
  /** Any CSS background: a color, a var(--zk-team-*) token, or a gradient. */
  color?: string;
  ink?: string;
  size?: number;
}

export function TeamBadge({ code, color, ink, size }: TeamBadgeProps) {
  const s = size ?? 40;
  const r = (x: number, m = 1) => Math.max(m, Math.round(x));
  const label = code ?? "BAR";
  const fs = r(s * 0.27);
  const bw = r(s * 0.05, 2);
  const d = r(s * 0.07, 2);
  return (
    <div
      role="img"
      aria-label={label}
      style={{
        width: `${s}px`,
        height: `${s}px`,
        borderRadius: "50%",
        background: color ?? "var(--zk-purple)",
        color: ink ?? "var(--zk-text)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `var(--zk-fw-black) ${fs}px/1 var(--zk-font-display)`,
        border: `${bw}px solid var(--zk-text)`,
        boxShadow: `0 ${d}px 0 rgb(var(--zk-black-rgb) / .4)`,
        boxSizing: "border-box",
        flex: "none",
      }}
    >
      {label}
    </div>
  );
}
