"use client";
// The bell in the feed header: your recent notices (stash zecked, ZEC came back, ZEC landed, you won).
// A pink count shows what's new since you last opened it. LiveNotices pings it when one arrives.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Notice } from "@/lib/types";
import { Icon, type IconName } from "@/components/zk/Icon";

const SEEN_KEY = "zk:bell-seen";
/** Fired on window by LiveNotices when new notices arrive. */
export const NOTICES_EVENT = "zk:notices";

const LOOK: Record<Notice["kind"], { icon: IconName; bg: string; fg: string }> = {
  zecked: { icon: "unlock", bg: "var(--zk-pink)", fg: "var(--zk-text)" },
  refunded: { icon: "hourglass", bg: "var(--zk-grad-tile-purple)", fg: "var(--zk-text)" },
  deposit: { icon: "coin", bg: "var(--zk-grad-tile-mint)", fg: "var(--zk-mint-ink)" },
  win: { icon: "trophy", bg: "var(--zk-grad-tile-gold)", fg: "var(--zk-gold-ink)" },
  invite: { icon: "sparkle", bg: "var(--zk-pink)", fg: "var(--zk-text)" },
};

function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function writeSeen(at: string) {
  try {
    localStorage.setItem(SEEN_KEY, at);
  } catch {}
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function NoticeBell({ hidden }: { hidden?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<Notice[] | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api
      .notifications()
      .then(({ items }) => setItems(items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSeen(readSeen());
    load();
    window.addEventListener(NOTICES_EVENT, load);
    return () => window.removeEventListener(NOTICES_EVENT, load);
  }, [load]);

  // Closes on any outside tap, Escape, or when the header slides away.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  const unread = items ? items.filter((n) => !seen || n.at > seen).length : 0;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && items?.[0]) {
      writeSeen(items[0].at);
      // Keep the count for this look (items still show as new), clear it for the next.
      setTimeout(() => setSeen(items[0].at), 400);
    }
  };

  const go = (n: Notice) => {
    setOpen(false);
    router.push(n.kind === "deposit" ? "/wallet" : n.stashId ? `/s/${n.stashId}` : "/me", { transitionTypes: ["nav-forward"] });
  };

  const now = Date.now();
  const shown = items?.slice(0, 12) ?? [];

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: "none" }}>
      <button
        type="button"
        className="zk-bell"
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        aria-controls="zk-bell-panel"
        onClick={toggle}
      >
        <Icon icon="bell" size={21} stroke={2.4} />
        {unread > 0 && (
          <span aria-hidden="true" className="zk-bell-count">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div id="zk-bell-panel" role="dialog" aria-label="Notifications" className="zk-bell-panel">
          <div style={{ font: "var(--zk-type-h4)", padding: "var(--zk-space-14) var(--zk-space-16) var(--zk-space-8)" }}>Notifications</div>
          {items === null ? (
            <div style={{ padding: "var(--zk-space-8) var(--zk-space-16) var(--zk-space-18)", font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
              Loading…
            </div>
          ) : shown.length ? (
            <ul style={{ listStyle: "none", margin: 0, padding: "0 var(--zk-space-6) var(--zk-space-6)", maxHeight: "min(60vh, 420px)", overflowY: "auto" }}>
              {shown.map((n) => {
                const look = LOOK[n.kind] ?? LOOK.zecked;
                const fresh = !seen || n.at > seen;
                return (
                  <li key={n.id}>
                    <button type="button" data-sfx="tap" className="zk-bell-row" onClick={() => go(n)}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 38,
                          height: 38,
                          flex: "none",
                          borderRadius: "var(--zk-radius-md)",
                          background: look.bg,
                          color: look.fg,
                          border: "2px solid var(--zk-ink)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Icon icon={look.icon} size={18} stroke={2.6} />
                      </span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <span style={{ display: "block", font: "var(--zk-fw-semibold) var(--zk-fs-14)/1.3 var(--zk-font-body)", color: "var(--zk-text)" }}>{n.text}</span>
                        <span style={{ display: "block", marginTop: 2, font: "var(--zk-fw-medium) var(--zk-fs-12)/1.2 var(--zk-font-body)", color: "var(--zk-text-faint)" }}>
                          {ago(n.at, now)}
                        </span>
                      </span>
                      {fresh && <span aria-label="New" style={{ width: 8, height: 8, flex: "none", borderRadius: "50%", background: "var(--zk-pink)" }} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div style={{ padding: "var(--zk-space-4) var(--zk-space-16) var(--zk-space-18)", font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
              Nothing yet. When someone cracks your stash, you win one, or ZEC lands in your wallet, it shows up here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
