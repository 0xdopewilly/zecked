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
//  - Tab switches (transitionTypes ["tab"]) skip the browser view transition altogether: snapshotting a
//    4800px feed twice costs 300-700ms on a slow phone. The page is marked html[data-nav=tab] while the
//    new screen mounts and the screen's blocks rise in with a plain CSS animation instead (globals.css).
//  - Edge-swipe back: on a screen with a ← button, a swipe in from the left edge taps it.
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

const KEY = "zk:in-app";
const BACK_MS = 1500;
const TAB_MS = 700; // a touch longer than the rise-in (300ms), then the marker is gone

// The app's fixed screens (cached, prefetched): going back to one of these is animated (see below).
const STATIC_SCREEN = /^\/(feed|leaderboard|wallet|me|hide|practice|how|sounds|signin|install)\/?$/;
let router: ReturnType<typeof useRouter> | null = null;
let shownPath = "";

if (typeof window !== "undefined") {
  shownPath = window.location.pathname;
  const html = document.documentElement;
  let t: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(t);
    html.removeAttribute("data-nav");
  };
  const mark = (kind: "back" | "tab", ms: number) => {
    html.setAttribute("data-nav", kind);
    clearTimeout(t);
    t = setTimeout(clear, ms);
  };
  // Registered before Next's own listener (this module loads with the layout).
  window.addEventListener("popstate", (e) => {
    mark("back", BACK_MS);
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

  // Tab switches: React starts a view transition for every screen change (types = the Link's
  // transitionTypes). For a pure "tab" change we decline it; React then commits the new screen directly
  // (its own no-view-transition path), and the CSS rise-in on html[data-nav=tab] takes over.
  const proto = Document.prototype;
  const native = proto.startViewTransition;
  if (typeof native === "function") {
    proto.startViewTransition = function (this: Document, arg?: ViewTransitionUpdateCallback | StartViewTransitionOptions) {
      const types = arg && typeof arg === "object" && arg.types ? Array.from(arg.types) : [];
      if (types.length > 0 && types.every((k) => k === "tab")) {
        mark("tab", TAB_MS);
        throw new DOMException("Tab switches mount in place (ZECKED)", "InvalidStateError");
      }
      return native.call(this, arg);
    };
  }

  installEdgeSwipe();
}

/* ---------- edge-swipe back ----------
   iOS standalone apps have no back gesture of their own. On a screen with a ← button, a touch that starts
   within EDGE_PX of the left edge and travels SWIPE_PX to the right (more across than down) taps that
   button, so it does exactly what the button does. The screen follows the finger a little meanwhile
   (only when the dock isn't on it: a transform on the route would carry the fixed dock along).
   Never from a horizontal scroller (the chip row), a text field or an open dialog. */
const EDGE_PX = 20;
const SWIPE_PX = 80;
const NO_SWIPE = ".zk-scroll-x,[role=dialog],[aria-modal=true],input,textarea,select,[data-edge-swipe=off]";
const BACK_BTN = "button[aria-label=Back],a[aria-label=Back]";

function installEdgeSwipe() {
  let sw: { x0: number; y0: number; dx: number; decided: boolean; route: HTMLElement | null; back: HTMLElement } | null = null;
  let resetT: ReturnType<typeof setTimeout> | undefined;

  const settle = (route: HTMLElement | null) => {
    if (!route) return;
    route.style.transition = "transform 220ms var(--zk-ease-out)";
    route.style.transform = "";
    const done = () => {
      route.style.transition = "";
      route.removeEventListener("transitionend", done);
    };
    route.addEventListener("transitionend", done);
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      sw = null;
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      if (touch.clientX > EDGE_PX) return;
      const target = e.target as Element | null;
      if (!target || target.closest(NO_SWIPE)) return;
      const back = document.querySelector<HTMLElement>(BACK_BTN);
      if (!back || back.closest("[role=dialog],[aria-modal=true]")) return;
      const route = document.querySelector<HTMLElement>(".zk-route");
      clearTimeout(resetT);
      sw = { x0: touch.clientX, y0: touch.clientY, dx: 0, decided: false, route: route && !route.querySelector(".zk-dock") ? route : null, back };
    },
    { passive: true, capture: true }
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!sw) return;
      const touch = e.touches[0];
      const dx = touch.clientX - sw.x0;
      const dy = touch.clientY - sw.y0;
      if (!sw.decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        sw.decided = true;
        if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
          sw = null;
          return;
        }
      }
      sw.dx = dx;
      if (sw.route) {
        sw.route.style.transition = "none";
        sw.route.style.transform = `translateX(${Math.round(Math.min(dx, 180) * 0.35)}px)`;
      }
    },
    { passive: true, capture: true }
  );
  const end = (fire: boolean) => {
    if (!sw) return;
    const { dx, route, back, decided } = sw;
    sw = null;
    if (fire && decided && dx >= SWIPE_PX && back.isConnected) {
      back.click();
      // The old screen is on its way out (the pop transition starts from where the finger left it). If the
      // route is still here after that (a same-screen back, like Hide's steps), ease it home.
      resetT = setTimeout(() => route?.isConnected && settle(route), 400);
      return;
    }
    settle(route);
  };
  document.addEventListener("touchend", () => end(true), { passive: true, capture: true });
  document.addEventListener("touchcancel", () => end(false), { passive: true, capture: true });
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
