"use client";
// Claim route: the win payload comes from sessionStorage (set by the Win moment), or else from the API.
import { useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import type { WinPayload } from "@/lib/types";
import { Button, Icon } from "@/components/zk";
import Claim from "@/components/screens/Claim";

type Load = { kind: "loading" } | { kind: "none" } | { kind: "ready"; win: WinPayload };

function readStored(id: string): WinPayload | null {
  try {
    const raw = sessionStorage.getItem(`zk_claim_${id}`);
    if (!raw) return null;
    const w = JSON.parse(raw) as WinPayload;
    if (!w || typeof w.claimToken !== "string" || !w.claimToken) return null;
    if (w.stashId && w.stashId !== id) return null;
    return w;
  } catch {
    return null;
  }
}

const center: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--zk-space-12)",
  textAlign: "center",
};

export default function ClaimPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id ?? "";
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const stored = readStored(id);
    if (stored) {
      setLoad({ kind: "ready", win: stored });
      return;
    }
    api
      .stash(id)
      .then((d) => {
        if (alive) setLoad(d.win ? { kind: "ready", win: d.win } : { kind: "none" });
      })
      .catch(() => {
        if (alive) setLoad({ kind: "none" });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (load.kind === "ready") return <Claim id={id} win={load.win} />;

  return (
    <main className="zk-screen" style={{ background: "var(--zk-bg)" }} aria-busy={load.kind === "loading"}>
      <div style={center}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "var(--zk-radius-2xl)",
            background: "var(--zk-surface)",
            color: load.kind === "loading" ? "var(--zk-gold)" : "var(--zk-text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: load.kind === "loading" ? "zk-glow 1.4s ease-in-out infinite" : undefined,
          }}
        >
          <Icon icon="vault" size={34} stroke={2.2} />
        </div>
        {load.kind === "loading" ? (
          <p style={{ margin: 0, font: "var(--zk-type-body-strong)", color: "var(--zk-text-muted)" }}>Loading…</p>
        ) : (
          <h1 style={{ margin: 0, font: "var(--zk-type-h2)" }}>Nothing to claim here</h1>
        )}
      </div>
      {load.kind === "none" && <Button label="Back to stashes" variant="primary" size="lg" href="/feed" />}
    </main>
  );
}
