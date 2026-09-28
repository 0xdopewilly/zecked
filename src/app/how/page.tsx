"use client";
// How it works + rules. Same visual language as the app screens: h1, surface cards, 3D tiles, info chips.
import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { Button, Chip, Icon, LiveBadge, Logo } from "@/components/zk";

const STEPS: { icon: string; grad: string; edge: string; ink?: string; title: string; text: ReactNode }[] = [
  {
    icon: "lock",
    grad: "var(--zk-grad-tile-purple)",
    edge: "var(--zk-purple-shade)",
    title: "Hide a stash",
    text: "Tuck some ZEC behind a riddle, or behind a call on a real match. You pick the prize and the clock.",
  },
  {
    icon: "share",
    grad: "var(--zk-grad-tile-sky)",
    edge: "var(--zk-sky-shade)",
    title: "Share it",
    text: "Every stash gets a link and a card for X and Telegram. Drop it in the group chat.",
  },
  {
    icon: "unlock",
    grad: "var(--zk-grad-tile-gold)",
    edge: "var(--zk-gold-deep)",
    ink: "var(--zk-gold-ink)",
    title: "First one wins",
    text: "First to crack the riddle, or first to call the match right, takes the lot.",
  },
  {
    icon: "shieldCheck",
    grad: "var(--zk-grad-tile-mint)",
    edge: "var(--zk-mint-deep)",
    ink: "var(--zk-mint-ink)",
    title: "It lands shielded",
    text: "The ZEC goes straight to the winner’s private wallet. Nobody can see who won 🥷",
  },
];

const RULES: { icon: string; color: string; text: ReactNode; callout?: boolean }[] = [
  {
    icon: "sparkle",
    color: "var(--zk-gold)",
    text: (
      <>
        <b>Free to play, no purchase necessary.</b> Players never pay to enter. Hiders fund the prizes.
      </>
    ),
  },
  { icon: "medal", color: "var(--zk-gold)", text: <><b>First correct answer or call wins.</b> The server clock decides who was first.</> },
  { icon: "key", color: "var(--zk-pink)", text: "Riddles give you 3 tries per 10 minutes. No brute-forcing the dictionary." },
  { icon: "lock", color: "var(--zk-sky)", text: "Predictions lock at kickoff and stay sealed until then." },
  { icon: "signal", color: "var(--zk-sky)", text: "Match results come from a live sports feed." },
  {
    icon: "vault",
    color: "var(--zk-purple-light)",
    text: "Nobody cracked it before expiry? The stash goes back to the hider. A postponed or abandoned match sends it back too.",
  },
  { icon: "clock", color: "var(--zk-mint)", text: <><b>Winners have 7 days to claim.</b> Your prize waits in the vault.</> },
  {
    icon: "coin",
    color: "var(--zk-gold)",
    text: "Stashes are capped at $100 while we’re in beta. ZECKED holds each stash until it resolves, then pays out.",
  },
  {
    icon: "info",
    color: "var(--zk-gold)",
    callout: true,
    text: (
      <>
        <b>Test mode:</b> you play with ZEC on a test network, not real money.
      </>
    ),
  },
  { icon: "flag", color: "var(--zk-red)", text: <><b>Be nice.</b> Offensive riddles get removed.</> },
];

const card: CSSProperties = {
  background: "var(--zk-surface)",
  borderRadius: "var(--zk-radius-2xl)",
  border: "1.5px solid var(--zk-border)",
  padding: "var(--zk-space-16)",
};

