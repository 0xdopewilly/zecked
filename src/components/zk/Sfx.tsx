"use client";
// Turns on app sounds and gives every tappable thing a sound by default (one listener for the whole app):
// buttons pop, links and tabs tap, radios/switches/tabs select. Opt out or pick another with data-sfx:
//   <button data-sfx="none">  ·  <button data-sfx="lock">
import { useEffect } from "react";
import { enableSfx, prewarmAudio, sfx, unlockAudio, type Sound } from "@/lib/sfx";

const TAPPABLE = "[data-sfx],button,a[href],[role=button],[role=tab],[role=radio],[role=switch],[role=checkbox],[role=option],summary";

export function Sfx() {
  useEffect(() => {
    enableSfx();
    // The splash plays first; the audio device opens once things are idle, so the first tap is instant.
    const warm = window.setTimeout(prewarmAudio, 2600);
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
    window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    window.addEventListener("keydown", unlock, { capture: true });
    window.addEventListener("touchend", unlock, { capture: true, passive: true });
    document.addEventListener("click", onClick, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      window.removeEventListener("touchend", unlock, { capture: true });
      document.removeEventListener("click", onClick, { capture: true });
      window.clearTimeout(warm);
    };
  }, []);
  return null;
}
