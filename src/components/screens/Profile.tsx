"use client";
// Screen 10 · Profile. Avatar + editable handle, account card (signed in: email, ZECKED wallet
// balance, sign out; guest: sign up), tier card with XP bar, 5 stats, badge grid, and a
// "My stashes" list (hider dashboard).
import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api, formatUsd, formatZec } from "@/lib/api";
import type { BadgeId, Player, PublicStash } from "@/lib/types";
import { ZAT } from "@/lib/types";
import { BADGE_META, Badge, Button, Emblem, Icon, Input, StashCard, TIER_LABEL, TabBar } from "@/components/zk";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { isMuted, setMuted } from "@/lib/sfx";

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

/* ---------- account card ---------- */

const accountCard: CSSProperties = {
  background: "var(--zk-surface)",
  borderRadius: "var(--zk-radius-2xl)",
  padding: "var(--zk-space-14) var(--zk-space-16)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--zk-space-12)",
};

const tile = (bg: string, fg: string, size = 40): CSSProperties => ({
  width: size,
  height: size,
  flex: "none",
  borderRadius: "var(--zk-radius-md)",
  background: bg,
  color: fg,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
});

function AccountCard({ player }: { player: Player }) {
  const signedIn = !!player.account?.signedIn;
  const [zecUsd, setZecUsd] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    api
      .config()
      .then((c) => {
        if (alive && c.zecUsd > 0) setZecUsd(c.zecUsd);
      })
      .catch(() => {
        /* balance still shows in ZEC */
      });
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const signOut = async () => {
    if (leaving) return;
    setLeaving(true);
    setError("");
    try {
      await api.logout();
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn’t sign you out. Try again.");
      setLeaving(false);
    }
  };

  if (!signedIn) {
    return (
      <section aria-label="Account" style={{ ...accountCard, border: "1.5px dashed var(--zk-border-strong)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
          <div style={tile("var(--zk-purple-tint)", "var(--zk-purple-light)")}>
            <Icon icon="user" size={20} stroke={2.4} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "var(--zk-type-h4)" }}>You’re playing as a guest</div>
            <div style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-medium)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)" }}>
              Sign up to keep your wins and hide stashes. Your XP and badges come with you.
            </div>
          </div>
        </div>
        <Button label="Sign up to save your progress" variant="primary" size="md" href="/signin?next=%2Fme" />
      </section>
    );
  }

  const bal = player.balanceZat || 0;
  const usd = zecUsd != null ? formatUsd((bal / ZAT) * zecUsd) : null;

  return (
    <section aria-label="Account" style={accountCard}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)" }}>
        <div style={tile("var(--zk-mint-tint)", "var(--zk-mint)", 32)}>
          <Icon icon="shieldCheck" size={17} stroke={2.4} />
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            font: "var(--zk-type-small)",
            color: "var(--zk-text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {player.account.email ? (
            <>
              Signed in as <span style={{ color: "var(--zk-text)", fontWeight: "var(--zk-fw-bold)" }}>{player.account.email}</span>
            </>
          ) : player.account.via?.includes("passkey") ? (
            "Signed in with a passkey"
          ) : (
            "Signed in"
          )}
        </div>
        <Button
          label={leaving ? "Signing out…" : "Sign out"}
          variant="ghost"
          size="sm"
          full={false}
          disabled={leaving}
          onClick={() => void signOut()}
        />
      </div>

      <Link
        href="/wallet"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--zk-space-12)",
          padding: "var(--zk-space-12)",
          borderRadius: "var(--zk-radius-xl)",
          background: "var(--zk-surface-raised)",
          color: "var(--zk-text)",
          textDecoration: "none",
        }}
      >
        <div style={{ ...tile("var(--zk-grad-tile-gold)", "var(--zk-gold-ink)", 44), borderRadius: "var(--zk-radius-lg)", boxShadow: "0 3px 0 var(--zk-gold-deep)" }}>
          <Icon icon="wallet" size={22} stroke={2.4} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--zk-type-h4)" }}>ZECKED wallet</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--zk-space-6)", marginTop: "var(--zk-space-2)", whiteSpace: "nowrap" }}>
            <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-gold)" }}>{formatZec(bal)} ZEC</span>
            {usd && <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>~{usd}</span>}
          </div>
        </div>
        <span style={{ color: "var(--zk-text-muted)", display: "flex" }}>
          <Icon icon="arrowRight" size={18} stroke={2.4} />
        </span>
      </Link>

      {error && (
        <span role="alert" style={{ font: "var(--zk-type-caption)", color: "var(--zk-red)" }}>
          {error}
        </span>
      )}
    </section>
  );
}