function Tile({ icon, grad, edge, ink, size = 44 }: { icon: string; grad: string; edge: string; ink?: string; size?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "var(--zk-radius-md)",
        background: grad,
        boxShadow: `var(--zk-inset-gloss), 0 3px 0 ${edge}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: ink ?? "var(--zk-text)",
      }}
    >
      <Icon icon={icon} size={Math.round(size * 0.5)} stroke={2.4} />
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 style={{ margin: "var(--zk-space-10) 0 0", font: "var(--zk-type-h3)" }}>{children}</h2>;
}

export default function HowItWorksPage() {
  const router = useRouter();
  const back = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/");
  };

  return (
    <main className="zk-screen" style={{ background: "var(--zk-bg-hero-purple)" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={back}
            aria-label="Back"
            style={{
              width: 40,
              height: 40,
              border: 0,
              padding: 0,
              borderRadius: "var(--zk-radius-md)",
              background: "var(--zk-surface)",
              color: "var(--zk-text)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Icon icon="back" size={20} stroke={2.6} />
          </button>
          <Logo variant="wordmark" size={22} />
          <div style={{ width: 40 }} />
        </div>

        {/* Title */}
        <div style={{ marginTop: "var(--zk-space-8)", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
          <h1 style={{ margin: 0, font: "var(--zk-type-h1)" }}>
            How it <span style={{ color: "var(--zk-gold)" }}>works</span>
          </h1>
          <p style={{ margin: 0, font: "var(--zk-type-body-lg)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
            Riddles and match calls with real ZEC inside. First one to crack it keeps it.
          </p>
        </div>

        <div style={{ display: "flex", gap: "var(--zk-space-8)", flexWrap: "wrap" }}>
          <Chip variant="info" icon="sparkle" label="Free to play" />
          <Chip variant="info" icon="user" label="No sign-up needed" />
          <Chip variant="info" icon="shield" label="Built on Zcash" />
        </div>

        {/* The loop */}
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
          {STEPS.map((s, i) => (
            <li key={s.title} style={{ ...card, display: "flex", alignItems: "flex-start", gap: "var(--zk-space-14)", position: "relative" }}>
              <div style={{ position: "relative" }}>
                <Tile icon={s.icon} grad={s.grad} edge={s.edge} ink={s.ink} />
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: -6,
                    top: -6,
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "var(--zk-bg)",
                    border: "1.5px solid var(--zk-border-strong)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    font: "var(--zk-type-mono-xs)",
                    color: "var(--zk-gold)",
                  }}
                >
                  {i + 1}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--zk-type-h4)" }}>{s.title}</div>
                <div style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-4)", textWrap: "pretty" }}>
                  {s.text}
                </div>
              </div>
              {i === 2 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    right: "var(--zk-space-14)",
                    top: -10,
                    transform: "rotate(4deg)",
                    padding: "var(--zk-space-4) var(--zk-space-10)",
                    borderRadius: "var(--zk-radius-sm)",
                    background: "var(--zk-pink)",
                    color: "var(--zk-text)",
                    font: "var(--zk-type-label)",
                    letterSpacing: ".06em",
                    boxShadow: "var(--zk-shadow-sticker-pink)",
                  }}
                >
                  FIRST RIGHT ANSWER WINS
                </span>
              )}
            </li>
          ))}
        </ol>

        {/* Why Zcash */}
        <SectionTitle>Why Zcash</SectionTitle>
        <div
          style={{
            ...card,
            background: "linear-gradient(160deg, var(--zk-surface-purple), var(--zk-surface) 70%)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--zk-space-16)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-8)", flexWrap: "wrap" }}>
              <LiveBadge label="Live · verified" size="md" />
              <span style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>by viewing key</span>
            </div>
            <div style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
              Every live stash is checked with a Zcash viewing key.{" "}
              <span style={{ color: "var(--zk-text)" }}>Anyone can check this stash is real. Nobody can touch it.</span>
            </div>
          </div>
          <div style={{ height: 1, background: "var(--zk-border)" }} />
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--zk-space-14)" }}>
            <Tile icon="mask" grad="var(--zk-grad-tile-mint)" edge="var(--zk-mint-deep)" ink="var(--zk-mint-ink)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "var(--zk-type-h4)" }}>Winners stay anonymous</div>
              <div style={{ font: "var(--zk-type-body)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-4)", textWrap: "pretty" }}>
                Prizes are paid shielded. The hider just hears their stash got ZECKED by a mystery cracker.
              </div>
            </div>
          </div>
        </div>

        {/* Rules */}
        <SectionTitle>Rules</SectionTitle>
        <div style={{ ...card, padding: "var(--zk-space-6) var(--zk-space-8)" }}>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column" }}>
            {RULES.map((r, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--zk-space-12)",
                  padding: "var(--zk-space-10) var(--zk-space-8)",
                  borderRadius: "var(--zk-radius-md)",
                  background: r.callout ? "var(--zk-gold-tint)" : "transparent",
                  border: r.callout ? "1px solid rgb(var(--zk-gold-rgb) / .35)" : "1px solid transparent",
                  margin: r.callout ? "var(--zk-space-4) 0" : 0,
                }}
              >
                <span style={{ color: r.color, display: "flex", paddingTop: 1 }}>
                  <Icon icon={r.icon} size={18} stroke={2.4} />
                </span>
                <span style={{ flex: 1, minWidth: 0, font: "var(--zk-type-body)", color: "var(--zk-text)", textWrap: "pretty" }}>
                  {r.text}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* CTA */}
        <div
          style={{
            marginTop: "var(--zk-space-14)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--zk-space-12)",
          }}
        >
          <Button label="Start zecking" variant="primary" size="lg" iconRight="arrowRight" href="/feed" />
          <Button label="Hide a stash" variant="ghost" size="md" icon="plus" href="/hide" />
          <span
            style={{
              marginTop: "var(--zk-space-4)",
              font: "var(--zk-fw-medium) var(--zk-fs-11)/1 var(--zk-font-body)",
              color: "var(--zk-text-faint)",
              letterSpacing: ".04em",
            }}
          >
            Built on Zcash
          </span>
        </div>
      </div>
    </main>
  );
}
