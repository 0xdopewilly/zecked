"use client";
// Wallet · the in-app ZECKED wallet. Balance hero, "Add ZEC" (a step-by-step guide: copy your address,
// grab free test ZEC from a faucet, then a live "waiting for your test ZEC" state), "Withdraw" (send to
// any Zcash wallet, private by default) and the activity list. Guests get a sign-up card.
// `?action=add` / `?action=withdraw` opens that panel on load.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, formatUsd, formatZec } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { ZAT } from "@/lib/types";
import type { WalletInfo, WalletTx, WalletTxKind } from "@/lib/types";
import { Button, Chip, Confetti, CountUp, Icon, Input, Logo, TabBar, Toast, SystemBanner } from "@/components/zk";
import type { IconName, ToastVariant } from "@/components/zk";

/* ───────────────────────── constants ───────────────────────── */

type Panel = "add" | "withdraw";
type Network = WalletInfo["network"];

/** Poll fast while ZEC may be on its way (Add panel open, deposit or send pending), slowly otherwise. */
const FAST_MS = 10_000;
const SLOW_MS = 30_000;
/** How long the hero's "+0.05 ZEC" sticker (and its confetti) stays up after ZEC lands. */
const LANDED_POP_MS = 4_200;

const SIM_AMOUNTS = [
  { label: "0.01 ZEC", zat: 1_000_000 },
  { label: "0.05 ZEC", zat: 5_000_000 },
  { label: "0.1 ZEC", zat: 10_000_000 },
] as const;

const FAUCETS = [
  { label: "faucet.testnet.valargroup.dev", href: "https://faucet.testnet.valargroup.dev" },
  { label: "zcashfaucet.jinolabs.xyz", href: "https://zcashfaucet.jinolabs.xyz" },
] as const;

const SIGNUP_HREF = "/signin?next=/wallet&reason=wallet";

const FEE_EXPLAINER = "A tiny fee the Zcash network charges";

/* ───────────────────────── helpers ───────────────────────── */

const errStatus = (e: unknown) => (e as { status?: number } | null)?.status;
const errText = (e: unknown) => (e instanceof Error ? e.message : "");
const withStop = (m: string) => (/[.!?]$/.test(m) ? m : `${m}.`);

/** Friendly copy for a failed request: never the raw browser text ("Failed to fetch", "Request failed (500)"). */
function friendlyErr(e: unknown, fallback = "Something went wrong. Try again."): string {
  const status = errStatus(e);
  if (status == null) return "Can’t reach ZECKED. Check your connection and try again.";
  if (status >= 500) return fallback;
  const m = errText(e);
  return m && !/^Request failed/i.test(m) ? withStop(m) : fallback;
}

const shortAddr = (a: string, head = 6, tail = 5) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);

/** One ZEC format everywhere: exact to the zat, trailing zeros trimmed, at least 2 decimals ("0.05", "0.0632"). */
const zec = (zat: number) => formatZec(Math.max(0, Math.round(zat)), 8);
/** Decimals `zec()` prints for this amount, so the counting hero lands on the same text. */
const decimalsOf = (zat: number) => zec(zat).split(".")[1]?.length ?? 2;

/** "0.05" → 5_000_000 zat, exactly. null when it isn't a ZEC amount. */
function parseZecToZat(s: string): number | null {
  const t = s.trim();
  if (!t || t === "." || !/^\d*\.?\d*$/.test(t)) return null;
  const [whole = "", frac = ""] = t.split(".");
  if (frac.length > 8) return null;
  return Number(whole || "0") * ZAT + Number((frac + "00000000").slice(0, 8));
}

/** Keeps digits and one decimal point (max 8 decimals); "," counts as ".". */
function cleanAmount(v: string): string {
  let t = v.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const i = t.indexOf(".");
  if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, "").slice(0, 8);
  t = t.replace(/^0+(?=\d)/, "");
  return t.slice(0, 16);
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 45) return "just now";
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/* ── destination address check (mirrors the server rules) ── */

type AddrCheck =
  | { kind: "empty" }
  | { kind: "typing" }
  | { kind: "shielded" }
  | { kind: "transparent" }
  | { kind: "error"; msg: string };

const SHIELDED_RE = /^(u1|utest1|zs1|ztestsapling1)[0-9a-z]{20,}$/i;
const TRANSPARENT_RE = /^(t1|t3|tm|t2|tex1|textest1)[0-9A-Za-z]{20,}$/;
const TESTNET_RE = /^(utest1|ztestsapling1|tm|textest1)/i;
const PREFIXES = ["u1", "utest1", "zs1", "ztestsapling1", "t1", "t3", "tm", "t2", "tex1", "textest1"];

function checkAddress(raw: string, network: Network, own?: string): AddrCheck {
  const a = raw.trim();
  if (!a) return { kind: "empty" };
  const shielded = SHIELDED_RE.test(a);
  const transparent = !shielded && TRANSPARENT_RE.test(a);
  if (!shielded && !transparent) {
    const lower = a.toLowerCase();
    const plausible = /^[0-9a-z]+$/i.test(a) && PREFIXES.some((p) => p.startsWith(lower) || lower.startsWith(p));
    return plausible && a.length < 30 ? { kind: "typing" } : { kind: "error", msg: "That doesn’t look like a Zcash wallet address." };
  }
  if (own && a === own) return { kind: "error", msg: "That’s your own ZECKED address. Send it to an outside wallet." };
  const testnetAddr = TESTNET_RE.test(a);
  if (network === "testnet" && !testnetAddr) {
    return { kind: "error", msg: "This is the test version of ZECKED, so use a Zcash testnet address (it starts with utest1)." };
  }
  if (network === "mainnet" && testnetAddr) return { kind: "error", msg: "That’s a testnet address. Use a regular Zcash address." };
  return { kind: shielded ? "shielded" : "transparent" };
}

/* ── QR of a ZIP-321 URI, drawn with `qrcode` at error correction H (room for the Z logo) ── */

function useQr(uri?: string) {
  const [qr, setQr] = useState<{ uri: string; src: string } | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    (async () => {
      const mod = await import("qrcode");
      const toDataURL =
        (mod as { toDataURL?: typeof mod.toDataURL }).toDataURL ??
        (mod as unknown as { default: typeof mod }).default.toDataURL;
      const src = await toDataURL(uri, {
        errorCorrectionLevel: "H",
        margin: 1,
        width: 440,
        color: { dark: "#0E0B1F", light: "#FFFFFF" },
      });
      if (!cancelled) setQr({ uri, src });
    })().catch(() => {
      if (!cancelled) setFailedFor(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return { src: qr && uri && qr.uri === uri ? qr.src : null, failed: !!uri && failedFor === uri };
}

/* ───────────────────────── shared styles ───────────────────────── */

/** Scoped rules inline styles can't express: plain-text placeholders (so an empty box never looks filled in) and the step indent on very narrow phones. */
const SCOPED_CSS = `
.zkw-ph input::placeholder{font:var(--zk-fw-semibold) var(--zk-fs-15)/1.2 var(--zk-font-body);color:var(--zk-text-faint);opacity:1}
.zkw-step-body{padding-left:38px}
@media (max-width:359px){.zkw-step-body{padding-left:0}}
`;

const ICON_BTN: CSSProperties = {
  width: 44,
  height: 44,
  flex: "none",
  borderRadius: "var(--zk-radius-md)",
  background: "var(--zk-surface)",
  border: "none",
  padding: 0,
  color: "var(--zk-text)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};

const SMALL_TEXT: CSSProperties = {
  margin: 0,
  font: "var(--zk-type-small)",
  fontWeight: "var(--zk-fw-medium)" as CSSProperties["fontWeight"],
  color: "var(--zk-text-muted)",
  textWrap: "pretty",
};

const LABEL: CSSProperties = {
  font: "var(--zk-type-label)",
  letterSpacing: "var(--zk-track-label)",
  color: "var(--zk-text-muted)",
};

const receiptRow = (last: boolean): CSSProperties => ({
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--zk-space-4) var(--zk-space-12)",
  padding: "var(--zk-space-10) 0",
  borderBottom: last ? "none" : "1px solid var(--zk-border)",
  font: "var(--zk-type-body)",
});

const glow = (h: number | string, r: string, extra?: CSSProperties): CSSProperties => ({
  height: h,
  borderRadius: r,
  background: "var(--zk-surface)",
  animation: "zk-glow 1.6s ease-in-out infinite",
  ...extra,
});

function Spinner({ size = 18, tone = "gold" }: { size?: number; tone?: "gold" | "mint" }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        boxSizing: "border-box",
        borderStyle: "solid",
        borderWidth: size > 20 ? 3 : 2.5,
        borderColor: `rgb(var(--zk-${tone}-rgb) / .25)`,
        borderTopColor: `var(--zk-${tone})`,
        willChange: "transform",
        animation: "zk-spin .9s linear infinite",
      }}
    />
  );
}

