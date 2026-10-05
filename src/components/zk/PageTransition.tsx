"use client";
// Screen-to-screen motion (browser View Transitions via React's <ViewTransition>):
//   "nav-forward" (opening a stash): the new screen pushes in from the right
//   "tab" (tab bar): no view transition at all. Snapshotting the old and new screens (a feed is ~4800px
//     tall) is what made tab switches drag on slow phones; lib/nav.ts declines the browser transition for
//     a "tab" change and the new screen's blocks rise in with a plain CSS animation (globals.css).
//   anything else (back, redirects, links): a soft crossfade
// The tab bar and the test-mode ribbon stay put. Styles live in globals.css (zk-vt-*).
// The wrapper div is what gets animated: it stays put while a screen swaps its own content (a loading
// skeleton for the real stash), which would otherwise cut the animation short.
import { ViewTransition, type ReactNode } from "react";

const MAP = { "nav-forward": "zk-vt-push", "nav-back": "zk-vt-pop", tab: "none", default: "zk-vt-fade" };

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition enter={MAP} exit={MAP} default="none">
      <div className="zk-route">{children}</div>
    </ViewTransition>
  );
}
