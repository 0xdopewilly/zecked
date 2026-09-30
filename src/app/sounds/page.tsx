"use client";
// Sound board: hear every ZECKED sound (tap a tile). The global <Sfx /> plays whatever data-sfx says.
import { useEffect, useState } from "react";
import { Icon, Logo } from "@/components/zk";
import { useAppBack } from "@/lib/nav";
import { isMuted, setMuted, type Sound } from "@/lib/sfx";

const TILES: { sound: Sound; label: string; when: string; bg: string; ink: string; edge: string }[] = [
  { sound: "tap", label: "Tap", when: "Tabs and chips. Tap fast to climb the combo!", bg: "var(--zk-sky)", ink: "var(--zk-sky-ink)", edge: "var(--zk-sky-deep)" },
  { sound: "pop", label: "Pop", when: "Every button", bg: "var(--zk-gold)", ink: "var(--zk-gold-ink)", edge: "var(--zk-gold-deep)" },
  { sound: "select", label: "Select", when: "Picking an option", bg: "var(--zk-mint)", ink: "var(--zk-mint-ink)", edge: "var(--zk-mint-deep)" },
  { sound: "type", label: "Type", when: "A letter or digit going in", bg: "var(--zk-surface-raised)", ink: "var(--zk-text)", edge: "var(--zk-border-strong)" },
  { sound: "success", label: "Success", when: "Saved, sealed, funded", bg: "var(--zk-mint)", ink: "var(--zk-mint-ink)", edge: "var(--zk-mint-deep)" },
  { sound: "lock", label: "Lock", when: "A match call sealed", bg: "var(--zk-purple)", ink: "#fff", edge: "var(--zk-purple-deep)" },
  { sound: "wrong", label: "Wrong", when: "A wrong guess", bg: "var(--zk-pink)", ink: "#fff", edge: "var(--zk-pink-deep)" },
  { sound: "error", label: "Oops", when: "Something didn't work", bg: "var(--zk-red)", ink: "#fff", edge: "var(--zk-red-deep)" },
  { sound: "coin", label: "Coin", when: "ZEC landed", bg: "var(--zk-gold)", ink: "var(--zk-gold-ink)", edge: "var(--zk-gold-deep)" },
  { sound: "notify", label: "Ping", when: "A live notice", bg: "var(--zk-sky)", ink: "var(--zk-sky-ink)", edge: "var(--zk-sky-deep)" },
  { sound: "whoosh", label: "Whoosh", when: "Big moves", bg: "var(--zk-purple)", ink: "#fff", edge: "var(--zk-purple-deep)" },
  { sound: "confetti", label: "Confetti", when: "Party time", bg: "var(--zk-pink)", ink: "#fff", edge: "var(--zk-pink-deep)" },
];

export default function SoundsPage() {
  const back = useAppBack("/me");
  const [muted, setM] = useState(false);
  useEffect(() => setM(isMuted()), []);
  return (
    <main className="zk-screen" style={{ background: "var(--zk-bg-hero-purple)", gap: "var(--zk-space-16)" }}>
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" aria-label="Back" onClick={back} style={{ width: 44, height: 44, borderRadius: "var(--zk-radius-lg)", background: "var(--zk-surface)", border: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Icon icon="back" size={22} stroke={2.4} />
        </button>
        <Logo variant="wordmark" size={24} />
        <span style={{ width: 44 }} />
      </nav>
      <div>
        <h1 style={{ margin: 0, font: "var(--zk-type-h1)" }}>Sound board</h1>
        <p style={{ margin: "var(--zk-space-6) 0 0", font: "var(--zk-type-body)", color: "var(--zk-text-muted)" }}>
          Every sound in ZECKED. Tap a tile to hear it{muted ? " (sounds are off: switch them on below)" : ""}.
        </p>
      </div>
      <button
        type="button"
        data-sfx="win"
        style={{ minHeight: 88, borderRadius: "var(--zk-radius-2xl)", border: 0, cursor: "pointer", background: "var(--zk-grad-gold)", color: "var(--zk-gold-ink)", boxShadow: "0 6px 0 var(--zk-gold-deep)", font: "var(--zk-type-h2)", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}
      >
        <Icon icon="trophy" size={28} stroke={2.6} /> YOU ZECKED IT!
      </button>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "var(--zk-space-12)" }}>
        {TILES.map((t) => (
          <button
            key={t.sound}
            type="button"
            data-sfx={t.sound}
            style={{ minHeight: 92, padding: "var(--zk-space-12)", borderRadius: "var(--zk-radius-xl)", border: 0, cursor: "pointer", textAlign: "left", background: t.bg, color: t.ink, boxShadow: `0 5px 0 ${t.edge}`, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 6 }}
          >
            <span style={{ font: "var(--zk-type-h3)" }}>{t.label}</span>
            <span style={{ font: "var(--zk-type-caption)", opacity: 0.85 }}>{t.when}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          setMuted(!muted);
          setM(!muted);
        }}
        style={{ minHeight: 52, borderRadius: "var(--zk-radius-xl)", border: "1.5px solid var(--zk-border-strong)", background: "transparent", color: "var(--zk-text)", font: "var(--zk-type-btn-md)", cursor: "pointer" }}
      >
        {muted ? "Turn sounds on" : "Turn sounds off"}
      </button>
    </main>
  );
}
