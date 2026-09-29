"use client";
// Stash route: loads the stash and shows the riddle or prediction screen. A correct answer / call
// opens the Win moment overlay. A win you made earlier shows a gold banner: signed in → "It's in your
// wallet" (/wallet); guest → "Sign up to keep it" (/signin?reason=win, back here after).
import Link from "next/link";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { WinPayload } from "@/lib/types";
import { Button, Icon } from "@/components/zk";
import RiddleStash from "@/components/screens/RiddleStash";
import { PredictionStash } from "@/components/screens/PredictionStash";
import WinMoment from "@/components/screens/WinMoment";

type StashData = Awaited<ReturnType<typeof api.stash>>;
type Load = { kind: "loading" } | { kind: "ready"; data: StashData } | { kind: "missing" } | { kind: "error"; message: string };

const center: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--zk-space-12)",
  textAlign: "center",
};

const tile: CSSProperties = {
  width: 72,
  height: 72,
  borderRadius: "var(--zk-radius-2xl)",
  background: "var(--zk-surface)",
  color: "var(--zk-text-muted)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export default function StashPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id ?? "";
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [win, setWin] = useState<WinPayload | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  const fetchStash = useCallback(async () => {
    if (!id) return;
    setLoad({ kind: "loading" });
    try {
      const data = await api.stash(id);
      setLoad({ kind: "ready", data });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/not found|404/i.test(message)) setLoad({ kind: "missing" });
      else setLoad({ kind: "error", message: message || "Couldn’t load this stash." });
    }
  }, [id]);

  useEffect(() => {
    void fetchStash();
  }, [fetchStash]);

  useEffect(() => {
    if (id) router.prefetch(`/s/${id}/claim`);
  }, [id, router]);

  // Only used for the banner copy; a failure just means "treat as guest".
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then(({ player }) => {
        if (alive) setSignedIn(!!player.account?.signedIn);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const handleWin = useCallback((w: WinPayload) => setWin(w), []);

  if (load.kind === "loading") {
    return (
      <main className="zk-screen" style={{ background: "var(--zk-bg-hero-purple)" }} aria-busy="true">
        <div style={center}>
          <div style={{ ...tile, color: "var(--zk-gold)", animation: "zk-glow 1.4s ease-in-out infinite" }}>
            <Icon icon="vault" size={34} stroke={2.2} />
          </div>
          <p style={{ margin: 0, font: "var(--zk-type-body-strong)", color: "var(--zk-text-muted)" }}>Loading stash…</p>
        </div>
      </main>
    );
  }

  if (load.kind === "missing" || load.kind === "error") {
    const missing = load.kind === "missing";
    return (
      <main className="zk-screen" style={{ background: "var(--zk-bg-hero-purple)" }}>
        <div style={center}>
          <div style={tile}>
            <Icon icon={missing ? "search" : "signal"} size={34} stroke={2.2} />
          </div>
          <h1 style={{ margin: 0, font: "var(--zk-type-h2)" }}>{missing ? "Stash not found" : "Couldn’t load this stash"}</h1>
          <p style={{ margin: 0, font: "var(--zk-type-body)", color: "var(--zk-text-muted)", maxWidth: 300 }}>
            {missing ? "This link doesn’t match any stash. Check it and try again." : load.message}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
          {!missing && <Button label="Try again" variant="primary" size="lg" onClick={() => void fetchStash()} />}
          <Button label="Find another stash" variant={missing ? "primary" : "ghost"} size={missing ? "lg" : "md"} href="/feed" />
        </div>
      </main>
    );
  }

  const { data } = load;
  // `win` comes back only while a win is unsettled (a guest's); once credited, the server settles it
  // and only `result.winnerIsYou` remains.
  const wonHere = data.stash.status === "zecked" && !!data.stash.result?.winnerIsYou;
  const banner: "wallet" | "signup" | null = win
    ? null
    : data.win
      ? data.win.credited
        ? "wallet"
        : "signup"
      : wonHere && signedIn
        ? "wallet"
        : null;
  const bannerHref = banner === "wallet" ? "/wallet" : `/signin?next=${encodeURIComponent(`/s/${id}`)}&reason=win`;

  return (
    <>
      {banner && (
        <Link
          href={bannerHref}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-10)",
            padding: "calc(env(safe-area-inset-top, 0px) + var(--zk-space-12)) var(--zk-screen-pad) var(--zk-space-12)",
            background: "var(--zk-grad-gold)",
            color: "var(--zk-gold-ink)",
            font: "var(--zk-type-body-strong)",
            fontSize: "var(--zk-fs-15)",
            boxShadow: "0 4px 0 var(--zk-gold-deep)",
          }}
        >
          <Icon icon={banner === "wallet" ? "wallet" : "unlock"} size={18} stroke={2.4} />
          <span style={{ flex: 1 }}>{banner === "wallet" ? "You zecked this! It’s in your wallet" : "You zecked this! Sign up to keep it"}</span>
          <Icon icon="arrowRight" size={18} stroke={2.4} />
        </Link>
      )}
      {data.stash.type === "riddle" ? (
        <RiddleStash key={data.stash.id} data={data} onWin={handleWin} />
      ) : (
        <PredictionStash key={data.stash.id} initial={data} onWin={handleWin} />
      )}
      {win && <WinMoment win={win} />}
    </>
  );
}
