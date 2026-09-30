"use client";
// App-wide live notices: polls /api/notifications and slides each new one in from the top with a
// sound ("your stash got ZECKED", "your ZEC came back", "ZEC landed"). Tap opens the stash or wallet.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, clearApiCache } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import type { Notice } from "@/lib/types";
import { HiderToast } from "@/components/screens/HiderToast";
import { NOTICES_EVENT } from "@/components/screens/NoticeBell";

const SEEN_KEY = "zk:notice-seen";
const POLL_MS = 12_000;

function readSeen() {
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

export function LiveNotices() {
  const router = useRouter();
  const [queue, setQueue] = useState<Notice[]>([]);
  const busy = useRef(false);

  const poll = useCallback(async () => {
    if (busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    try {
      const seen = readSeen();
      const { items, now } = await api.notifications(seen || undefined);
      if (!seen) {
        // First run on this device: start from now (server clock), don't replay older notices.
        writeSeen(items[0]?.at && items[0].at > now ? items[0].at : now);
        return;
      }
      if (!items.length) return;
      writeSeen(items[0].at);
      clearApiCache(); // balances/stats just changed: next reads go to the server
      window.dispatchEvent(new Event(NOTICES_EVENT)); // the bell's count
      setQueue((q) => [...q, ...[...items].reverse()]);
    } catch {
      /* offline or signed out: try again next tick */
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(poll, 1500);
    const t = setInterval(poll, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, [poll]);

  const current = queue[0];
  useEffect(() => {
    if (current) sfx(current.kind === "deposit" || current.kind === "win" ? "coin" : "notify");
  }, [current]);

  if (!current) return null;
  return (
    <HiderToast
      key={current.id}
      text={current.text}
      meta={current.kind === "zecked" ? "Tap to see it" : current.kind === "deposit" ? "Tap to open your wallet" : undefined}
      onTap={() => router.push(current.kind === "deposit" ? "/wallet" : current.stashId ? `/s/${current.stashId}` : "/me")}
      onClose={() => setQueue((q) => q.slice(1))}
    />
  );
}