/**
 * A small action that still has a 44×44 tap area: a transparent hit box around a visible pill
 * (so it fits inside a 54px input or a receipt row).
 */
function PillButton({
  label,
  icon,
  tone = "purple",
  active,
  ariaLabel,
  onClick,
}: {
  label: string;
  icon?: IconName;
  tone?: "purple" | "raised" | "mint";
  active?: boolean;
  ariaLabel?: string;
  onClick: () => void;
}) {
  const bg = tone === "mint" ? "var(--zk-mint-tint)" : tone === "raised" ? "var(--zk-surface-raised)" : active ? "var(--zk-gold)" : "var(--zk-purple)";
  const fg = tone === "mint" ? "var(--zk-mint)" : tone === "raised" ? "var(--zk-text)" : active ? "var(--zk-gold-ink)" : "var(--zk-text)";
  const edge = tone === "purple" ? (active ? "0 3px 0 var(--zk-gold-deep)" : "0 3px 0 var(--zk-purple-deep)") : "none";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={active}
      onClick={onClick}
      style={{
        minWidth: 44,
        height: 44,
        flex: "none",
        padding: 0,
        border: 0,
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <span
        style={{
          height: 34,
          padding: "0 var(--zk-space-12)",
          borderRadius: "var(--zk-radius-md)",
          background: bg,
          color: fg,
          boxShadow: edge,
          display: "flex",
          alignItems: "center",
          gap: "var(--zk-space-6)",
          font: "var(--zk-type-btn-sm)",
          whiteSpace: "nowrap",
        }}
      >
        {icon ? <Icon icon={icon} size={15} stroke={2.6} /> : null}
        {label}
      </span>
    </button>
  );
}

/** "Copy" that flips to "Copied" for a moment. The screen shows the toast. */
function CopyButton({ ariaLabel, onCopy, tone = "raised" }: { ariaLabel: string; onCopy: () => Promise<boolean>; tone?: "purple" | "raised" }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <PillButton
      label={done ? "Copied" : "Copy"}
      icon={done ? "check" : "copy"}
      tone={done ? "mint" : tone}
      ariaLabel={ariaLabel}
      onClick={() =>
        void onCopy().then((ok) => {
          if (!ok) return;
          setDone(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setDone(false), 2000);
        })
      }
    />
  );
}

/* ───────────────────────── header ───────────────────────── */

function Header() {
  return (
    <h1 className="zk-title" style={{ margin: 0 }}>
      Wallet
    </h1>
  );
}

/* ───────────────────────── hero ───────────────────────── */

interface Landed {
  zat: number;
  run: number;
}

function Hero({ wallet, count, pop }: { wallet: WalletInfo; count: { from: number; to: number; run: number }; pop: Landed | null }) {
  const net = wallet.network;
  const pending = wallet.pendingDepositZat;
  const decimals = Math.max(decimalsOf(count.from), decimalsOf(count.to));
  const digits = zec(wallet.balanceZat).length;
  return (
    <section
      aria-label="Your ZEC"
      style={{
        position: "relative",
        overflow: "hidden",
        flex: "none",
        borderRadius: "var(--zk-radius-3xl)",
        padding: "var(--zk-space-18) var(--zk-space-18) var(--zk-space-20)",
        background: "linear-gradient(160deg, var(--zk-surface-purple), var(--zk-surface) 65%)",
        border: "1.5px solid rgb(var(--zk-gold-rgb) / .3)",
        boxShadow: "var(--zk-shadow-card)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: -110,
          marginLeft: -170,
          width: 340,
          height: 340,
          borderRadius: "50%",
          background: "var(--zk-sunburst-gold)",
          willChange: "transform",
          animation: "zk-spin 40s linear infinite",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "50%",
          top: 36,
          marginLeft: -150,
          width: 300,
          height: 150,
          borderRadius: "50%",
          background: "radial-gradient(closest-side, rgb(var(--zk-gold-rgb) / .32), transparent)",
          animation: "zk-glow 3.2s ease-in-out infinite",
        }}
      />
      {pop ? <Confetti key={pop.run} count={36} size="sm" seed={pop.run * 13 + 5} run={pop.run} sound={false} /> : null}

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--zk-space-8)",
          minHeight: 30,
        }}
      >
        <span style={{ ...LABEL, whiteSpace: "nowrap", flex: "none" }}>YOUR ZEC</span>
        {net !== "mainnet" ? (
          <Chip
            variant="info"
            icon="flag"
            iconColor="var(--zk-gold)"
            label={net === "testnet" ? "Test ZEC" : "Test mode"}
            style={{ background: "var(--zk-gold-tint)", color: "var(--zk-gold)", padding: "var(--zk-space-6) var(--zk-space-10)", minWidth: 0 }}
          />
        ) : null}
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", marginTop: "var(--zk-space-14)" }}>
        <span className="zk-sr-only" aria-live="polite">
          {`${zec(wallet.balanceZat)} ZEC, about ${formatUsd(wallet.usd)}`}
        </span>
        <div aria-hidden="true" style={{ display: "flex", alignItems: "baseline", gap: "var(--zk-space-8)" }}>
          <span
            style={{
              font: `var(--zk-fw-black) ${digits > 7 ? "var(--zk-fs-40)" : "var(--zk-fs-52)"}/1 var(--zk-font-display)`,
              color: "var(--zk-gold)",
              letterSpacing: "-.03em",
              textShadow: "var(--zk-text-shadow-gold)",
            }}
          >
            <CountUp from={count.from / ZAT} to={count.to / ZAT} decimals={decimals} duration={1200} run={count.run} />
          </span>
          <span style={{ font: "var(--zk-type-mono)", fontSize: "var(--zk-fs-18)", color: "var(--zk-gold-light)" }}>ZEC</span>
        </div>
        <div aria-hidden="true" style={{ position: "relative", marginTop: "var(--zk-space-12)", minHeight: 22, display: "flex", alignItems: "center" }}>
          {pop ? (
            <span
              key={pop.run}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--zk-space-4)",
                padding: "var(--zk-space-4) var(--zk-space-10)",
                borderRadius: "var(--zk-radius-pill)",
                background: "var(--zk-mint)",
                color: "var(--zk-mint-ink)",
                boxShadow: "var(--zk-shadow-sticker-mint)",
                font: "var(--zk-type-mono-sm)",
                animation: "zk-pop var(--zk-dur-pop) var(--zk-ease-spring) both",
              }}
            >
              <Icon icon="coin" size={14} stroke={2.6} />+{zec(pop.zat)} ZEC landed
            </span>
          ) : (
            <span style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>~{formatUsd(wallet.usd)}</span>
          )}
        </div>
      </div>

      {pending > 0 ? (
        <div
          role="status"
          style={{
            position: "relative",
            marginTop: "var(--zk-space-14)",
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-10)",
            padding: "var(--zk-space-10) var(--zk-space-12)",
            borderRadius: "var(--zk-radius-lg)",
            background: "var(--zk-mint-tint)",
            border: "1px solid rgb(var(--zk-mint-rgb) / .3)",
            font: "var(--zk-type-small)",
          }}
        >
          <Spinner tone="mint" />
          <span>
            <b style={{ color: "var(--zk-mint)" }}>+{zec(pending)} ZEC</b> on its way…{" "}
            <span style={{ color: "var(--zk-text-muted)" }}>(the network is confirming it)</span>
          </span>
        </div>
      ) : null}
    </section>
  );
}

