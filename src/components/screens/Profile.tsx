"use client";
// Screen 10 · Profile. Avatar + editable handle, tier card with XP bar, 5 stats, badge grid,
// and a "My stashes" list (hider dashboard).
import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { BadgeId, Player, PublicStash } from "@/lib/types";
import { BADGE_META, Badge, Button, Emblem, Icon, Input, StashCard, TIER_LABEL, TabBar } from "@/components/zk";

const ALL_BADGES: BadgeId[] = [
  "first-crack",
  "uncrackable",
  "oracle",
  "speed-demon",
  "whale-hider",
  "shielded",
  "birthday-og",
];

const HANDLE_RE = /^[A-Za-z0-9_]{2,20}$/;
const HANDLE_HINT = "Handles are 2–20 letters, numbers or _";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const atHandle = (h: string) => (h.startsWith("@") ? h : `@${h}`);
const initialOf = (h: string) => (h.replace(/^@+/, "")[0] || "?").toUpperCase();

function sinceLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** Pencil glyph drawn in the ZK Icon style (24px grid, 2px round strokes). The icon set has no pencil. */
function PencilGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "none" }}
    >
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z M13.5 6.5l4 4" />
    </svg>
  );
}

const squareBtn: CSSProperties = {
  width: 40,
  height: 40,
  flex: "none",
  borderRadius: "var(--zk-radius-md)",
  background: "var(--zk-surface)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--zk-text)",
  border: 0,
  padding: 0,
  cursor: "pointer",
};

const sectionHead = (title: string, meta?: ReactNode) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
    <h2 style={{ margin: 0, font: "var(--zk-type-h3)" }}>{title}</h2>
    {meta != null && <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>{meta}</span>}
  </div>
);

/* ---------- identity row ---------- */

