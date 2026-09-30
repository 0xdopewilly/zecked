import type { Metadata } from "next";
import { Button, Vault } from "@/components/zk";

export const metadata: Metadata = { title: "Not found · ZECKED" };

// Any unknown link (an old share link, a typo): stay on brand and get people back to the stashes.
export default function NotFound() {
  return (
    <main className="zk-screen" style={{ background: "var(--zk-bg-hero-purple)", justifyContent: "center", gap: "var(--zk-space-20)", textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Vault mode="closed" size={150} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
        <h1 style={{ margin: 0, font: "var(--zk-type-h1)" }}>Nothing hidden here</h1>
        <p style={{ margin: 0, font: "var(--zk-type-body-lg)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
          This link doesn’t open anything. The stash may have moved, or the link got cut off.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
        <Button label="Find a stash to crack" iconRight="arrowRight" variant="primary" size="lg" href="/feed" />
        <Button label="Hide one yourself" variant="ghost" size="md" href="/hide" />
      </div>
    </main>
  );
}