/* ───────────────────────── panels ───────────────────────── */

function PanelShell({
  title,
  icon,
  tone,
  onClose,
  children,
}: {
  title: string;
  icon: IconName;
  tone: "purple" | "gold";
  onClose: () => void;
  children: ReactNode;
}) {
  const purple = tone === "purple";
  return (
    <section
      aria-label={title}
      style={{
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-2xl)",
        border: `1.5px solid ${purple ? "rgb(var(--zk-purple-rgb) / .45)" : "rgb(var(--zk-gold-rgb) / .35)"}`,
        boxShadow: purple ? "var(--zk-glow-purple)" : "0 0 40px rgb(var(--zk-gold-rgb) / .12)",
        padding: "var(--zk-space-16)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-14)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--zk-space-10)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)", minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: 36,
              height: 36,
              flex: "none",
              borderRadius: "var(--zk-radius-md)",
              background: purple ? "var(--zk-grad-tile-purple)" : "var(--zk-grad-tile-gold)",
              boxShadow: `var(--zk-inset-gloss), 0 3px 0 ${purple ? "var(--zk-purple-shade)" : "var(--zk-gold-deep)"}`,
              color: purple ? "var(--zk-text)" : "var(--zk-gold-ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon={icon} size={18} stroke={2.6} />
          </span>
          <h2 style={{ margin: 0, font: "var(--zk-type-h3)" }}>{title}</h2>
        </div>
        <button
          type="button"
          aria-label={`Close ${title}`}
          onClick={onClose}
          style={{ ...ICON_BTN, background: "var(--zk-surface-raised)", color: "var(--zk-text-muted)" }}
        >
          <Icon icon="close" size={16} stroke={2.6} />
        </button>
      </div>
      {children}
    </section>
  );
}

/* ── Add ZEC: a numbered, friendly guide ── */

function Step({ n, title, done, last, children }: { n: number; title: string; done?: boolean; last?: boolean; children?: ReactNode }) {
  return (
    <li
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-10)",
        paddingBottom: last ? 0 : "var(--zk-space-16)",
        borderBottom: last ? "none" : "1px solid var(--zk-border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)" }}>
        <span
          aria-hidden="true"
          style={{
            width: 28,
            height: 28,
            flex: "none",
            borderRadius: "50%",
            background: done ? "var(--zk-mint)" : "var(--zk-purple-tint)",
            color: done ? "var(--zk-mint-ink)" : "var(--zk-purple-light)",
            boxShadow: done ? "0 2px 0 var(--zk-mint-deep)" : "inset 0 0 0 1.5px rgb(var(--zk-purple-rgb) / .45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            font: "var(--zk-fw-black) var(--zk-fs-14)/1 var(--zk-font-display)",
            transition: "background var(--zk-dur-fast) var(--zk-ease-out)",
          }}
        >
          {done ? <Icon icon="check" size={15} stroke={3} /> : n}
        </span>
        <h3 style={{ margin: 0, font: "var(--zk-type-h4)", minWidth: 0, textWrap: "balance" }}>
          <span className="zk-sr-only">{`Step ${n}${done ? " (done)" : ""}: `}</span>
          {title}
        </h3>
      </div>
      {children ? (
        <div className="zkw-step-body" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
          {children}
        </div>
      ) : null}
    </li>
  );
}

function QrBox({ uri }: { uri?: string }) {
  const qr = useQr(uri);
  return (
    <div
      role="img"
      aria-label="QR code of your ZECKED wallet address"
      style={{
        alignSelf: "center",
        flex: "none",
        width: 188,
        height: 188,
        borderRadius: "var(--zk-radius-2xl)",
        background: "var(--zk-text)",
        padding: "var(--zk-space-12)",
        boxSizing: "border-box",
        position: "relative",
        boxShadow: "0 0 0 5px rgb(var(--zk-purple-rgb) / .3),var(--zk-shadow-float)",
      }}
    >
      {qr.src ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.src} alt="" width={164} height={164} style={{ display: "block", width: 164, height: 164 }} />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              transform: "translate(-50%,-50%)",
              padding: 3,
              background: "var(--zk-text)",
              borderRadius: "var(--zk-radius-sm)",
              display: "flex",
              lineHeight: 0,
            }}
          >
            <Logo variant="icon" size={24} />
          </div>
        </>
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--zk-space-10)",
            font: "var(--zk-type-caption)",
            color: "var(--zk-bg)",
            textAlign: "center",
          }}
        >
          {qr.failed ? "Couldn’t draw the QR code. Use the Copy button instead." : <Spinner size={24} />}
        </div>
      )}
    </div>
  );
}

const EXTERNAL_LINK: CSSProperties = {
  minHeight: 52,
  padding: "var(--zk-space-10) var(--zk-space-14)",
  borderRadius: "var(--zk-radius-xl)",
  border: "1.5px solid var(--zk-border-strong)",
  background: "var(--zk-surface-raised)",
  color: "var(--zk-text)",
  display: "flex",
  alignItems: "center",
  gap: "var(--zk-space-10)",
  textDecoration: "none",
  WebkitTapHighlightColor: "transparent",
};

/** Step 4's live line: waiting → seen on the network → landed. */
function Arrival({ pending, landed, test }: { pending: number; landed: Landed | null; test: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const run = landed?.run;
  // ZEC landed while you were further up the guide: bring the good news into view.
  useEffect(() => {
    if (!run) return;
    const id = requestAnimationFrame(() => boxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    return () => cancelAnimationFrame(id);
  }, [run]);
  if (landed) {
    return (
      <div
        ref={boxRef}
        role="status"
        style={{
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          gap: "var(--zk-space-12)",
          padding: "var(--zk-space-14)",
          borderRadius: "var(--zk-radius-xl)",
          background: "var(--zk-mint-tint)",
          border: "1.5px solid rgb(var(--zk-mint-rgb) / .45)",
        }}
      >
        <Confetti key={landed.run} count={28} size="sm" seed={landed.run * 7 + 3} run={landed.run} sound={false} />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
          <span
            key={landed.run}
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              flex: "none",
              borderRadius: "50%",
              background: "var(--zk-mint)",
              color: "var(--zk-mint-ink)",
              boxShadow: "var(--zk-shadow-sticker-mint)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "zk-pop var(--zk-dur-pop) var(--zk-ease-spring) both",
            }}
          >
            <Icon icon="check" size={22} stroke={3} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ font: "var(--zk-type-h4)" }}>+{zec(landed.zat)} ZEC landed!</div>
            <div style={{ ...SMALL_TEXT, marginTop: "var(--zk-space-2)" }}>You’re ready. Crack a riddle or call a match.</div>
          </div>
        </div>
        <div style={{ position: "relative" }}>
          <Button label="Crack a stash" icon="key" variant="primary" size="md" href="/feed" />
        </div>
      </div>
    );
  }
  const seen = pending > 0;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-12)",
        padding: "var(--zk-space-12) var(--zk-space-14)",
        borderRadius: "var(--zk-radius-xl)",
        background: seen ? "var(--zk-mint-tint)" : "var(--zk-surface-raised)",
        border: `1.5px dashed ${seen ? "rgb(var(--zk-mint-rgb) / .45)" : "rgb(var(--zk-gold-rgb) / .35)"}`,
      }}
    >
      <Spinner size={22} tone={seen ? "mint" : "gold"} />
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "var(--zk-type-body-strong)" }}>
          {seen ? `+${zec(pending)} ZEC spotted on the network…` : `Waiting for your ${test ? "test " : ""}ZEC…`}
        </div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)", textWrap: "pretty" }}>
          {seen
            ? "Almost there: it’s being confirmed."
            : "We check every few seconds. You can leave this page: we’ll tell you when it lands."}
        </div>
      </div>
    </div>
  );
}

