"use client";
// A gift link (/g/<id>). The person it's for sees who sent it, the amount and the note, answers the
// question if it's locked, and opens it: confetti, then "It's in your wallet" (accounts) or "Sign up to
// keep it" (guests: the ZEC waits for them). The sender sees it waiting (with "Take it back"), opened, or
// returned. Quiet by design: no reactions, no feed, no leaderboard.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { api, formatUsd, formatZec } from "@/lib/api";
import { useAppBack } from "@/lib/nav";
import { sfx } from "@/lib/sfx";
import type { GiftOpenResult, PublicGift } from "@/lib/types";
import { Avatar, Button, Confetti, Countdown, Icon, Input } from "@/components/zk";
import { StashSkeleton } from "@/app/s/[id]/StashSkeleton";

const MAX_TRIES = 5;

type GiftData = Awaited<ReturnType<typeof api.gift>>;
type Load = { kind: "loading" } | { kind: "ready"; data: GiftData } | { kind: "missing" } | { kind: "error"; message: string };

const errStatus = (e: unknown) => (e as { status?: number } | null)?.status;
const errText = (e: unknown) => (e instanceof Error ? e.message : "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const navBtn: CSSProperties = {
  width: "var(--zk-tap-min)",
  height: "var(--zk-tap-min)",
  borderRadius: "var(--zk-radius-lg)",
  background: "var(--zk-surface)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  padding: 0,
  color: "var(--zk-text)",
  cursor: "pointer",
  flex: "none",
};
const LABEL: CSSProperties = { font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-text-muted)" };
const SUB: CSSProperties = { margin: 0, font: "var(--zk-type-body)", fontSize: "var(--zk-fs-15)", color: "var(--zk-text-muted)", textWrap: "pretty" };
const CTA: CSSProperties = { marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)", paddingTop: "var(--zk-space-14)" };
const dot = (on: boolean): CSSProperties => ({ width: 10, height: 10, borderRadius: "50%", flex: "none", background: on ? "var(--zk-gold)" : "rgb(var(--zk-red-rgb) / .35)" });

/** The hero: who it's from, how much, the note. Sticker edge; dimmed with a stamp once it's over. */
function GiftHero({ gift, stamp, done }: { gift: PublicGift; stamp?: string; done?: boolean }) {
  const dim = !!stamp;
  return (
    <section
      aria-label="The gift"
      style={{
        position: "relative",
        borderRadius: "var(--zk-radius-2xl)",
        border: "2.5px solid var(--zk-ink)",
        boxShadow: "inset 0 1.5px 0 rgb(var(--zk-white-rgb) / .08), 0 3px 0 var(--zk-ink)",
        background: done
          ? "radial-gradient(90% 120% at 100% 0%, rgb(var(--zk-gold-rgb) / .28), transparent 60%), linear-gradient(160deg, var(--zk-surface-purple), var(--zk-surface))"
          : "radial-gradient(90% 120% at 100% 0%, rgb(var(--zk-pink-rgb) / .22), transparent 60%), linear-gradient(160deg, var(--zk-surface-purple), var(--zk-surface))",
        padding: "var(--zk-space-18)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-14)",
        opacity: dim ? 0.6 : 1,
        filter: dim ? "saturate(.6)" : "none",
      }}
    >
      {stamp ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: "var(--zk-space-14)",
            top: -12,
            transform: "rotate(4deg)",
            padding: "var(--zk-space-4) var(--zk-space-10)",
            borderRadius: "var(--zk-radius-md)",
            background: stamp === "OPENED" ? "var(--zk-pink)" : "var(--zk-surface-raised)",
            color: stamp === "OPENED" ? "var(--zk-text)" : "var(--zk-text-muted)",
            border: "2px solid var(--zk-ink)",
            boxShadow: "0 3px 0 var(--zk-ink)",
            font: "var(--zk-type-btn-sm)",
            fontSize: "var(--zk-fs-12)",
            letterSpacing: ".06em",
            zIndex: 2,
          }}
        >
          {stamp}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
        <Avatar handle={gift.from.handle} src={gift.from.avatarUrl} size={48} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ font: "var(--zk-type-h3)", overflowWrap: "anywhere" }}>{gift.isMine ? `You sent a gift ${gift.locked ? "🔐" : "🎁"}` : `${gift.from.handle} sent you a gift ${gift.locked ? "🔐" : "🎁"}`}</div>
          <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: 2 }}>{gift.testMode ? "Test ZEC · no real value" : "Paid privately, in shielded ZEC"}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-14)" }}>
        <span aria-hidden="true" style={{ width: 64, height: 64, flex: "none", borderRadius: "var(--zk-radius-xl)", background: "var(--zk-grad-tile-gold)", border: "2px solid var(--zk-ink)", boxShadow: "0 3px 0 var(--zk-ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, transform: "rotate(-4deg)" }}>
          {gift.locked && gift.status === "open" ? "🔐" : "🎁"}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ font: "var(--zk-fw-black) clamp(30px, 9vw, 40px)/1 var(--zk-font-display)", color: "var(--zk-gold)", letterSpacing: "-.02em", textShadow: "0 3px 0 var(--zk-gold-text-edge)" }}>{formatZec(gift.amountZat, 4)} ZEC</div>
          <div style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-text-muted)", marginTop: 6 }}>about {formatUsd(gift.usd)}</div>
        </div>
      </div>
      {gift.message ? <div style={{ font: "var(--zk-type-body-lg)", fontStyle: "italic", overflowWrap: "anywhere", borderTop: "1px solid var(--zk-border)", paddingTop: "var(--zk-space-12)" }}>“{gift.message}”</div> : null}
    </section>
  );
}

