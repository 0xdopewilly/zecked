"use client";
// Screen 11 · Leaderboard. Crackers / Hiders / Oracles × Today / Week / All-time, podium with a crown
// on #1, rows from #4 down, and a pinned "You · #N" bar. An empty board (or an open podium spot)
// invites you to take it. Every player (podium, rows, your own bar) opens their public profile.
import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { LeaderRow, Leaderboard, TournamentInfo } from "@/lib/types";
import { Avatar, Button, Countdown, Emblem, Icon, TabBar } from "@/components/zk";

type Board = Leaderboard["board"];
type Period = Leaderboard["period"];

const TABS: { id: Board; label: string; icon: string }[] = [
  { id: "crackers", label: "Crackers", icon: "unlock" },
  { id: "hiders", label: "Hiders", icon: "vault" },
  { id: "oracles", label: "Oracles", icon: "orb" },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "Week" },
  { id: "all", label: "All-time" },
];

// Server scores: crackers = stashes cracked, hiders = stashes hidden, oracles = exact scores called.
const UNIT: Record<Board, [one: string, many: string]> = {
  crackers: ["crack", "cracks"],
  hiders: ["hidden", "hidden"],
  oracles: ["exact", "exact"],
};

const HINT: Record<Board, { text: string; first: string; label: string; short: string; href: string }> = {
  crackers: {
    text: "Crack a riddle or call a match first to grab a spot.",
    first: "Crack a stash and the top spot is yours.",
    label: "Crack a stash",
    short: "Crack one",
    href: "/feed",
  },
  hiders: { text: "Hide a stash and you’re on it.", first: "Hide a stash and the top spot is yours.", label: "Hide a stash", short: "Hide one", href: "/hide" },
  oracles: {
    text: "Call an exact score right and the crystal ball is yours.",
    first: "Call an exact score right and the top spot is yours.",
    label: "Call a match",
    short: "Call one",
    href: "/feed",
  },
};

/** Friendly copy for a failed request: never the raw browser text ("Failed to fetch"). */
function friendlyErr(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status == null) return "Can’t reach ZECKED. Check your connection and try again.";
  return "We couldn’t load the board just now. Try again in a moment.";
}

const atHandle = (h: string) => (h.startsWith("@") ? h : `@${h}`);
const profileHref = (h: string) => `/u/${encodeURIComponent(h.replace(/^@+/, ""))}`;

/** A small "›" (the back chevron turned around): this row opens something. */
const Chevron = ({ color = "var(--zk-text-faint)", style }: { color?: string; style?: CSSProperties }) => (
  <span aria-hidden="true" style={{ display: "flex", flex: "none", color, transform: "rotate(180deg)", ...style }}>
    <Icon icon="back" size={15} stroke={2.6} />
  </span>
);

