"use client";
// The app's launch screen: plays once each time ZECKED opens (a new tab or a home-screen launch), not on
// in-app navigation or reloads within the same visit. The vault pops in, the dial spins, the door swings
// open onto the gold, ZECKED bounces in, the door swings shut, and the vault rushes at you as the splash
// dissolves into home (home's blocks rise in behind it: html[data-splash-exit], see globals.css).
// It is server-rendered so it covers the very first paint; a tiny head script (layout.tsx) hides it
// before paint when this visit has already seen it. Tap anywhere to skip.
// Timing: the very first open on a device plays the whole vault cycle. Every open after that holds only
// a beat (HOLD_MS) and steps aside as soon as home has something to show (the zk:ready event from the
// feed), so a fast phone is on home in about a second instead of 3.4s.
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/zk/Logo";
import { Vault } from "@/components/zk/Vault";
import { SPLASH_KEY } from "@/lib/splash";

const FIRST_KEY = "zk:launched"; // localStorage: this device has opened the app before
const FULL_HOLD_MS = 1850; // first ever open: the door has just shut
const HOLD_MS = 900; // every open after that: the vault has popped in and the dial has spun
const OUT_MS = 660;
const WAIT_MS = 1200; // the longest it holds on for home's first data
const SETTLE_MS = 900; // home's rise-in, after the splash is gone

/** Whether this page load opened with the splash already seen this visit (null until the first mount). */
let seenAtLoad: boolean | null = null;

/** Starts the exit: home rises in underneath, then the splash is marked done for this visit. Taps work
 *  throughout (the splash stops taking pointer events as it fades: .zk-splash.is-out). */
function exitStarted() {
  const html = document.documentElement;
  html.setAttribute("data-splash-exit", "");
  window.setTimeout(() => {
    html.setAttribute("data-splashed", "");
    html.removeAttribute("data-splash-exit");
  }, OUT_MS + SETTLE_MS);
}

/** The first open ever on this device? (Remembers it either way.) */
function firstOpen(): boolean {
  try {
    if (localStorage.getItem(FIRST_KEY)) return false;
    localStorage.setItem(FIRST_KEY, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

export function LaunchSplash() {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");
  const timers = useRef<number[]>([]);

  const out = useRef(false);
  const leave = () => {
    if (out.current) return;
    out.current = true;
    exitStarted();
    setPhase("out");
    timers.current.push(window.setTimeout(() => setPhase("gone"), OUT_MS));
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  useEffect(() => {
    // Decided once per page load, so a remount (React's dev double-run included) never cuts it short.
    if (seenAtLoad === null) {
      seenAtLoad = false;
      try {
        seenAtLoad = sessionStorage.getItem(SPLASH_KEY) === "1";
        sessionStorage.setItem(SPLASH_KEY, "1");
      } catch {}
    }
    if (seenAtLoad) {
      document.documentElement.setAttribute("data-splashed", "");
      setPhase("gone");
      return;
    }
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const full = firstOpen();
    // The CSS animation started at first paint (before JS ran): time the exit from that paint, so a slow
    // network or a slow phone never cuts the splash short and a fast one never makes it drag.
    const paint = performance.getEntriesByType?.("paint").find((e) => e.name === "first-paint")?.startTime;
    const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    const shownAt = paint ?? nav?.responseEnd ?? 0;
    const hold = Math.max(250, (reduce ? 600 : full ? FULL_HOLD_MS : HOLD_MS) - (performance.now() - shownAt));
    const onReady = () => leaveRef.current();
    // Home (the feed) says when it has something to show (zk:ready). Any other screen opened cold (a
    // shared stash link, the wallet) never does, so those leave right after the hold.
    const isHome = /^\/(feed)?\/?$/.test(window.location.pathname);
    timers.current.push(
      window.setTimeout(() => {
        const w = window as Window & { __zkReady?: boolean };
        if (w.__zkReady === true || !isHome) return leaveRef.current();
        window.addEventListener("zk:ready", onReady, { once: true });
        timers.current.push(window.setTimeout(onReady, WAIT_MS));
      }, hold)
    );
    const t = timers.current;
    return () => {
      t.forEach(clearTimeout);
      window.removeEventListener("zk:ready", onReady);
    };
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
