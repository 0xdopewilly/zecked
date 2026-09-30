"use client";
import { useEffect } from "react";
import { Button, Icon } from "@/components/zk";

// A screen crashed: say so kindly, offer a retry, and keep the way home open.
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="zk-screen" style={{ background: "var(--zk-bg-hero-purple)", justifyContent: "center", gap: "var(--zk-space-20)", textAlign: "center" }}>
      <div
        style={{
          width: 72,
          height: 72,
          margin: "0 auto",
          borderRadius: "var(--zk-radius-2xl)",
          background: "var(--zk-surface)",
          color: "var(--zk-gold)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon icon="bolt" size={34} stroke={2.2} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
        <h1 style={{ margin: 0, font: "var(--zk-type-h1)" }}>That didn’t load</h1>
        <p style={{ margin: 0, font: "var(--zk-type-body-lg)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
          Something tripped on our side. Your ZEC and progress are safe.
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
        <Button label="Try again" variant="primary" size="lg" onClick={reset} />
        <Button label="Back to stashes" variant="ghost" size="md" href="/feed" />
      </div>
    </main>
  );
}
