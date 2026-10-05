"use client";
// Send a gift (/gift): ZEC from your ZECKED wallet for one person, opened from a link. Pick an amount,
// add a note, optionally lock it with a question only they can answer, check it over, send. Then share
// the link (WhatsApp, X, Telegram, the phone's share sheet, copy). Unopened gifts come back in 7 days.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, formatZec } from "@/lib/api";
import { useAppBack } from "@/lib/nav";
import { sfx } from "@/lib/sfx";
import { ZAT, type AppConfig, type PublicGift, type WalletInfo } from "@/lib/types";
import { Button, Confetti, Icon, Input, LiveBadge, Logo, Switch, Toast, type ToastVariant } from "@/components/zk";

/* ───────────────────────── constants ───────────────────────── */

const PRESETS = [
  { label: "$1", usd: 1 },
  { label: "$2", usd: 2 },
  { label: "$5", usd: 5 },
] as const;
const DEFAULT_USD = 2;
// The server has the final say (ZECKED_GIFT_MIN_USD / _MAX_USD); these only shape the picker.
const MIN_USD = 0.5;
const MAX_USD = 20;
const MESSAGE_MAX = 140;
const QUESTION_MAX = 80;
const ANSWER_MAX = 60;
const ANSWER_ID = "zk-gift-answer";

type Step = "compose" | "review" | "sent";
type Load = { kind: "loading" } | { kind: "guest" } | { kind: "ready" } | { kind: "error"; message: string };

/* ───────────────────────── styles ───────────────────────── */

const H1: CSSProperties = { margin: "var(--zk-space-8) 0 0", font: "var(--zk-type-h1)" };
const SUB: CSSProperties = { margin: 0, font: "var(--zk-type-body)", fontSize: "var(--zk-fs-15)", color: "var(--zk-text-muted)", textWrap: "pretty" };
const LABEL: CSSProperties = { font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-text-muted)" };
const CTA: CSSProperties = { marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)", paddingTop: "var(--zk-space-14)" };
const ICON_BTN: CSSProperties = {
  width: 44,
  height: 44,
  flex: "none",
  borderRadius: "var(--zk-radius-md)",
  background: "var(--zk-surface)",
  border: "none",
  padding: 0,
  color: "var(--zk-text)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
};
/** Sticker edge: thick ink outline + hard drop (the app's card language). */
const STICKER: CSSProperties = {
  borderRadius: "var(--zk-radius-2xl)",
  border: "2.5px solid var(--zk-ink)",
  boxShadow: "inset 0 1.5px 0 rgb(var(--zk-white-rgb) / .08), 0 3px 0 var(--zk-ink)",
  background: "radial-gradient(90% 120% at 100% 0%, rgb(var(--zk-pink-rgb) / .22), transparent 60%), linear-gradient(160deg, var(--zk-surface-purple), var(--zk-surface))",
};

/* ───────────────────────── helpers ───────────────────────── */

