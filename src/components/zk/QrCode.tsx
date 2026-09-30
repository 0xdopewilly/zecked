"use client";
// A crisp SVG QR code on a white sticker card, with the ZECKED icon in the middle. Drawn with `qrcode`
// (MIT), loaded only when a code is shown. Error correction H, so the icon can cover the centre.
import { useEffect, useState, type CSSProperties } from "react";
import { Logo } from "@/components/zk/Logo";

export interface QrCodeProps {
  value: string;
  /** Card width and height in px. */
  size?: number;
  /** Read out to screen readers. */
  label?: string;
  style?: CSSProperties;
}

/** Quiet zone around the code, in modules (the white card adds a little more). */
const QUIET = 2;

export function QrCode({ value, size = 200, label = "QR code", style }: QrCodeProps) {
  const [qr, setQr] = useState<{ value: string; n: number; d: string; hole: number } | null>(null);
  useEffect(() => {
    let off = false;
    import("qrcode")
      .then((mod) => {
        const create = mod.create ?? (mod as unknown as { default: typeof mod }).default.create;
        const { modules } = create(value, { errorCorrectionLevel: "H" });
        const n = modules.size;
        // Leave a square hole in the middle for the icon (about 22% of the width, odd so it centres).
        let hole = Math.round(n * 0.22);
        if (hole % 2 !== n % 2) hole += 1;
        const h0 = (n - hole) / 2;
        const inHole = (x: number, y: number) => x >= h0 && x < h0 + hole && y >= h0 && y < h0 + hole;
        // One path: a run of dark modules per row becomes one rectangle.
        let d = "";
        for (let y = 0; y < n; y++) {
          let x = 0;
          while (x < n) {
            if (!modules.get(y, x) || inHole(x, y)) {
              x++;
              continue;
            }
            let w = 1;
            while (x + w < n && modules.get(y, x + w) && !inHole(x + w, y)) w++;
            d += `M${x} ${y}h${w}v1h-${w}z`;
            x += w;
          }
        }
        if (!off) setQr({ value, n, d, hole });
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [value]);

  const pad = Math.round(size * 0.05);
  const ready = qr && qr.value === value ? qr : null;
  const span = ready ? ready.n + QUIET * 2 : 1;
  const icon = ready ? Math.round(((size - pad * 2) * (ready.hole - 1)) / span) : Math.round(size * 0.2);
  return (
    <div
      role="img"
      aria-label={label}
      style={{
        position: "relative",
        width: size,
        height: size,
        flex: "none",
        boxSizing: "border-box",
        padding: pad,
        borderRadius: Math.round(size * 0.1),
        background: "#fff",
        border: "2.5px solid var(--zk-ink)",
        boxShadow: "0 4px 0 var(--zk-ink)",
        ...style,
      }}
    >
      {ready ? (
        <svg viewBox={`${-QUIET} ${-QUIET} ${span} ${span}`} width="100%" height="100%" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block" }}>
          <path d={ready.d} fill="#0E0B1F" />
        </svg>
      ) : (
        <div aria-hidden="true" style={{ width: "100%", height: "100%", borderRadius: Math.round(size * 0.05), background: "repeating-linear-gradient(45deg, #EEEAF8 0 6px, #F7F5FC 6px 12px)" }} />
      )}
      <div aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
        <Logo variant="icon" size={icon} />
      </div>
    </div>
  );
}
