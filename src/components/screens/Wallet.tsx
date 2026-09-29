"use client";
// Wallet · the in-app ZECKED wallet. Balance hero, "Add ZEC" (your personal address + QR), "Withdraw"
// (send to any Zcash wallet, shielded by default) and the activity list. Guests get a sign-up card.
// `?action=add` / `?action=withdraw` opens that panel on load.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { api, formatUsd, formatZec } from "@/lib/api";
import { ZAT } from "@/lib/types";
import type { WalletInfo, WalletTx, WalletTxKind } from "@/lib/types";
import { Button, Chip, CountUp, Icon, Input, Logo, TabBar, Toast } from "@/components/zk";
import type { IconName, ToastVariant } from "@/components/zk";

/* ───────────────────────── constants ───────────────────────── */

type Panel = "add" | "withdraw";
type Network = WalletInfo["network"];

/** Poll fast while ZEC may be on its way (Add panel open, deposit or send pending), slowly otherwise. */
const FAST_MS = 10_000;
const SLOW_MS = 30_000;

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

/* ───────────────────────── helpers ───────────────────────── */

const errStatus = (e: unknown) => (e as { status?: number } | null)?.status;
const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong. Try again.");
const shortAddr = (a: string, head = 6, tail = 5) => (a.length > head + tail + 1 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);

/** Exact zat → "0.0497" (no float maths, trailing zeros trimmed). */
function zecStr(zat: number): string {
  const z = Math.max(0, Math.round(zat));
  const whole = Math.floor(z / ZAT);
  const frac = String(z % ZAT).padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

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
    return plausible && a.length < 30 ? { kind: "typing" } : { kind: "error", msg: "That doesn’t look like a Zcash address." };
  }
  if (own && a === own) return { kind: "error", msg: "That’s your own ZECKED address. Send it to an outside wallet." };
  const testnetAddr = TESTNET_RE.test(a);
  if (network === "testnet" && !testnetAddr) {
    return { kind: "error", msg: "Test mode sends on Zcash testnet. Use a testnet address (utest1…)." };
  }
  if (network === "mainnet" && testnetAddr) return { kind: "error", msg: "That’s a testnet address." };
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

const ICON_BTN: CSSProperties = {
  width: 40,
  height: 40,
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

const SMALL_LABEL: CSSProperties = {
  font: "var(--zk-type-small)",
  fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"],
  color: "var(--zk-text-muted)",
};

const LABEL: CSSProperties = {
  font: "var(--zk-type-label)",
  letterSpacing: "var(--zk-track-label)",
  color: "var(--zk-text-muted)",
};

const receiptRow = (last: boolean): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--zk-space-12)",
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

function Note({ icon, color = "var(--zk-purple-light)", children }: { icon: IconName; color?: string; children: ReactNode }) {
  return (
    <div
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
      }}
    >
      <span style={{ color, display: "flex", flex: "none", marginTop: 1 }}>
        <Icon icon={icon} size={18} />
      </span>
      <span style={{ minWidth: 0, textWrap: "pretty" }}>{children}</span>
    </div>
  );
}

function CopyIconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        flex: "none",
        borderRadius: "var(--zk-radius-sm)",
        border: "none",
        padding: 0,
        background: "var(--zk-surface-raised)",
        color: "var(--zk-text-muted)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <Icon icon="copy" size={14} />
    </button>
  );
}

/* ───────────────────────── header ───────────────────────── */

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <button type="button" aria-label="Back" onClick={onBack} style={ICON_BTN}>
        <Icon icon="back" size={20} stroke={2.6} />
      </button>
      <h1 style={{ margin: 0, font: "var(--zk-type-mono-sm)", letterSpacing: ".12em", color: "var(--zk-text-muted)" }}>WALLET</h1>
      <div style={{ width: 40 }} aria-hidden="true" />
    </div>
  );
}

/* ───────────────────────── hero ───────────────────────── */

