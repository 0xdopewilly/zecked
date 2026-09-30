"use client";
// Claim screen. Wins go straight into the winner's in-app ZECKED wallet, so this is no longer a
// "where should we send it?" form:
//  · credited (signed-in winner): 08b-style "It's in your ZECKED wallet." + optional note for the hider,
//    "Withdraw to my own wallet", "Share my win", "Back to stashes".
//  · guest winner: the prize is waiting; sign up (email code) to keep it.
// The win overlay (WinMoment) now carries the note and Share too; this route stays for links and revisits.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { formatUsd, formatZec } from "@/lib/api";
import type { StashType } from "@/lib/types";
import { Badge, Button, Icon, Vault } from "@/components/zk";
import { TopToast, VictoryNote, shareLink, winShareText } from "@/components/screens/WinMoment";

export interface ClaimProps {
  /** Stash id. */
  id: string;
  amountZat: number;
  usd: number;
  /** true: already in the winner's ZECKED wallet. false: a guest won and must sign up to keep it. */
  credited: boolean;
  testMode?: boolean;
  /** Victory message already on the stash card, if any. */
  victoryMessage?: string;
  /** Riddle or prediction: "cracked it" vs "called it". */
  kind?: StashType;
}

/** Long CTA labels keep the big lg button but use the md type size so they never overflow a 360px phone. */
const LONG_LABEL: CSSProperties = { font: "var(--zk-type-btn-md)" };

/* ---------- styles ---------- */

const receiptRow = (last: boolean): CSSProperties => ({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--zk-space-12)",
  padding: "var(--zk-space-10) 0",
  borderBottom: last ? "none" : "1px solid var(--zk-border)",
  font: "var(--zk-type-body)",
});

const ring = (rgb: string, delay: string): CSSProperties => ({
  position: "absolute",
  inset: 0,
  borderRadius: "50%",
  border: `3px solid rgb(var(${rgb}) / .6)`,
  willChange: "transform, opacity",
  animation: `zk-ring 2s var(--zk-ease-out) ${delay} infinite`,
});

/** `shift` nudges the hero right: the open vault's door swings out ~80px to the left, so door + vault read centred. */
function Hero({ rgb, children, shift = 0 }: { rgb: string; children: ReactNode; shift?: number }) {
  return (
    <div style={{ alignSelf: "center", position: "relative", width: 140, height: 140, flex: "none", transform: shift ? `translateX(${shift}px)` : undefined }}>
      <div aria-hidden="true" style={ring(rgb, "0s")} />
      <div aria-hidden="true" style={ring(rgb, "1s")} />
      {children}
    </div>
  );
}

function TestNote() {
  return (
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
      Test mode: this is test ZEC (no real value).
    </p>
  );
}

/* ---------- component ---------- */

export function Claim({ id, amountZat, usd, credited, testMode, victoryMessage, kind }: ClaimProps) {
  const amount = `${formatZec(amountZat)} ZEC · ~${Number.isInteger(usd) ? `$${usd}` : formatUsd(usd)}`;
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /* ---------- guest winner: sign up to keep it ---------- */

  if (!credited) {
    const signUpHref = `/signin?next=${encodeURIComponent(`/s/${id}/claim`)}&reason=win`;
    return (
      <main
        className="zk-screen"
        style={{
          background: "var(--zk-bg-hero-gold)",
          gap: "var(--zk-space-14)",
          paddingTop: "calc(var(--zk-top-inset) + var(--zk-space-40))",
        }}
      >
        <Hero rgb="--zk-gold-rgb" shift={40}>
          <Vault mode="open" size={140} />
        </Hero>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)", textAlign: "center", alignItems: "center", marginTop: "var(--zk-space-8)" }}>
          <div
            style={{
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
            {amount}
          </div>
          <h1 style={{ margin: 0, font: "var(--zk-type-h1)", letterSpacing: "-.01em" }}>
            {kind === "prediction" ? "You called it." : "You cracked it."} Now keep it.
          </h1>
          <p style={{ margin: 0, font: "var(--zk-type-body-lg)", fontWeight: "var(--zk-fw-semibold)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
            Sign up with your email and the ZEC lands in your own ZECKED wallet. Your XP and badges come too.
          </p>
        </div>
        {testMode && <TestNote />}
        <div style={{ marginTop: "auto", paddingTop: "var(--zk-space-8)", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)", alignItems: "center" }}>
          <Button label="Sign up to keep your ZEC" iconRight="arrowRight" variant="primary" size="lg" href={signUpHref} style={LONG_LABEL} />
          <span style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-medium)", color: "var(--zk-text-muted)", textAlign: "center" }}>
            Guests can play. Winners sign up to keep it.
          </span>
          <Button label="Back to stashes" variant="ghost" size="md" href="/feed" />
        </div>
      </main>
    );
  }

  /* ---------- 08b · it's in your ZECKED wallet ---------- */

  // The share sheet (or the link copied): first person, and the winner's handle stays out of it.
  const shareWin = async () => {
    const url = `${window.location.origin}/s/${id}`;
    const r = await shareLink(url, winShareText(amountZat, kind));
    if (r !== "copied" && r !== "failed") return;
    clearTimeout(toastTimer.current);
    setToast((t) => ({ text: r === "copied" ? "Link copied" : url, n: (t?.n ?? 0) + 1 }));
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  const rows: { k: string; v: ReactNode }[] = [
    { k: "Amount", v: <span style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-gold)" }}>{amount}</span> },
    { k: "Sent to", v: <span style={{ font: "var(--zk-type-body-strong)" }}>Your ZECKED wallet</span> },
    {
      k: "Your handle",
      v: (
        <span style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-4)", font: "var(--zk-type-body-strong)", color: "var(--zk-mint)" }}>
          Hidden
          <Icon icon="check" size={16} stroke={3} />
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
        paddingTop: "calc(var(--zk-top-inset) + var(--zk-space-40))",
      }}
    >
      <Hero rgb="--zk-mint-rgb">
        <Badge badge="shielded" size={140} />
      </Hero>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)", textAlign: "center", alignItems: "center", marginTop: "var(--zk-space-8)" }}>
        <h1 style={{ margin: 0, font: "var(--zk-type-h1)", letterSpacing: "-.01em" }}>It’s in your ZECKED wallet.</h1>
        <p style={{ margin: 0, font: "var(--zk-type-body-lg)", fontWeight: "var(--zk-fw-semibold)", color: "var(--zk-text-muted)" }}>
          Nobody can see who won 🥷
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
      {testMode && <TestNote />}
      <VictoryNote id={id} initial={victoryMessage ?? ""} />
      <div style={{ marginTop: "auto", paddingTop: "var(--zk-space-8)", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
        <Button label="Withdraw to my own wallet" variant="primary" size="lg" href="/wallet?action=withdraw" style={LONG_LABEL} />
        <Button label="Share my win" icon="share" variant="secondary" size="md" onClick={() => void shareWin()} />
        <Button label="Back to stashes" variant="ghost" size="md" href="/feed" />
      </div>
      {toast && <TopToast key={toast.n} text={toast.text} variant="success" icon="copy" />}
    </main>
  );
}

export default Claim;
