"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/zk/Icon";

/* Port of "ZK Tab Bar": Home · Leaderboard · Hide · Profile, fixed to the bottom of the app column. */

export type TabId = "home" | "leaderboard" | "hide" | "profile";

export interface TabBarProps {
  active?: TabId;
  /** Optional callback, fired on tap alongside navigation. */
  onSelect?: (id: TabId) => void;
}

const TABS: [id: TabId, label: string, icon: IconName, href: string][] = [
  ["home", "Home", "home", "/feed"],
  ["leaderboard", "Leaderboard", "trophy", "/leaderboard"],
  ["hide", "Hide", "vault", "/hide"],
  ["profile", "Profile", "user", "/me"],
];

export function TabBar({ active = "home", onSelect }: TabBarProps) {
  return (
    <nav
      aria-label="Main"
      style={{
        position: "fixed",
        bottom: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: "430px",
        zIndex: 50,
        flex: "none",
        // Design height (90px) includes the home-indicator zone; on devices with a safe area the bar
        // grows only if the inset is larger than that zone.
        minHeight: "var(--zk-tabbar-h)",
        background: "rgb(var(--zk-bg-rgb) / .97)",
        borderTop: "1px solid var(--zk-border)",
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr)",
        alignContent: "start",
        padding: "var(--zk-space-10) var(--zk-space-8) env(safe-area-inset-bottom, 0px)",
        boxSizing: "border-box",
      }}
    >
      {TABS.map(([id, label, icon, href]) => {
        const on = id === active;
        const fg = on ? "var(--zk-gold)" : "var(--zk-text-muted)";
        return (
          <Link
            key={id}
            href={href}
            aria-current={on ? "page" : undefined}
            onClick={() => onSelect?.(id)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--zk-space-4)",
              cursor: "pointer",
              color: fg,
              textDecoration: "none",
              WebkitTapHighlightColor: "transparent",
              touchAction: "manipulation",
            }}
          >
            <div
              style={{
                width: "52px",
                height: "32px",
                borderRadius: "var(--zk-radius-lg)",
                background: on ? "var(--zk-gold-tint)" : "transparent",
                color: fg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon icon={icon} size={22} stroke={on ? 2.4 : 2} />
            </div>
            <span style={{ font: on ? "var(--zk-fw-black) var(--zk-fs-11)/1 var(--zk-font-body)" : "var(--zk-type-tab)", color: fg }}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
