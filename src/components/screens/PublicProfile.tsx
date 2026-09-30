"use client";
// A player's public page (/u/[handle]): big avatar, handle, tier + XP, stats, badges, and the stashes they
// hid (live first, then finished). Only aggregates: never which stashes they won (winners stay anonymous),
// never money or ids. Your own page says "This is you" and links to /me to edit it; the house (@zecked)
// gets its own header.
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAppBack } from "@/lib/nav";
import type { BadgeId, PublicProfile as Profile, PublicStash } from "@/lib/types";
import { BADGE_META, Badge, Button, Emblem, Icon, Logo, StashCard, TIER_LABEL } from "@/components/zk";
import { TopToast, shareLink } from "@/components/screens/WinMoment";

const ALL_BADGES: BadgeId[] = ["first-crack", "uncrackable", "oracle", "speed-demon", "whale-hider", "shielded", "birthday-og"];

// The same avatar palette as the leaderboard, so a player's colour matches from one screen to the next.
const AVATAR_COLORS = [
  "var(--zk-pink)",
  "var(--zk-sky)",
  "var(--zk-mint)",
  "var(--zk-gold)",
  "var(--zk-purple-light)",
  "var(--zk-tier-rookie-hi)",
  "var(--zk-sky-light)",
  "var(--zk-mint-light)",
];
function colorFor(handle: string) {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const atHandle = (h: string) => (h.startsWith("@") ? h : `@${h}`);
const initialOf = (h: string) => (h.replace(/^@+/, "")[0] || "?").toUpperCase();

function sinceLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

type Load = { kind: "loading" } | { kind: "ready"; profile: Profile } | { kind: "missing" } | { kind: "error"; message: string };

/* ---------- styles ---------- */

const navBtn: CSSProperties = {
  width: "var(--zk-tap-min)",
  height: "var(--zk-tap-min)",
  borderRadius: "var(--zk-radius-lg)",
  background: "var(--zk-surface)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  padding: 0,
  color: "var(--zk-text)",
  cursor: "pointer",
  flex: "none",
};

const sectionHead = (title: ReactNode, meta?: ReactNode) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "var(--zk-space-10)" }}>
    <h2 style={{ margin: 0, font: "var(--zk-type-h3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h2>
    {meta != null && <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", flex: "none" }}>{meta}</span>}
  </div>
);

const CSS = `
@keyframes zk-pp-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes zk-pp-avatar { 0% { opacity: 0; transform: scale(.6) rotate(-8deg) } 65% { opacity: 1; transform: scale(1.06) rotate(2deg) } 100% { transform: none } }
`;
const rise = (i: number): CSSProperties => ({ animation: `zk-pp-in 360ms var(--zk-ease-out) ${60 + i * 50}ms both` });

/* ---------- pieces ---------- */

function Header({ p }: { p: Profile }) {
  const since = sinceLabel(p.createdAt);
  const avatar: CSSProperties = {
    width: "clamp(76px, 22vw, 92px)",
    height: "clamp(76px, 22vw, 92px)",
    flex: "none",
    borderRadius: p.isHouse ? "var(--zk-radius-2xl)" : "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    animation: "zk-pp-avatar 520ms var(--zk-ease-out) both",
  };
  return (
    <section aria-label="Player" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-10)", textAlign: "center" }}>
      {p.isHouse ? (
        <div aria-hidden="true" style={{ ...avatar, background: "var(--zk-grad-tile-gold)", boxShadow: "var(--zk-inset-gloss), 0 5px 0 var(--zk-gold-deep), var(--zk-glow-gold)" }}>
          <Logo variant="mark" size={52} stroke="var(--zk-gold-deep)" />
        </div>
      ) : (
        <div
          aria-hidden="true"
          style={{
            ...avatar,
            background: colorFor(p.handle),
            color: "var(--zk-bg)",
            border: "4px solid rgb(var(--zk-white-rgb) / .9)",
            boxSizing: "border-box",
            boxShadow: "0 5px 0 rgb(var(--zk-black-rgb) / .35)",
            font: "var(--zk-fw-black) clamp(32px, 9vw, 40px)/1 var(--zk-font-display)",
          }}
        >
          {initialOf(p.handle)}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-4)", maxWidth: "100%" }}>
        <h1
          style={{
            margin: 0,
            maxWidth: "100%",
            font: "var(--zk-fw-black) clamp(26px, 8vw, 32px)/1.1 var(--zk-font-display)",
            letterSpacing: "var(--zk-track-tight)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {atHandle(p.handle)}
        </h1>
        {p.isHouse ? (
          <p style={{ margin: 0, font: "var(--zk-type-body)", fontSize: "var(--zk-fs-15)", color: "var(--zk-text-muted)", textWrap: "balance" } as CSSProperties}>
            <b style={{ color: "var(--zk-gold)" }}>The ZECKED house</b> · Drops a free riddle every few hours
          </p>
        ) : (
          <p style={{ margin: 0, font: "var(--zk-type-small)", fontWeight: "var(--zk-fw-semibold)" as CSSProperties["fontWeight"], color: "var(--zk-text-muted)" }}>
            <span style={{ color: "var(--zk-gold)" }}>{TIER_LABEL[p.tier] ?? "Rookie"}</span>
            {since ? ` · Playing since ${since}` : ""}
          </p>
        )}
      </div>
      {p.isYou && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--zk-space-8)", flexWrap: "wrap" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--zk-space-6)",
              height: 32,
              padding: "0 var(--zk-space-12)",
              borderRadius: "var(--zk-radius-pill)",
              background: "var(--zk-gold-tint)",
              border: "1px solid rgb(var(--zk-gold-rgb) / .35)",
              color: "var(--zk-gold)",
              font: "var(--zk-fw-black) var(--zk-fs-12)/1 var(--zk-font-body)",
              letterSpacing: "var(--zk-track-badge)",
              textTransform: "uppercase",
            }}
          >
            <Icon icon="user" size={13} stroke={2.6} />
            This is you
          </span>
          <Button label="Edit profile" icon="sliders" variant="ghost" size="sm" full={false} href="/me" style={{ height: 44 }} />
        </div>
      )}
    </section>
  );
}

