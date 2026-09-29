"use client";
// Small hydration-safe hooks shared by the HowItWorks and Games sections.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { useMotionValueEvent, type MotionValue } from "motion/react";

/** matchMedia as external state. Hydrates with `serverValue`, then re-renders once with the real value. */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** prefers-reduced-motion that never causes a hydration mismatch (false on the server and during hydration). */
export function useReducedSafe(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)", false);
}

/**
 * Maps a motion value to a primitive piece of React state. Re-renders only when the mapped value changes,
 * so a scroll-linked value can drive discrete UI phases without re-rendering every frame.
 */
export function useMotionState<T extends string | number | boolean>(mv: MotionValue<number>, map: (v: number) => T): T {
  const mapRef = useRef(map);
  useEffect(() => {
    mapRef.current = map;
  });
  const [s, setS] = useState<T>(() => map(mv.get()));
  useMotionValueEvent(mv, "change", (v) => {
    const n = mapRef.current(v);
    setS((p) => (p === n ? p : n));
  });
  return s;
}


/** Element size via ResizeObserver. Returns `fallback` until measured. */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>, fallback: { w: number; h: number }) {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setSize((p) => (p.w === w && p.h === h ? p : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Outer PhoneFrame height for a given frame width (the frame renders a 390×844 screen plus 12px padding). */
export const phoneHeight = (width: number) => ((width - 24) / 390) * 844 + 24;
/** Inverse of phoneHeight. */
export const phoneWidthForHeight = (height: number) => ((height - 24) * 390) / 844 + 24;
