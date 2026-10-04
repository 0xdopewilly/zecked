"use client";
// Laptop / desktop navigation (1024px and up): a left sidebar with the logo, the four tabs, a big
// "Hide a stash" button and you. Phones use the floating dock (TabBar); CSS shows one or the other.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, formatZec } from "@/lib/api";
import type { Player } from "@/lib/types";
import { Avatar } from "@/components/zk/Avatar";
import { Icon, type IconName } from "@/components/zk/Icon";
import { Logo } from "@/components/zk/Logo";

const ITEMS: [href: string, label: string, icon: IconName][] = [
  ["/feed", "Home", "home"],
  ["/leaderboard", "Leaderboard", "trophy"],
  ["/wallet", "Wallet", "wallet"],
  ["/me", "Profile", "user"],
];

export function SideNav() {
  const path = usePathname();
  const [me, setMe] = useState<Player | null>(null);

  // Refreshed on every screen change (the /me read is cached for a few seconds, so this is cheap).
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then(({ player }) => alive && setMe(player))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [path]);

  const signedIn = !!me?.account?.signedIn;
  return (
    <nav className="zk-side" aria-label="Sidebar">
      <Link href="/feed" transitionTypes={["tab"]} className="zk-side-logo" aria-label="ZECKED home">
        <Logo variant="wordmark" size={30} />
      </Link>

      <div className="zk-side-items">
        {ITEMS.map(([href, label, icon]) => {
          const on = path === href || (href === "/feed" && path === "/");
          return (
            <Link key={href} href={href} transitionTypes={["tab"]} aria-current={on ? "page" : undefined} className="zk-side-item">
              <span className="zk-side-icon">
                <Icon icon={icon} size={20} stroke={on ? 2.6 : 2.2} />
              </span>
              {label}
            </Link>
          );
        })}
      </div>

      <Link href="/hide" transitionTypes={["nav-forward"]} data-sfx="pop" className="zk-side-hide">
        <Icon icon="plus" size={20} stroke={3.2} />
        Hide a stash
      </Link>

      <div className="zk-side-foot">
        {me ? (
          <Link href={signedIn ? "/me" : "/signin?next=/feed"} transitionTypes={["tab"]} className="zk-side-me">
            <Avatar handle={me.handle} src={me.avatarUrl} size={40} />
            <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="zk-side-handle">{me.handle}</span>
              <span className="zk-side-sub">{signedIn ? `${formatZec(me.balanceZat)} ZEC` : "Sign up to keep your wins"}</span>
            </span>
          </Link>
        ) : (
          <span className="zk-side-me" aria-hidden="true" style={{ minHeight: 56 }} />
        )}
      </div>
    </nav>
  );
}
