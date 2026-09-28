"use client";
// Screens 08a (where should we send it?) and 08b (delivered).
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { api, formatUsd, formatZec } from "@/lib/api";
import type { ClaimResult, WinPayload } from "@/lib/types";
import { Badge, Button, Icon, Input, Toast, Vault } from "@/components/zk";

export interface ClaimProps {
  /** Stash id. */
  id: string;
  win: WinPayload;
}

type Method = "wallet" | "new";
type AddrCheck = "empty" | "partial" | "shielded" | "transparent" | "invalid";

const MESSAGE_MAX = 80;
const WALLETS = [
  { name: "Zodl", href: "https://zodl.com" },
  { name: "Vizor", href: "https://vizor.cash" },
];

// Same rules as the server (src/lib/server/util.ts).
const SHIELDED_RE = /^(u1|utest1|zs1|ztestsapling1)[0-9a-z]{20,}$/i;
const TRANSPARENT_RE = /^(t1|t3|tm|t2|tex1|textest1)[0-9A-Za-z]{20,}$/;
const PREFIXES = ["u1", "utest1", "zs1", "ztestsapling1", "t1", "t3", "tm", "t2", "tex1", "textest1"];

function checkAddress(raw: string): AddrCheck {
  const a = raw.trim();
  if (!a) return "empty";
  if (SHIELDED_RE.test(a)) return "shielded";
  if (TRANSPARENT_RE.test(a)) return "transparent";
  const lower = a.toLowerCase();
  const prefixOk = PREFIXES.some((p) => p.startsWith(lower) || lower.startsWith(p));
  if (!prefixOk || /[^0-9a-z]/i.test(a)) return "invalid";
  return "partial";
}

function shorten(s: string, head = 5, tail = 4): string {
  if (s.includes("…") || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

const claimKey = (id: string) => `zk_claim_${id}`;

/* ---------- styles ---------- */

const radioCard = (on: boolean, color: string): CSSProperties => ({
  background: "var(--zk-surface)",
  borderRadius: "var(--zk-radius-2xl)",
  padding: "var(--zk-space-16)",
  border: `2px solid ${on ? color : "var(--zk-border)"}`,
  display: "flex",
  flexDirection: "column",
  gap: "var(--zk-space-12)",
  cursor: "pointer",
  position: "relative",
  transition: "border-color var(--zk-dur-fast) var(--zk-ease-out)",
});

const radioHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--zk-space-12)",
  outline: "none",
  borderRadius: "var(--zk-radius-md)",
};

const tileStyle = (grad: string, deep: string, ink: string): CSSProperties => ({
  width: 44,
  height: 44,
  borderRadius: "var(--zk-radius-lg)",
  background: grad,
  boxShadow: `0 3px 0 ${deep}`,
  color: ink,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
});

const radioDot = (on: boolean, color: string): CSSProperties => ({
  width: 24,
  height: 24,
  borderRadius: "50%",
  boxSizing: "border-box",
  border: `2px solid ${on ? color : "var(--zk-border)"}`,
  background: on ? color : "transparent",
  flex: "none",
});

const cardTitle: CSSProperties = { font: "var(--zk-type-h4)", fontSize: "var(--zk-fs-18)" };
const cardSub: CSSProperties = { font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-medium)", color: "var(--zk-text-muted)" };

const stepNum: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: "50%",
  background: "var(--zk-mint)",
  color: "var(--zk-mint-ink)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  font: "var(--zk-fw-black) var(--zk-fs-13)/1 var(--zk-font-body)",
  flex: "none",
};