const errStatus = (e: unknown) => (e as { status?: number } | null)?.status;
const errText = (e: unknown) => (e instanceof Error ? e.message : "");
const usdLabel = (usd: number) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2).replace(/0$/, "")}`);
const fmtBal = (zat: number) => (zat > 0 ? formatZec(zat, 4) : "0");

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/** The step's forward button: looks disabled until the step is valid, but a tap still says what's missing. */
function NextButton({ label, valid, busy = false, onNext, onInvalid }: { label: string; valid: boolean; busy?: boolean; onNext: () => void; onInvalid: () => void }) {
  return (
    <div style={{ position: "relative" }}>
      <div aria-hidden={valid ? undefined : true}>
        <Button label={busy ? "Sending…" : label} variant="primary" size="lg" disabled={!valid || busy} sfx="whoosh" onClick={onNext} />
      </div>
      {valid ? null : (
        <button
          type="button"
          aria-label={label}
          aria-disabled="true"
          data-sfx="none"
          onClick={onInvalid}
          style={{ position: "absolute", inset: 0, margin: 0, padding: 0, border: "none", borderRadius: "var(--zk-radius-2xl)", background: "transparent", cursor: "not-allowed", WebkitTapHighlightColor: "transparent" }}
        />
      )}
    </div>
  );
}

function Header({ label, onClose, back = false }: { label: string; onClose: () => void; back?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <button type="button" aria-label={back ? "Back" : "Close"} onClick={onClose} data-sfx="tap" style={ICON_BTN}>
        <Icon icon={back ? "back" : "close"} size={back ? 20 : 18} stroke={2.6} />
      </button>
      <span style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-pink)" }}>{label}</span>
      <div style={{ width: 44 }} />
    </div>
  );
}

/** What the link looks like when it lands in a chat (the real card is /g/<id>/opengraph-image). */
export function GiftCardPreview({ fromHandle, locked, host, id }: { fromHandle: string; locked: boolean; host: string; id: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, (el.clientWidth || 354) / 354));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} style={{ width: "100%", maxWidth: 354, height: 199 * scale }}>
      <div
        aria-label="Share card preview"
        style={{
          width: 354,
          height: 199,
          borderRadius: "var(--zk-radius-xl)",
          overflow: "hidden",
          position: "relative",
          background:
            "radial-gradient(55% 80% at 95% 5%, rgb(var(--zk-pink-rgb) / .5), transparent 60%), radial-gradient(60% 90% at 0% 100%, rgb(var(--zk-gold-rgb) / .45), transparent 60%), var(--zk-bg)",
          border: "1px solid var(--zk-border-strong)",
          boxShadow: "var(--zk-shadow-float)",
          transform: `scale(${scale}) translate(177px, 99.5px) rotate(-2deg) translate(-177px, -99.5px)`,
          transformOrigin: "0 0",
        }}
      >
        <div style={{ position: "absolute", left: 16, top: 14 }}>
          <Logo variant="wordmark" size={18} />
        </div>
        <div style={{ position: "absolute", left: 16, top: 46, right: 118, font: "var(--zk-fw-black) var(--zk-fs-20)/1.08 var(--zk-font-display)" }}>
          You’ve got a <span style={{ color: "var(--zk-gold)" }}>ZECKED gift</span> 🎁
        </div>
        <div style={{ position: "absolute", left: 16, bottom: 36, right: 118, font: "var(--zk-fw-black) var(--zk-fs-10)/1 var(--zk-font-body)", letterSpacing: ".12em", color: "var(--zk-pink)" }}>
          FROM {fromHandle.toUpperCase()}
        </div>
        <div style={{ position: "absolute", left: 16, bottom: 14, right: 118, font: "var(--zk-fw-semibold) var(--zk-fs-11)/1.3 var(--zk-font-body)", color: "var(--zk-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {locked ? "Locked with a question only you can answer" : `${host}/g/${id}`}
        </div>
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            right: 18,
            top: 50,
            width: 86,
            height: 86,
            borderRadius: "var(--zk-radius-xl)",
            background: "var(--zk-grad-tile-gold)",
            boxShadow: "0 5px 0 var(--zk-gold-deep)",
            color: "var(--zk-gold-ink)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            transform: "rotate(4deg)",
            fontSize: 36,
          }}
        >
          {locked ? "🔐" : "🎁"}
          <span style={{ font: "var(--zk-fw-black) var(--zk-fs-11)/1 var(--zk-font-display)", marginTop: 4 }}>A gift for you</span>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── the flow ───────────────────────── */

interface ToastState {
  id: number;
  text: string;
  variant: ToastVariant;
  icon?: string;
}

export function GiftFlow() {
  const router = useRouter();
  const close = useAppBack("/wallet");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [step, setStep] = useState<Step>("compose");
  const [loc, setLoc] = useState({ origin: "", host: "" });

  // the gift being written
  const [usd, setUsd] = useState<number>(DEFAULT_USD);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [message, setMessage] = useState("");
  const [locked, setLocked] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [tried, setTried] = useState(false);
  const [shake, setShake] = useState({ question: 0, answer: 0 });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<PublicGift | null>(null);
  const [copied, setCopied] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showToast = (text: string, variant: ToastVariant = "default", icon?: string) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, variant, icon });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    setLoc({ origin: window.location.origin, host: window.location.host });
    let cancelled = false;
    (async () => {
      const [me, w, c] = await Promise.allSettled([api.me(), api.wallet(), api.config()]);
      if (cancelled) return;
      if (c.status === "fulfilled") setConfig(c.value);
      if (me.status === "fulfilled" && me.value.player.account && !me.value.player.account.signedIn) setLoad({ kind: "guest" });
      else if (w.status === "fulfilled") {
        setWallet(w.value);
        setLoad({ kind: "ready" });
      } else if (errStatus(w.reason) === 401) setLoad({ kind: "guest" });
      else setLoad({ kind: "error", message: errStatus(w.reason) == null ? "Can’t reach ZECKED. Check your connection and try again." : "We couldn’t load your wallet just now. Your ZEC is safe." });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The answer is a secret: masked with CSS (a plain text field, so no password-manager prompts).
  useEffect(() => {
    if (!locked || step !== "compose") return;
    const el = document.getElementById(ANSWER_ID) as HTMLInputElement | null;
    if (!el) return;
    el.setAttribute("data-1p-ignore", "true");
    el.setAttribute("data-lpignore", "true");
    el.setAttribute("autocapitalize", "none");
    el.setAttribute("autocorrect", "off");
    el.style.setProperty("-webkit-text-security", showAnswer ? "none" : "disc");
  }, [locked, showAnswer, step]);

  const rate = config?.zecUsd || 0;
  const zecZat = rate ? Math.round((usd / rate) * ZAT) : null;
  const balance = wallet?.balanceZat ?? null;
  const short = balance != null && zecZat != null && balance < zecZat;
  const amountOk = usd >= MIN_USD && usd <= MAX_USD;
  const qLen = question.trim().length;
  const issues = {
    amount: amountOk ? "" : `Pick an amount between ${usdLabel(MIN_USD)} and ${usdLabel(MAX_USD)}.`,
    question: locked && qLen < 2 ? "Write the question." : locked && qLen > QUESTION_MAX ? `Questions are up to ${QUESTION_MAX} characters.` : "",
    answer: locked && !answer.trim() ? "Add the answer." : "",
  };
  const valid = !issues.amount && !issues.question && !issues.answer;

  const onInvalid = () => {
    setTried(true);
    sfx("error");
    setShake((s) => ({ question: s.question + (issues.question ? 1 : 0), answer: s.answer + (issues.answer ? 1 : 0) }));
    showToast(issues.amount || issues.question || issues.answer, "error");
  };

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const r = await api.createGift({ usd, message: message.trim() || undefined, lock: locked ? { question: question.trim(), answer: answer.trim() } : undefined });
      setWallet(r.wallet);
      setSent(r.gift);
      setStep("sent");
      window.scrollTo({ top: 0 });
    } catch (e) {
      const status = errStatus(e);
      if (status === 401) setLoad({ kind: "guest" });
      else if (status === 402) {
        sfx("error");
        showToast("Not enough test ZEC in your wallet. Add some first (it’s free).", "error");
        setStep("compose");
      } else {
        sfx("error");
        const m = errText(e);
        showToast(status == null ? "Can’t reach ZECKED. Check your connection and try again." : m && !/^Request failed/i.test(m) ? m : "Couldn’t send that. Try again.", "error");
      }
    } finally {
      setSending(false);
    }
  };

  const setAmount = (v: number) => setUsd(Math.min(MAX_USD, Math.max(0, v)));
  const activePreset = customOpen ? "Custom" : (PRESETS.find((p) => p.usd === usd)?.label ?? "Custom");
  const presetStyle = (on: boolean): CSSProperties => ({
    height: 48,
    borderRadius: "var(--zk-radius-lg)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    font: "var(--zk-type-h4)",
    background: on ? "var(--zk-gold)" : "var(--zk-surface)",
    color: on ? "var(--zk-gold-ink)" : "var(--zk-text)",
    boxShadow: on ? "var(--zk-shadow-chip-active)" : "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  });

  /* ---------- pieces ---------- */

  let body: ReactNode;
  let bg = "var(--zk-bg-hero-purple)";

  if (load.kind === "loading") {
    body = (
      <>
        <Header label="SEND A GIFT" onClose={close} />
        <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
          <div style={{ height: 40, width: "60%", borderRadius: "var(--zk-radius-md)", background: "var(--zk-surface)", animation: "zk-glow 1.6s ease-in-out infinite" }} />
          <div style={{ height: 150, borderRadius: "var(--zk-radius-2xl)", background: "var(--zk-surface)", animation: "zk-glow 1.6s ease-in-out infinite" }} />
          <div style={{ height: 62, borderRadius: "var(--zk-radius-xl)", background: "var(--zk-surface)", animation: "zk-glow 1.6s ease-in-out infinite" }} />
        </div>
      </>
    );
  } else if (load.kind === "guest") {
    body = (
      <>
        <Header label="SEND A GIFT" onClose={close} />
        <h1 style={H1}>Sign up to send gifts.</h1>
        <section style={{ ...STICKER, padding: "var(--zk-space-18)", display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
            <span aria-hidden="true" style={{ width: 52, height: 52, flex: "none", borderRadius: "var(--zk-radius-lg)", background: "var(--zk-grad-tile-gold)", border: "2px solid var(--zk-ink)", boxShadow: "0 3px 0 var(--zk-ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>
              🎁
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: "var(--zk-type-h3)" }}>Gifts come from your wallet</div>
              <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: 2 }}>One tap to sign up. No passwords, no seed phrases. Test ZEC is free.</div>
            </div>
          </div>
          <Button label="Sign up" variant="primary" size="lg" href="/signin?next=%2Fgift&reason=wallet" />
        </section>
      </>
    );
  } else if (load.kind === "error") {
    body = (
      <>
        <Header label="SEND A GIFT" onClose={close} />
        <h1 style={H1}>Couldn’t load your wallet.</h1>
        <p style={SUB}>{load.message}</p>
        <div style={CTA}>
          <Button label="Try again" variant="primary" size="lg" onClick={() => window.location.reload()} />
        </div>
      </>
    );
  } else if (step === "compose") {
    body = (
      <>
        <Header label="SEND A GIFT" onClose={close} />
        <h1 style={H1}>Send a gift.</h1>
        <p style={SUB}>From your ZECKED wallet. Only the person with the link can open it.</p>

        <div aria-live="polite" style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "var(--zk-space-10) 0 var(--zk-space-4)" }}>
          <div style={{ font: "var(--zk-type-amount-xl)", fontSize: "clamp(56px, 18vw, 84px)", color: "var(--zk-gold)", letterSpacing: "-.03em", textShadow: "var(--zk-text-shadow-gold)" }}>{usdLabel(usd)}</div>
          <div style={{ font: "var(--zk-type-mono)", fontSize: "var(--zk-fs-18)", marginTop: "var(--zk-space-10)" }}>{zecZat != null ? formatZec(zecZat, 4) : "…"} ZEC</div>
          <div style={{ marginTop: "var(--zk-space-6)", minHeight: 18, font: "var(--zk-type-caption)", fontWeight: 500, color: short ? "var(--zk-gold)" : "var(--zk-text-muted)", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
            {balance == null ? " " : balance <= 0 ? "Your wallet is empty · add free test ZEC first" : short ? `You have ${fmtBal(balance)} test ZEC · add free test ZEC first` : `You have ${fmtBal(balance)} test ZEC`}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "var(--zk-space-8)" }}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={activePreset === p.label}
              onClick={() => {
                setCustomOpen(false);
                setUsd(p.usd);
              }}
              style={presetStyle(activePreset === p.label)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={activePreset === "Custom"}
            aria-expanded={customOpen}
            onClick={() => {
              setCustomText(String(usd));
              setCustomOpen(true);
            }}
            style={presetStyle(activePreset === "Custom")}
          >
            Custom
          </button>
        </div>
        {customOpen ? (
          <Input
            size="sm"
            type="text"
            inputMode="decimal"
            autoFocus
            ariaLabel="Custom amount in US dollars"
            placeholder={`${usdLabel(MIN_USD)}–${usdLabel(MAX_USD)}`}
            value={customText}
            onChange={(v) => {
              let t = v.replace(/,/g, ".").replace(/[^\d.]/g, "");
              const i = t.indexOf(".");
              if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, "").slice(0, 2);
              t = t.slice(0, 6);
              setCustomText(t);
              const n = parseFloat(t);
              if (Number.isFinite(n)) setAmount(Math.round(n * 100) / 100);
            }}
            onEnter={() => setCustomText(String(usd))}
            message={tried && issues.amount ? issues.amount : `Between ${usdLabel(MIN_USD)} and ${usdLabel(MAX_USD)}.`}
            state={tried && issues.amount ? "error" : undefined}
            trailing={<span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text-muted)" }}>USD</span>}
          />
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-6)", marginTop: "var(--zk-space-6)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={LABEL}>A NOTE (OPTIONAL)</span>
            <span style={{ font: "var(--zk-type-mono-xs)", color: message.length > MESSAGE_MAX - 10 ? "var(--zk-gold)" : "var(--zk-text-faint)" }}>
              {message.length} / {MESSAGE_MAX}
            </span>
          </div>
          <Input size="md" placeholder="Happy birthday 🎂" value={message} onChange={(v) => setMessage(v.slice(0, MESSAGE_MAX))} maxLength={MESSAGE_MAX} ariaLabel="A note for them" trailing="none" />
        </div>

        <section style={{ ...STICKER, padding: "var(--zk-space-14) var(--zk-space-16)", display: "flex", flexDirection: "column", gap: "var(--zk-space-12)", marginTop: "var(--zk-space-6)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: "var(--zk-type-h4)" }}>Lock it with a question</div>
              <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginTop: 2, textWrap: "pretty" }}>Only they’ll know the answer. “What’s my dog’s name?”</div>
            </div>
            <Switch on={locked} onChange={(on) => setLocked(on)} label="Lock it with a question" />
          </div>
          {locked ? (
            <>
              <Input
                multiline
                height={88}
                size="md"
                label="Your question"
                placeholder="What’s my dog’s name?"
                value={question}
                onChange={(v) => setQuestion(v.slice(0, QUESTION_MAX))}
                maxLength={QUESTION_MAX}
                shake={shake.question}
                state={tried && issues.question ? "error" : undefined}
                message={tried && issues.question ? issues.question : `${qLen} / ${QUESTION_MAX}`}
              />
              <Input
                id={ANSWER_ID}
                size="md"
                label="The answer"
                placeholder="Rex"
                value={answer}
                onChange={(v) => setAnswer(v.slice(0, ANSWER_MAX))}
                maxLength={ANSWER_MAX}
                autoComplete="off"
                spellCheck={false}
                shake={shake.answer}
                state={tried && issues.answer ? "error" : undefined}
                message={tried && issues.answer ? issues.answer : "Not case-sensitive. Spelling has to match."}
                trailing={
                  <button type="button" aria-label={showAnswer ? "Hide the answer" : "Show the answer"} aria-pressed={showAnswer} onClick={() => setShowAnswer((s) => !s)} data-sfx="tap" style={{ ...ICON_BTN, width: 36, height: 36, background: "var(--zk-surface-raised)" }}>
                    <Icon icon={showAnswer ? "eyeOff" : "eye"} size={18} stroke={2.4} />
                  </button>
                }
              />
            </>
          ) : null}
        </section>

        <div style={CTA}>
          {short ? (
            <Button label="Add free test ZEC" icon="plus" variant="primary" size="lg" sfx="whoosh" href="/wallet?action=add" />
          ) : (
            <NextButton label="Review gift" valid={valid} onNext={() => setStep("review")} onInvalid={onInvalid} />
          )}
        </div>
      </>
    );
  } else if (step === "review") {
    const zecLine = zecZat != null ? `${formatZec(zecZat, 4)} ${config?.testMode === false ? "ZEC" : "test ZEC"}` : "";
    body = (
      <>
        <Header label="CHECK IT OVER" onClose={() => setStep("compose")} back />
        <h1 style={H1}>Ready to send?</h1>
        <p style={SUB}>It leaves your wallet now and waits for them at the link.</p>
        <section aria-label="Your gift" style={{ ...STICKER, padding: "var(--zk-space-18)", display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
            <span aria-hidden="true" style={{ width: 56, height: 56, flex: "none", borderRadius: "var(--zk-radius-lg)", background: "var(--zk-grad-tile-gold)", border: "2px solid var(--zk-ink)", boxShadow: "0 3px 0 var(--zk-ink)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>
              {locked ? "🔐" : "🎁"}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ font: "var(--zk-fw-black) var(--zk-fs-34)/1 var(--zk-font-display)", color: "var(--zk-gold)" }}>{usdLabel(usd)}</div>
              <div style={{ font: "var(--zk-type-mono-sm)", color: "var(--zk-text-muted)", marginTop: 4 }}>{zecLine}</div>
            </div>
          </div>
          {message.trim() ? <div style={{ font: "var(--zk-type-body-lg)", fontStyle: "italic", overflowWrap: "anywhere" }}>“{message.trim()}”</div> : null}
          <div style={{ borderTop: "1px solid var(--zk-border)", paddingTop: "var(--zk-space-12)", display: "flex", flexDirection: "column", gap: "var(--zk-space-6)" }}>
            {locked ? (
              <>
                <span style={{ ...LABEL, color: "var(--zk-pink)" }}>LOCKED WITH A QUESTION</span>
                <div style={{ font: "var(--zk-type-h4)", overflowWrap: "anywhere" }}>{question.trim()}</div>
                <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>Answer: {showAnswer ? answer.trim() : "•".repeat(Math.min(12, answer.trim().length))} · 5 tries every 10 minutes</div>
              </>
            ) : (
              <>
                <span style={{ ...LABEL, color: "var(--zk-mint)" }}>NO LOCK</span>
                <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>Anyone with the link can open it, so send it to one person.</div>
              </>
            )}
          </div>
        </section>
        <ul style={{ margin: 0, padding: "0 0 0 var(--zk-space-18)", font: "var(--zk-type-small)", fontWeight: 500, color: "var(--zk-text-muted)", display: "flex", flexDirection: "column", gap: "var(--zk-space-6)", textWrap: "pretty" }}>
          <li>They open the link and the ZEC lands in their ZECKED wallet. No account needed to open it.</li>
          <li>Nobody opens it in 7 days? It comes back to you.</li>
          <li>Changed your mind? Take it back any time before it’s opened.</li>
        </ul>
        <div style={CTA}>
          <NextButton label="Send gift" valid busy={sending} onNext={() => void send()} onInvalid={() => {}} />
          <Button label="Edit" variant="ghost" size="md" onClick={() => setStep("compose")} disabled={sending} />
        </div>
      </>
    );
  } else if (sent) {
    bg = "var(--zk-bg-hero-gold)";
    const url = `${loc.origin}/g/${sent.id}`;
    const text = sent.locked ? "I sent you a ZECKED gift 🎁 Answer my question to open it:" : "I sent you a ZECKED gift 🎁 Open it here:";
    const enc = encodeURIComponent;
    const open = (href: string) => window.open(href, "_blank", "noopener,noreferrer");
    const copy = async () => {
      if (await copyText(url)) {
        setCopied(true);
        sfx("success");
        setTimeout(() => setCopied(false), 1800);
      } else showToast("Couldn’t copy. Long-press the link to copy it instead.", "error");
    };
    const share = async () => {
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
    const half: CSSProperties = { padding: "0 var(--zk-space-6)" };
    body = (
      <>
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", overflow: "hidden" }}>
          <Confetti count={40} seed={21} />
        </div>
        <div style={{ flex: 1, position: "relative", zIndex: 6, display: "flex", flexDirection: "column", gap: "var(--zk-space-14)", paddingTop: "var(--zk-space-12)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)", alignItems: "center", textAlign: "center" }}>
            <LiveBadge size="md" label="Ready to open" />
            <h1 style={{ margin: 0, font: "var(--zk-fw-black) var(--zk-fs-40)/1 var(--zk-font-display)", letterSpacing: "var(--zk-track-tight)" }}>Gift ready 🎁</h1>
            <p style={{ ...SUB, maxWidth: 300, textAlign: "center" }}>Send the link to one person. It comes back to you in 7 days if nobody opens it.</p>
          </div>
          <div>
            <div style={{ ...LABEL, marginBottom: "var(--zk-space-8)" }}>WHAT THEY’LL SEE</div>
            <GiftCardPreview fromHandle={sent.from.handle} locked={sent.locked} host={loc.host} id={sent.id} />
          </div>
          <div style={CTA}>
            <Button label="Share" icon="share" variant="primary" size="lg" onClick={() => void share()} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--zk-space-8)" }}>
              <Button label="WhatsApp" variant="success" size="md" style={half} onClick={() => open(`https://wa.me/?text=${enc(`${text} ${url}`)}`)} />
              <Button label="X" variant="light" size="md" style={half} onClick={() => open(`https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`)} />
              <Button label="Telegram" variant="sky" size="md" style={half} onClick={() => open(`https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`)} />
            </div>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label={copied ? "Link copied" : "Copy link"}
              style={{
                height: "var(--zk-h-btn-md)",
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
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {loc.host}/g/{sent.id}
              </span>
              <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 var(--zk-space-12)", borderRadius: "var(--zk-radius-md)", background: copied ? "var(--zk-mint)" : "var(--zk-gold)", color: copied ? "var(--zk-mint-ink)" : "var(--zk-gold-ink)", font: "var(--zk-type-btn-sm)" }}>
                <Icon icon={copied ? "check" : "copy"} size={15} stroke={2.8} />
                {copied ? "Copied" : "Copy"}
              </span>
            </button>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--zk-space-10)" }}>
              <Button label="View gift" variant="ghost" size="md" style={half} href={`/g/${sent.id}`} />
              <Button label="Done" variant="ghost" size="md" style={half} onClick={() => router.push("/wallet")} />
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <main className="zk-screen" style={{ background: bg, gap: "var(--zk-space-14)" }}>
      {body}
      {toast ? (
        <div aria-live="polite" style={{ position: "fixed", left: "var(--zk-col-x)", transform: "translateX(-50%)", top: "calc(var(--zk-fixed-top) + var(--zk-space-12))", width: "min(394px, calc(var(--zk-col-w) - 24px))", zIndex: 86, pointerEvents: "none" }}>
          <Toast key={toast.id} text={toast.text} variant={toast.variant} icon={toast.icon} />
        </div>
      ) : null}
    </main>
  );
}