function Hero({ wallet, count }: { wallet: WalletInfo; count: { from: number; to: number; run: number } }) {
  const net = wallet.network;
  const pending = wallet.pendingDepositZat;
  const digits = (wallet.balanceZat / ZAT).toFixed(4).length;
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
        <span style={LABEL}>YOUR ZEC</span>
        {net !== "mainnet" ? (
          <Chip
            variant="info"
            icon="flag"
            iconColor="var(--zk-gold)"
            label={net === "testnet" ? "Testnet ZEC" : "Test mode · play ZEC"}
            style={{ background: "var(--zk-gold-tint)", color: "var(--zk-gold)", padding: "var(--zk-space-6) var(--zk-space-10)" }}
          />
        ) : null}
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", marginTop: "var(--zk-space-14)" }}>
        <span className="zk-sr-only" aria-live="polite">
          {`${(wallet.balanceZat / ZAT).toFixed(4)} ZEC, about ${formatUsd(wallet.usd)}`}
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
            <CountUp from={count.from / ZAT} to={count.to / ZAT} decimals={4} duration={1200} run={count.run} />
          </span>
          <span style={{ font: "var(--zk-type-mono)", fontSize: "var(--zk-fs-18)", color: "var(--zk-gold-light)" }}>ZEC</span>
        </div>
        <div aria-hidden="true" style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-12)" }}>
          ~{formatUsd(wallet.usd)}
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
            <b style={{ color: "var(--zk-mint)" }}>+{formatZec(pending, 8)} ZEC</b> arriving…{" "}
            <span style={{ color: "var(--zk-text-muted)" }}>(waiting for confirmation)</span>
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
          style={{ ...ICON_BTN, width: 34, height: 34, background: "var(--zk-surface-raised)", color: "var(--zk-text-muted)" }}
        >
          <Icon icon="close" size={16} stroke={2.6} />
        </button>
      </div>
      {children}
    </section>
  );
}

/* ── Add ZEC ── */

function AddPanel({
  wallet,
  simulating,
  onCopyAddress,
  onSimulate,
  onClose,
}: {
  wallet: WalletInfo;
  simulating: number | null;
  onCopyAddress: (address: string) => void;
  onSimulate: (zat: number) => void;
  onClose: () => void;
}) {
  const address = wallet.depositAddress;
  const uri = wallet.depositUri;
  const qr = useQr(uri);

  return (
    <PanelShell title="Add ZEC" icon="plus" tone="purple" onClose={onClose}>
      <div style={SMALL_LABEL}>Your personal ZECKED address</div>
      <div
        role="img"
        aria-label="QR code of your ZECKED address"
        style={{
          alignSelf: "center",
          flex: "none",
          width: 250,
          height: 250,
          borderRadius: "var(--zk-radius-3xl)",
          background: "var(--zk-text)",
          padding: "var(--zk-space-18)",
          boxSizing: "border-box",
          position: "relative",
          boxShadow: "0 0 0 6px rgb(var(--zk-purple-rgb) / .3),var(--zk-shadow-float)",
        }}
      >
        {qr.src ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr.src} alt="" width={214} height={214} style={{ display: "block", width: 214, height: 214 }} />
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                transform: "translate(-50%,-50%)",
                padding: 4,
                background: "var(--zk-text)",
                borderRadius: "var(--zk-radius-md)",
                display: "flex",
                lineHeight: 0,
              }}
            >
              <Logo variant="icon" size={30} />
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
            {qr.failed ? (
              "Couldn’t draw the QR. Copy the address below."
            ) : (
              <>
                <Spinner size={24} />
                {!uri ? "Setting up your address…" : null}
              </>
            )}
          </div>
        )}
      </div>

      {address ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-10)",
            padding: "var(--zk-space-8) var(--zk-space-8) var(--zk-space-8) var(--zk-space-16)",
            borderRadius: "var(--zk-radius-lg)",
            background: "var(--zk-surface-raised)",
          }}
        >
          <span
            title={address}
            style={{
              flex: 1,
              minWidth: 0,
              font: "var(--zk-fw-medium) var(--zk-fs-14)/1 var(--zk-font-mono)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {shortAddr(address)}
          </span>
          <Button label="Copy" icon="copy" variant="secondary" size="sm" full={false} onClick={() => onCopyAddress(address)} />
        </div>
      ) : null}
      {uri ? <Button label="Open in wallet" icon="wallet" variant="ghost" size="md" href={uri} /> : null}

      <Note icon="info">Send ZEC from any Zcash wallet. It shows up here in about a minute.</Note>

      {wallet.network === "testnet" ? (
        <Note icon="flag" color="var(--zk-gold)">
          <b style={{ color: "var(--zk-text)" }}>Testnet only.</b> Get free test ZEC from a faucet:{" "}
          {FAUCETS.map((f, i) => (
            <span key={f.href}>
              {i > 0 ? " or " : null}
              <a
                href={f.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontWeight: "var(--zk-fw-bold)" as CSSProperties["fontWeight"], overflowWrap: "anywhere" }}
              >
                {f.label}
              </a>
            </span>
          ))}
        </Note>
      ) : null}

      {wallet.network === "sim" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
          <div style={{ ...SMALL_LABEL, display: "flex", alignItems: "center", gap: "var(--zk-space-6)" }}>
            <Icon icon="bolt" size={14} color="var(--zk-gold)" />
            Simulate a deposit (test mode)
          </div>
          <div style={{ display: "flex", gap: "var(--zk-space-8)", flexWrap: "wrap" }}>
            {SIM_AMOUNTS.map((a) => (
              <Chip
                key={a.zat}
                size="sm"
                label={simulating === a.zat ? "Adding…" : `+${a.label}`}
                active={simulating === a.zat}
                disabled={simulating != null}
                onClick={() => onSimulate(a.zat)}
              />
            ))}
          </div>
        </div>
      ) : null}
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

function PasteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 34,
        padding: "0 var(--zk-space-12)",
        borderRadius: "var(--zk-radius-md)",
        border: "none",
        background: "var(--zk-purple)",
        color: "var(--zk-text)",
        boxShadow: "0 3px 0 var(--zk-purple-deep)",
        font: "var(--zk-type-btn-sm)",
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      Paste
    </button>
  );
}

function Receipt({
  r,
  network,
  onCopyTxid,
  onDone,
}: {
  r: SentReceipt;
  network: Network;
  onCopyTxid: (txid: string) => void;
  onDone: () => void;
}) {
  const rows: { k: string; v: ReactNode }[] = [
    { k: "Amount", v: <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-gold)" }}>{formatZec(r.amountZat, 8)} ZEC</span> },
    { k: "To", v: <span style={{ font: "var(--zk-type-mono-sm)" }}>{shortAddr(r.to)}</span> },
    {
      k: "Txid",
      v: (
        <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", font: "var(--zk-type-mono-sm)" }}>
          {shortAddr(r.txid, 6, 6)}
          <CopyIconButton label="Copy transaction id" onClick={() => onCopyTxid(r.txid)} />
        </span>
      ),
    },
    {
      k: "Transfer",
      v: r.shielded ? (
        <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-4)", font: "var(--zk-type-body-strong)", color: "var(--zk-mint)" }}>
          Shielded
          <Icon icon="check" size={16} stroke={3} />
        </span>
      ) : (
        <span style={{ font: "var(--zk-type-body-strong)", color: "var(--zk-gold)" }}>Transparent</span>
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
          <div style={{ font: "var(--zk-type-h3)" }}>It’s on its way.</div>
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)" }}>
            {r.shielded ? "Shielded. Nobody can see where it went 🥷" : "Sent to a transparent address, so this one is public."}
          </div>
        </div>
      </div>
      <dl style={{ margin: 0, background: "var(--zk-surface-raised)", borderRadius: "var(--zk-radius-xl)", padding: "var(--zk-space-4) var(--zk-space-16)" }}>
        {rows.map((row, i) => (
          <div key={row.k} style={receiptRow(i === rows.length - 1)}>
            <dt style={{ color: "var(--zk-text-muted)" }}>{row.k}</dt>
            <dd style={{ margin: 0, minWidth: 0 }}>{row.v}</dd>
          </div>
        ))}
      </dl>
      {network === "sim" ? (
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-gold)", display: "flex", alignItems: "center", gap: "var(--zk-space-6)" }}>
          <Icon icon="flag" size={14} />
          Test mode: a pretend send with play ZEC.
        </div>
      ) : null}
      <Button label="Done" variant="ghost" size="md" onClick={onDone} />
    </>
  );
}