function AddPanel({
  wallet,
  simulating,
  landed,
  onCopyAddress,
  onSimulate,
  onClose,
}: {
  wallet: WalletInfo;
  simulating: number | null;
  landed: Landed | null;
  onCopyAddress: (address: string) => Promise<boolean>;
  onSimulate: (zat: number) => void;
  onClose: () => void;
}) {
  const address = wallet.depositAddress;
  const uri = wallet.depositUri;
  const test = wallet.network !== "mainnet";
  const [copied, setCopied] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);
  const [opened, setOpened] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const copy = async () => {
    if (!address || !(await onCopyAddress(address))) return;
    setCopied(true);
    setCopyFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setCopyFlash(false), 2200);
  };

  const step1 = (
    <Step n={1} title="Copy your ZECKED wallet address" done={copied}>
      {address ? (
        <>
          <div
            title={address}
            style={{
              padding: "var(--zk-space-12) var(--zk-space-14)",
              borderRadius: "var(--zk-radius-lg)",
              background: "var(--zk-surface-raised)",
              font: "var(--zk-fw-medium) var(--zk-fs-14)/1 var(--zk-font-mono)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              textAlign: "center",
            }}
          >
            <span className="zk-sr-only">Your address: </span>
            {shortAddr(address, 10, 8)}
          </div>
          <Button
            label={copyFlash ? "Copied!" : copied ? "Copy again" : "Copy my address"}
            icon={copyFlash ? "check" : "copy"}
            variant={copyFlash ? "success" : "secondary"}
            size="md"
            sfx="none"
            onClick={() => void copy()}
          />
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)", ...SMALL_TEXT }}>
          <Spinner /> Setting up your address…
        </div>
      )}
      {uri ? (
        <>
          <QrBox uri={uri} />
          <p style={{ ...SMALL_TEXT, font: "var(--zk-type-caption)", textAlign: "center" }}>Or scan it with a Zcash wallet app.</p>
        </>
      ) : null}
    </Step>
  );

  const faucetStep = (
    <Step n={2} title="Open a free faucet" done={opened}>
      <p style={SMALL_TEXT}>
        A faucet is a website that hands out <b style={{ color: "var(--zk-text)" }}>free test ZEC</b>. It has no real value: it’s just for
        playing here.
      </p>
      {FAUCETS.map((f) => (
        <a key={f.href} href={f.href} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} style={EXTERNAL_LINK}>
          <span
            aria-hidden="true"
            style={{
              width: 32,
              height: 32,
              flex: "none",
              borderRadius: "var(--zk-radius-sm)",
              background: "var(--zk-gold-tint)",
              color: "var(--zk-gold)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon="coin" size={17} stroke={2.4} />
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              font: "var(--zk-type-body-strong)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {f.label}
          </span>
          <span aria-hidden="true" style={{ display: "flex", color: "var(--zk-text-muted)", transform: "rotate(45deg)" }}>
            <Icon icon="arrowUp" size={18} stroke={2.6} />
          </span>
          <span className="zk-sr-only"> (opens in a new tab)</span>
        </a>
      ))}
      <p style={{ ...SMALL_TEXT, font: "var(--zk-type-caption)" }}>If one is busy or empty, try the other.</p>
      {wallet.network === "sim" ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--zk-space-6)",
            padding: "var(--zk-space-10) var(--zk-space-12)",
            borderRadius: "var(--zk-radius-lg)",
            border: "1.5px dashed rgb(var(--zk-gold-rgb) / .35)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", font: "var(--zk-type-caption)", color: "var(--zk-gold)" }}>
            <Icon icon="bolt" size={14} />
            Test mode shortcut: skip the faucet
          </div>
          <div style={{ display: "flex", gap: "var(--zk-space-6)" }}>
            {SIM_AMOUNTS.map((a) => (
              <Chip
                key={a.zat}
                size="sm"
                label={simulating === a.zat ? "Adding…" : `+${a.label}`}
                active={simulating === a.zat}
                disabled={simulating != null}
                onClick={() => onSimulate(a.zat)}
                style={{ height: 44, padding: "0 var(--zk-space-8)", flex: "1 1 0", minWidth: 0, justifyContent: "center" }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </Step>
  );

  const pasteStep = (
    <Step n={3} title="Paste your address and ask for test ZEC">
      <p style={SMALL_TEXT}>On the faucet page, paste the address you copied into the box, then tap its request button.</p>
    </Step>
  );

  const sendStep = (
    <Step n={2} title="Send ZEC to it from any Zcash wallet">
      {uri ? <Button label="Open my wallet app" icon="wallet" variant="ghost" size="md" href={uri} /> : null}
    </Step>
  );

  const lastN = test ? 4 : 3;
  const arriveStep = (
    <Step n={lastN} title="It lands here in a few minutes" done={!!landed} last>
      <p style={SMALL_TEXT}>The Zcash network needs a few confirmations first, so give it a few minutes.</p>
      <Arrival pending={wallet.pendingDepositZat} landed={landed} test={test} />
    </Step>
  );

  return (
    <PanelShell title={test ? "Add test ZEC" : "Add ZEC"} icon="plus" tone="purple" onClose={onClose}>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--zk-space-16)" }}>
        {step1}
        {test ? faucetStep : sendStep}
        {test ? pasteStep : null}
        {arriveStep}
      </ol>
    </PanelShell>
  );
}

/* ── Withdraw ── */

interface SentReceipt {
  txid: string;
  amountZat: number;
  feeZat: number;
  to: string;
  shielded: boolean;
}

function Receipt({
  r,
  network,
  onCopyTxid,
  onDone,
}: {
  r: SentReceipt;
  network: Network;
  onCopyTxid: (txid: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const rows: { k: ReactNode; v: ReactNode; note?: string }[] = [
    { k: "You sent", v: <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-gold)" }}>{zec(r.amountZat)} ZEC</span> },
    { k: "Network fee", v: <span style={{ font: "var(--zk-type-mono-sm)" }}>{zec(r.feeZat)} ZEC</span>, note: FEE_EXPLAINER },
    { k: "Total", v: <span style={{ font: "var(--zk-type-mono-sm)" }}>{zec(r.amountZat + r.feeZat)} ZEC</span> },
    { k: "To wallet", v: <span style={{ font: "var(--zk-type-mono-sm)" }}>{shortAddr(r.to)}</span> },
    {
      k: "Receipt ID",
      v: (
        <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-2)", font: "var(--zk-type-mono-sm)", marginLeft: "auto" }}>
          {shortAddr(r.txid, 6, 6)}
          <CopyButton ariaLabel="Copy receipt ID" onCopy={() => onCopyTxid(r.txid)} />
        </span>
      ),
    },
    {
      k: "Privacy",
      v: r.shielded ? (
        <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-4)", font: "var(--zk-type-body-strong)", color: "var(--zk-mint)" }}>
          Private
          <Icon icon="check" size={16} stroke={3} />
        </span>
      ) : (
        <span style={{ font: "var(--zk-type-body-strong)", color: "var(--zk-gold)" }}>Public</span>
      ),
    },
  ];
  return (
    <>
      <div role="status" style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
        <span
          aria-hidden="true"
          style={{
            width: 48,
            height: 48,
            flex: "none",
            borderRadius: "50%",
            background: "var(--zk-mint)",
            color: "var(--zk-mint-ink)",
            boxShadow: "var(--zk-shadow-sticker-mint), 0 0 30px rgb(var(--zk-mint-rgb) / .35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "zk-pop var(--zk-dur-pop) var(--zk-ease-spring) both",
          }}
        >
          <Icon icon="check" size={24} stroke={3} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "var(--zk-type-h3)" }}>Sent! It’s on its way.</div>
          <div style={{ ...SMALL_TEXT, marginTop: "var(--zk-space-2)" }}>
            {r.shielded
              ? "Private send: nobody can see where it went."
              : "Sent to a public address, so anyone can see this one."}
          </div>
        </div>
      </div>
      <dl style={{ margin: 0, background: "var(--zk-surface-raised)", borderRadius: "var(--zk-radius-xl)", padding: "var(--zk-space-4) var(--zk-space-16)" }}>
        {rows.map((row, i) => (
          <div key={i} style={receiptRow(i === rows.length - 1)}>
            <dt style={{ color: "var(--zk-text-muted)" }}>{row.k}</dt>
            <dd style={{ margin: 0, minWidth: 0, display: "flex", justifyContent: "flex-end", marginLeft: "auto" }}>{row.v}</dd>
            {row.note ? (
              <dd style={{ margin: "-2px 0 0", flexBasis: "100%", font: "var(--zk-type-caption)", color: "var(--zk-text-faint)" }}>{row.note}</dd>
            ) : null}
          </div>
        ))}
      </dl>
      {network !== "mainnet" ? (
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-gold)", display: "flex", alignItems: "center", gap: "var(--zk-space-6)" }}>
          <Icon icon="flag" size={14} />
          {network === "sim" ? "Test mode: a pretend send. Nothing left ZECKED." : "Test ZEC only (no real value)."}
        </div>
      ) : null}
      <Button label="Done" variant="ghost" size="md" onClick={onDone} />
    </>
  );
}