function scoreLabel(board: Board, n: number) {
  const [one, many] = UNIT[board];
  return `${Math.round(n).toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

const ellipsis: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" };

/* ---------- podium ---------- */

type Place = 1 | 2 | 3;

const PLACE: Record<
  Place,
  {
    avatar: number;
    border: string;
    avatarShadow: string;
    nameFont: string;
    valueColor: string;
    height: number;
    radius: string;
    bg: string;
    shadow: string;
    numFont: string;
    numColor: string;
    pad: string;
  }
> = {
  1: {
    avatar: 74,
    border: "4px solid var(--zk-gold)",
    avatarShadow: "0 5px 0 var(--zk-gold-deep), var(--zk-glow-gold)",
    nameFont: "var(--zk-type-body-strong)",
    valueColor: "var(--zk-gold)",
    height: 120,
    radius: "var(--zk-radius-xl) var(--zk-radius-xl) var(--zk-radius-sm) var(--zk-radius-sm)",
    bg: "linear-gradient(180deg, var(--zk-gold-bright), var(--zk-gold) 60%, var(--zk-gold-amber))",
    shadow: "inset 0 3px 0 rgb(var(--zk-white-rgb) / .6), 0 5px 0 var(--zk-tier-safecracker-edge)",
    numFont: "var(--zk-fw-black) var(--zk-fs-40)/1 var(--zk-font-display)",
    numColor: "var(--zk-tier-safecracker-ink)",
    pad: "var(--zk-space-10)",
  },
  2: {
    avatar: 58,
    border: "3px solid var(--zk-tier-cracker-mid)",
    avatarShadow: "var(--zk-shadow-3d-sm)",
    nameFont: "var(--zk-fw-bold) var(--zk-fs-13)/1.35 var(--zk-font-body)",
    valueColor: "var(--zk-text-muted)",
    height: 84,
    radius: "var(--zk-radius-lg) var(--zk-radius-lg) var(--zk-radius-sm) var(--zk-radius-sm)",
    bg: "linear-gradient(180deg, var(--zk-silver-light), var(--zk-tier-cracker-lo))",
    shadow: "inset 0 3px 0 rgb(var(--zk-white-rgb) / .6), 0 5px 0 var(--zk-tier-cracker-edge)",
    numFont: "var(--zk-fw-black) var(--zk-fs-34)/1 var(--zk-font-display)",
    numColor: "var(--zk-tier-cracker-ink)",
    pad: "var(--zk-space-10)",
  },
  3: {
    avatar: 58,
    border: "3px solid var(--zk-tier-rookie-mid)",
    avatarShadow: "var(--zk-shadow-3d-sm)",
    nameFont: "var(--zk-fw-bold) var(--zk-fs-13)/1.35 var(--zk-font-body)",
    valueColor: "var(--zk-text-muted)",
    height: 64,
    radius: "var(--zk-radius-lg) var(--zk-radius-lg) var(--zk-radius-sm) var(--zk-radius-sm)",
    bg: "linear-gradient(180deg, var(--zk-tier-rookie-hi), var(--zk-tier-rookie-mid))",
    shadow: "inset 0 3px 0 rgb(var(--zk-white-rgb) / .5), 0 5px 0 var(--zk-tier-rookie-edge)",
    numFont: "var(--zk-fw-black) var(--zk-fs-30)/1 var(--zk-font-display)",
    numColor: "var(--zk-tier-rookie-edge)",
    pad: "var(--zk-space-8)",
  },
};

function PodiumSlot({ place, row, board, loading }: { place: Place; row?: LeaderRow; board: Board; loading: boolean }) {
  const c = PLACE[place];
  const empty = !row;
  const open = empty && !loading;
  const hint = HINT[board];
  const slotStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    position: "relative",
    minWidth: 0,
    color: "inherit",
    textDecoration: "none",
    WebkitTapHighlightColor: "transparent",
    animation: loading ? "zk-glow 1.6s ease-in-out infinite" : undefined,
  };
  const inner = (
    <>
      {place === 1 && row && (
        <div
          aria-hidden="true"
          style={
            {
              position: "absolute",
              top: -30,
              color: "var(--zk-gold)",
              "--zk-tilt": "-12deg",
              animation: "zk-bob 2.6s ease-in-out infinite",
              filter: "drop-shadow(0 3px 0 var(--zk-gold-deep))",
            } as CSSProperties
          }
        >
          <Icon icon="crown" size={34} filled stroke={1.5} />
        </div>
      )}
      {empty ? (
        <div
          aria-hidden="true"
          style={{
            width: c.avatar,
            height: c.avatar,
            boxSizing: "border-box",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--zk-text-faint)",
            border: "2px dashed var(--zk-border-strong)",
          }}
        >
          {loading ? "" : <Icon icon="plus" size={place === 1 ? 26 : 22} stroke={2.6} />}
        </div>
      ) : (
        <Avatar handle={row.handle} src={row.avatarUrl} house={row.isHouse} size={c.avatar} ring="none" style={{ border: c.border, boxShadow: c.avatarShadow }} />
      )}
      <div
        style={{
          ...ellipsis,
          font: c.nameFont,
          marginTop: "var(--zk-space-6)",
          color: empty ? "var(--zk-text-faint)" : "var(--zk-text)",
        }}
      >
        {empty ? (loading ? " " : "Open spot") : atHandle(row.handle)}
        {row?.isYou && <span className="zk-sr-only"> (you)</span>}
      </div>
      <div style={{ ...ellipsis, font: "var(--zk-type-mono-xs)", color: open ? "var(--zk-purple-light)" : empty ? "var(--zk-text-faint)" : c.valueColor }}>
        {open ? "Take it" : empty ? " " : scoreLabel(board, row.score)}
      </div>
      <div
        aria-hidden="true"
        style={{
          width: "100%",
          height: c.height,
          marginTop: "var(--zk-space-8)",
          borderRadius: c.radius,
          background: c.bg,
          boxShadow: c.shadow,
          display: "flex",
          justifyContent: "center",
          paddingTop: c.pad,
          boxSizing: "border-box",
          font: c.numFont,
          color: c.numColor,
          opacity: empty ? 0.35 : 1,
        }}
      >
        {place}
      </div>
    </>
  );
  if (open)
    return (
      <Link href={hint.href} aria-label={`Open spot number ${place}. ${hint.label} to take it`} style={slotStyle}>
        {inner}
      </Link>
    );
  if (row)
    return (
      <Link
        href={profileHref(row.handle)}
        transitionTypes={["nav-forward"]}
        aria-label={`Number ${place}: ${atHandle(row.handle)}${row.isYou ? " (you)" : ""}, ${scoreLabel(board, row.score)}. Open profile`}
        style={slotStyle}
      >
        {inner}
      </Link>
    );
  return <div style={slotStyle}>{inner}</div>;
}

function Podium({ rows, board, loading }: { rows: LeaderRow[]; board: Board; loading: boolean }) {
  return (
    <div
      role="list"
      aria-label="Top three"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1.15fr 1fr",
        alignItems: "end",
        gap: "var(--zk-space-8)",
        marginTop: "var(--zk-space-14)",
      }}
    >
      {([2, 1, 3] as Place[]).map((p) => (
        <div role="listitem" key={p} style={{ minWidth: 0 }}>
          <PodiumSlot place={p} row={rows[p - 1]} board={board} loading={loading} />
        </div>
      ))}
    </div>
  );
}

/* ---------- rows ---------- */

function Row({ row, board }: { row: LeaderRow; board: Board }) {
  const [down, setDown] = useState(false);
  const up = () => setDown(false);
  return (
    <li>
      <Link
        href={profileHref(row.handle)}
        transitionTypes={["nav-forward"]}
        onPointerDown={() => setDown(true)}
        onPointerUp={up}
        onPointerLeave={up}
        onPointerCancel={up}
        style={{
          display: "flex",
          alignItems: "center",
          // A little tighter on 320px phones, so the handle keeps its room next to the chevron.
          gap: "clamp(var(--zk-space-8), 3vw, var(--zk-space-12))",
          minHeight: 50,
          boxSizing: "border-box",
          padding: "var(--zk-space-8) var(--zk-space-8) var(--zk-space-8) var(--zk-space-12)",
          borderRadius: "var(--zk-radius-lg)",
          background: down ? "var(--zk-surface-raised)" : "var(--zk-surface)",
          border: row.isYou ? "1.5px solid rgb(var(--zk-purple-rgb) / .7)" : "1.5px solid transparent",
          color: "var(--zk-text)",
          textDecoration: "none",
          transform: down ? "scale(.985)" : "none",
          transition: "transform var(--zk-dur-fast) var(--zk-ease-out), background var(--zk-dur-fast) var(--zk-ease-out)",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span style={{ width: 24, flex: "none", font: "var(--zk-type-mono-sm)", color: "var(--zk-text-muted)" }}>{row.rank}</span>
        <Avatar handle={row.handle} src={row.avatarUrl} house={row.isHouse} size={34} />
        <span style={{ flex: 1, minWidth: 0, font: "var(--zk-type-body-strong)", ...ellipsis }}>
          {atHandle(row.handle)}
          {row.isYou && <span className="zk-sr-only"> (you)</span>}
        </span>
        <Emblem tier={row.tier} size={22} />
        <span style={{ font: "var(--zk-type-mono-sm)", minWidth: 64, textAlign: "right", whiteSpace: "nowrap" }}>
          {scoreLabel(board, row.score)}
        </span>
        <Chevron style={{ marginLeft: -4 }} />
      </Link>
    </li>
  );
}

function SkeletonRows() {
  return (
    <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-6)", marginTop: "var(--zk-space-6)" }}>
      <span className="zk-sr-only">Loading leaderboard…</span>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            height: 50,
            borderRadius: "var(--zk-radius-lg)",
            background: "var(--zk-surface)",
            animation: `zk-glow 1.6s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        marginTop: "var(--zk-space-6)",
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-xl)",
        border: "1.5px dashed var(--zk-border-strong)",
        padding: "var(--zk-space-16)",
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-12)",
      }}
    >
      {children}
    </div>
  );
}