function TierCard({ p }: { p: Profile }) {
  const start = p.xpTierStart;
  const next = p.xpForNext;
  const hasNext = next != null && p.nextTier != null && next > start;
  const pct = hasNext ? Math.max(0, Math.min(1, (p.xp - start) / (next - start))) : 1;
  // The bar fills from empty on arrival.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(r);
  }, [pct]);
  return (
    <section
      aria-label="Tier"
      style={{
        position: "relative",
        overflow: "hidden",
        background: "linear-gradient(160deg, var(--zk-surface-purple), var(--zk-surface) 60%)",
        borderRadius: "var(--zk-radius-3xl)",
        border: "1.5px solid rgb(var(--zk-gold-rgb) / .3)",
        padding: "var(--zk-space-16) var(--zk-space-18)",
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-16)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: -120,
          top: -110,
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: "var(--zk-sunburst-gold)",
          willChange: "transform",
          animation: "zk-spin 40s linear infinite",
        }}
      />
      <div style={{ position: "relative", flex: "none" }}>
        <Emblem tier={p.tier} size={68} />
      </div>
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-text-muted)" }}>TIER</div>
        <div style={{ font: "var(--zk-fw-black) var(--zk-fs-26)/1.05 var(--zk-font-display)", color: "var(--zk-gold)", marginTop: "var(--zk-space-4)" }}>
          {TIER_LABEL[p.tier] ?? "Rookie"}
        </div>
        <div
          role="progressbar"
          aria-label="XP to next tier"
          aria-valuemin={start}
          aria-valuenow={p.xp}
          aria-valuemax={hasNext ? next : p.xp}
          style={{ marginTop: "var(--zk-space-10)", height: 12, borderRadius: "var(--zk-radius-pill)", background: "var(--zk-bg)", overflow: "hidden" }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.round(shown * 100)}%`,
              borderRadius: "var(--zk-radius-pill)",
              background: "var(--zk-grad-xp)",
              boxShadow: "inset 0 -3px 0 rgb(var(--zk-black-rgb) / .18)",
              transition: "width var(--zk-dur-meter) var(--zk-ease-out)",
            }}
          />
        </div>
        <div
          style={{
            marginTop: "var(--zk-space-6)",
            display: "flex",
            justifyContent: "space-between",
            gap: "var(--zk-space-8)",
            font: "var(--zk-fw-semibold) var(--zk-fs-11)/1 var(--zk-font-body)",
            color: "var(--zk-text-muted)",
          }}
        >
          <span style={{ fontFamily: "var(--zk-font-mono)", whiteSpace: "nowrap", flex: "none" }}>{fmt(p.xp)} XP</span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
            {hasNext ? `Next: ${TIER_LABEL[p.nextTier!]}` : "Top tier"}
          </span>
        </div>
      </div>
    </section>
  );
}

function StatTiles({ items }: { items: { v: ReactNode; l: string; c: string; aria: string }[] }) {
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: "clamp(4px, 1.4vw, var(--zk-space-8))" }}>
      {items.map((st) => (
        <div
          key={st.l}
          aria-label={st.aria}
          style={{
            minWidth: 0,
            background: "var(--zk-surface)",
            borderRadius: "var(--zk-radius-lg)",
            padding: "var(--zk-space-12) 3px",
            textAlign: "center",
            display: "flex",
            flexDirection: "column-reverse",
            alignItems: "center",
            gap: "var(--zk-space-6)",
          }}
        >
          <dt
            style={{
              font: "var(--zk-fw-bold) clamp(9.5px, 2.8vw, 11px)/1 var(--zk-font-body)",
              color: "var(--zk-text-muted)",
              whiteSpace: "nowrap",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {st.l}
          </dt>
          <dd style={{ margin: 0, font: "var(--zk-fw-black) var(--zk-fs-22)/1 var(--zk-font-display)", color: st.c }}>{st.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Badges({ p }: { p: Profile }) {
  const owned = new Set(p.badges);
  const ordered = [...ALL_BADGES.filter((b) => owned.has(b)), ...ALL_BADGES.filter((b) => !owned.has(b))];
  const count = ALL_BADGES.filter((b) => owned.has(b)).length;
  return (
    <section aria-label="Badges" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>
      {sectionHead("Badges", `${count} / ${ALL_BADGES.length}`)}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--zk-space-10) var(--zk-space-6)" }}>
        {ordered.map((id) => {
          const locked = !owned.has(id);
          return (
            <div key={id} title={BADGE_META[id].desc} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-6)", minWidth: 0 }}>
              <Badge badge={id} locked={locked} size={56} />
              <span style={{ font: "var(--zk-fw-bold) var(--zk-fs-11)/1.2 var(--zk-font-body)", color: locked ? "var(--zk-text-faint)" : "var(--zk-text)", textAlign: "center" }}>
                {BADGE_META[id].name}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const isLive = (s: PublicStash) => s.status === "live" || s.status === "locked";

function Stashes({ p }: { p: Profile }) {
  const live = p.stashes.filter(isLive);
  const done = p.stashes.filter((s) => !isLive(s));
  const groups = [
    { k: "live", label: "LIVE NOW", color: "var(--zk-mint)", items: live },
    { k: "done", label: "FINISHED", color: "var(--zk-text-muted)", items: done },
  ].filter((g) => g.items.length > 0);
  return (
    <section aria-label={`Stashes by ${atHandle(p.handle)}`} style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)", marginTop: "var(--zk-space-6)" }}>
      {sectionHead(`Stashes by ${atHandle(p.handle)}`, p.stashes.length > 0 ? String(p.stashes.length) : undefined)}
      {groups.length === 0 ? (
        <div
          style={{
            background: "var(--zk-surface)",
            borderRadius: "var(--zk-radius-xl)",
            border: "1.5px dashed var(--zk-border-strong)",
            padding: "var(--zk-space-18)",
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-12)",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              flex: "none",
              borderRadius: "var(--zk-radius-md)",
              background: "var(--zk-surface-raised)",
              color: "var(--zk-text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon="vault" size={22} stroke={2.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "var(--zk-type-h4)" }}>No stashes yet</div>
            <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-4)" }}>
              {p.isYou ? "Hide a riddle or a match call. Watch them sweat." : "When they hide one, it shows up here."}
            </div>
          </div>
          {p.isYou ? <Button label="Hide" icon="plus" variant="primary" size="sm" full={false} href="/hide" style={{ height: 44 }} /> : null}
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.k} style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-16)" }}>
            {groups.length > 1 || g.k === "live" ? (
              <span style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: g.color }}>{g.label}</span>
            ) : null}
            {g.items.map((s) => (
              <StashCard key={s.id} stash={s} href={`/s/${s.id}`} linkHider={false} />
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function Skeleton() {
  const block = (w: string | number, h: string | number, r: string, extra?: CSSProperties): CSSProperties => ({
    width: w,
    height: h,
    borderRadius: r,
    background: "var(--zk-surface)",
    animation: "zk-glow 1.6s ease-in-out infinite",
    ...extra,
  });
  return (
    <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
      <span className="zk-sr-only">Loading profile…</span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-10)" }}>
        <div style={block("clamp(76px, 22vw, 92px)", "clamp(76px, 22vw, 92px)", "50%")} />
        <div style={block(170, 30, "var(--zk-radius-md)")} />
        <div style={block(190, 14, "var(--zk-radius-sm)")} />
      </div>
      <div style={block("100%", 116, "var(--zk-radius-3xl)")} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--zk-space-6)" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={block("100%", 66, "var(--zk-radius-lg)")} />
        ))}
      </div>
      <div style={block("100%", 150, "var(--zk-radius-2xl)")} />
    </div>
  );
}

/* ---------- screen ---------- */

export default function PublicProfile({ handle }: { handle: string }) {
  const back = useAppBack("/feed");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [toast, setToast] = useState<{ text: string; variant: "success" | "default"; icon?: string; n: number } | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const { profile } = await api.profile(handle);
      setLoad({ kind: "ready", profile });
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status === 404) setLoad({ kind: "missing" });
      else
        setLoad({
          kind: "error",
          message: status == null ? "Can’t reach ZECKED. Check your connection and try again." : "We couldn’t load this player just now. Try again in a moment.",
        });
    }
  }, [handle]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const profile = load.kind === "ready" ? load.profile : null;
  const shownHandle = atHandle(profile?.handle ?? handle);

  const share = async () => {
    const url = `${window.location.origin}/u/${encodeURIComponent(shownHandle.replace(/^@+/, ""))}`;
    const text = profile?.isYou ? "My ZECKED profile. Crack one of my stashes 🔐" : profile?.isHouse ? "Free riddles with ZEC inside, every few hours 🔐" : `${shownHandle} on ZECKED 🔐`;
    const res = await shareLink(url, text);
    if (res === "copied") setToast((t) => ({ text: "Link copied", variant: "success", icon: "copy", n: (t?.n ?? 0) + 1 }));
    else if (res === "failed") setToast((t) => ({ text: url, variant: "default", icon: "copy", n: (t?.n ?? 0) + 1 }));
  };

  const nav = (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <button type="button" aria-label="Back" onClick={back} style={navBtn}>
        <Icon icon="back" size={22} stroke={2.4} />
      </button>
      <span style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: profile?.isHouse ? "var(--zk-gold)" : "var(--zk-purple-light)" }}>
        {profile?.isHouse ? "THE HOUSE" : "PLAYER"}
      </span>
      {load.kind === "missing" ? (
        <span aria-hidden="true" style={{ width: 44, height: 44, flex: "none" }} />
      ) : (
        <button type="button" aria-label="Share this profile" onClick={() => void share()} style={navBtn}>
          <Icon icon="share" size={20} stroke={2.2} />
        </button>
      )}
    </nav>
  );

  let body: ReactNode;
  if (load.kind === "loading") {
    body = <Skeleton />;
  } else if (load.kind === "missing" || load.kind === "error") {
    const missing = load.kind === "missing";
    body = (
      <>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--zk-space-12)", textAlign: "center", ...rise(0) }}>
          <div
            aria-hidden="true"
            style={{
              width: 76,
              height: 76,
              borderRadius: "50%",
              background: "var(--zk-surface)",
              border: "2px dashed var(--zk-border-strong)",
              color: "var(--zk-text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon={missing ? "mask" : "signal"} size={34} stroke={2.2} />
          </div>
          <h1 style={{ margin: 0, font: "var(--zk-type-h2)", textWrap: "balance" } as CSSProperties}>{missing ? "No player with that name" : "Couldn’t load this player"}</h1>
          <p style={{ margin: 0, font: "var(--zk-type-body)", color: "var(--zk-text-muted)", maxWidth: 300, textWrap: "pretty" } as CSSProperties}>
            {missing ? `Nobody on ZECKED goes by ${shownHandle}. Maybe they changed their name.` : load.message}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
          {!missing && (
            <Button
              label="Try again"
              variant="primary"
              size="lg"
              onClick={() => {
                setLoad({ kind: "loading" });
                void fetchProfile();
              }}
            />
          )}
          <Button label="Back to stashes" variant={missing ? "primary" : "ghost"} size={missing ? "lg" : "md"} href="/feed" />
        </div>
      </>
    );
  } else {
    const p = load.profile;
    const s = p.stats;
    const liveNow = p.stashes.filter(isLive).length;
    body = (
      <>
        <div style={rise(0)}>
          <Header p={p} />
        </div>
        {p.isHouse ? (
          <div style={rise(1)}>
            <StatTiles
              items={[
                { v: fmt(s.hidden), l: "Riddles dropped", c: "var(--zk-gold)", aria: `${fmt(s.hidden)} riddles dropped` },
                { v: fmt(liveNow), l: "Live now", c: "var(--zk-mint)", aria: `${fmt(liveNow)} live now` },
              ]}
            />
          </div>
        ) : (
          <>
            <div style={rise(1)}>
              <TierCard p={p} />
            </div>
            <div style={rise(2)}>
              <StatTiles
                items={[
                  { v: fmt(s.cracked), l: "Cracked", c: "var(--zk-gold)", aria: `${fmt(s.cracked)} cracked` },
                  { v: fmt(s.hidden), l: "Hidden", c: "var(--zk-pink)", aria: `${fmt(s.hidden)} hidden` },
                  { v: fmt(s.oracle), l: "Oracle calls", c: "var(--zk-sky)", aria: `${fmt(s.oracle)} exact scores called` },
                  {
                    v: (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                        <Icon icon="flame" size={18} filled stroke={1.5} color="var(--zk-pink)" />
                        {fmt(s.streak)}
                      </span>
                    ),
                    l: "Streak",
                    c: "var(--zk-text)",
                    aria: `${fmt(s.streak)} day streak`,
                  },
                ]}
              />
            </div>
            <div style={rise(3)}>
              <Badges p={p} />
            </div>
          </>
        )}
        <div style={rise(p.isHouse ? 2 : 4)}>
          <Stashes p={p} />
        </div>
      </>
    );
  }

  return (
    <main
      className="zk-screen"
      style={{ background: profile?.isHouse ? "var(--zk-bg-hero-gold)" : "var(--zk-bg-hero-purple)", gap: "var(--zk-space-16)" }}
    >
      <style>{CSS}</style>
      {nav}
      {body}
      {toast && <TopToast key={toast.n} text={toast.text} variant={toast.variant} icon={toast.icon} />}
    </main>
  );
}
