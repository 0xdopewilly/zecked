import type { CSSProperties } from "react";

/** Stash-shaped placeholder: shown by the route's loading.tsx the instant a stash is tapped, and while its data loads. */
export function StashSkeleton() {
  const bar = (w: string, h: number, extra: CSSProperties = {}): CSSProperties => ({
      width: w,
      height: h,
      borderRadius: "var(--zk-radius-md)",
      background: "rgb(var(--zk-white-rgb) / .07)",
      animation: "zk-glow 1.4s ease-in-out infinite",
      ...extra,
    });
  return (
      <main className="zk-screen" style={{ background: "var(--zk-bg-hero-purple)", gap: "var(--zk-space-18)" }} aria-busy="true" aria-label="Loading stash">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div style={bar("44px", 44, { borderRadius: "var(--zk-radius-lg)" })} />
          <div style={bar("44px", 44, { borderRadius: "var(--zk-radius-lg)" })} />
        </div>
        <div style={{ display: "flex", gap: "var(--zk-space-10)", alignItems: "center" }}>
          <div style={bar("48px", 48, { borderRadius: "var(--zk-radius-lg)" })} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={bar("40%", 12)} />
            <div style={bar("60%", 14)} />
          </div>
        </div>
        <div style={bar("100%", 180, { borderRadius: "var(--zk-radius-2xl)" })} />
        <div style={bar("70%", 30)} />
        <div style={bar("100%", 60, { borderRadius: "var(--zk-radius-xl)" })} />
        <div style={{ marginTop: "auto", ...bar("100%", 64, { borderRadius: "var(--zk-radius-2xl)" }) }} />
      </main>
  );
}