/* ---------- settings ---------- */

const settingRow: CSSProperties = { display: "flex", alignItems: "center", gap: "var(--zk-space-12)", minHeight: 52 };

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{
        width: 52,
        height: 32,
        flex: "none",
        borderRadius: 999,
        border: 0,
        padding: 3,
        cursor: "pointer",
        background: on ? "var(--zk-mint)" : "var(--zk-surface-raised)",
        boxShadow: on ? "inset 0 -2px 0 var(--zk-mint-deep)" : "inset 0 0 0 1.5px var(--zk-border-strong)",
        transition: "background var(--zk-dur-fast) var(--zk-ease-out)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          display: "block",
          width: 26,
          height: 26,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 2px 4px rgb(0 0 0 / .3)",
          transform: on ? "translateX(20px)" : "none",
          transition: "transform var(--zk-dur-fast) var(--zk-ease-spring)",
        }}
      />
    </button>
  );
}

function SettingsCard({ player, onSaved }: { player: Player; onSaved: (p: Player) => void }) {
  const [soundOn, setSoundOn] = useState(true);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => {
    setSoundOn(!isMuted());
    setCanPasskey(browserSupportsWebAuthn());
  }, []);
  const via = player.account?.via || [];
  const signedIn = !!player.account?.signedIn;
  const methods = via.map((v) => (v === "google" ? "Google" : v === "passkey" ? "Passkey" : "Email")).join(" · ");

  const addPasskey = async () => {
    if (adding) return;
    setAdding(true);
    setNote(null);
    try {
      const optionsJSON = await api.passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON });
      const r = await api.passkeyRegisterVerify(response);
      onSaved(r.player);
      setNote({ text: "Passkey added. Next time, just use Face ID or your fingerprint.", ok: true });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      setNote({
        text: name === "NotAllowedError" || name === "AbortError" ? "No passkey added." : e instanceof Error && e.message ? e.message : "Couldn’t add the passkey.",
        ok: false,
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <section aria-label="Settings" style={{ ...accountCard, gap: 0 }}>
      {sectionHead("Settings")}
      <div style={{ ...settingRow, marginTop: "var(--zk-space-6)" }}>
        <div style={tile("var(--zk-sky-tint)", "var(--zk-sky)", 36)}>
          <Icon icon="bell" size={18} stroke={2.4} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--zk-type-h4)" }}>Sounds</div>
          <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>Pops, confetti and wins</div>
        </div>
        <Switch
          label="Sounds"
          on={soundOn}
          onChange={(v) => {
            setSoundOn(v);
            setMuted(!v);
          }}
        />
      </div>
      {signedIn && (
        <div style={{ ...settingRow, borderTop: "1px solid var(--zk-border)" }}>
          <div style={tile("var(--zk-mint-tint)", "var(--zk-mint)", 36)}>
            <Icon icon="passkey" size={18} stroke={2.4} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "var(--zk-type-h4)" }}>Sign-in</div>
            <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>{methods || "Signed in"}</div>
          </div>
          {canPasskey && (
            <Button
              label={adding ? "Adding…" : via.includes("passkey") ? "Add another" : "Add a passkey"}
              variant="ghost"
              size="sm"
              full={false}
              disabled={adding}
              onClick={() => void addPasskey()}
            />
          )}
        </div>
      )}
      {note && (
        <span role="status" style={{ font: "var(--zk-type-caption)", color: note.ok ? "var(--zk-mint)" : "var(--zk-text-muted)", paddingBottom: "var(--zk-space-4)" }}>
          {note.text}
        </span>
      )}
    </section>
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
            <AccountCard player={player} />
            <TierCard player={player} />
            <Stats player={player} />
            <Badges player={player} />
            <MyStashes />
            <SettingsCard player={player} onSaved={setPlayer} />
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
