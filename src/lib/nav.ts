"use client";
// In-app navigation helpers.
//  - NavTracker (mounted once in the app layout) notes when this tab has moved around inside ZECKED.
//  - useAppBack(): the ← button. Goes back only when the previous page is ours (instant, like a native
//    app's back); a shared link opened fresh (from X, Telegram, a new tab) slides over to `fallback`
//    instead of leaving the app.
//    (A hand-rolled view transition around router.back() stalled the next navigation by ~2s: removed.)
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

const KEY = "zk:in-app";

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
  // Compare paths (not a "first run" flag): effects run twice in dev StrictMode, and only a real path
  // change means we moved inside the app.
  const prev = useRef(path);
  useEffect(() => {
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
