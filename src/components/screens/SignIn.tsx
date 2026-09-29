"use client";
// Sign in / sign up (one door). Step 1: email → "Send my code". Step 2: six digit boxes (auto-submit).
// Success: confetti, "You're in, @handle!", any guest wins credited, then back to `?next=`.
// The first verified email creates the account; the guest's XP, badges and wins carry over.
import { useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, formatZec } from "@/lib/api";
import type { AuthStartResult, Player } from "@/lib/types";
import { Button, Confetti, Icon, Input, Logo, type IconName } from "@/components/zk";

type Reason = "win" | "hide" | "wallet" | "default";
type Step = "email" | "code" | "done";
type Note = { text: string; tone: "error" | "success" | "muted" };

const CODE_LEN = 6;
const RESEND_SECONDS = 30;
const REDIRECT_MS = 1400;
const EMPTY: string[] = Array.from({ length: CODE_LEN }, () => "");
// Same shape the server accepts (src/lib/server/auth.ts).
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

type Hero = { icon: IconName; grad: string; deep: string; ink: string };

const REASONS: Record<Reason, { title: string; sub: string; bg: string; hero: Hero }> = {
  win: {
    title: "Sign up to keep your ZEC",
    sub: "Just your email. We’ll send a 6-digit code and your win lands in your ZECKED wallet.",
    bg: "var(--zk-bg-hero-gold)",
    hero: { icon: "unlock", grad: "var(--zk-grad-tile-gold)", deep: "var(--zk-gold-deep)", ink: "var(--zk-gold-ink)" },
  },
  hide: {
    title: "Sign up to hide a stash",
    sub: "Just your email. We’ll send you a 6-digit code.",
    bg: "var(--zk-bg-hero-purple)",
    hero: { icon: "vault", grad: "var(--zk-grad-tile-purple)", deep: "var(--zk-purple-shade)", ink: "var(--zk-text)" },
  },
  wallet: {
    title: "Get your own ZECKED wallet",
    sub: "Just your email. We’ll send you a 6-digit code.",
    bg: "var(--zk-bg-hero-mint)",
    hero: { icon: "wallet", grad: "var(--zk-grad-tile-mint)", deep: "var(--zk-mint-deep)", ink: "var(--zk-mint-ink)" },
  },
  default: {
    title: "Welcome to ZECKED",
    sub: "Just your email. We’ll send you a 6-digit code.",
    bg: "var(--zk-bg-hero-purple)",
    hero: { icon: "sparkle", grad: "var(--zk-grad-tile-purple)", deep: "var(--zk-purple-shade)", ink: "var(--zk-text)" },
  },
};

const CODE_HERO: Hero = { icon: "bell", grad: "var(--zk-grad-tile-sky)", deep: "var(--zk-sky-shade)", ink: "var(--zk-sky-ink)" };

function readReason(raw: string | null): Reason {
  return raw === "win" || raw === "hide" || raw === "wallet" ? raw : "default";
}

