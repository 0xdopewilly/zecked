"use client";
// Screen 10 · Profile. Avatar + editable handle, account card (signed in: email, ZECKED wallet
// balance, sign out; guest: sign up), tier card with XP bar, 5 stats (tap one to learn what it
// counts), badge grid, a "My stashes" list (hider dashboard) and Settings.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { api, formatUsd, formatZec } from "@/lib/api";
import type { BadgeId, Player, PublicStash } from "@/lib/types";
import { ZAT } from "@/lib/types";
import { BADGE_META, Badge, Button, Emblem, Icon, Input, StashCard, TIER_LABEL, TabBar, Toast } from "@/components/zk";
import { InviteCard } from "@/components/screens/InviteCard";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { isMuted, setMuted } from "@/lib/sfx";
import { PUSH_COPY, usePush } from "@/components/zk/PushSetup";
import { useInstall } from "@/lib/install";
import { AvatarPhoto } from "@/components/screens/AvatarPicker";

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
/** The server's random first handles ("@velvettiger", "@quietkey430", "@cracker123456"). */
const GENERATED_HANDLE_RE =
  /^@?(?:(?:night|quiet|shadow|ghost|zero|gold|vault|cipher|silent|lucky|neon|velvet|hidden|sly|misty)(?:owl|fox|key|cat|raven|lynx|wolf|moth|otter|hawk|viper|tiger|panda|koala|zebra)(?:\d{3})?|cracker\d+)$/i;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const atHandle = (h: string) => (h.startsWith("@") ? h : `@${h}`);

/** Friendly copy for a failed request: never the raw browser text ("Failed to fetch", "Request failed (500)"). */
function friendlyErr(e: unknown, fallback: string): string {
  const status = (e as { status?: number } | null)?.status;
  if (status == null) return "Can’t reach ZECKED. Check your connection and try again.";
  if (status >= 500) return fallback;
  const m = e instanceof Error ? e.message : "";
  return m && !/^Request failed/i.test(m) ? (/[.!?]$/.test(m) ? m : `${m}.`) : fallback;
}

function sinceLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * A toast that outlives this screen (sign-out navigates to the feed): rendered into its own root on
 * <body>, at the top, then removed.
 */