function WithdrawPanel({
  wallet,
  onWallet,
  onRefresh,
  onSignedOut,
  onToast,
  onCopy,
  onAddZec,
  onClose,
}: {
  wallet: WalletInfo;
  onWallet: (w: WalletInfo) => void;
  onRefresh: () => void;
  onSignedOut: () => void;
  onToast: (text: string, variant?: ToastVariant, icon?: string) => void;
  onCopy: (text: string, what: string) => Promise<boolean>;
  onAddZec: () => void;
  onClose: () => void;
}) {
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [serverAddrErr, setServerAddrErr] = useState<string | null>(null);
  const [serverAmtErr, setServerAmtErr] = useState<string | null>(null);
  const [shakeAddr, setShakeAddr] = useState(0);
  const [shakeAmt, setShakeAmt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<SentReceipt | null>(null);
  const addrWrap = useRef<HTMLDivElement>(null);

  const fee = wallet.withdrawFeeZat;
  const min = wallet.minWithdrawZat;
  const maxZat = Math.max(0, wallet.balanceZat - fee);
  const test = wallet.network !== "mainnet";

  const check = checkAddress(address, wallet.network, wallet.depositAddress);
  const addrOk = check.kind === "shielded" || check.kind === "transparent";
  const addrErr = serverAddrErr ?? (check.kind === "error" ? check.msg : null);

  const amountZat = parseZecToZat(amount);
  let amtIssue: string | null = null;
  if (amount.trim() && amountZat == null) amtIssue = "Numbers only, like 0.01";
  else if (amountZat != null && amountZat > maxZat) amtIssue = `You can send up to ${zec(maxZat)} ZEC (after the network fee).`;
  else if (amountZat != null && amountZat > 0 && amountZat < min) amtIssue = `The minimum is ${zec(min)} ZEC.`;
  const amtErr = serverAmtErr ?? amtIssue;
  const amtOk = amountZat != null && amountZat >= min && amountZat <= maxZat;
  const canSend = addrOk && amtOk && !addrErr && !amtErr && !busy;

  const setAddr = (v: string) => {
    setAddress(v.replace(/\s+/g, "").slice(0, 256));
    setServerAddrErr(null);
  };

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) {
        setAddr(t);
        return;
      }
    } catch {
      /* clipboard blocked: fall through to a manual paste */
    }
    onToast("Couldn’t read your clipboard. Long-press the box to paste.", "error");
    // Straight away, not a frame later: iOS only opens the keyboard for a focus() inside the gesture.
    addrWrap.current?.querySelector<HTMLInputElement>("input")?.focus();
  };

  const send = async () => {
    if (!canSend || amountZat == null) return;
    setBusy(true);
    const shielded = check.kind === "shielded";
    try {
      const res = await api.withdraw(address.trim(), amountZat);
      onWallet(res.wallet);
      setReceipt({ txid: res.txid, amountZat: res.amountZat, feeZat: res.feeZat, to: res.to, shielded });
      sfx("success");
      setAddress("");
      setAmount("");
    } catch (e) {
      const status = errStatus(e);
      const m = errText(e);
      if (status === 401) {
        onSignedOut();
      } else if (status === 503) {
        onToast(m || "The prize vault is being topped up. Your ZEC is safe here. Try again in a few minutes.", "error", "hourglass");
      } else if (status === 502) {
        // Outcome not known yet (the server keeps it as "pending" and settles it): show it in the activity list.
        onToast("Your withdrawal is processing. It’ll show in your activity in a minute.", "default", "hourglass");
        onRefresh();
        onClose();
      } else if (status === 402) {
        setServerAmtErr("Not enough ZEC for that plus the network fee.");
        setShakeAmt((n) => n + 1);
      } else if (status === 400 && /address/i.test(m)) {
        setServerAddrErr(friendlyErr(e, "That address didn’t work. Check it and try again."));
        setShakeAddr((n) => n + 1);
      } else if (status === 400 && /minimum|amount/i.test(m)) {
        setServerAmtErr(friendlyErr(e, "That amount didn’t work. Try a different one."));
        setShakeAmt((n) => n + 1);
      } else {
        onToast(friendlyErr(e, "Couldn’t send that. Your ZEC is safe here. Try again in a minute."), "error");
      }
    } finally {
      setBusy(false);
    }
  };

  if (receipt) {
    return (
      <PanelShell title="Withdraw" icon="arrowUp" tone="gold" onClose={onClose}>
        <Receipt r={receipt} network={wallet.network} onCopyTxid={(t) => onCopy(t, "Receipt ID")} onDone={onClose} />
      </PanelShell>
    );
  }

  if (maxZat < min) {
    return (
      <PanelShell title="Withdraw" icon="arrowUp" tone="gold" onClose={onClose}>
        <div
          style={{
            border: "1.5px dashed var(--zk-border-strong)",
            borderRadius: "var(--zk-radius-xl)",
            padding: "var(--zk-space-18)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--zk-space-8)",
            textAlign: "center",
          }}
        >
          <div style={{ font: "var(--zk-type-h4)" }}>Nothing to send yet.</div>
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
            You need at least {zec(min + fee)} ZEC, network fee included. Crack a stash or add some {test ? "test " : ""}ZEC first.
          </div>
          <div style={{ marginTop: "var(--zk-space-6)" }}>
            <Button label="Add ZEC" icon="plus" variant="secondary" size="sm" full={false} onClick={onAddZec} style={{ height: 44 }} />
          </div>
        </div>
      </PanelShell>
    );
  }

  let addrMessage: ReactNode;
  if (addrErr) addrMessage = addrErr;
  else if (check.kind === "shielded") addrMessage = "Private address. Nobody can see where it goes.";
  else if (check.kind === "transparent") {
    addrMessage = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--zk-space-4)", color: "var(--zk-gold)" }}>
        <Icon icon="eye" size={13} stroke={2.4} />
        Public address: anyone can see this payout
      </span>
    );
  } else {
    addrMessage = test
      ? "Any Zcash testnet wallet. Addresses starting with utest1 keep it private."
      : "Any Zcash wallet. Addresses starting with u1 keep it private.";
  }

  return (
    <PanelShell title="Withdraw" icon="arrowUp" tone="gold" onClose={onClose}>
      <div ref={addrWrap} className="zkw-ph">
        <Input
          label="Send to (wallet address)"
          size="md"
          font="mono"
          value={address}
          onChange={setAddr}
          placeholder="Paste an address"
          autoComplete="off"
          spellCheck={false}
          ariaLabel="Wallet address to send to"
          state={addrErr ? "error" : check.kind === "shielded" ? "success" : "default"}
          message={addrMessage}
          shake={shakeAddr}
          trailing={<PillButton label="Paste" onClick={() => void paste()} />}
        />
      </div>
      <div className="zkw-ph">
        <Input
          label="Amount"
          size="md"
          font="display"
          inputMode="decimal"
          value={amount}
          onChange={(v) => {
            setAmount(cleanAmount(v));
            setServerAmtErr(null);
          }}
          onEnter={() => void send()}
          placeholder="How much?"
          autoComplete="off"
          ariaLabel="Amount in ZEC"
          state={amtErr ? "error" : "default"}
          message={amtErr ?? `You have ${zec(maxZat)} ZEC to send.`}
          shake={shakeAmt}
          trailing={
            <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-4)" }}>
              <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text-muted)" }}>ZEC</span>
              <PillButton
                label="Max"
                tone="purple"
                active={amountZat === maxZat}
                ariaLabel="Max amount"
                onClick={() => {
                  setAmount(zec(maxZat));
                  setServerAmtErr(null);
                }}
              />
            </span>
          }
        />
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--zk-space-6) var(--zk-space-12)",
          padding: "var(--zk-space-10) var(--zk-space-12)",
          borderRadius: "var(--zk-radius-md)",
          background: "var(--zk-surface-raised)",
        }}
      >
        <span style={{ display: "flex", alignItems: "flex-start", gap: "var(--zk-space-8)", minWidth: 0 }}>
          <span style={{ display: "flex", marginTop: 1 }}>
            <Icon icon="bolt" size={14} color="var(--zk-gold)" />
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text)" }}>Network fee: {zec(fee)} ZEC</span>
            <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>{FEE_EXPLAINER}</span>
          </span>
        </span>
        {amtOk && amountZat != null ? (
          <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text)", marginLeft: "auto" }}>Total {zec(amountZat + fee)} ZEC</span>
        ) : null}
      </div>
      <Button
        label={busy ? "Sending…" : amtOk && amountZat != null ? `Send ${zec(amountZat)} ZEC` : "Send ZEC"}
        icon={busy ? undefined : check.kind === "transparent" ? "arrowUp" : "shieldCheck"}
        variant="primary"
        size="lg"
        disabled={!canSend}
        sfx={busy ? "none" : "whoosh"}
        onClick={() => void send()}
      />
      {wallet.network === "sim" ? (
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-faint)", textAlign: "center" }}>
          Test mode: sends are pretend. Nothing leaves ZECKED.
        </div>
      ) : null}
    </PanelShell>
  );
}