export default function GiftScreen() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params.id[0] : (params?.id ?? "");
  const goBack = useAppBack("/feed");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [answer, setAnswer] = useState("");
  const [verdict, setVerdict] = useState("");
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<GiftOpenResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const fetchGift = useCallback(async () => {
    if (!id) return;
    setLoad({ kind: "loading" });
    try {
      const data = await api.gift(id);
      if (alive.current) setLoad({ kind: "ready", data });
    } catch (e) {
      if (!alive.current) return;
      const m = errText(e);
      if (errStatus(e) === 404 || /not found/i.test(m)) setLoad({ kind: "missing" });
      else setLoad({ kind: "error", message: errStatus(e) == null ? "Can’t reach ZECKED. Check your connection and try again." : m || "Couldn’t load this gift." });
    }
  }, [id]);
  useEffect(() => {
    void fetchGift();
  }, [fetchGift]);

  // The tries window: tick once a second while it's counting down so "resets in" and the dots stay honest.
  const tries = load.kind === "ready" ? (opened ? { left: opened.triesLeft, resetsAt: opened.resetsAt } : load.data.myTries) : undefined;
  useEffect(() => {
    if (!tries?.resetsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [tries?.resetsAt]);
  const windowOver = !!tries?.resetsAt && Date.parse(tries.resetsAt) <= now;
  const triesLeft = tries ? (windowOver ? MAX_TRIES : tries.left) : MAX_TRIES;
  const outOfTries = triesLeft <= 0 && !windowOver;

  const open = async () => {
    if (busy || load.kind !== "ready") return;
    const g = load.data.gift;
    if (g.locked && !answer.trim()) {
      setVerdict("Type the answer first.");
      setShake((s) => s + 1);
      sfx("error");
      return;
    }
    setBusy(true);
    setVerdict("");
    try {
      const r = await api.openGift(g.id, g.locked ? answer.trim() : undefined);
      if (!alive.current) return;
      setOpened(r);
      setLoad({ kind: "ready", data: { gift: r.gift, myTries: { left: r.triesLeft, resetsAt: r.resetsAt } } });
      if (r.opened) {
        if (r.credited) sfx("coin");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setVerdict(r.verdict || "Not it.");
        setShake((s) => s + 1);
        sfx("wrong");
      }
    } catch (e) {
      if (!alive.current) return;
      const m = errText(e);
      setVerdict(errStatus(e) == null ? "Can’t reach ZECKED. Check your connection." : m && !/^Request failed/i.test(m) ? m : "Couldn’t open it. Try again.");
      setShake((s) => s + 1);
      sfx("error");
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const takeBack = async () => {
    if (busy || load.kind !== "ready") return;
    setBusy(true);
    try {
      const r = await api.cancelGift(load.data.gift.id);
      if (!alive.current) return;
      setConfirm(false);
      setLoad({ kind: "ready", data: { gift: r.gift } });
      if (r.gift.status === "cancelled") sfx("coin");
      else {
        sfx("error");
        setVerdict(r.gift.status === "open" ? "Someone is opening this gift right now. Try again in a moment." : "Too late, this gift was already opened.");
      }
    } catch (e) {
      if (!alive.current) return;
      setConfirm(false);
      sfx("error");
      // The gift changed under us (opened meanwhile, or already back): show what's true now.
      void fetchGift();
      setVerdict(errText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const share = async () => {
    if (load.kind !== "ready") return;
    const g = load.data.gift;
    const url = `${window.location.origin}/g/${g.id}`;
    const text = g.locked ? "I sent you a ZECKED gift 🎁 Answer my question to open it:" : "I sent you a ZECKED gift 🎁 Open it here:";
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "ZECKED", text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      sfx("success");
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  /* ---------- states ---------- */

  if (load.kind === "loading") return <StashSkeleton />;

  if (load.kind === "missing" || load.kind === "error") {
    const missing = load.kind === "missing";
    return (
      <main className="zk-screen" style={{ background: "var(--zk-bg-hero-purple)" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "var(--zk-space-12)", textAlign: "center" }}>
          <div style={{ width: 72, height: 72, borderRadius: "var(--zk-radius-2xl)", background: "var(--zk-surface)", color: "var(--zk-text-muted)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon icon={missing ? "search" : "signal"} size={34} stroke={2.2} />
          </div>
          <h1 style={{ margin: 0, font: "var(--zk-type-h2)" }}>{missing ? "Gift not found" : "Couldn’t load this gift"}</h1>
          <p style={{ ...SUB, maxWidth: 300 }}>{missing ? "This link doesn’t match any gift. Check it and try again." : load.message}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
          {!missing && <Button label="Try again" variant="primary" size="lg" onClick={() => void fetchGift()} />}
          <Button label="Find a stash to crack" variant={missing ? "primary" : "ghost"} size={missing ? "lg" : "md"} href="/feed" />
        </div>
      </main>
    );
  }

  const gift = load.data.gift;
  const justOpened = !!opened?.opened;
  const yours = justOpened || (gift.status === "claimed" && gift.isYours);
  const credited = justOpened ? opened!.credited : gift.credited;
  const signupHref = `/signin?next=${encodeURIComponent(`/g/${gift.id}`)}&reason=gift`;

  let label = gift.isMine ? "YOUR GIFT" : "A GIFT FOR YOU";
  let labelColor = "var(--zk-pink)";
  let stamp: string | undefined;
  let bg = "var(--zk-bg-hero-purple)";
  let body: ReactNode;

  if (yours) {
    // Opened by this viewer (now, or earlier).
    bg = "var(--zk-bg-hero-gold)";
    label = "OPENED";
    labelColor = "var(--zk-gold)";
    body = (
      <>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)", alignItems: "center" }}>
          <h1 style={{ margin: 0, font: "var(--zk-fw-black) var(--zk-fs-40)/1 var(--zk-font-display)", letterSpacing: "var(--zk-track-tight)" }}>{justOpened ? "It’s yours! 🎉" : "You opened this gift 🎁"}</h1>
          <p style={{ ...SUB, maxWidth: 300 }}>
            {credited ? `${formatZec(gift.amountZat, 4)} ZEC from ${gift.from.handle} is in your ZECKED wallet.` : "We’re holding it for you. Sign up and it lands in your own wallet. No passwords."}
          </p>
        </div>
        <div style={CTA}>
          {credited ? <Button label="It’s in your wallet" icon="wallet" variant="primary" size="lg" href="/wallet" /> : <Button label="Sign up to keep it" icon="unlock" variant="primary" size="lg" href={signupHref} />}
          <Button label="Find a stash to crack" variant="ghost" size="md" href="/feed" />
        </div>
      </>
    );
  } else if (gift.isMine) {
    if (gift.status === "open") {
      body = (
        <>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--zk-space-8)", font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
            <Icon icon="hourglass" size={16} stroke={2.4} style={{ marginTop: 1 }} />
            <span style={{ minWidth: 0 }}>
              Waiting to be opened · comes back to you in <Countdown to={gift.expiresAt} format="human" size="sm" tone="gold" />
            </span>
          </div>
          {verdict ? (
            <p role="status" style={{ ...SUB, color: "var(--zk-red)" }}>
              {verdict}
            </p>
          ) : null}
          {confirm ? (
            <section aria-label="Take the gift back?" style={{ borderRadius: "var(--zk-radius-2xl)", border: "2.5px solid var(--zk-ink)", boxShadow: "0 3px 0 var(--zk-ink)", background: "var(--zk-surface)", padding: "var(--zk-space-16)", display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>
              <div style={{ font: "var(--zk-type-h3)" }}>Take the gift back?</div>
              <p style={SUB}>The ZEC returns to your wallet and the link stops working.</p>
              <Button label={busy ? "One sec…" : "Yes, take it back"} variant="light" size="md" disabled={busy} onClick={() => void takeBack()} />
              <Button label="Keep it waiting" variant="ghost" size="md" disabled={busy} onClick={() => setConfirm(false)} />
            </section>
          ) : null}
          <div style={CTA}>
            <Button label={copied ? "Link copied" : "Share the link"} icon={copied ? "check" : "share"} variant="primary" size="lg" onClick={() => void share()} />
            {!confirm && <Button label="Take it back" variant="ghost" size="md" onClick={() => setConfirm(true)} />}
          </div>
        </>
      );
    } else if (gift.status === "claimed") {
      bg = "var(--zk-bg-hero-gold)";
      stamp = "OPENED";
      body = (
        <>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)", alignItems: "center" }}>
            <h1 style={{ margin: 0, font: "var(--zk-type-h1)" }}>{gift.openedBy ? `Opened by ${gift.openedBy} 🎉` : "Opened 🎉"}</h1>
            <p style={{ ...SUB, maxWidth: 300 }}>{gift.credited ? "The ZEC is in their wallet." : "They opened it as a guest. The ZEC lands in their wallet when they sign up."}</p>
          </div>
          <div style={CTA}>
            <Button label="Send another gift" icon="sparkle" variant="primary" size="lg" href="/gift" />
            <Button label="Back to wallet" variant="ghost" size="md" href="/wallet" />
          </div>
        </>
      );
    } else {
      stamp = "RETURNED";
      body = (
        <>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)", alignItems: "center" }}>
            <h1 style={{ margin: 0, font: "var(--zk-type-h1)" }}>{gift.returnReason === "cancelled" ? "You took this gift back." : "It came back to you."}</h1>
            <p style={{ ...SUB, maxWidth: 300 }}>{gift.returnReason === "cancelled" ? `${formatZec(gift.amountZat, 4)} ZEC is back in your wallet and this link no longer works.` : `Nobody opened it in 7 days, so ${formatZec(gift.amountZat, 4)} ZEC came back to your wallet.`}</p>
          </div>
          <div style={CTA}>
            <Button label="Back to wallet" icon="wallet" variant="primary" size="lg" href="/wallet" />
          </div>
        </>
      );
    }
  } else if (gift.status === "claimed") {
    stamp = "OPENED";
    body = (
      <>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)", alignItems: "center" }}>
          <h1 style={{ margin: 0, font: "var(--zk-type-h1)" }}>This gift was already opened.</h1>
          <p style={{ ...SUB, maxWidth: 300 }}>Gifts open once. There’s plenty of ZEC to crack on the feed, though.</p>
        </div>
        <div style={CTA}>
          <Button label="Find a stash to crack" variant="primary" size="lg" href="/feed" />
        </div>
      </>
    );
  } else if (gift.status !== "open") {
    stamp = "RETURNED";
    body = (
      <>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)", alignItems: "center" }}>
          <h1 style={{ margin: 0, font: "var(--zk-type-h1)" }}>This gift went back to {gift.from.handle}.</h1>
          <p style={{ ...SUB, maxWidth: 300 }}>{gift.returnReason === "cancelled" ? "They took it back before it was opened." : "Nobody opened it in 7 days, so it returned to them."}</p>
        </div>
        <div style={CTA}>
          <Button label="Find a stash to crack" variant="primary" size="lg" href="/feed" />
        </div>
      </>
    );
  } else if (gift.locked) {
    bg = verdict && !busy ? "var(--zk-bg-hero-red)" : "var(--zk-bg-hero-purple)";
    body = (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
          <span style={{ ...LABEL, color: "var(--zk-pink)" }}>LOCKED WITH A QUESTION</span>
          <div style={{ font: "var(--zk-type-h2)", overflowWrap: "anywhere" }}>{gift.question}</div>
        </div>
        <Input
          size="lg"
          placeholder="Your answer…"
          value={answer}
          onChange={(v) => {
            setAnswer(v.slice(0, 80));
            if (verdict) setVerdict("");
          }}
          onEnter={() => void open()}
          shake={shake}
          state={verdict ? "error" : undefined}
          disabled={outOfTries || busy}
          autoComplete="off"
          spellCheck={false}
          ariaLabel="Your answer"
          trailing="none"
        />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--zk-space-8)", minHeight: 22, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", minWidth: 0 }}>
            {Array.from({ length: MAX_TRIES }, (_, i) => (
              <span key={i} aria-hidden="true" style={dot(i < triesLeft)} />
            ))}
            <span style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginLeft: "var(--zk-space-4)" }}>
              {outOfTries ? (
                <>
                  Out of tries. Fresh tries in <Countdown to={tries!.resetsAt} format="ms" size="sm" tone="gold" />
                </>
              ) : tries?.resetsAt && triesLeft < MAX_TRIES ? (
                <>
                  {plural(triesLeft, "try", "tries")} left · resets in <Countdown to={tries.resetsAt} format="ms" size="sm" tone="gold" />
                </>
              ) : (
                <>{MAX_TRIES} tries every 10 minutes</>
              )}
            </span>
          </div>
          {verdict ? (
            <span role="status" style={{ font: "var(--zk-type-small)", fontWeight: 700, color: "var(--zk-red)" }}>
              {verdict}
            </span>
          ) : null}
        </div>
        <div style={CTA}>
          <Button label={busy ? "Opening…" : "Open it"} icon="unlock" variant="primary" size="lg" sfx="whoosh" disabled={busy || outOfTries} onClick={() => void open()} />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <p style={SUB}>Tap to open it. The ZEC is yours the moment it opens.</p>
        {verdict ? (
          <p role="status" style={{ ...SUB, color: "var(--zk-red)" }}>
            {verdict}
          </p>
        ) : null}
        <div style={CTA}>
          <Button label={busy ? "Opening…" : "Open it 🎁"} variant="primary" size="lg" sfx="whoosh" disabled={busy} onClick={() => void open()} />
        </div>
      </>
    );
  }

  return (
    <main className="zk-screen" style={{ background: bg, gap: "var(--zk-space-16)", transition: "background var(--zk-dur-base) var(--zk-ease-out)" }}>
      {justOpened ? (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", overflow: "hidden" }}>
          <Confetti count={60} seed={21} />
        </div>
      ) : null}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative", zIndex: 6 }}>
        <button type="button" aria-label="Back" onClick={goBack} data-sfx="tap" style={navBtn}>
          <Icon icon="back" size={22} stroke={2.4} />
        </button>
        <span style={{ ...LABEL, color: labelColor }}>{label}</span>
        {gift.isMine && gift.status === "open" ? (
          <button type="button" aria-label="Share" onClick={() => void share()} data-sfx="tap" style={navBtn}>
            <Icon icon="share" size={20} stroke={2.2} />
          </button>
        ) : (
          <div style={{ width: "var(--zk-tap-min)" }} />
        )}
      </nav>
      <div style={{ position: "relative", zIndex: 6, display: "flex", flexDirection: "column", gap: "var(--zk-space-16)", flex: 1 }}>
        <GiftHero gift={gift} stamp={stamp} done={yours} />
        {body}
      </div>
    </main>
  );
}
