"use client";
// Claim route. The state comes from api.me() (signed in?) and api.stash(id):
//  · signed-in winner → the win is already in their ZECKED wallet (the server credits it and stops sending `win`)
//  · guest winner     → `win` is present with credited:false → sign up to keep it
//  · anyone else      → "Nothing to claim here"
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Icon } from "@/components/zk";
import Claim, { type ClaimProps } from "@/components/screens/Claim";
import { friendlyError } from "@/components/screens/WinMoment";

type Load =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "ready"; props: Omit<ClaimProps, "id"> };

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

  const fetchState = useCallback(async (alive: () => boolean) => {
    if (!id) return;
    setLoad({ kind: "loading" });
    const [me, detail] = await Promise.allSettled([api.me(), api.stash(id)]);
    if (!alive()) return;
    if (detail.status === "rejected") {
      const err = detail.reason as { status?: number; message?: string } | undefined;
      if (err?.status === 404) setLoad({ kind: "none" });
      else setLoad({ kind: "error", message: friendlyError(detail.reason, "Couldn’t load this stash.") });
      return;
    }
    const { stash, win } = detail.value;
    const signedIn = me.status === "fulfilled" && !!me.value.player.account?.signedIn;
    const wonHere = stash.status === "zecked" && !!stash.result?.winnerIsYou;

    let credited: boolean;
    if (win) credited = win.credited; // unsettled win: credited is false for guests
    else if (wonHere && signedIn) credited = true; // settled into the ZECKED wallet
    else {
      setLoad({ kind: "none" });
      return;
    }
    setLoad({
      kind: "ready",
      props: {
        amountZat: win?.amountZat ?? stash.amountZat,
        usd: win?.usd ?? stash.usd,
        credited,
        testMode: stash.testMode,
        victoryMessage: stash.result?.victoryMessage,
        kind: stash.type,
      },
    });
  }, [id]);

  useEffect(() => {
    let alive = true;
    void fetchState(() => alive);
    return () => {
      alive = false;
    };
  }, [fetchState]);

  if (load.kind === "ready") return <Claim id={id} {...load.props} />;

  const loading = load.kind === "loading";
  return (
    <main className="zk-screen" style={{ background: "var(--zk-bg)" }} aria-busy={loading}>
      <div style={center}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "var(--zk-radius-2xl)",
            background: "var(--zk-surface)",
            color: loading ? "var(--zk-gold)" : "var(--zk-text-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: loading ? "zk-glow 1.4s ease-in-out infinite" : undefined,
          }}
        >
          <Icon icon={load.kind === "error" ? "signal" : "vault"} size={34} stroke={2.2} />
        </div>
        {loading ? (
          <p style={{ margin: 0, font: "var(--zk-type-body-strong)", color: "var(--zk-text-muted)" }}>Loading…</p>
        ) : load.kind === "error" ? (
          <>
            <h1 style={{ margin: 0, font: "var(--zk-type-h2)" }}>Couldn’t load this stash</h1>
            <p style={{ margin: 0, font: "var(--zk-type-body)", color: "var(--zk-text-muted)", maxWidth: 300 }}>{load.message}</p>
          </>
        ) : (
          <h1 style={{ margin: 0, font: "var(--zk-type-h2)" }}>Nothing to claim here</h1>
        )}
      </div>
      {!loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
          {load.kind === "error" && <Button label="Try again" variant="primary" size="lg" onClick={() => void fetchState(() => true)} />}
          <Button
            label="Back to stashes"
            variant={load.kind === "error" ? "ghost" : "primary"}
            size={load.kind === "error" ? "md" : "lg"}
            href="/feed"
          />
        </div>
      )}
    </main>
  );
}
