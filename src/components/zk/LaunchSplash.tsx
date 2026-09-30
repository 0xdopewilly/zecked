"use client";
// The app's launch screen: plays once each time ZECKED opens (a new tab or a home-screen launch), not on
// in-app navigation or reloads within the same visit. The vault pops in, the dial spins, the door swings
// open onto the gold, ZECKED bounces in, the door swings shut, and the splash zooms away into the app.
// It is server-rendered so it covers the very first paint; a tiny head script (layout.tsx) hides it
// before paint when this visit has already seen it. Tap anywhere to skip.
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/zk/Logo";
import { Vault } from "@/components/zk/Vault";
import { SPLASH_KEY } from "@/lib/splash";

const HOLD_MS = 1950;
const OUT_MS = 420;

export function LaunchSplash() {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");
  const timers = useRef<number[]>([]);

  const leave = () => {
    if (phase !== "in") return;
    setPhase("out");
    timers.current.push(window.setTimeout(() => setPhase("gone"), OUT_MS));
  };

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SPLASH_KEY) === "1";
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {}
    if (seen) {
      setPhase("gone");
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // The CSS animation started at first paint (before JS ran): time the exit from that paint, so a slow
    // network or a slow phone never cuts the splash short and a fast one never makes it drag.
    const paint = performance.getEntriesByType?.("paint").find((e) => e.name === "first-paint")?.startTime;
    const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    const shownAt = paint ?? nav?.responseEnd ?? 0;
    const hold = Math.max(250, (reduce ? 600 : HOLD_MS) - (performance.now() - shownAt));
    timers.current.push(window.setTimeout(() => setPhase("out"), hold));
    timers.current.push(window.setTimeout(() => setPhase("gone"), hold + OUT_MS));
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  if (phase === "gone") return null;
  return (
    <div className={`zk-splash${phase === "out" ? " is-out" : ""}`} onClick={leave} role="presentation" aria-hidden="true">
      <div className="zk-splash-sun" />
      <div className="zk-splash-stage">
        <div className="zk-splash-vault">
          <Vault mode="splash" size={210} />
        </div>
        <div className="zk-splash-word">
          <Logo variant="wordmark" size={46} />
        </div>
        <p className="zk-splash-tag">Hide it. Crack it. Get Zecked.</p>
      </div>
    </div>
  );
}
