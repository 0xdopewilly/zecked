"use client";
// Screen 02 · Home feed. Header (wordmark, streak, prizes to claim), live ticker, filter chips,
// stash list, floating "Hide a stash" button and the tab bar.
import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api, type FeedFilter } from "@/lib/api";
import type { Player, PublicStash, TickerItem } from "@/lib/types";
import { Button, Chip, Icon, Logo, StashCard, TabBar } from "@/components/zk";

const CHIPS: { label: string; filter: FeedFilter }[] = [
  { label: "All", filter: "all" },
  { label: "Riddles", filter: "riddles" },
  { label: "Predictions", filter: "predictions" },
  { label: "Ending soon", filter: "ending" },
  { label: "Biggest", filter: "biggest" },
];

const FEED_MS = 20_000;
const TICKER_MS = 15_000;

/* ---------- ticker helpers ---------- */

// The design bolds one phrase per line in gold ("just ZECKED 0.02 ZEC", "called BAR 2–1", "hid 0.5 ZEC").
const BOLD_PATTERNS = [
  /ZECKED/,
  /\b[A-Z]{2,4} \d+\s?[–-]\s?\d+\b/,
  /\b[A-Z]{2,4} win\b/,
  /\bdraw\b/i,
  /\d[\d.,]*\s?ZEC\b/,
  /\buncrackable\b/i,
];

function splitBold(text: string): [string, string, string] {
  for (const re of BOLD_PATTERNS) {
    const m = re.exec(text);
    if (m) return [text.slice(0, m.index), m[0], text.slice(m.index + m[0].length)];
  }
  return [text, "", ""];
}