function WithdrawPanel({
  wallet,
  onWallet,
  onSignedOut,
  onToast,
  onAddZec,
  onClose,
}: {
  wallet: WalletInfo;
  onWallet: (w: WalletInfo) => void;
  onSignedOut: () => void;
  onToast: (text: string, variant?: ToastVariant, icon?: string) => void;
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
  const testnet = wallet.network === "testnet";

  const check = checkAddress(address, wallet.network, wallet.depositAddress);
  const addrOk = check.kind === "shielded" || check.kind === "transparent";
  const addrErr = serverAddrErr ?? (check.kind === "error" ? check.msg : null);

  const amountZat = parseZecToZat(amount);
  let amtIssue: string | null = null;
  if (amount.trim() && amountZat == null) amtIssue = "Numbers only, like 0.05";
  else if (amountZat != null && amountZat > maxZat) amtIssue = `You can send up to ${zecStr(maxZat)} ZEC (after the fee).`;
  else if (amountZat != null && amountZat > 0 && amountZat < min) amtIssue = `The minimum is ${zecStr(min)} ZEC.`;
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
    onToast("Couldn’t read your clipboard. Long-press the field to paste.", "error");
    requestAnimationFrame(() => addrWrap.current?.querySelector<HTMLInputElement>("input")?.focus());
  };

  const send = async () => {
    if (!canSend || amountZat == null) return;
    setBusy(true);
    const shielded = check.kind === "shielded";
    try {
      const res = await api.withdraw(address.trim(), amountZat);
      onWallet(res.wallet);
      setReceipt({ txid: res.txid, amountZat: res.amountZat, feeZat: res.feeZat, to: res.to, shielded });
      setAddress("");
      setAmount("");
    } catch (e) {
      const status = errStatus(e);
      const m = errMsg(e);
      if (status === 401) {
        onSignedOut();
      } else if (status === 503) {
        onToast("The prize vault is being topped up. Your ZEC is safe here. Try again in a few minutes.", "error", "hourglass");
      } else if (status === 402) {
        setServerAmtErr("Not enough ZEC for that plus the network fee.");
        setShakeAmt((n) => n + 1);
      } else if (status === 400 && /address/i.test(m)) {
        setServerAddrErr(/[.!?]$/.test(m) ? m : `${m}.`);
        setShakeAddr((n) => n + 1);
      } else if (status === 400 && /minimum|amount/i.test(m)) {
        setServerAmtErr(/[.!?]$/.test(m) ? m : `${m}.`);
        setShakeAmt((n) => n + 1);
      } else {
        onToast(m, "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const copyTxid = async (txid: string) => {
    if (await copyText(txid)) onToast("Transaction id copied", "success", "copy");
    else onToast("Couldn’t copy. Long-press to copy instead.", "error");
  };

  if (receipt) {
    return (
      <PanelShell title="Withdraw" icon="arrowUp" tone="gold" onClose={onClose}>
        <Receipt r={receipt} network={wallet.network} onCopyTxid={(t) => void copyTxid(t)} onDone={onClose} />
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
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
            You need at least {zecStr(min + fee)} ZEC, fee included. Crack a stash or add some ZEC first.
          </div>
          <div style={{ marginTop: "var(--zk-space-6)" }}>
            <Button label="Add ZEC" icon="plus" variant="secondary" size="sm" full={false} onClick={onAddZec} />
          </div>
        </div>
      </PanelShell>
    );
  }

  let addrMessage: ReactNode;
  if (addrErr) addrMessage = addrErr;
  else if (check.kind === "shielded") addrMessage = "Shielded address. Private by default.";
  else if (check.kind === "transparent") {
    addrMessage = (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--zk-space-4)", color: "var(--zk-gold)" }}>
        <Icon icon="eye" size={13} stroke={2.4} />
        Transparent: this payout will be public
      </span>
    );
  } else addrMessage = testnet ? "Any testnet wallet. Shielded (utest1…) keeps it private." : "Any Zcash wallet. Shielded (u1…) keeps it private.";

  return (
    <PanelShell title="Withdraw" icon="arrowUp" tone="gold" onClose={onClose}>
      <div ref={addrWrap}>
        <Input
          label="Send to"
          size="md"
          font="mono"
          value={address}
          onChange={setAddr}
          placeholder={testnet ? "utest1…" : "u1…"}
          autoComplete="off"
          spellCheck={false}
          ariaLabel="Destination Zcash address"
          state={addrErr ? "error" : check.kind === "shielded" ? "success" : "default"}
          message={addrMessage}
          shake={shakeAddr}
          trailing={<PasteButton onClick={() => void paste()} />}
        />
      </div>
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
        placeholder="0.05"
        autoComplete="off"
        ariaLabel="Amount in ZEC"
        state={amtErr ? "error" : "default"}
        message={amtErr ?? `You can send up to ${zecStr(maxZat)} ZEC.`}
        shake={shakeAmt}
        trailing={
          <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-8)" }}>
            <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text-muted)" }}>ZEC</span>
            <Chip
              size="sm"
              label="Max"
              active={amountZat === maxZat}
              onClick={() => {
                setAmount(zecStr(maxZat));
                setServerAmtErr(null);
              }}
            />
          </span>
        }
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--zk-space-8)",
          padding: "var(--zk-space-10) var(--zk-space-12)",
          borderRadius: "var(--zk-radius-md)",
          background: "var(--zk-surface-raised)",
          font: "var(--zk-type-caption)",
          color: "var(--zk-text-muted)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)" }}>
          <Icon icon="bolt" size={14} color="var(--zk-gold)" />
          Network fee ~{formatZec(fee, 8)} ZEC
        </span>
        {amtOk && amountZat != null ? (
          <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text)" }}>Total {formatZec(amountZat + fee, 8)} ZEC</span>
        ) : null}
      </div>
      <Button
        label={busy ? "Sending…" : amtOk && amountZat != null ? `Send ${zecStr(amountZat)} ZEC` : "Send ZEC"}
        icon={busy ? undefined : check.kind === "transparent" ? "arrowUp" : "shieldCheck"}
        variant="primary"
        size="lg"
        disabled={!canSend}
        onClick={() => void send()}
      />
      {wallet.network === "sim" ? (
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-faint)", textAlign: "center" }}>
          Test mode: sends are pretend, play ZEC only.
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

function TxRow({ tx, now, last }: { tx: WalletTx; now: number; last: boolean }) {
  const look = TX_LOOK[tx.kind] ?? TX_FALLBACK;
  const credit = tx.amountZat > 0;
  const failed = tx.status === "failed";
  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--zk-space-12)",
    padding: "var(--zk-space-12) var(--zk-space-14)",
    borderBottom: last ? "none" : "1px solid var(--zk-border)",
    color: "var(--zk-text)",
    textDecoration: "none",
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
        <span
          style={{
            font: "var(--zk-type-body-strong)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {tx.label}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
          <time dateTime={tx.at}>{ago(tx.at, now)}</time>
          <StatusTag status={tx.status} />
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
        {formatZec(Math.abs(tx.amountZat), 8)}
      </span>
    </>
  );
  return tx.stashId ? (
    <Link href={`/s/${tx.stashId}`} style={rowStyle}>
      {content}
    </Link>
  ) : (
    <div style={rowStyle}>{content}</div>
  );
}

function Activity({ items, now }: { items: WalletTx[]; now: number }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-12)", marginTop: "var(--zk-space-6)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2 style={{ margin: 0, font: "var(--zk-type-h3)" }}>Activity</h2>
        {items.length > 0 ? <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>ZEC</span> : null}
      </div>
      {items.length > 0 ? (
        <div style={{ background: "var(--zk-surface)", borderRadius: "var(--zk-radius-xl)", overflow: "hidden" }}>
          {items.map((t, i) => (
            <TxRow key={t.id} tx={t} now={now} last={i === items.length - 1} />
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
          <Button label="Crack one" icon="key" variant="primary" size="sm" full={false} href="/feed" />
        </div>
      )}
    </section>
  );
}

/* ───────────────────────── guest / loading / error ───────────────────────── */

function GuestCard({ href }: { href: string }) {
  const perks = ["Your own personal Zcash address", "Wins land in your balance instantly", "Send your ZEC to any wallet, any time"];
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
        Just your email. Takes about 30 seconds.
      </div>
    </section>
  );
}

function WalletSkeleton() {
  return (
    <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
      <span className="zk-sr-only">Loading your wallet…</span>
      <div style={glow(206, "var(--zk-radius-3xl)")} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--zk-space-10)" }}>
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

export default function Wallet() {
  const router = useRouter();
  const params = useSearchParams();
  const initialAction = params.get("action");
  const [panel, setPanel] = useState<Panel | null>(
    initialAction === "add" || initialAction === "withdraw" ? initialAction : null,
  );
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [now, setNow] = useState(0);
  const [count, setCount] = useState({ from: 0, to: 0, run: 0 });
  const [simulating, setSimulating] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const balRef = useRef<number | null>(null);
  const pollBusy = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const showToast = useCallback((text: string, variant: ToastVariant = "default", icon?: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, variant, icon });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /** Store a fresh WalletInfo. The hero counts up (or down) from the last balance it showed. */
  const applyWallet = useCallback(
    (w: WalletInfo, announce = false) => {
      const prev = balRef.current;
      balRef.current = w.balanceZat;
      if (prev == null) setCount({ from: w.balanceZat, to: w.balanceZat, run: 0 });
      else if (prev !== w.balanceZat) {
        setCount((c) => ({ from: prev, to: w.balanceZat, run: c.run + 1 }));
        if (announce && w.balanceZat > prev) showToast(`+${formatZec(w.balanceZat - prev, 8)} ZEC landed in your wallet`, "gold", "coin");
      }
      setWallet(w);
      setNow(Date.now());
      setLoad({ kind: "ready" });
    },
    [showToast],
  );

  const signedOut = useCallback(() => {
    setLoad({ kind: "guest" });
    setWallet(null);
    balRef.current = null;
  }, []);

  // First load: the account (guests have no wallet) and the wallet itself.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [me, w] = await Promise.allSettled([api.me(), api.wallet()]);
      if (cancelled) return;
      if (me.status === "fulfilled" && me.value.player.account && !me.value.player.account.signedIn) {
        setLoad({ kind: "guest" });
      } else if (w.status === "fulfilled") {
        applyWallet(w.value);
      } else if (errStatus(w.reason) === 401) {
        setLoad({ kind: "guest" });
      } else {
        setLoad({ kind: "error", message: errMsg(w.reason) });
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
    if (window.location.search !== want) window.history.replaceState(null, "", `/wallet${want}`);
  }, [panel]);

  // Bring an opened panel into view (also on load for ?action=).
  useEffect(() => {
    if (!panel || !ready) return;
    const id = requestAnimationFrame(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    return () => cancelAnimationFrame(id);
  }, [panel, ready]);

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/me");
  };

  const copyAddress = async (address: string) => {
    if (await copyText(address)) showToast("Address copied", "success", "copy");
    else showToast("Couldn’t copy. Long-press to copy instead.", "error");
  };

  const simulateDeposit = async (zat: number) => {
    if (simulating != null) return;
    setSimulating(zat);
    try {
      applyWallet(await api.simulateDeposit(zat));
      showToast(`+${formatZec(zat, 8)} play ZEC landed in your wallet`, "gold", "coin");
    } catch (e) {
      if (errStatus(e) === 401) signedOut();
      else showToast(errMsg(e), "error");
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
        <Hero wallet={wallet} count={count} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--zk-space-10)", marginTop: "var(--zk-space-4)" }}>
          <Button label="Add ZEC" icon="plus" variant="secondary" size="md" onClick={() => toggle("add")} />
          <Button label="Withdraw" icon="arrowUp" variant="primary" size="md" onClick={() => toggle("withdraw")} />
        </div>
        {panel ? (
          <div
            ref={panelRef}
            style={{
              marginTop: "var(--zk-space-4)",
              scrollMarginTop: "var(--zk-space-16)",
              scrollMarginBottom: "calc(var(--zk-tabbar-h) + var(--zk-space-16))",
            }}
          >
            {panel === "add" ? (
              <AddPanel
                wallet={wallet}
                simulating={simulating}
                onCopyAddress={(a) => void copyAddress(a)}
                onSimulate={(zat) => void simulateDeposit(zat)}
                onClose={() => setPanel(null)}
              />
            ) : (
              <WithdrawPanel
                wallet={wallet}
                onWallet={(w) => applyWallet(w)}
                onSignedOut={signedOut}
                onToast={showToast}
                onAddZec={() => setPanel("add")}
                onClose={() => setPanel(null)}
              />
            )}
          </div>
        ) : null}
        <Activity items={wallet.activity} now={now} />
      </>
    );
  } else {
    body = <WalletSkeleton />;
  }

  return (
    <main className="zk-screen has-tabs" style={{ background: "var(--zk-bg-hero-gold)", gap: "var(--zk-space-14)" }}>
      <Header onBack={goBack} />
      {body}
      {toast ? (
        <div
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: "calc(var(--zk-tabbar-h) + env(safe-area-inset-bottom, 0px) + var(--zk-space-16))",
            width: "min(394px, calc(100vw - 36px))",
            zIndex: 80,
            pointerEvents: "none",
          }}
        >
          <Toast key={toast.id} text={toast.text} variant={toast.variant} icon={toast.icon} />
        </div>
      ) : null}
      <TabBar active="profile" />
    </main>
  );
}