/* ───────────────────────── activity ───────────────────────── */

const TX_LOOK: Record<WalletTxKind, { icon: IconName; color: string; bg: string; flip?: boolean }> = {
  deposit: { icon: "arrowUp", flip: true, color: "var(--zk-sky)", bg: "var(--zk-sky-tint)" },
  win: { icon: "unlock", color: "var(--zk-mint)", bg: "var(--zk-mint-tint)" },
  refund: { icon: "shield", color: "var(--zk-purple-light)", bg: "var(--zk-purple-tint)" },
  hide: { icon: "lock", color: "var(--zk-pink)", bg: "rgb(var(--zk-pink-rgb) / .12)" },
  withdraw: { icon: "arrowUp", color: "var(--zk-gold)", bg: "var(--zk-gold-tint)" },
  bonus: { icon: "sparkle", color: "var(--zk-orange)", bg: "var(--zk-surface-raised)" },
  gift: { icon: "sparkle", color: "var(--zk-pink)", bg: "rgb(var(--zk-pink-rgb) / .12)" },
};
const TX_FALLBACK = { icon: "coin" as IconName, color: "var(--zk-gold)", bg: "var(--zk-gold-tint)", flip: false };

function StatusTag({ status }: { status: WalletTx["status"] }) {
  if (status === "done") return null;
  const pending = status === "pending";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--zk-space-4)",
        padding: "3px var(--zk-space-8)",
        borderRadius: "var(--zk-radius-pill)",
        background: pending ? "var(--zk-gold-tint)" : "var(--zk-red-tint)",
        color: pending ? "var(--zk-gold)" : "var(--zk-red)",
        font: "var(--zk-fw-black) var(--zk-fs-10)/1 var(--zk-font-body)",
        letterSpacing: "var(--zk-track-badge)",
        textTransform: "uppercase",
      }}
    >
      <Icon icon={pending ? "hourglass" : "close"} size={10} stroke={3} />
      {pending ? "Pending" : "Failed"}
    </span>
  );
}

