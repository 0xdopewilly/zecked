"use client";
// Claim screen. Wins go straight into the winner's in-app ZECKED wallet, so this is no longer a
// "where should we send it?" form:
//  · credited (signed-in winner): 08b-style "It's in your ZECKED wallet." + optional victory message,
//    "Withdraw to my own wallet", "Share my win", "Back to stashes".
//  · guest winner: the prize is waiting; sign up (email code) to keep it.
import { useState, type CSSProperties, type ReactNode } from "react";
import { api, formatUsd, formatZec } from "@/lib/api";
import { Badge, Button, Icon, Input, Vault } from "@/components/zk";

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
}

const MESSAGE_MAX = 80;
const MESSAGE_NOTE = "Shown on the stash card. Your handle stays hidden.";
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

function Hero({ rgb, children }: { rgb: string; children: ReactNode }) {
  return (
    <div style={{ alignSelf: "center", position: "relative", width: 140, height: 140, flex: "none" }}>
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
      Test mode: play ZEC on a test network.
    </p>
  );
}

/* ---------- victory message ---------- */

function VictoryMessage({ id, initial }: { id: string; initial: string }) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  const [shake, setShake] = useState(0);

  const clean = draft.trim().slice(0, MESSAGE_MAX);
  const dirty = clean !== saved;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setError("");
    try {
      await api.victory(id, clean);
      setSaved(clean);
      setDraft(clean);
      setJustSaved(true);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn’t save that. Try again.");
      setShake((n) => n + 1);
    } finally {
      setSaving(false);
    }
  };

  const count = draft.length >= MESSAGE_MAX - 20 ? ` ${draft.length}/${MESSAGE_MAX}` : "";
  const message = error
    ? error
    : justSaved && !dirty
      ? clean
        ? "Saved. It’s on the stash card now."
        : "Removed from the stash card."
      : MESSAGE_NOTE + count;

  return (
    <Input
      label="Leave a victory message"
      value={draft}
      onChange={(v) => {
        setDraft(v.slice(0, MESSAGE_MAX));
        setJustSaved(false);
        if (error) setError("");
      }}
      onEnter={() => void save()}
      placeholder="Say something to the hider…"
      size="md"
      maxLength={MESSAGE_MAX}
      state={error ? "error" : justSaved && !dirty && clean ? "success" : "default"}
      message={message}
      shake={shake}
      trailing={
        <Button
          label={saving ? "Saving…" : !dirty && saved ? "Saved" : "Save"}
          icon={!dirty && saved && !saving ? "check" : undefined}
          variant="secondary"
          size="sm"
          full={false}
          disabled={!dirty || saving}
          onClick={() => void save()}
        />
      }
    />
  );
}

/* ---------- component ---------- */

export function Claim({ id, amountZat, usd, credited, testMode, victoryMessage }: ClaimProps) {
  const amount = `${formatZec(amountZat)} ZEC · ~${formatUsd(usd)}`;

  /* ---------- guest winner: sign up to keep it ---------- */

  if (!credited) {
    const signUpHref = `/signin?next=${encodeURIComponent(`/s/${id}/claim`)}&reason=win`;
    return (
      <main
        className="zk-screen"
        style={{
          background: "var(--zk-bg-hero-gold)",
          gap: "var(--zk-space-14)",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + var(--zk-space-40))",
        }}
      >
        <Hero rgb="--zk-gold-rgb">
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
          <h1 style={{ margin: 0, font: "var(--zk-type-h1)", letterSpacing: "-.01em" }}>You cracked it. Now keep it.</h1>
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

  const shareWin = () => {
    const text = `I just ZECKED ${formatZec(amountZat)} ZEC on @PlayZecked 🔓 Nobody knows it was me.`;
    const url = `${window.location.origin}/s/${id}`;
    window.open(
      `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      "_blank",
      "noopener,noreferrer",
    );
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
        paddingTop: "calc(env(safe-area-inset-top, 0px) + var(--zk-space-40))",
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
      <VictoryMessage id={id} initial={victoryMessage ?? ""} />
      <div style={{ marginTop: "auto", paddingTop: "var(--zk-space-8)", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
        <Button label="Withdraw to my own wallet" variant="primary" size="lg" href="/wallet?action=withdraw" style={LONG_LABEL} />
        <Button label="Share my win" icon="share" variant="secondary" size="md" onClick={shareWin} />
        <Button label="Back to stashes" variant="ghost" size="md" href="/feed" />
      </div>
    </main>
  );
}

export default Claim;