function tickerLook(t: TickerItem): { icon: string; color: string } {
  if (/uncrackable/i.test(t.text)) return { icon: "shield", color: "var(--zk-purple-light)" };
  if (t.kind === "zecked") return { icon: "unlock", color: "var(--zk-mint)" };
  if (t.kind === "called") return { icon: "ball", color: "var(--zk-sky)" };
  return { icon: "lock", color: "var(--zk-pink)" };
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function Ticker({ items, now }: { items: TickerItem[]; now: number }) {
  const [paused, setPaused] = useState(false);
  // Each half must be at least as wide as the column for the −50% loop to be seamless.
  let half = items;
  while (half.length < 4) half = half.concat(items);
  const pause = () => setPaused(true);
  const resume = () => setPaused(false);

  const renderHalf = (hidden: boolean) => (
    <span aria-hidden={hidden || undefined} style={{ display: "flex" }}>
      {half.map((t, i) => {
        const [before, bold, after] = splitBold(t.text);
        const look = tickerLook(t);
        return (
          <span
            key={`${t.id}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--zk-space-6)",
              marginRight: "var(--zk-space-28)",
            }}
          >
            <span style={{ color: look.color, display: "flex" }}>
              <Icon icon={look.icon} size={14} stroke={2.4} />
            </span>
            <span>
              {before}
              {bold && <b style={{ color: "var(--zk-gold)" }}>{bold}</b>}
              {after} · <span style={{ color: "var(--zk-text-muted)" }}>{ago(t.at, now)}</span>
            </span>
          </span>
        );
      })}
    </span>
  );

  return (
    <div
      aria-label="Live activity"
      role="marquee"
      onTouchStart={pause}
      onTouchEnd={resume}
      onTouchCancel={resume}
      onMouseEnter={pause}
      onMouseLeave={resume}
      style={{
        marginTop: "var(--zk-space-12)",
        height: 36,
        flex: "none",
        overflow: "hidden",
        background: "rgb(var(--zk-mint-rgb) / .07)",
        borderTop: "1px solid rgb(var(--zk-mint-rgb) / .18)",
        borderBottom: "1px solid rgb(var(--zk-mint-rgb) / .18)",
        display: "flex",
        alignItems: "center",
        paddingLeft: "var(--zk-space-16)",
      }}
    >
      <div
        style={{
          display: "flex",
          whiteSpace: "nowrap",
          width: "max-content",
          animation: "zk-marquee var(--zk-dur-ticker) linear infinite",
          animationDuration: `calc(var(--zk-dur-ticker) * ${half.length / 4})`,
          animationPlayState: paused ? "paused" : "running",
          font: "var(--zk-type-small)",
        }}
      >
        {renderHalf(false)}
        {renderHalf(true)}
      </div>
    </div>
  );
}

/* ---------- header chips ---------- */

const headerChip: CSSProperties = {
  height: 36,
  borderRadius: "var(--zk-radius-pill)",
  background: "var(--zk-surface)",
  display: "flex",
  alignItems: "center",
  gap: "var(--zk-space-6)",
};

function Header({ player }: { player: Player | null }) {
  const streak = player?.stats.streak ?? 0;
  const pending = player?.pendingClaims ?? [];
  const balance = (
    <>
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "var(--zk-grad-tile-gold)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--zk-gold-ink)",
        }}
      >
        <Logo variant="mark" size={14} stroke="var(--zk-gold-ink)" />
      </span>
      {pending.length}
    </>
  );
  const balanceStyle: CSSProperties = {
    ...headerChip,
    padding: "0 var(--zk-space-12) 0 var(--zk-space-4)",
    font: "var(--zk-type-mono-sm)",
    color: "var(--zk-gold)",
  };
  const balanceLabel = `${pending.length} ${pending.length === 1 ? "prize" : "prizes"} to claim`;

  return (
    <div style={{ padding: "0 var(--zk-screen-pad)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <Logo variant="wordmark" size={28} />
      <div style={{ display: "flex", gap: "var(--zk-space-8)", alignItems: "center" }}>
        <div
          aria-label={`${streak} day streak`}
          style={{ ...headerChip, padding: "0 var(--zk-space-12)", font: "var(--zk-type-btn-sm)", color: "var(--zk-text)" }}
        >
          <Icon icon="flame" size={16} filled stroke={1.5} color="var(--zk-pink)" />
          {streak}
        </div>
        {pending.length > 0 ? (
          <Link href={`/s/${pending[0]}`} aria-label={balanceLabel} style={balanceStyle}>
            {balance}
          </Link>
        ) : (
          <div aria-label={balanceLabel} style={balanceStyle}>
            {balance}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- list states ---------- */

const bar = (w: number | string, h: number, extra?: CSSProperties): CSSProperties => ({
  width: w,
  height: h,
  borderRadius: "var(--zk-radius-sm)",
  background: "var(--zk-surface-raised)",
  ...extra,
});

function SkeletonCard({ delay = 0 }: { delay?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        flex: "none",
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-2xl)",
        border: "1.5px solid var(--zk-border)",
        padding: "var(--zk-space-16)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-14)",
        animation: `zk-glow 1.6s ease-in-out ${delay}s infinite`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)" }}>
        <div style={bar("var(--zk-tile-md)", 44, { height: "var(--zk-tile-md)", borderRadius: "var(--zk-radius-md)" })} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
          <div style={bar(64, 10)} />
          <div style={bar(140, 12)} />
        </div>
        <div style={bar(96, 22, { borderRadius: "var(--zk-radius-pill)" })} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
        <div style={bar("92%", 20)} />
        <div style={bar("64%", 20)} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
          <div style={bar(120, 22)} />
          <div style={bar(40, 10)} />
        </div>
        <div style={bar(84, 32, { borderRadius: "var(--zk-radius-pill)" })} />
      </div>
      <div style={bar("100%", 8, { borderRadius: "var(--zk-radius-xs)" })} />
    </div>
  );
}

function StateCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-2xl)",
        border: "1.5px dashed var(--zk-border-strong)",
        padding: "var(--zk-space-28) var(--zk-space-20)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--zk-space-12)",
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function StateTile({ icon, grad, edge }: { icon: string; grad: string; edge: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 64,
        height: 64,
        borderRadius: "var(--zk-radius-lg)",
        background: grad,
        boxShadow: `var(--zk-inset-gloss), 0 4px 0 ${edge}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--zk-text)",
        marginBottom: "var(--zk-space-4)",
      }}
    >
      <Icon icon={icon} size={30} stroke={2.4} />
    </div>
  );
}

function EmptyState() {
  return (
    <StateCard>
      <StateTile icon="vault" grad="var(--zk-grad-tile-purple)" edge="var(--zk-purple-shade)" />
      <div style={{ font: "var(--zk-type-h3)" }}>No stashes here yet.</div>
      <div style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)", marginTop: "calc(-1 * var(--zk-space-6))" }}>
        Be the first to hide one.
      </div>
      <div style={{ marginTop: "var(--zk-space-4)" }}>
        <Button label="Hide a stash" icon="plus" variant="primary" size="md" full={false} href="/hide" />
      </div>
    </StateCard>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <StateCard>
      <StateTile icon="signal" grad="var(--zk-grad-tile-sky)" edge="var(--zk-sky-shade)" />
      <div style={{ font: "var(--zk-type-h3)" }}>The vault didn’t answer.</div>
      <div style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)", marginTop: "calc(-1 * var(--zk-space-6))" }}>
        {message}
      </div>
      <div style={{ marginTop: "var(--zk-space-4)" }}>
        <Button label="Try again" variant="secondary" size="md" full={false} onClick={onRetry} />
      </div>
    </StateCard>
  );
}

/* ---------- screen ---------- */

export default function Feed() {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [lists, setLists] = useState<Partial<Record<FeedFilter, PublicStash[]>>>({});
  const [errors, setErrors] = useState<Partial<Record<FeedFilter, string>>>({});
  const [player, setPlayer] = useState<Player | null>(null);
  const [ticker, setTicker] = useState<{ items: TickerItem[]; now: number }>({ items: [], now: 0 });

  const loadFeed = useCallback(async (f: FeedFilter) => {
    try {
      const { stashes } = await api.feed(f);
      setLists((p) => ({ ...p, [f]: stashes }));
      setErrors((p) => ({ ...p, [f]: undefined }));
    } catch (e) {
      setErrors((p) => ({ ...p, [f]: e instanceof Error ? e.message : "Something went wrong." }));
    }
  }, []);

  // Feed: load on filter change, refresh every 20s while the tab is visible.
  useEffect(() => {
    loadFeed(filter);
    const t = setInterval(() => {
      if (!document.hidden) loadFeed(filter);
    }, FEED_MS);
    const onVis = () => {
      if (!document.hidden) loadFeed(filter);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [filter, loadFeed]);

  // Ticker: poll every 15s.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { items } = await api.ticker();
        if (alive) setTicker({ items, now: Date.now() });
      } catch {
        /* keep the last ticker */
      }
    };
    load();
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, TICKER_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Player: streak + pending claims.
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then(({ player }) => alive && setPlayer(player))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const list = lists[filter];
  const error = errors[filter];
  const retry = () => {
    setErrors((p) => ({ ...p, [filter]: undefined }));
    loadFeed(filter);
  };

  let body: ReactNode;
  if (list && list.length > 0) {
    body = list.map((s) => <StashCard key={s.id} stash={s} href={`/s/${s.id}`} />);
  } else if (list) {
    body = <EmptyState />;
  } else if (error) {
    body = <ErrorState message={error} onRetry={retry} />;
  } else {
    body = (
      <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
        <span className="zk-sr-only">Loading stashes…</span>
        <SkeletonCard />
        <SkeletonCard delay={0.2} />
        <SkeletonCard delay={0.4} />
      </div>
    );
  }

  return (
    <main
      className="zk-screen has-tabs"
      style={{ background: "var(--zk-bg)", paddingTop: 0, paddingLeft: 0, paddingRight: 0 }}
    >
      {/* Header, ticker and chips stay pinned while the list scrolls, as in the design. */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: "var(--zk-bg)",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + var(--zk-space-14))",
        }}
      >
        <Header player={player} />
        {ticker.items.length > 0 && <Ticker items={ticker.items} now={ticker.now} />}
        <div
          role="group"
          aria-label="Filter stashes"
          className="zk-scroll-x"
          style={{
            display: "flex",
            gap: "var(--zk-space-8)",
            padding: "var(--zk-space-12) var(--zk-space-16) var(--zk-space-6)",
            flex: "none",
          }}
        >
          {CHIPS.map((c) => (
            <Chip key={c.filter} label={c.label} active={filter === c.filter} onClick={() => setFilter(c.filter)} />
          ))}
        </div>
      </div>

      <div
        style={{
          padding: "var(--zk-space-8) var(--zk-space-16) 72px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--zk-space-14)",
        }}
      >
        {body}
      </div>

      <div
        style={{
          position: "fixed",
          right: "max(var(--zk-space-16), calc((100vw - 430px) / 2 + var(--zk-space-16)))",
          bottom: "calc(var(--zk-tabbar-h) + var(--zk-space-16))",
          zIndex: 10,
        }}
      >
        <Button label="Hide a stash" icon="plus" variant="primary" size="md" full={false} href="/hide" />
      </div>

      <TabBar active="home" />
    </main>
  );
}