function TxRow({
  tx,
  now,
  last,
  feeZat,
  onCopy,
}: {
  tx: WalletTx;
  now: number;
  last: boolean;
  feeZat: number;
  onCopy: (text: string, what: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const look = TX_LOOK[tx.kind] ?? TX_FALLBACK;
  const credit = tx.amountZat > 0;
  const failed = tx.status === "failed";
  // A withdrawal's line is what left your balance: the amount sent plus the network fee. Say so.
  const sentZat = tx.kind === "withdraw" && !credit ? Math.max(0, Math.abs(tx.amountZat) - feeZat) : null;
  const expandable = !!tx.txid && !tx.stashId && !tx.giftId;
  // A stash row opens the stash; a gift row (sent, opened, or came back) opens the gift.
  const href = tx.stashId ? `/s/${tx.stashId}` : tx.giftId ? `/g/${tx.giftId}` : null;
  const rowStyle: CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "var(--zk-space-12)",
    padding: "var(--zk-space-12) var(--zk-space-14)",
    minHeight: 64,
    border: 0,
    background: "transparent",
    textAlign: "left",
    font: "inherit",
    color: "var(--zk-text)",
    textDecoration: "none",
    cursor: expandable || href ? "pointer" : "default",
    WebkitTapHighlightColor: "transparent",
  };
  const content = (
    <>
      <span
        aria-hidden="true"
        style={{
          width: "var(--zk-tile-md)",
          height: "var(--zk-tile-md)",
          flex: "none",
          borderRadius: "var(--zk-radius-md)",
          background: look.bg,
          color: look.color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon icon={look.icon} size={20} stroke={2.4} style={look.flip ? { transform: "rotate(180deg)" } : undefined} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--zk-space-4)" }}>
        <span style={{ font: "var(--zk-type-body-strong)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tx.label}</span>
        {sentZat != null && !failed ? (
          <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
            {zec(sentZat)} ZEC + {zec(feeZat)} network fee
          </span>
        ) : null}
        <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
          <time dateTime={tx.at}>{ago(tx.at, now)}</time>
          <StatusTag status={tx.status} />
          {expandable ? <span style={{ color: "var(--zk-purple-light)" }}>· {open ? "Hide receipt" : "Receipt"}</span> : null}
        </span>
      </span>
      <span
        style={{
          flex: "none",
          font: "var(--zk-type-mono-sm)",
          color: failed ? "var(--zk-text-faint)" : credit ? "var(--zk-mint)" : "var(--zk-text-muted)",
          textDecoration: failed ? "line-through" : "none",
          whiteSpace: "nowrap",
        }}
      >
        {credit ? "+" : "−"}
        {zec(Math.abs(tx.amountZat))}
      </span>
    </>
  );
  const wrap: CSSProperties = { borderBottom: last ? "none" : "1px solid var(--zk-border)" };
  if (href) {
    return (
      <div style={wrap}>
        <Link href={href} style={rowStyle}>
          {content}
        </Link>
      </div>
    );
  }
  if (!expandable) {
    return (
      <div style={wrap}>
        <div style={rowStyle}>{content}</div>
      </div>
    );
  }
  return (
    <div style={wrap}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-sfx="tap" style={rowStyle}>
        {content}
      </button>
      {open ? (
        <dl
          style={{
            margin: "0 var(--zk-space-14) var(--zk-space-12)",
            padding: "var(--zk-space-2) var(--zk-space-14)",
            borderRadius: "var(--zk-radius-lg)",
            background: "var(--zk-surface-raised)",
            font: "var(--zk-type-small)",
          }}
        >
          {sentZat != null ? (
            <>
              <div style={receiptRow(false)}>
                <dt style={{ color: "var(--zk-text-muted)" }}>You sent</dt>
                <dd style={{ margin: 0, font: "var(--zk-type-mono-sm)" }}>{zec(sentZat)} ZEC</dd>
              </div>
              <div style={receiptRow(false)}>
                <dt style={{ color: "var(--zk-text-muted)" }}>Network fee</dt>
                <dd style={{ margin: 0, font: "var(--zk-type-mono-sm)" }}>{zec(feeZat)} ZEC</dd>
              </div>
            </>
          ) : null}
          <div style={{ ...receiptRow(true), padding: "var(--zk-space-4) 0" }}>
            <dt style={{ color: "var(--zk-text-muted)" }}>Receipt ID</dt>
            <dd style={{ margin: "0 0 0 auto", display: "flex", alignItems: "center", gap: "var(--zk-space-2)", font: "var(--zk-type-mono-sm)" }}>
              {shortAddr(tx.txid!, 6, 6)}
              <CopyButton ariaLabel="Copy receipt ID" onCopy={() => onCopy(tx.txid!, "Receipt ID")} />
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}

function Activity({
  items,
  now,
  feeZat,
  onCopy,
}: {
  items: WalletTx[];
  now: number;
  feeZat: number;
  onCopy: (text: string, what: string) => Promise<boolean>;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-12)", marginTop: "var(--zk-space-6)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, font: "var(--zk-type-h3)" }}>Activity</h2>
        {items.length > 0 ? <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>ZEC</span> : null}
      </div>
      {items.length > 0 ? (
        <div style={{ background: "var(--zk-surface)", borderRadius: "var(--zk-radius-xl)", overflow: "hidden" }}>
          {items.map((t, i) => (
            <TxRow key={t.id} tx={t} now={now} last={i === items.length - 1} feeZat={feeZat} onCopy={onCopy} />
          ))}
        </div>
      ) : (
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
            <div style={{ font: "var(--zk-type-h4)" }}>No moves yet.</div>
            <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-4)" }}>
              Crack a stash and your ZEC lands here instantly.
            </div>
          </div>
          <Button label="Crack one" icon="key" variant="primary" size="sm" full={false} href="/feed" style={{ height: 44 }} />
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── guest / loading / error ───────────────────────── */

function GuestCard({ href }: { href: string }) {
  const perks = ["Your own Zcash wallet address", "Wins land in your balance instantly", "Send your ZEC to any wallet, any time"];
  return (
    <section
      aria-label="Get a ZECKED wallet"
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "var(--zk-radius-3xl)",
        padding: "var(--zk-space-24) var(--zk-space-20) var(--zk-space-20)",
        background: "radial-gradient(circle at 80% 15%,var(--zk-purple-light) 0%,var(--zk-purple-vivid) 40%,var(--zk-purple-shade) 100%)",
        boxShadow: "0 8px 0 var(--zk-purple-night), var(--zk-glow-purple)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-14)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          right: -40,
          top: -40,
          width: 230,
          height: 230,
          borderRadius: "50%",
          background: "repeating-conic-gradient(rgb(var(--zk-white-rgb) / .1) 0 10deg,transparent 10deg 22deg)",
          willChange: "transform",
          animation: "zk-spin 30s linear infinite",
        }}
      />
      <div
        aria-hidden="true"
        style={
          {
            position: "relative",
            alignSelf: "flex-end",
            width: 84,
            height: 84,
            borderRadius: "var(--zk-radius-2xl)",
            background: "var(--zk-grad-tile-gold)",
            boxShadow: "inset 0 4px 0 rgb(var(--zk-white-rgb) / .5),0 6px 0 var(--zk-gold-deep),var(--zk-glow-gold)",
            color: "var(--zk-gold-ink)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: "rotate(6deg)",
            animation: "zk-bob 3s ease-in-out infinite",
            "--zk-tilt": "6deg",
          } as CSSProperties
        }
      >
        <Icon icon="wallet" size={44} stroke={2.4} />
      </div>
      <h2 style={{ position: "relative", margin: "calc(var(--zk-space-8) * -1) 0 0", font: "var(--zk-type-h2)" }}>
        Sign up to get your own ZECKED wallet
      </h2>
      <ul style={{ position: "relative", margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
        {perks.map((p) => (
          <li
            key={p}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--zk-space-10)",
              font: "var(--zk-type-body)",
              fontWeight: "var(--zk-fw-semibold)" as CSSProperties["fontWeight"],
              color: "rgb(var(--zk-white-rgb) / .9)",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                flex: "none",
                borderRadius: "50%",
                background: "var(--zk-mint)",
                color: "var(--zk-mint-ink)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon icon="check" size={13} stroke={3} />
            </span>
            {p}
          </li>
        ))}
      </ul>
      <div style={{ position: "relative", marginTop: "var(--zk-space-6)" }}>
        <Button label="Sign up" variant="primary" size="lg" href={href} />
      </div>
      <div style={{ position: "relative", textAlign: "center", font: "var(--zk-type-caption)", color: "rgb(var(--zk-white-rgb) / .75)" }}>
        Free. Takes about 30 seconds.
      </div>
    </section>
  );
}

function WalletSkeleton() {
  return (
    <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
      <span className="zk-sr-only">Loading your wallet…</span>
      <div style={glow(206, "var(--zk-radius-3xl)")} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--zk-space-10)", marginTop: "var(--zk-space-4)" }}>
        <div style={glow("var(--zk-h-btn-md)", "var(--zk-radius-xl)")} />
        <div style={glow("var(--zk-h-btn-md)", "var(--zk-radius-xl)")} />
      </div>
      <div style={glow(22, "var(--zk-radius-sm)", { width: 110, marginTop: "var(--zk-space-6)" })} />
      <div style={glow(210, "var(--zk-radius-xl)")} />
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        marginTop: "var(--zk-space-24)",
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
      <div
        aria-hidden="true"
        style={{
          width: 64,
          height: 64,
          borderRadius: "var(--zk-radius-lg)",
          background: "var(--zk-grad-tile-sky)",
          boxShadow: "var(--zk-inset-gloss), 0 4px 0 var(--zk-sky-shade)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--zk-text)",
        }}
      >
        <Icon icon="signal" size={30} stroke={2.4} />
      </div>
      <div style={{ font: "var(--zk-type-h3)" }}>Your wallet is napping.</div>
      <div style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>{message}</div>
      <Button label="Try again" variant="secondary" size="md" full={false} onClick={onRetry} />
    </div>
  );
}

/* ───────────────────────── screen ───────────────────────── */

type Load = { kind: "loading" } | { kind: "ready" } | { kind: "guest" } | { kind: "error"; message: string };

interface ToastState {
  id: number;
  text: string;
  variant: ToastVariant;
  icon?: string;
}

/** The three buttons under the hero (Add ZEC · Gift · Withdraw): sized so all fit in one row on a 320px phone. */
const ACTION_BTN: CSSProperties = {
  padding: "0 var(--zk-space-6)",
  gap: "var(--zk-space-6)",
  font: "var(--zk-fw-black) clamp(14px, 4.3vw, 17px)/var(--zk-lh-none) var(--zk-font-display)",
};

export default function Wallet() {
  const params = useSearchParams();
  const initialAction = params.get("action");
  const [panel, setPanel] = useState<Panel | null>(
    initialAction === "add" || initialAction === "withdraw" ? initialAction : null,
  );
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [count, setCount] = useState({ from: 0, to: 0, run: 0 });
  const [simulating, setSimulating] = useState<number | null>(null);
  const [landed, setLanded] = useState<Landed | null>(null);
  const [heroPop, setHeroPop] = useState<Landed | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const landedRun = useRef(0);
  const seenTx = useRef(new Set<string>());
  const balRef = useRef<number | null>(null);
  const pollBusy = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((text: string, variant: ToastVariant = "default", icon?: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, variant, icon });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(
    () => () => {
      clearTimeout(toastTimer.current);
      clearTimeout(popTimer.current);
    },
    [],
  );

  /**
   * Store a fresh WalletInfo. The hero counts up (or down) from the last balance it showed. With `celebrate`,
   * a balance that went up gets the coin sound, a "+0.05 ZEC landed" sticker with confetti, and the Add panel's
   * "landed" state. (The app-wide notice toast says "ZEC landed" too, so no toast here.)
   */
  const applyWallet = useCallback((w: WalletInfo, celebrate = false) => {
    const prev = balRef.current;
    balRef.current = w.balanceZat;
    // Only a brand-new credit in the activity counts as "landed" (not, say, a failed send being put back).
    const seen = seenTx.current;
    const fresh = w.activity.some((t) => !seen.has(t.id) && t.amountZat > 0 && t.status !== "failed");
    for (const t of w.activity) seen.add(t.id);
    if (prev == null) setCount({ from: w.balanceZat, to: w.balanceZat, run: 0 });
    else if (prev !== w.balanceZat) {
      setCount((c) => ({ from: prev, to: w.balanceZat, run: c.run + 1 }));
      if (celebrate && fresh && w.balanceZat > prev) {
        const l = { zat: w.balanceZat - prev, run: ++landedRun.current };
        sfx("coin");
        setLanded(l);
        setHeroPop(l);
        clearTimeout(popTimer.current);
        popTimer.current = setTimeout(() => setHeroPop(null), LANDED_POP_MS);
      }
    }
    setWallet(w);
    setNow(Date.now());
    setLoad({ kind: "ready" });
  }, []);

  const signedOut = useCallback(() => {
    setLoad({ kind: "guest" });
    setWallet(null);
    balRef.current = null;
    seenTx.current.clear();
  }, []);

  // First load: the account (guests have no wallet) and the wallet itself.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [me, w, cfg] = await Promise.allSettled([api.me(), api.wallet(), api.config()]);
      if (cancelled) return;
      if (cfg.status === "fulfilled") setBanner(cfg.value.banner ?? null);
      if (me.status === "fulfilled" && me.value.player.account && !me.value.player.account.signedIn) {
        setLoad({ kind: "guest" });
      } else if (w.status === "fulfilled") {
        applyWallet(w.value);
      } else if (errStatus(w.reason) === 401) {
        setLoad({ kind: "guest" });
      } else {
        setLoad({ kind: "error", message: friendlyErr(w.reason, "We couldn’t load your wallet just now. Your ZEC is safe.") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyWallet, reloadKey]);

  const refresh = useCallback(async () => {
    if (pollBusy.current) return;
    pollBusy.current = true;
    try {
      applyWallet(await api.wallet(), true);
    } catch (e) {
      if (errStatus(e) === 401) signedOut();
      /* otherwise keep showing the last wallet */
    } finally {
      pollBusy.current = false;
    }
  }, [applyWallet, signedOut]);

  // Polling: every 10s while ZEC may be arriving (or leaving), every 30s otherwise; paused while hidden.
  const ready = load.kind === "ready";
  const fast =
    panel === "add" || (wallet?.pendingDepositZat ?? 0) > 0 || !!wallet?.activity.some((t) => t.status === "pending");
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      if (!document.hidden) void refresh();
    }, fast ? FAST_MS : SLOW_MS);
    const onVis = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ready, fast, refresh]);

  // Keep ?action= in the URL in sync with the open panel, so a reload lands in the same place.
  useEffect(() => {
    const want = panel ? `?action=${panel}` : "";
    if (window.location.search !== want) window.history.replaceState(window.history.state, "", `/wallet${want}`);
  }, [panel]);

  // Bring an opened panel into view (also on load for ?action=).
  useEffect(() => {
    if (!panel || !ready) return;
    const id = requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    return () => cancelAnimationFrame(id);
  }, [panel, ready]);

  const openPanel = (p: Panel | null) => {
    setLanded(null);
    setPanel(p);
  };
  const toggle = (p: Panel) => openPanel(panel === p ? null : p);

  const copy = useCallback(
    async (text: string, what: string) => {
      const ok = await copyText(text);
      if (ok) showToast(`${what} copied`, "success", "copy");
      else showToast("Couldn’t copy. Long-press it to copy instead.", "error");
      return ok;
    },
    [showToast],
  );

  const copyAddress = async (address: string) => {
    const ok = await copyText(address);
    if (ok) showToast(wallet?.network === "mainnet" ? "Address copied" : "Copied! Now paste it into the faucet.", "success", "copy");
    else showToast("Couldn’t copy. Long-press the address to copy it instead.", "error");
    return ok;
  };

  const simulateDeposit = async (zat: number) => {
    if (simulating != null) return;
    setSimulating(zat);
    try {
      applyWallet(await api.simulateDeposit(zat), true);
    } catch (e) {
      if (errStatus(e) === 401) signedOut();
      else showToast(friendlyErr(e, "Couldn’t add that. Try again."), "error");
    } finally {
      setSimulating(null);
    }
  };

  const guestHref = panel ? `/signin?next=${encodeURIComponent(`/wallet?action=${panel}`)}&reason=wallet` : SIGNUP_HREF;

  let body: ReactNode;
  if (load.kind === "guest") {
    body = <GuestCard href={guestHref} />;
  } else if (load.kind === "error") {
    body = (
      <ErrorCard
        message={load.message}
        onRetry={() => {
          setLoad({ kind: "loading" });
          setReloadKey((k) => k + 1);
        }}
      />
    );
  } else if (load.kind === "ready" && wallet) {
    body = (
      <>
        <Hero wallet={wallet} count={count} pop={heroPop} />
        {/* Three actions in one row: on a 320px phone each gets ~90px, so the labels stay short and the icons go. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "var(--zk-space-8)", marginTop: "var(--zk-space-4)" }}>
          <Button
            label="Add ZEC"
            variant="secondary"
            size="md"
            sfx="whoosh"
            ariaLabel={panel === "add" ? "Close Add ZEC" : "Add ZEC"}
            onClick={() => toggle("add")}
            style={ACTION_BTN}
          />
          <Button label="Gift 🎁" variant="sky" size="md" sfx="whoosh" ariaLabel="Send a gift" href="/gift" style={ACTION_BTN} />
          <Button
            label="Withdraw"
            variant="primary"
            size="md"
            sfx="whoosh"
            ariaLabel={panel === "withdraw" ? "Close Withdraw" : "Withdraw"}
            onClick={() => toggle("withdraw")}
            style={ACTION_BTN}
          />
        </div>
        {panel ? (
          <div
            ref={panelRef}
            style={{
              marginTop: "var(--zk-space-4)",
              scrollMarginTop: "calc(var(--zk-fixed-top) + var(--zk-space-16))",
              scrollMarginBottom: "calc(var(--zk-tabbar-h) + var(--zk-space-16))",
            }}
          >
            {panel === "add" ? (
              <AddPanel
                wallet={wallet}
                simulating={simulating}
                landed={landed}
                onCopyAddress={copyAddress}
                onSimulate={(zat) => void simulateDeposit(zat)}
                onClose={() => openPanel(null)}
              />
            ) : (
              <WithdrawPanel
                wallet={wallet}
                onWallet={(w) => applyWallet(w)}
                onRefresh={() => void refresh()}
                onSignedOut={signedOut}
                onToast={showToast}
                onCopy={copy}
                onAddZec={() => openPanel("add")}
                onClose={() => openPanel(null)}
              />
            )}
          </div>
        ) : null}
        <Activity items={wallet.activity} now={now} feeZat={wallet.withdrawFeeZat} onCopy={copy} />
      </>
    );
  } else {
    body = <WalletSkeleton />;
  }

  return (
    <main className="zk-screen has-tabs" style={{ background: "var(--zk-bg-hero-gold)", gap: "var(--zk-space-14)" }}>
      <style>{SCOPED_CSS}</style>
      <Header />
      <SystemBanner text={banner} />
      {body}
      {toast ? (
        <div
          aria-live="polite"
          style={{
            position: "fixed",
            left: "var(--zk-col-x)",
            transform: "translateX(-50%)",
            top: "calc(var(--zk-fixed-top) + var(--zk-space-12))",
            width: "min(394px, calc(var(--zk-col-w) - 24px))",
            zIndex: 86,
            pointerEvents: "none",
          }}
        >
          <Toast key={toast.id} text={toast.text} variant={toast.variant} icon={toast.icon} />
        </div>
      ) : null}
      <TabBar active="wallet" />
    </main>
  );
}