/** The whole board is empty (a fresh testnet): make the first move feel like a prize. */
function FirstOnBoard({ board, period }: { board: Board; period: Period }) {
  const hint = HINT[board];
  const when = period === "today" ? "today" : period === "week" ? "this week" : "yet";
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        marginTop: "var(--zk-space-4)",
        borderRadius: "var(--zk-radius-2xl)",
        padding: "var(--zk-space-18)",
        background: "linear-gradient(160deg, var(--zk-surface-purple), var(--zk-surface) 70%)",
        border: "1.5px solid rgb(var(--zk-gold-rgb) / .3)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-14)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-14)" }}>
        <div
          aria-hidden="true"
          style={
            {
              width: 56,
              height: 56,
              flex: "none",
              borderRadius: "var(--zk-radius-lg)",
              background: "var(--zk-grad-tile-gold)",
              boxShadow: "var(--zk-inset-gloss), 0 4px 0 var(--zk-gold-deep)",
              color: "var(--zk-gold-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: "rotate(-6deg)",
              animation: "zk-bob 3s ease-in-out infinite",
              "--zk-tilt": "-6deg",
            } as CSSProperties
          }
        >
          <Icon icon="trophy" size={28} stroke={2.4} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, font: "var(--zk-type-h3)" }}>Be the first on the board</h2>
          <p style={{ margin: "var(--zk-space-4) 0 0", font: "var(--zk-type-small)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
            Nobody’s on it {when}. {hint.first}
          </p>
        </div>
      </div>
      <Button label={hint.label} icon={board === "hiders" ? "lock" : board === "oracles" ? "ball" : "key"} variant="primary" size="md" href={hint.href} />
    </div>
  );
}

