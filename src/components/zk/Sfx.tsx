"use client";
// Turns on app sounds and gives every tappable thing a sound by default (one listener for the whole app):
// buttons pop, links and tabs tap, radios/switches/tabs select. Opt out or pick another with data-sfx:
//   <button data-sfx="none">  ·  <button data-sfx="lock">
// Also marks the page while it's in the background (html[data-hidden]) so looping animations pause.
import { useEffect } from "react";
import { enableSfx, prewarmAudio, sfx, unlockAudio, type Sound } from "@/lib/sfx";

const TAPPABLE = "[data-sfx],button,a[href],[role=button],[role=tab],[role=radio],[role=switch],[role=checkbox],[role=option],summary";

/** Runs `fn` once the launch splash is gone (html[data-splashed]) and the main thread is idle. Opening
 *  the audio device costs ~100ms of main thread; it used to land right on home's rise-in and first taps. */
function afterSplashIdle(fn: () => void): () => void {
  const html = document.documentElement;
  let idle = 0;
  let mo: MutationObserver | null = null;
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  const go = () => {
    mo?.disconnect();
    mo = null;
    if (w.requestIdleCallback) idle = w.requestIdleCallback(fn, { timeout: 4000 });
    else idle = window.setTimeout(fn, 1500);
  };
  if (html.hasAttribute("data-splashed")) go();
  else {
    mo = new MutationObserver(() => html.hasAttribute("data-splashed") && go());
    mo.observe(html, { attributes: true, attributeFilter: ["data-splashed"] });
  }
  return () => {
    mo?.disconnect();
    if (!idle) return;
    if (w.cancelIdleCallback) w.cancelIdleCallback(idle);
    else window.clearTimeout(idle);
  };
}

export function Sfx() {
  useEffect(() => {
    enableSfx();
    const stopWarm = afterSplashIdle(prewarmAudio);
    const unlock = () => unlockAudio();
    const onClick = (e: MouseEvent) => {
      unlockAudio(); // iOS only unlocks audio on a completed tap (touchend/click), not on touchstart
      const el = (e.target as Element | null)?.closest?.(TAPPABLE);
      if (!el || el.matches(":disabled,[aria-disabled=true]")) return;
      const want = el.getAttribute("data-sfx");
      if (want === "none") return;
      if (want) return sfx(want as Sound);
      if (el.matches("[role=radio],[role=tab],[role=switch],[role=checkbox],[role=option]")) return sfx("select");
      if (el.tagName === "A") return sfx("tap");
      sfx("pop");
    };
    // Background tab / app switcher / lock screen: pause the sunbursts, pings and other loops (globals.css).
    const onVisibility = () => {
      if (document.hidden) document.documentElement.setAttribute("data-hidden", "");
      else document.documentElement.removeAttribute("data-hidden");
    };
    onVisibility();
    window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    window.addEventListener("keydown", unlock, { capture: true });
    window.addEventListener("touchend", unlock, { capture: true, passive: true });
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      window.removeEventListener("touchend", unlock, { capture: true });
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      document.documentElement.removeAttribute("data-hidden");
      stopWarm();
    };
  }, []);
  return null;
}
