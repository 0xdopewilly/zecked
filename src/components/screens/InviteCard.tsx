"use client";
// "Invite friends, get $1 each": your invite link with one-tap sharing (WhatsApp, X, Telegram, the
// phone's share sheet, copy), and how it's going. Guests get a sign-up nudge instead (links are for accounts).
import { useEffect, useState, type CSSProperties } from "react";
import { api, formatZec } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { Button, Icon } from "@/components/zk";

type Invite = Awaited<ReturnType<typeof api.myInvite>>;

const card: CSSProperties = {
  borderRadius: "var(--zk-radius-2xl)",
  padding: "var(--zk-space-16)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--zk-space-12)",
  background:
    "radial-gradient(90% 120% at 100% 0%, rgb(var(--zk-pink-rgb) / .22), transparent 60%), linear-gradient(160deg, var(--zk-surface-purple), var(--zk-surface))",
  border: "2.5px solid var(--zk-ink)",
  boxShadow: "inset 0 1.5px 0 rgb(var(--zk-white-rgb) / .08), 0 4px 0 var(--zk-ink)",
};

const shareBtn: CSSProperties = { padding: "0 var(--zk-space-6)" };

export function InviteCard({ signedIn }: { signedIn: boolean }) {
  const [inv, setInv] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    api
      .myInvite()
      .then((v) => alive && setInv(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const reward = inv?.rewardUsd ?? 1;
  const head = (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
      <span
        aria-hidden="true"
        style={{
          width: 44,
          height: 44,
          flex: "none",
          borderRadius: "var(--zk-radius-md)",
          background: "var(--zk-pink)",
          border: "2px solid var(--zk-ink)",
          boxShadow: "0 3px 0 var(--zk-ink)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--zk-text)",
        }}
      >
        <Icon icon="sparkle" size={22} stroke={2.6} />
      </span>
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: 0, font: "var(--zk-type-h3)" }}>Invite friends, get ${reward} each</h2>
        <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: 2 }}>
          When a friend joins with your link and plays, you get ${reward} of test ZEC.
        </div>
      </div>
    </div>
  );

  if (!signedIn) {
    return (
      <section aria-label="Invite friends" style={card}>
        {head}
        <Button label="Sign up to get your link" variant="primary" size="md" href="/signin?next=/me" />
      </section>
    );
  }

  const url = inv?.url ?? "";
  const text = "Come play ZECKED with me: riddles with ZEC inside, first to crack it keeps it 🔐 Join with my link and get free test ZEC to play:";
  const enc = encodeURIComponent;
  const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      sfx("success");
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  const more = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "ZECKED", text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    void copy();
  };

  return (
    <section aria-label="Invite friends" style={card}>
      {head}
      <button
        type="button"
        onClick={() => void copy()}
        disabled={!url}
        aria-label={copied ? "Link copied" : "Copy your invite link"}
        style={{
          height: 48,
          borderRadius: "var(--zk-radius-lg)",
          border: "2px solid var(--zk-ink)",
          background: "rgb(var(--zk-bg-rgb) / .6)",
          color: "var(--zk-text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--zk-space-10)",
          padding: "0 var(--zk-space-8) 0 var(--zk-space-14)",
          font: "var(--zk-fw-bold) var(--zk-fs-14)/1 var(--zk-font-mono)",
          cursor: url ? "pointer" : "default",
        }}
      >
        <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {url ? url.replace(/^https?:\/\//, "") : "Making your link…"}
        </span>
        <span
          style={{
            flex: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 34,
            padding: "0 var(--zk-space-12)",
            borderRadius: "var(--zk-radius-md)",
            background: copied ? "var(--zk-mint)" : "var(--zk-gold)",
            color: copied ? "var(--zk-mint-ink)" : "var(--zk-gold-ink)",
            font: "var(--zk-type-btn-sm)",
          }}
        >
          <Icon icon={copied ? "check" : "copy"} size={15} stroke={2.8} />
          {copied ? "Copied" : "Copy"}
        </span>
      </button>
      <div className="zk-invite-share">
        <Button label="WhatsApp" variant="success" size="sm" style={shareBtn} disabled={!url} onClick={() => open(`https://wa.me/?text=${enc(`${text} ${url}`)}`)} />
        <Button label="X" variant="light" size="sm" style={shareBtn} disabled={!url} onClick={() => open(`https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`)} />
        <Button label="Telegram" variant="sky" size="sm" style={shareBtn} disabled={!url} onClick={() => open(`https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`)} />
        <Button label="More" icon="share" variant="ghost" size="sm" style={shareBtn} disabled={!url} onClick={() => void more()} />
      </div>
      {inv && (inv.joined > 0 || inv.earnedZat > 0) ? (
        <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
          <b style={{ color: "var(--zk-text)" }}>{inv.joined}</b> joined · <b style={{ color: "var(--zk-text)" }}>{inv.rewarded}</b> played ·{" "}
          <b style={{ color: "var(--zk-gold)" }}>+{formatZec(inv.earnedZat)} test ZEC</b> earned
        </div>
      ) : null}
    </section>
  );
}