const walletLink: CSSProperties = {
  color: "var(--zk-mint)",
  textDecoration: "underline",
  textUnderlineOffset: 2,
  fontWeight: "var(--zk-fw-bold)",
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

/* ---------- component ---------- */

export function Claim({ id, win }: ClaimProps) {
  const [method, setMethod] = useState<Method>("wallet");
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [sentMessage, setSentMessage] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const addrWrap = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const addr = address.trim();
  const check = checkAddress(address);
  const valid = check === "shielded" || check === "transparent";

  const focusAddress = () => {
    requestAnimationFrame(() => addrWrap.current?.querySelector<HTMLInputElement>("input")?.focus());
  };

  const pick = (m: Method) => {
    if (m === method) return;
    setMethod(m);
    // Both paths end with pasting an address, so the input gets focus again.
    focusAddress();
  };

  const radioKeys = (m: Method) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(m);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      pick(m === "wallet" ? "new" : "wallet");
    }
  };

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setAddress(t.trim());
    } catch {
      /* clipboard blocked: let them paste by hand */
    }
    focusAddress();
  };

  const showToast = (text: string) => {
    clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  const send = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const msg = message.trim().slice(0, MESSAGE_MAX);
    try {
      const res = await api.claim(id, { claimToken: win.claimToken, address: addr, message: msg || undefined });
      try {
        sessionStorage.removeItem(claimKey(id));
      } catch {
        /* ignore */
      }
      setSentMessage(msg);
      setResult(res);
      window.scrollTo({ top: 0 });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      if (/already claimed|nothing to claim/i.test(m)) {
        try {
          sessionStorage.removeItem(claimKey(id));
        } catch {
          /* ignore */
        }
      }
      setError(m || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 08b · delivered ---------- */

  if (result) {
    const amount = `${formatZec(result.amountZat)} ZEC · ~${formatUsd(result.usd)}`;
    const shareWin = () => {
      const text = `I just ZECKED ${formatZec(result.amountZat)} ZEC on @PlayZecked 🔓 Nobody knows it was me.`;
      const url = `${window.location.origin}/s/${id}`;
      window.open(
        `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
        "_blank",
        "noopener,noreferrer",
      );
    };
    const copyTx = async () => {
      try {
        await navigator.clipboard.writeText(result.txid);
        showToast("Transaction id copied");
      } catch {
        showToast(result.txid);
      }
    };
    const rows: { k: string; v: ReactNode }[] = [
      { k: "Amount", v: <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-gold)" }}>{amount}</span> },
      { k: "Sent to", v: <span style={{ font: "var(--zk-type-mono-sm)" }}>{shorten(result.to)}</span> },
      {
        k: "Transfer",
        v: result.shielded ? (
          <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-4)", font: "var(--zk-type-body-strong)", color: "var(--zk-mint)" }}>
            Shielded
            <Icon icon="check" size={16} stroke={3} />
          </span>
        ) : (
          <span style={{ font: "var(--zk-type-body-strong)", color: "var(--zk-gold)" }}>Transparent</span>
        ),
      },
      {
        k: "Txid",
        v: (
          <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", font: "var(--zk-type-mono-sm)" }}>
            {shorten(result.txid, 6, 6)}
            <button
              type="button"
              aria-label="Copy transaction id"
              onClick={() => void copyTx()}
              style={{
                width: 28,
                height: 28,
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
          </span>
        ),
      },
    ];

    return (
      <main
        className="zk-screen"
        style={{
          background: "var(--zk-bg-claimed)",
          gap: "var(--zk-space-14)",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + var(--zk-space-40))",
        }}
      >
        <div style={{ alignSelf: "center", position: "relative", width: 140, height: 140, flex: "none" }}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: "3px solid rgb(var(--zk-mint-rgb) / .6)",
              willChange: "transform, opacity",
              animation: "zk-ring 2s var(--zk-ease-out) infinite",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: "3px solid rgb(var(--zk-mint-rgb) / .6)",
              willChange: "transform, opacity",
              animation: "zk-ring 2s var(--zk-ease-out) 1s infinite",
            }}
          />
          {result.shielded ? <Badge badge="shielded" size={140} /> : <Vault mode="open" size={140} />}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)", textAlign: "center", alignItems: "center", marginTop: "var(--zk-space-8)" }}>
          <h1 style={{ margin: 0, font: "var(--zk-type-h1)", letterSpacing: "-.01em" }}>
            {result.shielded ? "It’s in your private wallet." : "It’s in your wallet."}
          </h1>
          <p style={{ margin: 0, font: "var(--zk-type-body-lg)", fontWeight: "var(--zk-fw-semibold)", color: "var(--zk-text-muted)" }}>
            {result.shielded
              ? "Nobody can see who won 🥷"
              : "Transparent address: the payout will be public. A shielded address (u1…) keeps it private."}
          </p>
        </div>
        <dl style={{ margin: "var(--zk-space-8) 0 0", background: "var(--zk-surface)", borderRadius: "var(--zk-radius-xl)", padding: "var(--zk-space-6) var(--zk-space-16)" }}>
          {rows.map((row, i) => (
            <div key={row.k} style={receiptRow(i === rows.length - 1)}>
              <dt style={{ color: "var(--zk-text-muted)" }}>{row.k}</dt>
              <dd style={{ margin: 0, minWidth: 0 }}>{row.v}</dd>
            </div>
          ))}
        </dl>
        {result.testMode && (
          <p
            role="note"
            style={{
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: "var(--zk-space-8)",
              padding: "var(--zk-space-10) var(--zk-space-12)",
              borderRadius: "var(--zk-radius-md)",
              background: "var(--zk-gold-tint)",
              color: "var(--zk-gold)",
              font: "var(--zk-type-caption)",
            }}
          >
            <Icon icon="flag" size={14} />
            Test mode: play ZEC on a test network.
          </p>
        )}
        {sentMessage && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
            <span style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>Victory message</span>
            <div
              style={{
                padding: "var(--zk-space-14) var(--zk-space-18)",
                borderRadius: "var(--zk-radius-xl)",
                background: "var(--zk-surface)",
                border: "1.5px solid var(--zk-border-strong)",
                font: "var(--zk-fw-semibold) var(--zk-fs-18)/1.3 var(--zk-font-body)",
                overflowWrap: "anywhere",
              }}
            >
              {sentMessage}
            </div>
            <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>Shown on the stash card. Your handle stays hidden.</span>
          </div>
        )}
        <div style={{ marginTop: "auto", paddingTop: "var(--zk-space-8)", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
          <Button label="Share my win" icon="share" variant="primary" size="lg" onClick={shareWin} />
          <Button label="Back to stashes" variant="ghost" size="md" href="/feed" />
        </div>
        {toast && (
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: "calc(env(safe-area-inset-bottom, 0px) + var(--zk-space-18))",
              zIndex: 60,
              display: "flex",
              justifyContent: "center",
              padding: "0 var(--zk-screen-pad)",
              pointerEvents: "none",
            }}
          >
            <div style={{ width: "100%", maxWidth: "calc(430px - 2 * var(--zk-screen-pad))" }}>
              <Toast text={toast} variant="success" icon="copy" />
            </div>
          </div>
        )}
      </main>
    );
  }

  /* ---------- 08a · where should we send it? ---------- */

  const isWallet = method === "wallet";
  const addressRow = (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: "flex", gap: "var(--zk-space-8)", alignItems: "center" }}>
        <div ref={addrWrap} style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={address}
            onChange={(v) => {
              setAddress(v);
              setError(null);
            }}
            onEnter={() => void send()}
            placeholder="u1…"
            ariaLabel="Zcash address"
            size="sm"
            font="mono"
            state={check === "invalid" ? "error" : check === "shielded" ? "success" : "default"}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button label="Paste" variant="secondary" size="sm" full={false} onClick={() => void paste()} />
      </div>
      {check === "invalid" && (
        <span role="alert" style={{ font: "var(--zk-type-caption)", color: "var(--zk-red)" }}>
          That doesn’t look like a Zcash address.
        </span>
      )}
      {check === "transparent" && (
        <div
          role="note"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "var(--zk-space-8)",
            padding: "var(--zk-space-10) var(--zk-space-12)",
            borderRadius: "var(--zk-radius-md)",
            background: "var(--zk-gold-tint)",
            color: "var(--zk-gold)",
            font: "var(--zk-type-caption)",
          }}
        >
          <span style={{ flex: "none", marginTop: 1 }}>
            <Icon icon="eye" size={14} />
          </span>
          Transparent address: the payout will be public. A shielded address (u1…) keeps it private.
        </div>
      )}
    </div>
  );

  const msgNote =
    message.length >= MESSAGE_MAX - 20
      ? `Shown on the stash card. Your handle stays hidden. ${message.length}/${MESSAGE_MAX}`
      : "Shown on the stash card. Your handle stays hidden.";

  return (
    <main className="zk-screen" style={{ background: "var(--zk-bg)", gap: "var(--zk-space-14)" }}>
      <div
        style={{
          alignSelf: "flex-start",
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--zk-space-8)",
          padding: "var(--zk-space-8) var(--zk-space-14)",
          borderRadius: "var(--zk-radius-lg)",
          background: "var(--zk-gold-tint)",
          border: "1px solid rgb(var(--zk-gold-rgb) / .35)",
          font: "var(--zk-type-mono-sm)",
          color: "var(--zk-gold)",
        }}
      >
        <Icon icon="unlock" size={15} stroke={2.4} />
        {formatZec(win.amountZat)} ZEC · ~{formatUsd(win.usd)}
      </div>
      <h1 id="zk-claim-title" style={{ margin: 0, font: "var(--zk-type-h1)", letterSpacing: "-.01em" }}>
        Where should we send it?
      </h1>

      <div role="radiogroup" aria-labelledby="zk-claim-title" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
        <div onClick={() => pick("wallet")} style={radioCard(isWallet, "var(--zk-gold)")}>
          <div role="radio" aria-checked={isWallet} tabIndex={isWallet ? 0 : -1} onKeyDown={radioKeys("wallet")} style={radioHead}>
            <div style={tileStyle("var(--zk-grad-tile-gold)", "var(--zk-gold-deep)", "var(--zk-gold-ink)")}>
              <Icon icon="wallet" size={22} stroke={2.4} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={cardTitle}>I have a Zcash wallet</div>
              <div style={cardSub}>Paste a shielded address</div>
            </div>
            <span aria-hidden="true" style={radioDot(isWallet, "var(--zk-gold)")} />
          </div>
          {isWallet && addressRow}
        </div>

        <div onClick={() => pick("new")} style={radioCard(!isWallet, "var(--zk-mint)")}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              right: "var(--zk-space-14)",
              top: -11,
              transform: "rotate(4deg)",
              padding: "var(--zk-space-4) var(--zk-space-8)",
              borderRadius: "var(--zk-radius-sm)",
              background: "var(--zk-mint)",
              color: "var(--zk-mint-ink)",
              font: "var(--zk-type-label)",
              letterSpacing: "var(--zk-track-badge)",
            }}
          >
            NEW TO CRYPTO?
          </div>
          <div role="radio" aria-checked={!isWallet} tabIndex={isWallet ? -1 : 0} onKeyDown={radioKeys("new")} style={radioHead}>
            <div style={tileStyle("var(--zk-grad-tile-mint)", "var(--zk-mint-deep)", "var(--zk-mint-ink)")}>
              <Icon icon="bolt" size={22} stroke={2.4} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={cardTitle}>Get a wallet in 60 seconds</div>
              <div style={cardSub}>Your first ZEC, your own keys</div>
            </div>
            <span aria-hidden="true" style={radioDot(!isWallet, "var(--zk-mint)")} />
          </div>
          {!isWallet && (
            <>
              <ol
                style={{
                  margin: 0,
                  padding: "var(--zk-space-12)",
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--zk-space-8)",
                  background: "var(--zk-surface-raised)",
                  borderRadius: "var(--zk-radius-lg)",
                }}
              >
                <li style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)", font: "var(--zk-type-small)" }}>
                  <span style={stepNum}>1</span>
                  <span>
                    Download a private Zcash wallet:{" "}
                    {WALLETS.map((w, i) => (
                      <span key={w.name}>
                        {i > 0 && " or "}
                        <a href={w.href} target="_blank" rel="noopener noreferrer" style={walletLink} onClick={(e) => e.stopPropagation()}>
                          {w.name}
                        </a>
                      </span>
                    ))}
                  </span>
                </li>
                <li style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)", font: "var(--zk-type-small)" }}>
                  <span style={stepNum}>2</span>
                  Tap Receive, copy your address
                </li>
                <li style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)", font: "var(--zk-type-small)" }}>
                  <span style={stepNum}>3</span>
                  Paste it here. Done.
                </li>
              </ol>
              {addressRow}
            </>
          )}
        </div>
      </div>

      <Input
        label="Leave a victory message"
        value={message}
        onChange={(v) => setMessage(v.slice(0, MESSAGE_MAX))}
        placeholder="Say something to the hider…"
        size="md"
        maxLength={MESSAGE_MAX}
        message={msgNote}
      />

      <div style={{ marginTop: "auto", paddingTop: "var(--zk-space-8)", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)", alignItems: "center" }}>
        {error && (
          <span role="alert" style={{ font: "var(--zk-type-small)", color: "var(--zk-red)", textAlign: "center" }}>
            {error}
          </span>
        )}
        <Button label={busy ? "Sending…" : "Send it to me"} variant="primary" size="lg" disabled={!valid || busy} onClick={() => void send()} />
        <span style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-medium)", color: "var(--zk-text-muted)" }}>
          Your prize waits in the vault for 7 days.
        </span>
      </div>
    </main>
  );
}

export default Claim;
