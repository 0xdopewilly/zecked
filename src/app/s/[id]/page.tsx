"use client";
// Stash route: loads the stash and shows the riddle or prediction screen. A correct answer / call
// opens the Win moment overlay. A win you made earlier shows a gold banner: signed in → "It's in your
// wallet" (/wallet); guest → "Sign up to keep it" (/signin?reason=win, back here after).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { readyStash, takeStash } from "@/lib/stashCache";
import { StashSkeleton } from "./StashSkeleton";
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
  // Tapped from the feed, the stash has usually arrived already: draw it on the very first frame, so the
  // screen that slides in is the real one (no skeleton swapped out mid-slide).
  const [first] = useState(() => (id ? readyStash(id) : null));
  const [load, setLoad] = useState<Load>(() => (first ? { kind: "ready", data: first } : { kind: "loading" }));
  const [win, setWin] = useState<WinPayload | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  // One request per visit, even when effects run twice (dev StrictMode) and would take the cache twice.
  const pending = useRef<ReturnType<typeof takeStash> | null>(null);

  const fetchStash = useCallback(async (retry = false) => {
    if (!id) return;
    setLoad({ kind: "loading" });
    try {
      // The feed card started this request on touch, so it's usually already here.
      const data = retry ? await api.stash(id) : await (pending.current ??= takeStash(id));
      setLoad({ kind: "ready", data });
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      if (/not found|404/i.test(message)) setLoad({ kind: "missing" });
      else setLoad({ kind: "error", message: message || "Couldn’t load this stash." });
    }
  }, [id]);

  useEffect(() => {
    // Already drawn from the warm read: just hand it over (that also counts the view), nothing to redraw.
    if (first) void (pending.current ??= takeStash(id)).catch(() => {});
    else void fetchStash();
  }, [fetchStash, first, id]);


  // Only used for the banner copy on a match you won; a failure just means "treat as guest".
  const wonIt = load.kind === "ready" && load.data.stash.status === "zecked" && !!load.data.stash.result?.winnerIsYou;
  useEffect(() => {
    if (!wonIt) return;
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
  }, [wonIt]);

  const handleWin = useCallback((w: WinPayload) => setWin(w), []);

  if (load.kind === "loading") return <StashSkeleton />;

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
          {!missing && <Button label="Try again" variant="primary" size="lg" onClick={() => void fetchStash(true)} />}
          <Button label="Find another stash" variant={missing ? "primary" : "ghost"} size={missing ? "lg" : "md"} href="/feed" />
        </div>
      </main>
    );
  }

  const { data } = load;
  // `win` comes back only while a win is unsettled (a guest's); once credited, the server settles it
  // and only `result.winnerIsYou` remains.
  const wonHere = data.stash.status === "zecked" && !!data.stash.result?.winnerIsYou;
  // Riddles show their own won state (with Share); only prediction screens need the floating banner.
  const banner: "wallet" | "signup" | null = win || data.stash.type === "riddle"
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
        // A floating pill over the screen (not above it), so the screen's own buttons stay in view.
        <Link
          href={bannerHref}
          style={{
            position: "fixed",
            left: "var(--zk-col-x)",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 112px)",
            transform: "translateX(-50%)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            gap: "var(--zk-space-8)",
            maxWidth: "calc(min(var(--zk-col-w), 430px) - 2 * var(--zk-screen-pad))",
            padding: "var(--zk-space-10) var(--zk-space-16)",
            borderRadius: 999,
            background: "var(--zk-grad-gold)",
            color: "var(--zk-gold-ink)",
            font: "var(--zk-type-body-strong)",
            fontSize: "var(--zk-fs-15)",
            whiteSpace: "nowrap",
            textDecoration: "none",
            boxShadow: "0 4px 0 var(--zk-gold-deep), 0 16px 40px rgb(0 0 0 / .45)",
            animation: "zk-pop var(--zk-dur-pop) var(--zk-ease-spring) both",
          }}
        >
          <Icon icon={banner === "wallet" ? "wallet" : "unlock"} size={18} stroke={2.4} />
          <span>{banner === "wallet" ? "You zecked this! It’s in your wallet" : "You zecked this! Sign up to keep it"}</span>
          <Icon icon="arrowRight" size={18} stroke={2.4} />
        </Link>
      )}
      {data.stash.type === "riddle" ? (
        <RiddleStash key={data.stash.id} data={data} onWin={handleWin} />
      ) : (
        <PredictionStash key={data.stash.id} initial={data} onWin={handleWin} />
      )}
      {win && <WinMoment win={win} kind={data.stash.type} />}
    </>
  );
}