/* ---------- weekly tournament (crackers › week only) ---------- */

const sticker: CSSProperties = {
  borderRadius: "var(--zk-radius-xl)",
  background: "radial-gradient(90% 120% at 100% 0%, rgb(var(--zk-gold-rgb) / .18), transparent 60%), linear-gradient(160deg, var(--zk-surface-purple), var(--zk-surface))",
  border: "2.5px solid var(--zk-ink)",
  boxShadow: "inset 0 1.5px 0 rgb(var(--zk-white-rgb) / .08), 0 3px 0 var(--zk-ink)",
};

const fmtUsd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/** "2d 4h" · "4h 12m" · "12m" · "under a minute", from the seconds left. */
function leftText(secs: number) {
  const s = Math.max(0, Math.floor(secs));
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor(s / 3600) % 24}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return "under a minute";
}

/** Seconds until `to`, refreshed every 30 s (the strip is coarse on purpose: days and hours, no seconds). */
function useSecondsLeft(to: string) {
  const target = Date.parse(to);
  const calc = () => Math.max(0, Math.ceil((target - Date.now()) / 1000));
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    const t = setInterval(() => setLeft(calc()), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return left;
}

/** "Week ends in 2d 4h · top 3 win $5 / $3 / $2 of test ZEC": a strip between the period row and the podium. */
function TournamentStrip({ info, onWeekEnd }: { info: TournamentInfo | null | undefined; onWeekEnd: () => void }) {
  const left = useSecondsLeft(info?.week.endsAt ?? "");
  if (info === null) return null; // couldn't load: the board still works without it
  const places = info ? info.prizesUsd.length : 3;
  return (
    <section
      aria-label="Weekly tournament"
      aria-busy={!info || undefined}
      style={{
        ...sticker,
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-12)",
        padding: "var(--zk-space-10) var(--zk-space-12)",
        minHeight: 64,
        boxSizing: "border-box",
        animation: info ? undefined : "zk-glow 1.6s ease-in-out infinite",
      }}
    >
      <div
        aria-hidden="true"
        style={
          {
            width: 40,
            height: 40,
            flex: "none",
            borderRadius: "var(--zk-radius-md)",
            background: "var(--zk-grad-tile-gold)",
            boxShadow: "var(--zk-inset-gloss), 0 3px 0 var(--zk-gold-deep)",
            color: "var(--zk-gold-ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: "rotate(-6deg)",
          } as CSSProperties
        }
      >
        <Icon icon="trophy" size={22} stroke={2.4} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ font: "var(--zk-fw-black) var(--zk-fs-13)/1.2 var(--zk-font-display)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--zk-gold)" }}>
          Weekly tournament
        </div>
        {info ? (
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text)", textWrap: "pretty" }}>
            Week ends in <Countdown to={info.week.endsAt} text={leftText(left)} tone="gold" size="sm" onDone={onWeekEnd} />
            <span style={{ color: "var(--zk-text-muted)" }}>
              {" · "}top {places} win {info.prizesUsd.map(fmtUsd).join(" / ")} of test ZEC
            </span>
          </div>
        ) : (
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-faint)" }}>Most cracks this week wins test ZEC</div>
        )}
      </div>
    </section>
  );
}

