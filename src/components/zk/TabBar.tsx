"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Icon, type IconName } from "@/components/zk/Icon";

/* The floating nav dock: Home · Leaderboard · (+ Hide) · Wallet · Profile. The current tab is a gold circle
   that pops in; Hide is the big raised button in the middle. Styles live in globals.css (.zk-dock). */

export type TabId = "home" | "leaderboard" | "wallet" | "profile";

export interface TabBarProps {
  active?: TabId;
  /** Optional callback, fired on tap alongside navigation. */
  onSelect?: (id: TabId) => void;
}

const TABS: [id: TabId, name: string, icon: IconName, href: string][] = [
  ["home", "Home", "home", "/feed"],
  ["leaderboard", "Leaderboard", "trophy", "/leaderboard"],
  ["wallet", "Wallet", "wallet", "/wallet"],
  ["profile", "Profile", "user", "/me"],
];

const POP_MS = 460;
/** The last tab tapped. The next screen's dock picks the bubble's pop up where this one left off. */
let tapped: { id: TabId; at: number } | null = null;

/** Once the screen is idle, warm the data the other tabs open with, so the first tap on a tab is instant. */
function useWarmTabs(active: TabId) {
  useEffect(() => {
    const warm = () => {
      if (active !== "leaderboard") void api.leaderboard("crackers", "week").catch(() => {});
      if (active !== "profile") {
        void api
          .me()
          .then(({ player }) => (player.account?.signedIn ? api.myStashes() : null))
          .catch(() => {});
      }
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(warm, { timeout: 2500 }) : window.setTimeout(warm, 1500);
    return () => {
      const c = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (c.cancelIdleCallback) c.cancelIdleCallback(id);
      else window.clearTimeout(id);
    };
  }, [active]);
}

export function TabBar({ active = "home", onSelect }: TabBarProps) {
  useWarmTabs(active);
  // The bubble moves on tap, before the next screen arrives.
  const [picked, setPicked] = useState<TabId | null>(null);
  const current = picked ?? active;
  // Arriving from a tab tap: carry on the pop the last screen started (a negative delay), so it plays once.
  const [carry] = useState(() => {
    if (!tapped || tapped.id !== active) return null;
    const t = performance.now() - tapped.at;
    return t < POP_MS ? t : null;
  });
  const [popping, setPopping] = useState(carry !== null);

  const pick = (id: TabId) => {
    onSelect?.(id);
    if (id === current) return;
    tapped = { id, at: performance.now() };
    setPicked(id);
    setPopping(true);
  };

  const tab = ([id, name, icon, href]: (typeof TABS)[number]) => {
    const on = id === current;
    return (
      <Link
        key={id}
        href={href}
        transitionTypes={["tab"]}
        aria-current={on ? "page" : undefined}
        aria-label={name}
        onClick={() => pick(id)}
        className={on && popping ? "zk-dock-item is-pop" : "zk-dock-item"}
        style={on && carry !== null && !picked ? { animationDelay: `-${Math.round(carry)}ms` } : undefined}
        onAnimationEnd={() => setPopping(false)}
      >
        <Icon icon={icon} size={23} stroke={on ? 2.6 : 2.2} />
      </Link>
    );
  };

  return (
    <nav aria-label="Main" className="zk-dock">
      {TABS.slice(0, 2).map(tab)}
      <Link href="/hide" transitionTypes={["nav-forward"]} aria-label="Hide a stash" data-sfx="pop" className="zk-dock-hide">
        <Icon icon="plus" size={28} stroke={3.4} />
      </Link>
      {TABS.slice(2).map(tab)}
    </nav>
  );
}
