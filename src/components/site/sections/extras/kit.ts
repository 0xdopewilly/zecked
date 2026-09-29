"use client";
// Small shared helpers for the WhyZcash / LiveStats / GetTestZec / Faq / FinalCta / Footer sections.
import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

/** Deterministic PRNG (mulberry32). Same seed gives the same numbers on server and client. */
export function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * prefers-reduced-motion, but hydration-safe: always `false` on the server and on the first
 * client render, then the real value after mount. Use this (not useReducedMotion) whenever the
 * answer changes rendered markup or inline styles.
 */
export function useReduced() {
  const r = useReducedMotion();
  const [v, setV] = useState(false);
  useEffect(() => setV(!!r), [r]);
  return v;
}

/** useId, cleaned so it is safe inside url(#…) references. */
export function useSafeId(prefix: string) {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

/* Page-wide "is the user scrolling right now" flag: true from the first scroll event until 160ms after the last. */
let scrolling = false;
let idleTimer = 0;
const scrollSubs = new Set<() => void>();
function onScroll() {
  if (!scrolling) {
    scrolling = true;
    scrollSubs.forEach((f) => f());
  }
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    scrolling = false;
    scrollSubs.forEach((f) => f());
  }, 160);
}
function subscribeScrolling(cb: () => void) {
  if (scrollSubs.size === 0) window.addEventListener("scroll", onScroll, { passive: true });
  scrollSubs.add(cb);
  return () => {
    scrollSubs.delete(cb);
    if (scrollSubs.size === 0) window.removeEventListener("scroll", onScroll);
  };
}
export function useScrolling() {
  return useSyncExternalStore(subscribeScrolling, () => scrolling, () => false);
}

/**
 * Scene state for in-view SVG illustrations.
 * on:   has entered the viewport once (play the intro).
 * live: on screen, not mid-scroll, and motion allowed (run the loops). SVG loops repaint the whole
 *       drawing every frame, so they rest while the page scrolls and pick up again when it stops.
 */
export function useScene(amount = 0.35) {
  const ref = useRef<HTMLDivElement>(null);
  const started = useInView(ref, { once: true, amount });
  const visible = useInView(ref, { amount: 0.05 });
  const reduce = useReduced();
  const moving = useScrolling();
  return { ref, on: started, live: started && visible && !reduce && !moving, reduce };
}

/** Rotate/scale an SVG element around its own centre. */
export const FB = { transformBox: "fill-box", transformOrigin: "50% 50%" } as const;

/**
 * fx.tsx SplitText puts each word's trailing space inside an inline-block, where browsers collapse it
 * ("OnlypossibleonZcash"). Preserving whitespace inside the word spans restores the gaps, and stays
 * harmless if SplitText is later fixed to put the space outside. Add className "zkx-split" to SplitText.
 */
export const SPLIT_FIX_CSS = ".zkx-split > span { white-space: pre; }";

export const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Illustration palette (hex mirrors of zk-tokens.css, for SVG attributes). */
export const K = {
  ink: "#1E1257",
  night: "#2B1880",
  shade: "#3A22A8",
  vivid: "#6444F0",
  purple: "#7C5CFF",
  purpleLight: "#A48CFF",
  purplePale: "#E3DBFF",
  purpleDeep: "#4A2BC7",
  gold: "#F4B728",
  goldLight: "#FFD869",
  goldPale: "#FFE9A3",
  goldDeep: "#B9811A",
  goldShadow: "#8A5A08",
  goldInk: "#2A1B00",
  rim: "#8A620E",
  bolt: "#C88A12",
  boltEdge: "#6B4708",
  hubInk: "#3A2600",
  faceHi: "#43388A",
  faceLo: "#1E1840",
  mint: "#2EE6A6",
  mintLight: "#B6FFE6",
  mintDeep: "#129A6C",
  mintInk: "#062A1E",
  sky: "#3DB8FF",
  skyLight: "#8FDBFF",
  skyDeep: "#1C79B0",
  pink: "#FF4D9A",
  pinkLight: "#FF8FBF",
  pinkDeep: "#A8266A",
  pinkShade: "#C73A7E",
  surface: "#1A1533",
  muted: "#A9A3C9",
  paper: "#FFF9EC",
} as const;
