"use client";
// Lenis smooth scrolling for the website surface (off under prefers-reduced-motion).
import "lenis/dist/lenis.css";
import { ReactLenis, useLenis } from "lenis/react";
import { MotionConfig, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export function SmoothScroll({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <MotionConfig reducedMotion="user">
      {reduce ? (
        children
      ) : (
        <ReactLenis root options={{ lerp: 0.14, smoothWheel: true, wheelMultiplier: 1, syncTouch: false, anchors: { offset: -80 } }}>
          {children}
        </ReactLenis>
      )}
    </MotionConfig>
  );
}

/** Smooth-scroll to a section id (falls back to native scrolling). */
export function useScrollTo() {
  const lenis = useLenis();
  return (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: -72, duration: 1.4 });
    else el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}