/** Only same-origin paths: never `//host`, `javascript:`, or a loop back to /signin. */
function safeNext(raw: string | null): string {
  const v = (raw || "").trim();
  if (!v.startsWith("/") || v.startsWith("//") || /[\\\u0000-\u001f]/.test(v)) return "/feed";
  if (/^\/signin(?:[/?#]|$)/i.test(v)) return "/feed";
  return v;
}

const atHandle = (h: string) => (h.startsWith("@") ? h : `@${h}`);
const initialOf = (h: string) => (h.replace(/^@+/, "")[0] || "?").toUpperCase();
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback;

/* ---------- styles ---------- */

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

const heroTile = (h: Hero): CSSProperties => ({
  width: 64,
  height: 64,
  borderRadius: "var(--zk-radius-xl)",
  background: h.grad,
  color: h.ink,
  boxShadow: `var(--zk-inset-gloss), 0 4px 0 ${h.deep}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
});

const textBtn = (disabled: boolean): CSSProperties => ({
  minHeight: "var(--zk-tap-min)",
  padding: "0 var(--zk-space-8)",
  border: "none",
  background: "transparent",
  font: "var(--zk-type-small)",
  color: disabled ? "var(--zk-text-faint)" : "var(--zk-gold)",
  textDecoration: disabled ? "none" : "underline",
  textUnderlineOffset: 3,
  cursor: disabled ? "default" : "pointer",
  display: "inline-flex",
  alignItems: "center",
  fontVariantNumeric: "tabular-nums",
});

const digitBox = (filled: boolean, focused: boolean, bad: boolean): CSSProperties => ({
  width: "100%",
  minWidth: 0,
  height: 64,
  boxSizing: "border-box",
  margin: 0,
  padding: 0,
  textAlign: "center",
  borderRadius: "var(--zk-radius-lg)",
  background: bad ? "var(--zk-red-tint)" : "var(--zk-surface)",
  border: bad
    ? "2px solid var(--zk-red)"
    : focused
      ? "2px solid var(--zk-purple)"
      : filled
        ? "1.5px solid rgb(var(--zk-gold-rgb) / .55)"
        : "1.5px solid var(--zk-border-strong)",
  boxShadow: bad ? "none" : focused ? "var(--zk-ring-focus)" : "none",
  font: "var(--zk-fw-bold) var(--zk-fs-26)/1 var(--zk-font-mono)",
  color: bad ? "var(--zk-red-soft)" : filled ? "var(--zk-gold)" : "var(--zk-text)",
  caretColor: "var(--zk-purple-light)",
  outline: "none",
  appearance: "none",
  transition: "border-color var(--zk-dur-fast) var(--zk-ease-out),box-shadow var(--zk-dur-fast) var(--zk-ease-out)",
});

const noteColor: Record<Note["tone"], string> = {
  error: "var(--zk-red)",
  success: "var(--zk-mint)",
  muted: "var(--zk-text-muted)",
};

/* ---------- screen ---------- */

export default function SignIn() {
  const params = useSearchParams();
  const router = useRouter();
  const next = safeNext(params.get("next"));
  const reason = readReason(params.get("reason"));
  const copy = REASONS[reason];

  const [step, setStep] = useState<Step>("email");
  const [already, setAlready] = useState<Player | null>(null);

  // step 1
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailShake, setEmailShake] = useState(0);
  const [sending, setSending] = useState(false);

  // step 2
  const [sent, setSent] = useState<(AuthStartResult & { email: string; minutes: number }) | null>(null);
  const [digits, setDigits] = useState<string[]>(EMPTY);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const [bad, setBad] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [codeShake, setCodeShake] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);

  // success
  const [done, setDone] = useState<{ player: Player; creditedZat: number } | null>(null);

  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const busyVerify = useRef(false);
  const typed = useRef(false);
  const left = useRef(false);

  /** `hard`: after verify the session cookie rotates, so do a full navigation (no stale client state). */
  const leave = (hard = false) => {
    if (left.current) return;
    left.current = true;
    if (hard) window.location.replace(next);
    else router.replace(next);
  };

  // Already signed in? Offer a quick way on (unless they've started typing).
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then(({ player }) => {
        if (alive && player.account?.signedIn && !typed.current) setAlready(player);
      })
      .catch(() => {
        /* guest or offline: show the form */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Resend cooldown ticker.
  useEffect(() => {
    if (step !== "code" || resendAt <= Date.now()) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= resendAt) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [step, resendAt]);

  // Success: head back to where they came from.
  useEffect(() => {
    if (step !== "done") return;
    const t = setTimeout(() => leave(true), REDIRECT_MS);
    return () => clearTimeout(t);
    // `leave` only reads `next`, which is fixed for this screen.
  }, [step]);

  const focusBox = (i: number) => {
    requestAnimationFrame(() => {
      const el = boxes.current[Math.max(0, Math.min(CODE_LEN - 1, i))];
      el?.focus();
      el?.select();
    });
  };

  const failEmail = (msg: string) => {
    setEmailError(msg);
    setEmailShake((n) => n + 1);
  };

  /* ---------- actions ---------- */

  const sendCode = async (resend = false) => {
    if (sending) return;
    const e = resend && sent ? sent.email : email.trim();
    if (!e) return failEmail("Pop your email in first");
    if (!EMAIL_RE.test(e)) return failEmail("That email doesn’t look right");
    setSending(true);
    if (!resend) setEmailError("");
    try {
      const r = await api.authStart(e);
      const t = Date.now();
      const ms = Date.parse(r.expiresAt) - t;
      setSent({ ...r, email: e, minutes: Number.isFinite(ms) && ms > 0 ? Math.max(1, Math.round(ms / 60_000)) : 10 });
      setResendAt(t + RESEND_SECONDS * 1000);
      setNow(t);
      setDigits(EMPTY);
      setBad(false);
      setNote(resend ? { text: r.devCode ? "New code ready" : "New code sent. Check your inbox", tone: "success" } : null);
      setStep("code");
      focusBox(0);
    } catch (err) {
      const msg = errText(err, "Couldn’t send the code. Try again");
      if (resend) setNote({ text: msg, tone: "error" });
      else failEmail(msg);
    } finally {
      setSending(false);
    }
  };

  const verify = async (code: string) => {
    if (!sent || busyVerify.current) return;
    busyVerify.current = true;
    setVerifying(true);
    setNote(null);
    try {
      const r = await api.authVerify(sent.email, code);
      setDone(r);
      setStep("done");
    } catch (err) {
      setBad(true);
      setCodeShake((n) => n + 1);
      setNote({ text: errText(err, "That code didn’t work. Try again"), tone: "error" });
      setDigits(EMPTY);
      focusBox(0);
    } finally {
      busyVerify.current = false;
      setVerifying(false);
    }
  };

  const apply = (nextDigits: string[], focusTo?: number) => {
    setDigits(nextDigits);
    if (bad) setBad(false);
    if (note?.tone === "error") setNote(null);
    if (nextDigits.every(Boolean)) void verify(nextDigits.join(""));
    else if (focusTo !== undefined) focusBox(focusTo);
  };

  /** Writes digits starting at box `i`. A full code (paste, autofill) always fills every box. */
  const fillFrom = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, "");
    if (!d) return;
    const out = [...digits];
    if (d.length >= CODE_LEN) {
      d.slice(0, CODE_LEN)
        .split("")
        .forEach((c, k) => (out[k] = c));
      apply(out, CODE_LEN - 1);
      return;
    }
    let k = 0;
    for (; k < d.length && i + k < CODE_LEN; k++) out[i + k] = d[k];
    apply(out, i + k);
  };

  const onBoxChange = (i: number, raw: string) => {
    if (verifying) return;
    let d = raw.replace(/\D/g, "");
    if (!d) {
      const out = [...digits];
      out[i] = "";
      apply(out);
      return;
    }
    // Typed into a filled box without the old digit being selected: keep the new one.
    const prev = digits[i];
    if (d.length === 2 && prev) d = d[0] === prev ? d[1] : d[0];
    fillFrom(i, d);
  };

  const onBoxKey = (i: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      const out = [...digits];
      out[i - 1] = "";
      apply(out, i - 1);
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === "ArrowRight" && i < CODE_LEN - 1) {
      e.preventDefault();
      focusBox(i + 1);
    } else if (e.key === "Enter" && digits.every(Boolean)) {
      e.preventDefault();
      void verify(digits.join(""));
    }
  };

  const onBoxPaste = (i: number) => (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (!verifying) fillFrom(i, e.clipboardData.getData("text"));
  };

  const fillDevCode = () => {
    if (sent?.devCode && !verifying) fillFrom(0, sent.devCode);
  };

  const differentEmail = () => {
    setStep("email");
    setDigits(EMPTY);
    setBad(false);
    setNote(null);
    setEmailError("");
  };

  const goBack = () => {
    if (step === "code") return differentEmail();
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.replace(next);
  };

  /* ---------- render ---------- */

  const footer = (
    <p
      style={{
        margin: 0,
        marginTop: "auto",
        paddingTop: "var(--zk-space-24)",
        textAlign: "center",
        font: "var(--zk-fw-medium) var(--zk-fs-11)/1 var(--zk-font-body)",
        color: "var(--zk-text-faint)",
        letterSpacing: ".04em",
      }}
    >
      Built on Zcash · Free to play
    </p>
  );

  if (step === "done" && done) {
    const handle = atHandle(done.player.handle);
    return (
      <main className="zk-screen" style={{ background: "var(--zk-bg-claimed)", overflow: "hidden" }}>
        <Confetti count={80} seed={11} />
        <div
          role="status"
          style={{
            position: "relative",
            zIndex: 6,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--zk-space-14)",
            textAlign: "center",
          }}
        >
          <div style={{ position: "relative", width: 112, height: 112, flex: "none", marginBottom: "var(--zk-space-8)" }}>
            {[0, 1].map((k) => (
              <div
                key={k}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: "3px solid rgb(var(--zk-mint-rgb) / .6)",
                  willChange: "transform, opacity",
                  animation: `zk-ring 2s var(--zk-ease-out) ${k}s infinite`,
                }}
              />
            ))}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: "50%",
                background: "var(--zk-grad-tile-purple)",
                boxShadow: "var(--zk-inset-gloss), 0 5px 0 var(--zk-purple-shade)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                font: "var(--zk-fw-black) var(--zk-fs-52)/1 var(--zk-font-display)",
                animation: "zk-pop var(--zk-dur-pop) var(--zk-ease-spring) both",
              }}
            >
              {initialOf(handle)}
            </div>
          </div>
          <h1 style={{ margin: 0, font: "var(--zk-type-h1)", letterSpacing: "-.01em", overflowWrap: "anywhere" }}>
            You’re in, {handle}!
          </h1>
          {done.creditedZat > 0 && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--zk-space-8)",
                padding: "var(--zk-space-8) var(--zk-space-14)",
                borderRadius: "var(--zk-radius-lg)",
                background: "var(--zk-gold-tint)",
                border: "1px solid rgb(var(--zk-gold-rgb) / .35)",
                font: "var(--zk-type-mono-sm)",
                color: "var(--zk-gold)",
              }}
            >
              <Icon icon="coin" size={16} stroke={2.4} />+{formatZec(done.creditedZat)} ZEC added to your wallet
            </div>
          )}
          <p style={{ margin: 0, font: "var(--zk-type-body-lg)", fontWeight: "var(--zk-fw-semibold)", color: "var(--zk-text-muted)" }}>
            Your XP and badges came along. Taking you back…
          </p>
        </div>
        <div style={{ position: "relative", zIndex: 6 }}>
          <Button label="Continue" iconRight="arrowRight" variant="primary" size="lg" onClick={() => leave(true)} />
        </div>
        {footer}
      </main>
    );
  }

  const isCode = step === "code" && !!sent;
  const hero = isCode ? CODE_HERO : copy.hero;
  const cooldown = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const shakeAnim =
    codeShake > 0 ? `${codeShake % 2 ? "zk-shake-a" : "zk-shake-b"} var(--zk-dur-shake) var(--zk-ease-in-out)` : "none";

  let body: ReactNode;
  if (already && step === "email") {
    body = (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
          <h1 style={{ margin: 0, font: "var(--zk-type-h1)", letterSpacing: "-.01em" }}>You’re already in!</h1>
          <p style={{ margin: 0, font: "var(--zk-type-body-lg)", color: "var(--zk-text-muted)" }}>
            Signed in as{" "}
            <strong style={{ color: "var(--zk-text)", fontWeight: "var(--zk-fw-bold)" }}>
              {already.account.email || atHandle(already.handle)}
            </strong>
            .
          </p>
        </div>
        <Button label="Continue" iconRight="arrowRight" variant="primary" size="lg" onClick={() => leave()} />
        <div style={{ display: "flex", justifyContent: "center", marginTop: "calc(-1 * var(--zk-space-8))" }}>
          <button type="button" onClick={() => setAlready(null)} style={textBtn(false)}>
            Use a different email
          </button>
        </div>
      </>
    );
  } else if (isCode) {
    body = (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
          <h1 style={{ margin: 0, font: "var(--zk-type-h1)", letterSpacing: "-.01em" }}>Check your inbox</h1>
          <p style={{ margin: 0, font: "var(--zk-type-body-lg)", color: "var(--zk-text-muted)", overflowWrap: "anywhere" }}>
            We sent a 6-digit code to{" "}
            <strong style={{ color: "var(--zk-text)", fontWeight: "var(--zk-fw-bold)" }}>{sent.sentTo}</strong>.
          </p>
        </div>

        {sent.devCode && (
          <div
            role="note"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--zk-space-10)",
              padding: "var(--zk-space-10) var(--zk-space-10) var(--zk-space-10) var(--zk-space-12)",
              borderRadius: "var(--zk-radius-lg)",
              background: "var(--zk-gold-tint)",
              border: "1px solid rgb(var(--zk-gold-rgb) / .35)",
              color: "var(--zk-gold)",
              font: "var(--zk-type-caption)",
            }}
          >
            <span style={{ flex: "none", display: "flex" }}>
              <Icon icon="flag" size={16} stroke={2.2} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              Test mode: email isn’t set up yet. Your code is{" "}
              <span style={{ font: "var(--zk-type-mono-sm)", letterSpacing: ".08em", whiteSpace: "nowrap" }}>{sent.devCode}</span>
            </span>
            <Button label="Use code" variant="primary" size="sm" full={false} disabled={verifying} onClick={fillDevCode} />
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
          <div
            role="group"
            aria-label="6-digit code"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${CODE_LEN}, 1fr)`,
              gap: "var(--zk-space-8)",
              animation: shakeAnim,
            }}
          >
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  boxes.current[i] = el;
                }}
                value={d}
                onChange={(e) => onBoxChange(i, e.target.value)}
                onKeyDown={onBoxKey(i)}
                onPaste={onBoxPaste(i)}
                onFocus={(e) => {
                  setFocusIdx(i);
                  e.currentTarget.select();
                }}
                onBlur={() => setFocusIdx((f) => (f === i ? null : f))}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                autoFocus={i === 0}
                readOnly={verifying}
                aria-label={`Digit ${i + 1} of ${CODE_LEN}`}
                aria-invalid={bad}
                style={digitBox(!!d, focusIdx === i, bad)}
              />
            ))}
          </div>
          <span
            aria-live="polite"
            style={{
              minHeight: 16,
              font: "var(--zk-type-caption)",
              color: verifying ? "var(--zk-text-muted)" : note ? noteColor[note.tone] : "var(--zk-text-muted)",
              textAlign: "center",
            }}
          >
            {verifying ? "Checking…" : note ? note.text : `It works for ${sent.minutes} minutes.`}
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "0 var(--zk-space-12)", marginTop: "calc(-1 * var(--zk-space-6))" }}>
          <button
            type="button"
            onClick={() => void sendCode(true)}
            disabled={cooldown > 0 || sending}
            style={textBtn(cooldown > 0 || sending)}
          >
            {sending ? "Sending…" : cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
          <button type="button" onClick={differentEmail} style={textBtn(false)}>
            Use a different email
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
          <h1 style={{ margin: 0, font: "var(--zk-type-h1)", letterSpacing: "-.01em" }}>{copy.title}</h1>
          <p style={{ margin: 0, font: "var(--zk-type-body-lg)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>{copy.sub}</p>
        </div>
        <Input
          value={email}
          onChange={(v) => {
            typed.current = true;
            setEmail(v);
            if (emailError) setEmailError("");
          }}
          onEnter={() => void sendCode()}
          label="Your email"
          placeholder="you@example.com"
          type="email"
          inputMode="email"
          name="email"
          autoComplete="email"
          spellCheck={false}
          maxLength={254}
          autoFocus
          state={emailError ? "error" : "default"}
          message={emailError || "First time? This creates your account. Your XP and badges come with you."}
          shake={emailShake}
        />
        <Button
          label={sending ? "Sending…" : "Send my code"}
          iconRight={sending ? undefined : "arrowRight"}
          variant="primary"
          size="lg"
          disabled={sending}
          onClick={() => void sendCode()}
        />
      </>
    );
  }

  return (
    <main className="zk-screen" style={{ background: copy.bg, gap: "var(--zk-space-20)" }}>
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" aria-label={isCode ? "Back to email" : "Back"} onClick={goBack} style={navBtn}>
          <Icon icon="back" size={22} stroke={2.4} />
        </button>
        <Logo variant="wordmark" size={24} />
        <span aria-hidden="true" style={{ width: "var(--zk-tap-min)", flex: "none" }} />
      </nav>
      <div style={{ ...heroTile(hero), marginTop: "var(--zk-space-12)" }} aria-hidden="true">
        <Icon icon={hero.icon} size={30} stroke={2.4} />
      </div>
      {body}
      {footer}
    </main>
  );
}
