"use client";
// Screen 08c as an in-app toast: the hider's "Your stash just got ZECKED 🔓" push, sliding in from the top.
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/zk";

export interface HiderToastProps {
  /** Headline, e.g. "Your stash just got ZECKED 🔓 by a mystery cracker". */
  text: string;
  /** Detail line, e.g. "“The map was right there 🗺️” · 38 tries · cracked in 4m 12s". */
  meta?: string;
  /** Called after the toast has slid away (auto after 6s, or on tap). */
  onClose: () => void;
  /** Tap action (e.g. open the stash); the toast still slides away. */
  onTap?: () => void;
}

const SHOW_MS = 6000;
const EXIT_MS = 320;

export function HiderToast({ text, meta, onClose, onTap }: HiderToastProps) {
  const [shown, setShown] = useState(false);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    setShown(false);
    exitTimer.current = setTimeout(() => onCloseRef.current(), EXIT_MS);
  }, []);

  useEffect(() => {
    // Two frames so the off-screen position paints before the slide-in transition starts.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setShown(true));
    });
    const t = setTimeout(dismiss, SHOW_MS);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t);
      clearTimeout(exitTimer.current);
    };
  }, [dismiss]);

  return (
    <div
      style={{
        position: "fixed",
        top: "calc(var(--zk-fixed-top) + var(--zk-space-12))",
        left: "50%",
        width: "calc(min(100vw, 430px) - 2 * var(--zk-space-12))",
        zIndex: 85,
        transform: `translateX(-50%) translateY(${shown ? "0" : "calc(-100% - 60px)"})`,
        opacity: shown ? 1 : 0,
        transition: shown
          ? `transform 480ms var(--zk-ease-spring), opacity var(--zk-dur-base) var(--zk-ease-out)`
          : `transform ${EXIT_MS}ms var(--zk-ease-in-out), opacity ${EXIT_MS}ms var(--zk-ease-in-out)`,
      }}
    >
      <div
        role="alert"
        aria-live="assertive"
        onClick={() => {
          onTap?.();
          dismiss();
        }}
        style={{
          background: "linear-gradient(rgb(var(--zk-white-rgb) / .16), rgb(var(--zk-white-rgb) / .16)), var(--zk-scrim)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: "var(--zk-radius-2xl)",
          padding: "var(--zk-space-14)",
          display: "flex",
          gap: "var(--zk-space-12)",
          boxShadow: "var(--zk-shadow-float)",
          color: "var(--zk-text)",
          fontFamily: "var(--zk-font-body)",
          cursor: "pointer",
        }}
      >
        <div style={{ flex: "none" }}>
          <Logo variant="icon" size={40} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", font: "var(--zk-type-caption)", color: "rgb(var(--zk-white-rgb) / .7)" }}>
            <span>ZECKED</span>
            <span>now</span>
          </div>
          <div style={{ font: "var(--zk-type-h4)", marginTop: "var(--zk-space-2)", overflowWrap: "anywhere" }}>{text}</div>
          {meta && (
            <div
              style={{
                font: "var(--zk-type-small)",
                fontWeight: "var(--zk-fw-medium)",
                color: "rgb(var(--zk-white-rgb) / .85)",
                marginTop: "var(--zk-space-4)",
                overflowWrap: "anywhere",
              }}
            >
              {meta}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default HiderToast;
