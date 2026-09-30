"use client";
// In-app navigation helpers.
//  - NavTracker (mounted once in the app layout) notes when this tab has moved around inside ZECKED.
//  - useAppBack(): the ← button. Goes back only when the previous page is ours (instant, like a native
//    app's back); a shared link opened fresh (from X, Telegram, a new tab) slides over to `fallback`
//    instead of leaving the app.
//    (A hand-rolled view transition around router.back() stalled the next navigation by ~2s: removed.)
//  - Going back through history (the ← button, the browser's back, Android's back) marks the page with
//    html[data-nav=back] for a moment (the feed uses it to restore its scroll), and back to one of the
//    fixed screens slides back like a native app instead of just swapping (see the popstate listener).
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

const KEY = "zk:in-app";
const BACK_MS = 1500;

// The app's fixed screens (cached, prefetched): going back to one of these is animated (see below).
const STATIC_SCREEN = /^\/(feed|leaderboard|wallet|me|hide|practice|how|sounds|signin|install)\/?$/;
let router: ReturnType<typeof useRouter> | null = null;
let shownPath = "";

if (typeof window !== "undefined") {
  shownPath = window.location.pathname;
  let t: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(t);
    document.documentElement.removeAttribute("data-nav");
  };
  // Registered before Next's own listener (this module loads with the layout).
  window.addEventListener("popstate", (e) => {
    document.documentElement.setAttribute("data-nav", "back");
    clearTimeout(t);
    t = setTimeout(clear, BACK_MS);
    // Next applies back/forward instantly, with no screen transition. Back to one of the fixed screens, we
    // replay it as an animated navigation instead (they're cached, so it's just as quick). Same-screen
    // history (Hide's steps) and pages that must come back exactly as they were are left to Next.
    const to = window.location.pathname;
    const state = e.state as { __NA?: unknown } | null;
    if (!router || !state?.__NA || to === shownPath || !STATIC_SCREEN.test(to)) return;
    e.stopImmediatePropagation();
    router.replace(to + window.location.search + window.location.hash, { scroll: false, transitionTypes: ["nav-back"] });
  });
  // Cleared once it's over, or as soon as you tap something (the next change has its own direction).
  document.addEventListener("pointerdown", clear, { capture: true, passive: true });
}

function markInApp() {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {}
}
function wasInApp() {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function NavTracker() {
  const path = usePathname();
  const r = useRouter();
  useEffect(() => {
    router = r;
  }, [r]);
  // Compare paths (not a "first run" flag): effects run twice in dev StrictMode, and only a real path
  // change means we moved inside the app.
  const prev = useRef(path);
  useEffect(() => {
    shownPath = path;
    if (prev.current === path) return;
    prev.current = path;
    markInApp();
  }, [path]);
  return null;
}

export function useAppBack(fallback = "/feed") {
  const router = useRouter();
  return () => {
    if (wasInApp() && window.history.length > 1) router.back();
    else router.push(fallback, { transitionTypes: ["nav-back"] });
  };
}