function IdentityRow({ player, onSaved }: { player: Player; onSaved: (p: Player) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);
  const [saving, setSaving] = useState(false);
  const start = () => {
    setDraft(atHandle(player.handle));
    setError("");
    setShake(0); // a fresh Input with shake > 0 would shake on mount
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError("");
  };
  const fail = (msg: string) => {
    setError(msg);
    setShake((n) => n + 1);
  };
  const save = async () => {
    if (saving) return;
    const base = draft.trim().replace(/^@+/, "");
    if (!HANDLE_RE.test(base)) return fail(HANDLE_HINT);
    // The server treats handles case-insensitively, so an unchanged handle just closes the editor.
    if (base.toLowerCase() === player.handle.replace(/^@+/, "").toLowerCase()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const { player: p } = await api.setHandle(base);
      onSaved(p);
      setEditing(false);
    } catch (e) {
      fail(e instanceof Error ? e.message : "Couldn’t save that handle.");
    } finally {
      setSaving(false);
    }
  };

  const since = sinceLabel(player.createdAt);

  return (
    <div style={{ display: "flex", alignItems: editing ? "flex-start" : "center", gap: "var(--zk-space-12)" }}>
      <div
        aria-hidden="true"
        style={{
          width: 52,
          height: 52,
          flex: "none",
          borderRadius: "50%",
          background: "var(--zk-grad-tile-purple)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "var(--zk-inset-gloss), 0 3px 0 var(--zk-purple-shade)",
          font: "var(--zk-type-h3)",
        }}
      >
        {initialOf(editing ? draft || player.handle : player.handle)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div
            onKeyDown={(e) => {
              if (e.key === "Escape") cancel();
            }}
            style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}
          >
            <Input
              value={draft}
              onChange={(v) => {
                setDraft(v);
                if (error) setError("");
              }}
              onEnter={save}
              placeholder="@yourhandle"
              label="Your handle"
              size="sm"
              state={error ? "error" : "default"}
              message={error || "2–20 letters, numbers or _"}
              shake={shake}
              maxLength={21}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <div style={{ display: "flex", gap: "var(--zk-space-8)" }}>
              <Button
                label={saving ? "Saving…" : "Save"}
                icon="check"
                variant="primary"
                size="sm"
                full={false}
                disabled={saving}
                onClick={save}
              />
              <Button label="Cancel" variant="ghost" size="sm" full={false} onClick={cancel} />
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", minWidth: 0 }}>
              <h1
                style={{
                  margin: 0,
                  font: "var(--zk-type-h3)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                {atHandle(player.handle)}
              </h1>
              <button
                type="button"
                onClick={start}
                aria-label="Edit handle"
                style={{
                  flex: "none",
                  width: 28,
                  height: 28,
                  borderRadius: "var(--zk-radius-sm)",
                  background: "var(--zk-surface)",
                  color: "var(--zk-text-muted)",
                  border: 0,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <PencilGlyph size={15} />
              </button>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--zk-space-4)",
                font: "var(--zk-type-caption)",
                color: "var(--zk-text-muted)",
                flexWrap: "wrap",
              }}
            >
              {since && <>Zecking since {since}</>}
              {player.shielded && (
                <>
                  {since && " · "}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--zk-space-2)", color: "var(--zk-mint)" }}>
                    Shielded
                    <Icon icon="check" size={12} stroke={3} />
                  </span>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {!editing && (
        <Link href="/how" aria-label="How it works" style={squareBtn}>
          <Icon icon="info" size={18} />
        </Link>
      )}
    </div>
  );
}

/* ---------- tier card ---------- */

function TierCard({ player }: { player: Player }) {
  const start = player.xpTierStart;
  const next = player.xpForNext;
  const hasNext = next != null && player.nextTier != null && next > start;
  const pct = hasNext ? Math.max(0, Math.min(1, (player.xp - start) / (next - start))) : 1;

  return (
    <div
      style={{
        background: "linear-gradient(160deg, var(--zk-surface-purple), var(--zk-surface) 60%)",
        borderRadius: "var(--zk-radius-3xl)",
        padding: "var(--zk-space-18)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        border: "1.5px solid rgb(var(--zk-gold-rgb) / .3)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: -80,
          marginLeft: -160,
          width: 320,
          height: 320,
          borderRadius: "50%",
          background: "var(--zk-sunburst-gold)",
          willChange: "transform",
          animation: "zk-spin 40s linear infinite",
        }}
      />
      <div style={{ position: "relative" }}>
        <Emblem tier={player.tier} size={100} />
      </div>
      <div
        style={{
          position: "relative",
          font: "var(--zk-type-label)",
          letterSpacing: "var(--zk-track-label)",
          color: "var(--zk-text-muted)",
          marginTop: "var(--zk-space-12)",
        }}
      >
        CURRENT TIER
      </div>
      <div
        style={{
          position: "relative",
          font: "var(--zk-fw-black) var(--zk-fs-30)/1 var(--zk-font-display)",
          color: "var(--zk-gold)",
          marginTop: "var(--zk-space-4)",
        }}
      >
        {TIER_LABEL[player.tier]}
      </div>
      <div style={{ position: "relative", width: "100%", marginTop: "var(--zk-space-14)" }}>
        <div
          role="progressbar"
          aria-label="XP to next tier"
          aria-valuemin={start}
          aria-valuenow={player.xp}
          aria-valuemax={hasNext ? next : player.xp}
          style={{ height: 14, borderRadius: "var(--zk-radius-pill)", background: "var(--zk-bg)", overflow: "hidden" }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.round(pct * 100)}%`,
              borderRadius: "var(--zk-radius-pill)",
              background: "var(--zk-grad-xp)",
              boxShadow: "inset 0 -3px 0 rgb(var(--zk-black-rgb) / .18)",
              transition: "width var(--zk-dur-meter) var(--zk-ease-out)",
            }}
          />
        </div>
        {/* Design review fix: neither label may wrap. The XP count never shrinks; the hint truncates. */}
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
          <span style={{ fontFamily: "var(--zk-font-mono)", whiteSpace: "nowrap", flex: "none" }}>
            {hasNext ? `${fmt(player.xp)} / ${fmt(next)} XP` : `${fmt(player.xp)} XP`}
          </span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
            {hasNext ? `${fmt(next - player.xp)} XP to ${TIER_LABEL[player.nextTier!]}` : "Top tier reached"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- stats + badges ---------- */

function Stats({ player }: { player: Player }) {
  const s = player.stats;
  const stats = [
    { v: String(s.cracked), l: "Cracked", c: "var(--zk-gold)" },
    { v: String(s.hidden), l: "Hidden", c: "var(--zk-pink)" },
    { v: String(s.uncrackable), l: "Uncrackable", c: "var(--zk-purple-light)" },
    { v: String(s.oracle), l: "Oracle", c: "var(--zk-sky)" },
    { v: `${s.streak}🔥`, l: "Streak", c: "var(--zk-text)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "var(--zk-space-6)" }}>
      {stats.map((st) => (
        <div
          key={st.l}
          style={{
            background: "var(--zk-surface)",
            borderRadius: "var(--zk-radius-lg)",
            padding: "var(--zk-space-10) var(--zk-space-4)",
            textAlign: "center",
            minWidth: 0,
          }}
        >
          <div style={{ font: "var(--zk-fw-black) var(--zk-fs-22)/1 var(--zk-font-display)", color: st.c }}>{st.v}</div>
          <div
            style={{
              font: "var(--zk-fw-bold) var(--zk-fs-10)/1 var(--zk-font-body)",
              color: "var(--zk-text-muted)",
              marginTop: "var(--zk-space-6)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {st.l}
          </div>
        </div>
      ))}
    </div>
  );
}

function Badges({ player }: { player: Player }) {
  const owned = new Set(player.badges);
  const ordered = [...ALL_BADGES.filter((b) => owned.has(b)), ...ALL_BADGES.filter((b) => !owned.has(b))];
  const count = ALL_BADGES.filter((b) => owned.has(b)).length;
  return (
    <>
      {sectionHead("Badges", `${count} / ${ALL_BADGES.length}`)}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--zk-space-10) var(--zk-space-6)" }}>
        {ordered.map((id) => {
          const locked = !owned.has(id);
          const name =
            id === "oracle" && locked ? `Oracle ${Math.min(player.stats.oracle, 3)}/3` : BADGE_META[id].name;
          return (
            <div
              key={id}
              title={BADGE_META[id].desc}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-6)" }}
            >
              <Badge badge={id} locked={locked} size={60} />
              <span
                style={{
                  font: "var(--zk-fw-bold) var(--zk-fs-11)/1.2 var(--zk-font-body)",
                  color: locked ? "var(--zk-text-faint)" : "var(--zk-text)",
                  textAlign: "center",
                }}
              >
                {name}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ---------- my stashes ---------- */

function MyStashes() {
  const [stashes, setStashes] = useState<PublicStash[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { stashes } = await api.myStashes();
      setStashes(stashes);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load your stashes.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  let body: ReactNode;
  if (stashes && stashes.length > 0) {
    body = stashes.map((s) => (
      <StashCard
        key={s.id}
        stash={s}
        href={s.status === "awaiting_funding" ? `/hide?resume=${s.id}` : `/s/${s.id}`}
      />
    ));
  } else if (stashes) {
    body = (
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--zk-type-h4)" }}>Nothing hidden yet.</div>
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-4)" }}>
            Hide a riddle or a match call. Watch them sweat.
          </div>
        </div>
        <Button label="Hide" icon="plus" variant="primary" size="sm" full={false} href="/hide" />
      </div>
    );
  } else if (error) {
    body = (
      <div
        style={{
          background: "var(--zk-surface)",
          borderRadius: "var(--zk-radius-xl)",
          padding: "var(--zk-space-14) var(--zk-space-16)",
          display: "flex",
          alignItems: "center",
          gap: "var(--zk-space-12)",
        }}
      >
        <span style={{ flex: 1, font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>{error}</span>
        <Button label="Retry" variant="secondary" size="sm" full={false} onClick={load} />
      </div>
    );
  } else {
    body = (
      <div
        aria-busy="true"
        style={{
          height: 120,
          borderRadius: "var(--zk-radius-2xl)",
          background: "var(--zk-surface)",
          animation: "zk-glow 1.6s ease-in-out infinite",
        }}
      >
        <span className="zk-sr-only">Loading your stashes…</span>
      </div>
    );
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)", marginTop: "var(--zk-space-8)" }}>
      {sectionHead("My stashes", stashes && stashes.length > 0 ? String(stashes.length) : undefined)}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>{body}</div>
    </section>
  );
}

/* ---------- loading / error ---------- */

function ProfileSkeleton() {
  const block = (h: number, r: string, extra?: CSSProperties): CSSProperties => ({
    height: h,
    borderRadius: r,
    background: "var(--zk-surface)",
    animation: "zk-glow 1.6s ease-in-out infinite",
    ...extra,
  });
  return (
    <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
      <span className="zk-sr-only">Loading profile…</span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
        <div style={block(52, "50%", { width: 52 })} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
          <div style={block(20, "var(--zk-radius-sm)", { width: 140 })} />
          <div style={block(12, "var(--zk-radius-sm)", { width: 180 })} />
        </div>
      </div>
      <div style={block(250, "var(--zk-radius-3xl)")} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "var(--zk-space-6)" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} style={block(56, "var(--zk-radius-lg)")} />
        ))}
      </div>
    </div>
  );
}

/* ---------- screen ---------- */

export default function Profile() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const { player } = await api.me();
      setPlayer(player);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t load your profile.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="zk-screen has-tabs" style={{ background: "var(--zk-bg-hero-gold)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
        {player ? (
          <>
            <IdentityRow player={player} onSaved={setPlayer} />
            <TierCard player={player} />
            <Stats player={player} />
            <Badges player={player} />
            <MyStashes />
          </>
        ) : error ? (
          <div
            style={{
              marginTop: "var(--zk-space-40)",
              background: "var(--zk-surface)",
              borderRadius: "var(--zk-radius-2xl)",
              padding: "var(--zk-space-24) var(--zk-space-20)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "var(--zk-space-12)",
              textAlign: "center",
            }}
          >
            <div style={{ font: "var(--zk-type-h3)" }}>Your profile is hiding.</div>
            <div style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>{error}</div>
            <Button label="Try again" variant="secondary" size="md" full={false} onClick={load} />
          </div>
        ) : (
          <ProfileSkeleton />
        )}
      </div>
      <TabBar active="profile" />
    </main>
  );
}