const PAID: Record<"paid" | "owed" | "pending", string> = { paid: "paid", owed: "unclaimed", pending: "on its way" };

/** Last week's top 3 with their prizes. Shown once a settled week exists. */
function Champions({ last }: { last: NonNullable<TournamentInfo["last"]> }) {
  return (
    <section aria-label="Last week’s champions" style={{ ...sticker, marginTop: "var(--zk-space-14)", padding: "var(--zk-space-12)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-8)", color: "var(--zk-gold)" }}>
        <Icon icon="crown" size={18} filled stroke={1.6} />
        <h2 style={{ margin: 0, font: "var(--zk-type-h4)", color: "var(--zk-text)" }}>Last week’s champions</h2>
      </div>
      {last.champions.length === 0 ? (
        <p style={{ margin: "var(--zk-space-6) 0 0", font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>No champions last week. This one’s wide open.</p>
      ) : (
        <ol
          style={{
            margin: "var(--zk-space-12) 0 0",
            padding: 0,
            listStyle: "none",
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(3, last.champions.length)}, minmax(0, 1fr))`,
            gap: "var(--zk-space-8)",
          }}
        >
          {last.champions.map((c) => {
            const state = c.paidZat > 0 ? "paid" : c.paidZat < 0 ? "owed" : "pending";
            return (
              <li key={c.place} style={{ minWidth: 0 }}>
                <Link
                  href={profileHref(c.handle)}
                  transitionTypes={["nav-forward"]}
                  aria-label={`Number ${c.place}: ${atHandle(c.handle)}, ${c.score} ${c.score === 1 ? "crack" : "cracks"}, won ${fmtUsd(c.prizeUsd)} of test ZEC (${PAID[state]}). Open profile`}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: "var(--zk-text)", textDecoration: "none", WebkitTapHighlightColor: "transparent", minWidth: 0 }}
                >
                  <span style={{ position: "relative", display: "inline-flex" }}>
                    <Avatar handle={c.handle} src={c.avatarUrl} size={c.place === 1 ? 48 : 40} />
                    <span
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        right: -6,
                        bottom: -4,
                        minWidth: 18,
                        height: 18,
                        padding: "0 4px",
                        boxSizing: "border-box",
                        borderRadius: "var(--zk-radius-pill)",
                        background: c.place === 1 ? "var(--zk-gold)" : "var(--zk-surface-raised)",
                        color: c.place === 1 ? "var(--zk-gold-ink)" : "var(--zk-text)",
                        border: "2px solid var(--zk-ink)",
                        font: "var(--zk-fw-black) 11px/14px var(--zk-font-display)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {c.place}
                    </span>
                  </span>
                  <span style={{ ...ellipsis, font: "var(--zk-fw-bold) var(--zk-fs-13)/1.35 var(--zk-font-body)", marginTop: "var(--zk-space-4)" }}>{atHandle(c.handle)}</span>
                  <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text-muted)" }}>{scoreLabel("crackers", c.score)}</span>
                  <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-gold)" }}>+{fmtUsd(c.prizeUsd)}</span>
                  {state !== "paid" ? <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-faint)" }}>{PAID[state]}</span> : null}
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/* ---------- you bar ---------- */

function YouBar({ you, board, ranked }: { you: NonNullable<Leaderboard["you"]>; board: Board; ranked: boolean }) {
  const delta = you.deltaThisWeek ?? 0;
  const hint = HINT[board];
  return (
    <div
      style={{
        position: "fixed",
        left: "var(--zk-col-x)",
        transform: "translateX(-50%)",
        width: "min(calc(var(--zk-col-w) - 28px), 380px)",
        bottom: "calc(var(--zk-tabbar-h) + var(--zk-space-24))",
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-12)",
        padding: "var(--zk-space-10) var(--zk-space-14)",
        boxSizing: "border-box",
        borderRadius: "var(--zk-radius-xl)",
        background: "linear-gradient(90deg, var(--zk-purple), var(--zk-purple-mid))",
        border: "2.5px solid var(--zk-ink)",
        boxShadow: "inset 0 1.5px 0 rgb(var(--zk-white-rgb) / .2), 0 5px 0 var(--zk-ink), var(--zk-shadow-float)",
        zIndex: 12,
      }}
    >
      {/* Your rank, avatar and name open your public profile (the button on the right stays its own tap). */}
      <Link
        href={profileHref(you.handle)}
        transitionTypes={["nav-forward"]}
        aria-label={`You, ${atHandle(you.handle)}${ranked ? `, number ${you.rank}` : ", not ranked yet"}. Open your profile`}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          display: "flex",
          alignItems: "center",
          gap: "var(--zk-space-12)",
          color: "var(--zk-text)",
          textDecoration: "none",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {ranked ? <span style={{ font: "var(--zk-type-mono-sm)", flex: "none" }}>#{you.rank}</span> : null}
        <Avatar handle={you.handle} src={you.avatarUrl} house={you.isHouse} size={34} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-2)", minWidth: 0 }}>
            <span style={{ font: "var(--zk-type-h4)", ...ellipsis, minWidth: 0 }}>You · {atHandle(you.handle)}</span>
            <Chevron color="var(--zk-purple-pale)" />
          </span>
          {!ranked ? (
            <span style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"], color: "var(--zk-purple-pale)" }}>
              Not ranked yet
            </span>
          ) : null}
        </span>
      </Link>
      {ranked && delta > 0 ? (
        <span
          style={{
            flex: "none",
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-2)",
            font: "var(--zk-type-caption)",
            fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"],
            color: "var(--zk-purple-pale)",
          }}
        >
          <Icon icon="arrowUp" size={12} stroke={3} />
          {Math.round(delta).toLocaleString("en-US")} this week
        </span>
      ) : !ranked ? (
        <Button label={hint.short} variant="light" size="sm" full={false} href={hint.href} style={{ height: 44, flex: "none", padding: "0 var(--zk-space-14)" }} />
      ) : null}
    </div>
  );
}

/* ---------- screen ---------- */

export default function LeaderboardScreen() {
  const [board, setBoard] = useState<Board>("crackers");
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<Record<string, Leaderboard | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const key = `${board}:${period}`;

  const load = useCallback(async (b: Board, p: Period) => {
    const k = `${b}:${p}`;
    try {
      const lb = await api.leaderboard(b, p);
      setData((d) => ({ ...d, [k]: lb }));
      setErrors((e) => ({ ...e, [k]: undefined }));
    } catch (err) {
      setErrors((e) => ({ ...e, [k]: friendlyErr(err) }));
    }
  }, []);

  useEffect(() => {
    load(board, period);
  }, [board, period, load]);

  // The weekly tournament rides on the crackers › week board: undefined = loading, null = couldn't load.
  const tourneyOn = board === "crackers" && period === "week";
  const [tourney, setTourney] = useState<TournamentInfo | null | undefined>(undefined);
  const loadTourney = useCallback(() => {
    api
      .tournament()
      .then(setTourney)
      .catch(() => setTourney((t) => t ?? null));
  }, []);
  useEffect(() => {
    if (tourneyOn && tourney === undefined) loadTourney();
  }, [tourneyOn, tourney, loadTourney]);
  const onWeekEnd = useCallback(() => {
    loadTourney();
    load("crackers", "week");
  }, [loadTourney, load]);

  const lb = data[key];
  const error = errors[key];
  const rows = lb?.rows ?? [];
  const loading = !lb && !error;
  const you = lb?.you;
  const ranked = !!you && (you.score > 0 || rows.some((r) => r.isYou));
  const hint = HINT[board];

  const retry = () => {
    setErrors((e) => ({ ...e, [key]: undefined }));
    load(board, period);
  };

  return (
    <main className="zk-screen has-tabs" style={{ background: "var(--zk-bg-hero-purple)" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--zk-space-12)",
          paddingBottom: you ? 92 : 0,
        }}
      >
        <h1 className="zk-title" style={{ margin: 0 }}>Leaderboard</h1>

        <div
          role="tablist"
          aria-label="Board"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "var(--zk-space-4)",
            padding: "var(--zk-space-4)",
            borderRadius: "var(--zk-radius-xl)",
            background: "var(--zk-surface)",
          }}
        >
          {TABS.map((t) => {
            const on = board === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setBoard(t.id)}
                style={{
                  height: 44,
                  border: 0,
                  padding: 0,
                  borderRadius: "var(--zk-radius-lg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "var(--zk-space-6)",
                  font: "var(--zk-type-btn-sm)",
                  background: on ? "var(--zk-gold)" : "transparent",
                  color: on ? "var(--zk-gold-ink)" : "var(--zk-text-muted)",
                  boxShadow: on ? "var(--zk-shadow-chip-active)" : "none",
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                  transition: "background var(--zk-dur-fast) var(--zk-ease-out)",
                }}
              >
                <Icon icon={t.icon} size={15} stroke={2.4} />
                {t.label}
              </button>
            );
          })}
        </div>

        <div role="group" aria-label="Period" style={{ display: "flex", gap: "var(--zk-space-8)" }}>
          {PERIODS.map((p) => {
            const on = period === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => setPeriod(p.id)}
                style={{
                  height: 44,
                  padding: "0 var(--zk-space-18)",
                  borderRadius: "var(--zk-radius-pill)",
                  display: "flex",
                  alignItems: "center",
                  font: "var(--zk-type-small)",
                  fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"],
                  background: on ? "var(--zk-text)" : "transparent",
                  color: on ? "var(--zk-bg)" : "var(--zk-text-muted)",
                  border: `1px solid ${on ? "var(--zk-text)" : "var(--zk-border-strong)"}`,
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {tourneyOn ? <TournamentStrip info={tourney} onWeekEnd={onWeekEnd} /> : null}

        {error && !lb ? (
          <Card>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "var(--zk-type-h4)" }}>The board’s gone quiet.</div>
              <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-4)" }}>
                {error}
              </div>
            </div>
            <Button label="Try again" variant="secondary" size="sm" full={false} onClick={retry} style={{ height: 44 }} />
          </Card>
        ) : (
          <>
            {!loading && rows.length === 0 ? <FirstOnBoard board={board} period={period} /> : null}
            <Podium rows={rows} board={board} loading={loading} />
            {loading ? (
              <SkeletonRows />
            ) : rows.length === 0 ? null : rows.length < 3 ? (
              <Card>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--zk-type-h4)" }}>Grab a spot on the podium</div>
                  <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-4)" }}>
                    {hint.text}
                  </div>
                </div>
                <Button label={hint.short} variant="primary" size="sm" full={false} href={hint.href} style={{ height: 44 }} />
              </Card>
            ) : (
              rows.length > 3 && (
                <ol
                  start={4}
                  style={{
                    margin: "var(--zk-space-6) 0 0",
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--zk-space-6)",
                  }}
                >
                  {rows.slice(3).map((r) => (
                    <Row key={`${r.rank}-${r.handle}`} row={r} board={board} />
                  ))}
                </ol>
              )
            )}
            {tourneyOn && tourney?.last ? <Champions last={tourney.last} /> : null}
          </>
        )}
      </div>

      {you && <YouBar you={you} board={board} ranked={ranked} />}
      <TabBar active="leaderboard" />
    </main>
  );
}