function toastAcrossNavigation(text: string) {
  if (typeof document === "undefined") return;
  const host = document.createElement("div");
  host.setAttribute("aria-live", "polite");
  Object.assign(host.style, {
    position: "fixed",
    left: "50%",
    top: "calc(var(--zk-fixed-top) + var(--zk-space-12))",
    width: "min(394px, calc(100vw - 24px))",
    transform: "translateX(-50%)",
    zIndex: "86",
    pointerEvents: "none",
    transition: "opacity var(--zk-dur-base) var(--zk-ease-out), transform var(--zk-dur-base) var(--zk-ease-out)",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<Toast text={text} variant="default" icon="user" />);
  setTimeout(() => {
    host.style.opacity = "0";
    host.style.transform = "translateX(-50%) translateY(-8px)";
  }, 2600);
  setTimeout(() => {
    root.unmount();
    host.remove();
  }, 3000);
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
  width: 44,
  height: 44,
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

/** Small buttons keep the design's 40px look elsewhere; here they get the full 44px tap height. */
const TAP_44: CSSProperties = { height: 44 };

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
      fail(friendlyErr(e, "Couldn’t save that handle. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const since = sinceLabel(player.createdAt);
  // A handle the server picked at random: nudge people to make it theirs.
  const generated = GENERATED_HANDLE_RE.test(player.handle);

  return (
    <div style={{ display: "flex", alignItems: editing ? "flex-start" : "center", gap: "var(--zk-space-10)" }}>
      {/* Tap to add or change your photo. Without one, the buddy follows the name as you type it. */}
      <AvatarPhoto player={player} handle={editing ? draft || player.handle : player.handle} size="clamp(44px, 13.4vw, 52px)" onSaved={onSaved} />

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
              placeholder="@yourname"
              label="Your name on ZECKED"
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
                sfx="success"
                onClick={save}
                style={TAP_44}
              />
              <Button label="Cancel" variant="ghost" size="sm" full={false} onClick={cancel} style={TAP_44} />
            </div>
          </div>
        ) : (
          <>
            {/* The name and the pencil are one 44px-tall button: tap anywhere on your name to change it. */}
            <h1 style={{ margin: 0, minWidth: 0, display: "flex" }}>
              <button
                type="button"
                onClick={start}
                aria-label={`${atHandle(player.handle)}. Change your name`}
                style={{
                  minWidth: 0,
                  maxWidth: "100%",
                  minHeight: 44,
                  margin: "-4px 0",
                  padding: 0,
                  border: 0,
                  background: "transparent",
                  color: "var(--zk-text)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--zk-space-2)",
                  cursor: "pointer",
                  textAlign: "left",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span
                  style={{
                    font: "var(--zk-fw-black) clamp(16px, 5vw, var(--zk-fs-20))/var(--zk-lh-snug) var(--zk-font-display)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    minWidth: 0,
                  }}
                >
                  {atHandle(player.handle)}
                </span>
                <span aria-hidden="true" style={{ width: 40, height: 44, flex: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "var(--zk-radius-sm)",
                      background: generated ? "var(--zk-purple)" : "var(--zk-surface)",
                      color: generated ? "var(--zk-text)" : "var(--zk-text-muted)",
                      boxShadow: generated ? "0 3px 0 var(--zk-purple-deep)" : "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <PencilGlyph size={15} />
                  </span>
                </span>
              </button>
            </h1>
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
              {generated ? (
                <span style={{ color: "var(--zk-purple-light)" }}>We picked a random name. Tap it to choose yours.</span>
              ) : (
                <>
                  {since && <>Zecking since {since}</>}
                  {player.shielded && (
                    <>
                      {since && " · "}
                      <span
                        title="You’ve sent ZEC to a private wallet address"
                        style={{ display: "inline-flex", alignItems: "center", gap: "var(--zk-space-2)", color: "var(--zk-mint)" }}
                      >
                        Private
                        <Icon icon="check" size={12} stroke={3} />
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {!editing && (
        <Link href="/how" aria-label="How it works" style={squareBtn} transitionTypes={["nav-forward"]}>
          <Icon icon="info" size={18} />
        </Link>
      )}
    </div>
  );
}

/* ---------- sign-out confirmation ---------- */

function signBackInWith(via: Player["account"]["via"]): string {
  const ways = (via || []).map((v) => (v === "google" ? "Google" : v === "passkey" ? "your passkey" : "your email"));
  const uniq = [...new Set(ways)];
  if (!uniq.length) return "You can sign back in any time.";
  const list = uniq.length > 1 ? `${uniq.slice(0, -1).join(", ")} or ${uniq[uniq.length - 1]}` : uniq[0];
  return `You can sign back in with ${list}.`;
}

function SignOutSheet({
  via,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  via: Player["account"]["via"];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    sheetRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onCancel]);

  return createPortal(
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgb(var(--zk-black-rgb) / .55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        animation: "zk-vt-fade-in var(--zk-dur-base) var(--zk-ease-out) both",
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          boxSizing: "border-box",
          background: "var(--zk-surface)",
          borderRadius: "var(--zk-radius-3xl) var(--zk-radius-3xl) 0 0",
          border: "1px solid var(--zk-border)",
          borderBottom: 0,
          boxShadow: "var(--zk-shadow-float)",
          padding: "var(--zk-space-20) var(--zk-space-18) calc(env(safe-area-inset-bottom, 0px) + var(--zk-space-18))",
          display: "flex",
          flexDirection: "column",
          gap: "var(--zk-space-14)",
          color: "var(--zk-text)",
          fontFamily: "var(--zk-font-body)",
          animation: "zk-vt-rise var(--zk-dur-base) var(--zk-ease-out) both",
        }}
      >
        <div aria-hidden="true" style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, background: "var(--zk-border-strong)", marginTop: -6 }} />
        <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
          <div style={tile("var(--zk-purple-tint)", "var(--zk-purple-light)", 44)}>
            <Icon icon="user" size={22} stroke={2.4} />
          </div>
          <h2 id={titleId} style={{ margin: 0, font: "var(--zk-type-h3)" }}>
            Sign out?
          </h2>
        </div>
        <p style={{ margin: 0, font: "var(--zk-type-body)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
          {signBackInWith(via)} Your ZEC, XP and badges stay safe in your account.
        </p>
        {error ? (
          <span role="alert" style={{ font: "var(--zk-type-caption)", color: "var(--zk-red)" }}>
            {error}
          </span>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)", marginTop: "var(--zk-space-4)" }}>
          <Button label="Stay signed in" variant="secondary" size="md" onClick={onCancel} />
          <Button label={busy ? "Signing out…" : "Sign out"} variant="ghost" size="md" disabled={busy} sfx="whoosh" onClick={onConfirm} />
        </div>
      </div>
    </div>,
    document.body,
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
  const router = useRouter();
  const signedIn = !!player.account?.signedIn;
  const [zecUsd, setZecUsd] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
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

  const closeSheet = useCallback(() => {
    if (!leaving) {
      setConfirming(false);
      setError("");
    }
  }, [leaving]);

  const signOut = async () => {
    if (leaving) return;
    setLeaving(true);
    setError("");
    try {
      await api.logout();
      toastAcrossNavigation("Signed out. You’re browsing as a guest.");
      router.push("/feed", { transitionTypes: ["nav-back"] });
    } catch (e) {
      setError(friendlyErr(e, "Couldn’t sign you out. Try again."));
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
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
            {player.account.email
              ? "Signed in as"
              : player.account.via?.includes("google")
                ? "Signed in with Google"
                : player.account.via?.includes("passkey")
                  ? "Signed in with a passkey"
                  : "Signed in"}
          </span>
          {player.account.email ? (
            <span
              style={{
                font: "var(--zk-type-small)",
                fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"],
                color: "var(--zk-text)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {player.account.email}
            </span>
          ) : null}
        </div>
        <Button label="Sign out" variant="ghost" size="sm" full={false} sfx="whoosh" onClick={() => setConfirming(true)} style={TAP_44} />
      </div>

      <Link
        href="/wallet"
        transitionTypes={["nav-forward"]}
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
            <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-gold)" }}>{formatZec(bal, 8)} ZEC</span>
            {usd && <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>~{usd}</span>}
          </div>
        </div>
        <span style={{ color: "var(--zk-text-muted)", display: "flex" }}>
          <Icon icon="arrowRight" size={18} stroke={2.4} />
        </span>
      </Link>

      {confirming ? (
        <SignOutSheet via={player.account.via} busy={leaving} error={error} onCancel={closeSheet} onConfirm={() => void signOut()} />
      ) : null}
    </section>
  );
}

/* ---------- settings ---------- */

const settingRow: CSSProperties = { display: "flex", alignItems: "center", gap: "var(--zk-space-12)", minHeight: 60, padding: "var(--zk-space-8) 0" };

/** iOS-style switch: a 52×32 track inside a 44px-tall tap area. */
/** Push pings on this device: a switch when possible, otherwise a one-line "how to" (e.g. iPhone: add to Home Screen).
 *  With pings on, a second switch for the free-drop alerts. */
function NotificationsRow({ player, onSaved }: { player: Player; onSaved: (p: Player) => void }) {
  const { state, busy, turnOn, turnOff } = usePush();
  const [drops, setDrops] = useState(player.dropAlerts !== false);
  if (!state) return null;
  const canToggle = state === "on" || state === "off";
  const setDropAlerts = (v: boolean) => {
    setDrops(v);
    api
      .setDropAlerts(v)
      .then(({ player }) => onSaved(player))
      .catch(() => setDrops(!v));
  };
  return (
    <div style={{ borderTop: "1px solid var(--zk-border)" }}>
      <div style={settingRow}>
        <div style={tile("rgb(var(--zk-pink-rgb) / .12)", "var(--zk-pink)", 40)}>
          <Icon icon="bolt" size={19} stroke={2.4} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--zk-type-h4)" }}>Notifications</div>
          <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)", textWrap: "pretty" }}>{PUSH_COPY[state]}</div>
        </div>
        {canToggle && <Switch label="Notifications" on={state === "on"} onChange={(v) => !busy && void (v ? turnOn() : turnOff())} />}
      </div>
      {state === "on" && (
        <div style={{ ...settingRow, paddingTop: 0 }}>
          <div style={{ width: 40, flex: "none" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "var(--zk-type-h4)" }}>Free drop alerts</div>
            <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)", textWrap: "pretty" }}>
              A ping when the house hides a free riddle. At most one every 4 hours.
            </div>
          </div>
          <Switch label="Free drop alerts" on={drops} onChange={setDropAlerts} />
        </div>
      )}
    </div>
  );
}

/** "Add ZECKED to your Home Screen": opens /install. Hidden once ZECKED runs as the installed app. */
function InstallRow() {
  const { ready, installed, platform } = useInstall();
  if (!ready || installed) return null;
  return (
    <div style={{ borderTop: "1px solid var(--zk-border)" }}>
      <Link href="/install" transitionTypes={["nav-forward"]} style={{ ...settingRow, color: "var(--zk-text)", textDecoration: "none" }}>
        <div style={tile("var(--zk-gold-tint)", "var(--zk-gold)", 40)}>
          <Icon icon="plus" size={19} stroke={2.6} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--zk-type-h4)" }}>{platform === "desktop" ? "Get the ZECKED app" : "Add ZECKED to your Home Screen"}</div>
          <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)", textWrap: "pretty" }}>
            Opens full screen in one tap, like a real app.
          </div>
        </div>
        <Icon icon="arrowRight" size={18} stroke={2.4} color="var(--zk-text-faint)" />
      </Link>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-sfx="none"
      onClick={() => onChange(!on)}
      style={{
        width: 60,
        height: 44,
        flex: "none",
        border: 0,
        padding: 0,
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          width: 52,
          height: 32,
          boxSizing: "border-box",
          borderRadius: 999,
          padding: 3,
          background: on ? "var(--zk-mint)" : "var(--zk-surface-raised)",
          boxShadow: on ? "inset 0 -2px 0 var(--zk-mint-deep)" : "inset 0 0 0 1.5px var(--zk-border-strong)",
          transition: "background var(--zk-dur-fast) var(--zk-ease-out)",
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
      </span>
    </button>
  );
}

function passkeyError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return "No passkey added.";
  if (name === "InvalidStateError") return "This device already has a passkey for ZECKED.";
  return friendlyErr(e, "Couldn’t add the passkey. Try again.");
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
  const methods = [...new Set(via.map((v) => (v === "google" ? "Google" : v === "passkey" ? "Passkey" : "Email")))].join(" · ");
  const hasPasskey = via.includes("passkey");

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
      setNote({ text: passkeyError(e), ok: false });
    } finally {
      setAdding(false);
    }
  };

  return (
    <section aria-label="Settings" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)", marginTop: "var(--zk-space-8)" }}>
      {sectionHead("Settings")}
      <div style={{ ...accountCard, gap: 0, padding: "var(--zk-space-4) var(--zk-space-16)" }}>
        <div style={settingRow}>
          <div style={tile("var(--zk-sky-tint)", "var(--zk-sky)", 40)}>
            <Icon icon="bell" size={19} stroke={2.4} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "var(--zk-type-h4)" }}>Sounds</div>
            <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)" }}>
              Pops, confetti and wins ·{" "}
              <Link href="/sounds" style={{ color: "var(--zk-gold)", textDecoration: "underline", textUnderlineOffset: 3, display: "inline-flex", alignItems: "center", minHeight: 32 }}>
                Hear them all
              </Link>
            </div>
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
        <NotificationsRow player={player} onSaved={onSaved} />
        <InstallRow />
        {signedIn && (
          <div style={{ borderTop: "1px solid var(--zk-border)" }}>
            <div style={settingRow}>
              <div style={tile("var(--zk-mint-tint)", "var(--zk-mint)", 40)}>
                <Icon icon="passkey" size={19} stroke={2.4} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--zk-type-h4)" }}>Sign-in methods</div>
                <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)" }}>
                  {methods || "Signed in"}
                </div>
              </div>
            </div>
            {canPasskey && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "var(--zk-space-10)", padding: "0 0 var(--zk-space-14) 52px" }}>
                {note ? (
                  <p role="status" style={{ margin: 0, font: "var(--zk-type-caption)", color: note.ok ? "var(--zk-mint)" : "var(--zk-text-muted)", textWrap: "pretty" }}>
                    {note.text}
                  </p>
                ) : !hasPasskey ? (
                  <p style={{ margin: 0, font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
                    Sign in with Face ID or your fingerprint next time. No codes, no passwords.
                  </p>
                ) : null}
                <Button
                  label={adding ? "Adding…" : hasPasskey ? "Add another passkey" : "Add a passkey"}
                  icon={adding ? undefined : "plus"}
                  variant={hasPasskey ? "ghost" : "secondary"}
                  size="sm"
                  full={false}
                  disabled={adding}
                  onClick={() => void addPasskey()}
                  style={TAP_44}
                />
              </div>
            )}
          </div>
        )}
      </div>
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

type StatKey = "cracked" | "hidden" | "uncrackable" | "oracle" | "streak";

function Stats({ player }: { player: Player }) {
  const s = player.stats;
  const [open, setOpen] = useState<StatKey | null>(null);
  const noteId = useId();
  const stats: { k: StatKey; v: ReactNode; l: string; c: string; about: string }[] = [
    { k: "cracked", v: s.cracked, l: "Cracked", c: "var(--zk-gold)", about: "Stashes you won: riddles you cracked first and matches you called first." },
    { k: "hidden", v: s.hidden, l: "Hidden", c: "var(--zk-pink)", about: "Stashes you hid for other players to crack." },
    {
      k: "uncrackable",
      v: s.uncrackable,
      l: "Uncrackable",
      c: "var(--zk-purple-light)",
      about: "Your stashes nobody cracked before time ran out. The ZEC came back to you.",
    },
    { k: "oracle", v: s.oracle, l: "Oracle", c: "var(--zk-sky)", about: "Exact match scores you called right. Three unlock the Oracle badge." },
    {
      k: "streak",
      v: (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <Icon icon="flame" size={18} filled stroke={1.5} color="var(--zk-pink)" />
          {s.streak}
        </span>
      ),
      l: "Streak",
      c: "var(--zk-text)",
      about:
        s.streak > 0
          ? `${s.streak} ${s.streak === 1 ? "day" : "days"} in a row of playing. Guess a riddle, call a match or hide a stash each day to keep it going. Miss a day and it starts over.`
          : "Days in a row you’ve played. Guess a riddle, call a match or hide a stash each day to build it up.",
    },
  ];
  const current = stats.find((st) => st.k === open);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
      <div style={{ display: "flex", gap: "clamp(3px, 1.2vw, var(--zk-space-6))" }}>
        {stats.map((st) => {
          const on = open === st.k;
          return (
            <button
              key={st.k}
              type="button"
              aria-expanded={on}
              aria-controls={noteId}
              aria-label={`${st.l}: ${st.k === "streak" ? `${s.streak} day${s.streak === 1 ? "" : "s"}` : st.v}. What’s this?`}
              data-sfx="tap"
              onClick={() => setOpen(on ? null : st.k)}
              style={{
                flex: "1 1 auto",
                minWidth: 0,
                minHeight: 60,
                margin: 0,
                background: on ? "var(--zk-surface-raised)" : "var(--zk-surface)",
                border: 0,
                boxShadow: on ? `inset 0 0 0 1.5px ${st.c === "var(--zk-text)" ? "var(--zk-pink)" : st.c}` : "none",
                borderRadius: "var(--zk-radius-lg)",
                padding: "var(--zk-space-10) 3px",
                textAlign: "center",
                color: "var(--zk-text)",
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                transition: "background var(--zk-dur-fast) var(--zk-ease-out)",
              }}
            >
              <span style={{ display: "block", font: "var(--zk-fw-black) var(--zk-fs-22)/1 var(--zk-font-display)", color: st.c }}>{st.v}</span>
              <span
                style={{
                  display: "block",
                  font: "var(--zk-fw-bold) clamp(9.5px, 2.8vw, 11px)/1 var(--zk-font-body)",
                  color: "var(--zk-text-muted)",
                  marginTop: "var(--zk-space-6)",
                  whiteSpace: "nowrap",
                }}
              >
                {st.l}
              </span>
            </button>
          );
        })}
      </div>
      <div id={noteId} aria-live="polite">
        {current ? (
          <div
            key={current.k}
            style={{
              display: "flex",
              gap: "var(--zk-space-10)",
              alignItems: "flex-start",
              padding: "var(--zk-space-12) var(--zk-space-14)",
              borderRadius: "var(--zk-radius-lg)",
              background: "var(--zk-surface-raised)",
              font: "var(--zk-type-small)",
              fontWeight: "var(--zk-fw-medium)" as CSSProperties["fontWeight"],
              color: "var(--zk-text-muted)",
              animation: "zk-vt-rise var(--zk-dur-base) var(--zk-ease-out) both",
            }}
          >
            <span style={{ display: "flex", flex: "none", marginTop: 1, color: current.k === "streak" ? "var(--zk-pink)" : current.c }}>
              <Icon icon={current.k === "streak" ? "flame" : "info"} size={18} filled={current.k === "streak"} stroke={current.k === "streak" ? 1.5 : 2} />
            </span>
            <span style={{ minWidth: 0, textWrap: "pretty" }}>
              <b style={{ color: "var(--zk-text)" }}>{current.l}. </b>
              {current.about}
            </span>
          </div>
        ) : null}
      </div>
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

type StashGroup = "unfunded" | "live" | "ended";
const groupOf = (s: PublicStash): StashGroup =>
  s.status === "awaiting_funding" ? "unfunded" : s.status === "live" || s.status === "locked" ? "live" : "ended";
const GROUP_ORDER: StashGroup[] = ["unfunded", "live", "ended"];
const GROUP_LABEL: Record<StashGroup, string> = { unfunded: "NOT LIVE YET", live: "LIVE NOW", ended: "FINISHED" };

function MyStashes() {
  const [stashes, setStashes] = useState<PublicStash[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { stashes } = await api.myStashes();
      setStashes(stashes);
      setError("");
    } catch (e) {
      setError(friendlyErr(e, "Couldn’t load your stashes. Try again."));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  let body: ReactNode;
  if (stashes && stashes.length > 0) {
    // Unfunded first (they need you), then live, then finished. The server's order stays within a group.
    const groups = GROUP_ORDER.map((g) => ({ g, items: stashes.filter((s) => groupOf(s) === g) })).filter((x) => x.items.length > 0);
    const labelled = groups.length > 1;
    body = groups.map(({ g, items }) => (
      <div key={g} style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
        {labelled ? (
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--zk-space-8)" }}>
            <span
              style={{
                font: "var(--zk-type-label)",
                letterSpacing: "var(--zk-track-label)",
                color: g === "unfunded" ? "var(--zk-gold)" : g === "live" ? "var(--zk-mint)" : "var(--zk-text-muted)",
              }}
            >
              {GROUP_LABEL[g]}
            </span>
          </div>
        ) : null}
        {items.map((s) => (
          <StashCard key={s.id} stash={s} href={s.status === "awaiting_funding" ? `/hide?resume=${s.id}` : `/s/${s.id}`} />
        ))}
      </div>
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
        <Button label="Hide" icon="plus" variant="primary" size="sm" full={false} href="/hide" style={TAP_44} />
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
        <Button label="Retry" variant="secondary" size="sm" full={false} onClick={load} style={TAP_44} />
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
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-16)" }}>{body}</div>
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
          <div key={i} style={block(60, "var(--zk-radius-lg)")} />
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
      setError(friendlyErr(e, "Couldn’t load your profile. Try again in a moment."));
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
            {player.account?.signedIn && (
              <Link
                href={`/u/${player.handle.replace(/^@+/, "")}`}
                style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: "var(--zk-space-6)", minHeight: 44, font: "var(--zk-type-small)", color: "var(--zk-gold)", marginTop: "calc(-1 * var(--zk-space-8))" }}
              >
                See your public page <Icon icon="arrowRight" size={14} stroke={2.6} />
              </Link>
            )}
            <AccountCard player={player} />
            <InviteCard signedIn={!!player.account?.signedIn} />
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
