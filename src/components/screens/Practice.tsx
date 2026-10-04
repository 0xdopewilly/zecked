"use client";
// Free practice riddle: the core mechanic (crack a riddle) with zero risk and zero sign-up. It looks and
// plays like the real riddle screen (RiddleStash: live card, 3 tries, shake on a miss, answer reveal),
// but everything runs in the browser: a small bank of easy riddles, the server's forgiving answer
// matching, a hint once you've missed, and a win moment that points at real stashes.
// Solving one sets "zk:practice-done" (the feed stops suggesting practice). The 3-step rules card shows
// until it's dismissed ("zk:practice-rules") and can be reopened from the ⓘ button.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { sfx } from "@/lib/sfx";
import { useAppBack } from "@/lib/nav";
import { Button, Confetti, CountUp, Icon, Input, Logo, Vault } from "@/components/zk";

const MAX_TRIES = 3;
const PRIZE_ZEC = 0.02;
const DONE_KEY = "zk:practice-done";
const RULES_KEY = "zk:practice-rules";
const SEEN_KEY = "zk:practice-seen";

/* ---------- the riddle bank ---------- */

interface PracticeRiddle {
  text: string;
  /** Shown in the answer reveal. */
  show: string;
  /** Every accepted answer (matched the server's way, so "A Vault!" counts as "vault"). */
  answers: string[];
  hint: string;
}

// Easy on purpose, and none of them is in the house's riddle bank (a practice reveal must never give away
// the answer to a real stash).
const BANK: PracticeRiddle[] = [
  {
    text: "I have a door and a dial, and I’m full of coins. What am I?",
    show: "A vault",
    answers: ["vault", "vaults", "safe", "bank vault", "strongbox", "safe box", "money vault"],
    hint: "Every ZECKED stash hides in one 🔐",
  },
  {
    text: "What has a bark but no bite?",
    show: "A tree",
    answers: ["tree", "trees", "oak", "oak tree", "pine tree", "tree trunk"],
    hint: "It grows in a forest 🌲",
  },
  {
    text: "What kind of room has no doors and no windows?",
    show: "A mushroom",
    answers: ["mushroom", "mushrooms", "mushroom room"],
    hint: "It grows in the woods. Great on pizza.",
  },
  {
    text: "What’s full of holes but still holds water?",
    show: "A sponge",
    answers: ["sponge", "sponges", "kitchen sponge", "spongebob"],
    hint: "You’ll find it by the kitchen sink.",
  },
  {
    text: "What has a thumb and four fingers, but isn’t alive?",
    show: "A glove",
    answers: ["glove", "gloves", "rubber glove", "mitt"],
    hint: "Keeps your hand warm in winter 🧤",
  },
  {
    text: "What building has the most stories?",
    show: "A library",
    answers: ["library", "libraries", "public library", "bookstore", "book store"],
    hint: "Shh! It’s full of books.",
  },
];

/** The server's answer cleanup: no accents, lowercase, punctuation to spaces, one space, no leading a/an/the. */
function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the) /, "");
}

function isRight(r: PracticeRiddle, guess: string): boolean {
  const g = normalize(guess);
  return !!g && r.answers.some((a) => normalize(a) === g);
}

/* ---------- small helpers ---------- */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ORDINAL = ["first", "second", "third"];

/** "4m 12s", "38s". */
function formatDuration(sec: number): string {
  const s = Math.max(1, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function reducedMotion(): boolean {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readSeen(): number[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]");
    return Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < BANK.length) : [];
  } catch {
    return [];
  }
}

/** A riddle you haven't had this visit (once you've had them all, any but the current one). */
function pickNext(current: number | null): number {
  let seen = readSeen();
  let pool = BANK.map((_, i) => i).filter((i) => i !== current && !seen.includes(i));
  if (!pool.length) {
    seen = [];
    pool = BANK.map((_, i) => i).filter((i) => i !== current);
  }
  const next = pool[Math.floor(Math.random() * pool.length)] ?? 0;
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen, next]));
  } catch {}
  return next;
}

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

const riddleText: CSSProperties = {
  margin: 0,
  font: "var(--zk-type-riddle)",
  letterSpacing: "-.01em",
  textWrap: "pretty",
  overflowWrap: "anywhere",
};

const metaItem: CSSProperties = { display: "flex", alignItems: "center", gap: "var(--zk-space-4)" };

const dot = (on: boolean): CSSProperties => ({
  width: 12,
  height: 12,
  borderRadius: "50%",
  flex: "none",
  background: on ? "var(--zk-gold)" : "rgb(var(--zk-red-rgb) / .35)",
});

const tile = (grad: string, edge: string, ink: string, size = 40): CSSProperties => ({
  width: size,
  height: size,
  borderRadius: "var(--zk-radius-md)",
  background: grad,
  boxShadow: `var(--zk-inset-gloss), 0 3px 0 ${edge}`,
  color: ink,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
});

const RULES: { icon: string; grad: string; edge: string; ink: string; text: string }[] = [
  { icon: "vault", grad: "var(--zk-grad-tile-purple)", edge: "var(--zk-purple-shade)", ink: "var(--zk-text)", text: "Someone hides ZEC behind a riddle" },
  { icon: "unlock", grad: "var(--zk-grad-tile-gold)", edge: "var(--zk-gold-deep)", ink: "var(--zk-gold-ink)", text: "First right answer keeps it" },
  { icon: "key", grad: "var(--zk-grad-tile-sky)", edge: "var(--zk-sky-shade)", ink: "var(--zk-text)", text: "3 tries every 10 minutes" },
];

/** Entrances (same as the real riddle screen). Instant under reduced motion. */
const CSS = `
@keyframes zk-rs-in { from { opacity: 0; transform: translateY(10px) scale(.97) } to { opacity: 1; transform: none } }
@keyframes zk-rs-reveal { 0% { opacity: 0; transform: scale(.7); filter: blur(10px) } 60% { opacity: 1; transform: scale(1.06); filter: blur(0) } 100% { transform: none } }
@keyframes zk-rs-glint { 0%, 100% { box-shadow: 0 0 0 0 rgb(var(--zk-gold-rgb) / 0) } 40% { box-shadow: 0 0 0 6px rgb(var(--zk-gold-rgb) / .28) } }
`;

/* ---------- component ---------- */

interface Wrong {
  /** The raw input value that was submitted (the input shows it struck through). */
  raw: string;
}

export default function Practice() {
  const goBack = useAppBack("/feed");
  // Picked on the client (random, and it remembers what you've had): nothing riddle-shaped is server-rendered.
  const [idx, setIdx] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const [rules, setRules] = useState(false);
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState<Wrong | null>(null);
  const [shake, setShake] = useState(0);
  const [triesLeft, setTriesLeft] = useState(MAX_TRIES);
  const [hint, setHint] = useState(false);
  const [solved, setSolved] = useState<{ seconds: number; tries: number } | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const idxRef = useRef<number | null>(null);
  const startedAt = useRef(0);
  const inputWrap = useRef<HTMLDivElement>(null);
  const endedRef = useRef<HTMLDivElement>(null);

  // Before the first paint on the client: the first riddle, and the rules card for first-timers.
  useLayoutEffect(() => {
    idxRef.current = pickNext(null);
    setIdx(idxRef.current);
    startedAt.current = Date.now();
    try {
      setRules(!localStorage.getItem(RULES_KEY) && !localStorage.getItem(DONE_KEY));
    } catch {
      setRules(true);
    }
  }, []);

  const riddle = idx === null ? null : BANK[idx];
  const out = triesLeft <= 0 && !solved;
  const strike = !!wrong && answer === wrong.raw;
  const wrongLayout = !!wrong && !out && !solved;
  const hintReady = triesLeft < MAX_TRIES;

  const focusInput = () => {
    requestAnimationFrame(() => inputWrap.current?.querySelector<HTMLInputElement>("input")?.focus());
  };

  const closeRules = () => {
    setRules(false);
    try {
      localStorage.setItem(RULES_KEY, new Date().toISOString());
    } catch {}
  };

  const tryAgain = () => {
    setAnswer("");
    setWrong(null);
    focusInput();
  };

  const submit = () => {
    const v = answer.trim();
    if (!riddle || solved || out) return;
    if (!v) {
      focusInput();
      return;
    }
    // You're playing: the rules card has done its job (the ⓘ button brings it back).
    if (rules) closeRules();
    const used = MAX_TRIES - triesLeft + 1;
    if (isRight(riddle, v)) {
      setWrong(null);
      setSolved({ seconds: (Date.now() - startedAt.current) / 1000, tries: used });
      setCelebrate(true);
      try {
        localStorage.setItem(DONE_KEY, new Date().toISOString());
      } catch {}
      return;
    }
    const left = triesLeft - 1;
    setTriesLeft(left);
    setWrong({ raw: answer });
    setShake((n) => n + 1);
    // The last try: a heavier sound, like the real game's locked state.
    sfx(left <= 0 ? "error" : "wrong");
  };

  const primary = () => {
    if (strike) tryAgain();
    else submit();
  };

  const another = useCallback(() => {
    idxRef.current = pickNext(idxRef.current);
    setIdx(idxRef.current);
    setRound((n) => n + 1);
    setAnswer("");
    setWrong(null);
    setShake(0);
    setTriesLeft(MAX_TRIES);
    setHint(false);
    setSolved(null);
    setCelebrate(false);
    startedAt.current = Date.now();
    // Done one already: the rules card has done its job.
    try {
      if (localStorage.getItem(DONE_KEY)) setRules(false);
    } catch {}
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  }, []);

  const closeWin = useCallback(() => {
    setCelebrate(false);
    requestAnimationFrame(() => endedRef.current?.focus({ preventScroll: true }));
  }, []);

  /* ---------- pieces ---------- */

  const bg = wrongLayout || out ? "var(--zk-bg-hero-red)" : solved ? "var(--zk-bg-hero-gold)" : "var(--zk-bg-hero-purple)";

  const nav = (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <button type="button" aria-label="Back" onClick={goBack} style={navBtn}>
        <Icon icon="back" size={22} stroke={2.4} />
      </button>
      <span style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-pink)" }}>PRACTICE RIDDLE</span>
      <button
        type="button"
        aria-label="How it works"
        aria-expanded={rules}
        aria-controls="zk-practice-rules"
        data-sfx="tap"
        onClick={() => (rules ? closeRules() : setRules(true))}
        style={{
          ...navBtn,
          color: rules ? "var(--zk-purple-light)" : navBtn.color,
          boxShadow: rules ? "inset 0 0 0 1.5px rgb(var(--zk-purple-rgb) / .7)" : undefined,
        }}
      >
        <Icon icon="info" size={20} stroke={2.2} />
      </button>
    </nav>
  );

  // Where the real screen shows the hider: the house, and the (pretend) prize.
  const hostRow = (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
      <div aria-hidden="true" style={{ ...tile("var(--zk-grad-tile-gold)", "var(--zk-gold-deep)", "var(--zk-gold-ink)", 42), borderRadius: "50%" }}>
        <Logo variant="mark" size={20} stroke="var(--zk-gold-ink)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--zk-type-body-strong)", fontSize: "var(--zk-fs-15)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          ZECKED practice
        </div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-gold)" }}>Free · no sign-up</div>
      </div>
      <div style={{ textAlign: "right", flex: "none" }}>
        <span className="zk-sr-only">Pretend prize: {PRIZE_ZEC} ZEC</span>
        <div aria-hidden="true" style={{ font: "var(--zk-type-mono-lg)", fontSize: "min(var(--zk-fs-22), 5.6vw)", color: "var(--zk-gold)", whiteSpace: "nowrap" }}>
          {PRIZE_ZEC} ZEC
        </div>
        <div aria-hidden="true" style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>
          pretend prize
        </div>
      </div>
    </div>
  );

  const rulesCard = rules ? (
    <section
      id="zk-practice-rules"
      aria-label="How it works"
      style={{
        position: "relative",
        background: "var(--zk-surface)",
        border: "1.5px solid var(--zk-border)",
        borderRadius: "var(--zk-radius-2xl)",
        padding: "var(--zk-space-14) var(--zk-space-16) var(--zk-space-16)",
        animation: "zk-rs-in 320ms var(--zk-ease-out) both",
      }}
    >
      <div style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-gold)", paddingRight: 44 }}>HOW IT WORKS</div>
      <button
        type="button"
        aria-label="Got it, hide this"
        data-sfx="tap"
        onClick={closeRules}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: "var(--zk-tap-min)",
          height: "var(--zk-tap-min)",
          border: 0,
          padding: 0,
          background: "transparent",
          color: "var(--zk-text-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <span style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--zk-surface-raised)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon icon="close" size={14} stroke={2.8} />
        </span>
      </button>
      <ol style={{ listStyle: "none", margin: "var(--zk-space-12) 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
        {RULES.map((s, i) => (
          <li key={s.text} style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-12)" }}>
            <div aria-hidden="true" style={tile(s.grad, s.edge, s.ink, 34)}>
              <Icon icon={s.icon} size={18} stroke={2.4} />
            </div>
            <span style={{ font: "var(--zk-type-body-strong)", minWidth: 0 }}>
              <span className="zk-sr-only">{i + 1}. </span>
              {s.text}
            </span>
          </li>
        ))}
      </ol>
    </section>
  ) : null;

  // The playful label, where a real stash shows "Live · Prize verified".
  const practiceChip = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--zk-space-6)",
        maxWidth: "100%",
        padding: "var(--zk-space-6) var(--zk-space-12) var(--zk-space-6) var(--zk-space-10)",
        borderRadius: "var(--zk-radius-lg)",
        background: "rgb(var(--zk-pink-rgb) / .14)",
        border: "1px solid rgb(var(--zk-pink-rgb) / .4)",
        color: "var(--zk-pink)",
        // One line down to 320px phones; if it ever has to wrap, it breaks after the "·".
        font: "var(--zk-fw-black) clamp(10.5px, 3.3vw, var(--zk-fs-12))/1.25 var(--zk-font-body)",
        transform: "rotate(-1.5deg)",
        transformOrigin: "left center",
      }}
    >
      <Icon icon="sparkle" size={14} stroke={2.6} />
      <span>
        <span style={{ whiteSpace: "nowrap" }}>Practice riddle ·</span>{" "}
        <span style={{ whiteSpace: "nowrap", fontWeight: "var(--zk-fw-semibold)" }}>no ZEC, just for fun</span>
      </span>
    </span>
  );

  const metaRow = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        columnGap: "var(--zk-space-14)",
        rowGap: "var(--zk-space-6)",
        font: "var(--zk-type-caption)",
        color: "var(--zk-text-muted)",
      }}
    >
      <span style={metaItem}>
        <Icon icon="key" size={14} />
        {plural(MAX_TRIES, "try", "tries")}
      </span>
      <span style={metaItem}>
        <Icon icon="bulb" size={14} />
        Hint after a miss
      </span>
      <span style={metaItem}>
        <Icon icon="hourglass" size={14} />
        No clock
      </span>
    </div>
  );

  const liveCard = riddle ? (
    <section
      key={`card-${round}`}
      aria-label="Practice riddle"
      style={{
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-3xl)",
        padding: "var(--zk-space-20)",
        border: "1.5px solid rgb(var(--zk-purple-rgb) / .35)",
        boxShadow: "var(--zk-glow-purple)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--zk-space-14)",
        animation: "zk-rs-in 380ms var(--zk-ease-out) both",
      }}
    >
      <div>{practiceChip}</div>
      <h1 style={riddleText}>{riddle.text}</h1>
      {metaRow}
    </section>
  ) : null;

  // Solved: the card dimmed with the ZECKED stamp, like a zecked stash.
  const endedCard = riddle ? (
    <section
      aria-label="Practice riddle"
      style={{
        position: "relative",
        background: "var(--zk-surface)",
        borderRadius: "var(--zk-radius-3xl)",
        padding: "var(--zk-space-20)",
        border: "1.5px solid var(--zk-border)",
      }}
    >
      <div style={{ opacity: 0.45, display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
        <div>{practiceChip}</div>
        <h1 style={riddleText}>{riddle.text}</h1>
      </div>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          right: "var(--zk-space-18)",
          top: "50%",
          marginTop: -26,
          transform: "rotate(-8deg)",
          display: "flex",
          alignItems: "center",
          gap: "var(--zk-space-8)",
          padding: "var(--zk-space-8) var(--zk-space-14)",
          borderRadius: "var(--zk-radius-md)",
          border: "3px solid var(--zk-pink)",
          background: "rgb(var(--zk-bg-rgb) / .85)",
          color: "var(--zk-pink)",
          font: "var(--zk-type-btn-md)",
        }}
      >
        <Icon icon="unlock" size={20} stroke={2.6} />
        ZECKED
      </div>
    </section>
  ) : null;

  const answerReveal = riddle ? (
    <section
      aria-label="The answer"
      style={{
        background: "var(--zk-surface)",
        border: "1.5px solid rgb(var(--zk-gold-rgb) / .45)",
        borderRadius: "var(--zk-radius-2xl)",
        padding: "var(--zk-space-14) var(--zk-space-16)",
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-14)",
        animation: "zk-rs-in 380ms var(--zk-ease-out) both, zk-rs-glint 1.2s var(--zk-ease-out) 700ms both",
      }}
    >
      <div style={{ ...tile("var(--zk-grad-tile-gold)", "var(--zk-gold-deep)", "var(--zk-gold-ink)", 44), borderRadius: "var(--zk-radius-lg)" }}>
        <Icon icon="key" size={22} stroke={2.4} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)", color: "var(--zk-gold)" }}>THE ANSWER WAS</div>
        <div
          style={{
            font: "var(--zk-type-h2)",
            color: "var(--zk-text)",
            marginTop: "var(--zk-space-4)",
            overflowWrap: "anywhere",
            transformOrigin: "left center",
            animation: "zk-rs-reveal 700ms var(--zk-ease-out) 250ms both",
          }}
        >
          {riddle.show}
        </div>
      </div>
    </section>
  ) : null;

  const triesRow = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--zk-space-8)", minHeight: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", minWidth: 0 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} aria-hidden="true" style={dot(i < triesLeft)} />
        ))}
        <span style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", marginLeft: "var(--zk-space-4)" }}>
          {triesLeft < MAX_TRIES ? `${plural(triesLeft, "try", "tries")} left` : `${MAX_TRIES} tries, like the real game`}
        </span>
      </div>
    </div>
  );

  // Locked until your first miss, then a tap reveals it (the real game unlocks hints on a timer).
  const hintBox: CSSProperties = {
    width: "100%",
    minHeight: 68,
    background: "var(--zk-surface)",
    borderRadius: "var(--zk-radius-xl)",
    padding: "var(--zk-space-14) var(--zk-space-16)",
    display: "flex",
    alignItems: "center",
    gap: "var(--zk-space-12)",
    textAlign: "left",
    color: "var(--zk-text)",
  };
  const hintTile = (on: boolean) => ({
    width: 40,
    height: 40,
    borderRadius: "var(--zk-radius-md)",
    background: on ? "var(--zk-gold-tint)" : "var(--zk-surface-raised)",
    color: on ? "var(--zk-gold)" : "var(--zk-text-muted)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
  });
  const hintRow = !riddle ? null : hint ? (
    <div
      key={`hint-${round}`}
      role="status"
      style={{
        ...hintBox,
        border: "1.5px solid rgb(var(--zk-gold-rgb) / .35)",
        animation: "zk-rs-in 380ms var(--zk-ease-spring) both, zk-rs-glint 1.2s var(--zk-ease-out) 300ms both",
      }}
    >
      <div style={hintTile(true)}>
        <Icon icon="bulb" size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--zk-type-body-strong)" }}>Hint</div>
        <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text)", overflowWrap: "anywhere" }}>{riddle.hint}</div>
      </div>
      <span style={{ color: "var(--zk-gold)", flex: "none" }}>
        <Icon icon="unlock" size={18} />
      </span>
    </div>
  ) : hintReady ? (
    <button
      type="button"
      data-sfx="select"
      onClick={() => setHint(true)}
      style={{
        ...hintBox,
        border: "1.5px solid rgb(var(--zk-gold-rgb) / .5)",
        cursor: "pointer",
        animation: "zk-rs-glint 1.2s var(--zk-ease-out) 200ms 2 both",
      }}
    >
      <div style={hintTile(true)}>
        <Icon icon="bulb" size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--zk-type-body-strong)" }}>Stuck? Get a hint</div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-gold)" }}>Tap to see it</div>
      </div>
      <span style={{ color: "var(--zk-gold)", flex: "none" }}>
        <Icon icon="arrowRight" size={18} stroke={2.4} />
      </span>
    </button>
  ) : (
    <div style={{ ...hintBox, border: "1.5px dashed rgb(var(--zk-white-rgb) / .2)" }}>
      <div style={hintTile(false)}>
        <Icon icon="bulb" size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--zk-type-body-strong)" }}>Hint</div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>Unlocks after one miss</div>
      </div>
      <span style={{ color: "var(--zk-text-muted)", flex: "none" }}>
        <Icon icon="lock" size={18} />
      </span>
    </div>
  );

  const answerBox = (
    <>
      <div ref={inputWrap}>
        <Input
          value={answer}
          onChange={(v) => setAnswer(v)}
          onEnter={primary}
          placeholder="Type your answer…"
          ariaLabel="Your answer"
          state={strike ? "error" : "default"}
          strike={strike}
          shake={shake}
          maxLength={80}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <Button
        label={strike ? "TRY AGAIN" : "ZECK IT"}
        iconRight={strike ? undefined : "unlock"}
        variant="primary"
        size="lg"
        // A wrong guess already plays its own sound.
        sfx={strike ? "pop" : "none"}
        onClick={primary}
      />
    </>
  );

  const bottom = (children: ReactNode) => (
    <div style={{ marginTop: "auto", paddingTop: "var(--zk-space-8)", display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>{children}</div>
  );

  const skip = <Button label="Skip this one" icon="sparkle" variant="ghost" size="md" onClick={another} sfx="whoosh" />;

  const statusBlock = (title: ReactNode, sub: ReactNode, color: string) => (
    <div
      ref={endedRef}
      tabIndex={-1}
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--zk-space-6)",
        padding: "var(--zk-space-10) 0 var(--zk-space-4)",
        textAlign: "center",
        outline: "none",
      }}
    >
      <div style={{ font: "var(--zk-type-h2)", color, textWrap: "balance" }}>{title}</div>
      <div style={{ font: "var(--zk-type-body)", fontSize: "var(--zk-fs-15)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>{sub}</div>
    </div>
  );

  /* ---------- body per state ---------- */

  let body: ReactNode = null;
  if (!riddle) {
    body = null;
  } else if (solved) {
    body = (
      <>
        {endedCard}
        {statusBlock(
          "You cracked it!",
          `Cracked in ${formatDuration(solved.seconds)} · ${ORDINAL[solved.tries - 1] ?? "last"} try. Real stashes work exactly like this.`,
          "var(--zk-gold)",
        )}
        {answerReveal}
        {bottom(
          <>
            <Button label="Crack a real stash" iconRight="arrowRight" variant="primary" size="lg" href="/feed" />
            <Button label="Try another practice riddle" icon="sparkle" variant="secondary" size="md" onClick={another} sfx="whoosh" />
            <Button label="Hide your own" icon="plus" variant="ghost" size="md" href="/hide" />
          </>,
        )}
      </>
    );
  } else if (out) {
    body = (
      <>
        <div style={{ background: "var(--zk-surface)", borderRadius: "var(--zk-radius-3xl)", padding: "var(--zk-space-20)", opacity: 0.75 }}>
          <h1 style={riddleText}>{riddle.text}</h1>
        </div>
        {statusBlock("Out of tries", "No harm done. On a real stash you’d get 3 fresh tries in 10 minutes.", "var(--zk-red)")}
        {answerReveal}
        {bottom(
          <>
            <Button label="Try another practice riddle" icon="sparkle" variant="primary" size="lg" onClick={another} sfx="whoosh" style={{ font: "var(--zk-type-btn-md)" }} />
            <Button label="Crack a real stash" iconRight="arrowRight" variant="ghost" size="md" href="/feed" />
          </>,
        )}
      </>
    );
  } else if (wrongLayout) {
    // Same as the real wrong-answer screen: the riddle dims, a big Nope!, the hint in reach.
    body = (
      <>
        <div style={{ background: "var(--zk-surface)", borderRadius: "var(--zk-radius-3xl)", padding: "var(--zk-space-20)", opacity: 0.75 }}>
          <h1 style={riddleText}>{riddle.text}</h1>
        </div>
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--zk-space-6)",
            padding: "var(--zk-space-10) 0 var(--zk-space-4)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              font: "var(--zk-fw-black) var(--zk-fs-40)/1 var(--zk-font-display)",
              color: "var(--zk-red)",
              transform: "rotate(-3deg)",
              textShadow: "var(--zk-text-shadow-red)",
            }}
          >
            Nope!
          </div>
          <div style={{ font: "var(--zk-type-btn-md)" }}>{plural(triesLeft, "try", "tries")} left</div>
          <div style={{ font: "var(--zk-type-body)", fontSize: "var(--zk-fs-15)", color: "var(--zk-text-muted)" }}>Try again 😏</div>
        </div>
        {answerBox}
        {triesRow}
        {hintRow}
        {bottom(skip)}
      </>
    );
  } else {
    body = (
      <>
        {liveCard}
        {answerBox}
        {triesRow}
        {hintRow}
        {bottom(skip)}
      </>
    );
  }

  return (
    <>
      <main className="zk-screen" style={{ background: bg, gap: "var(--zk-space-14)" }}>
        <style>{CSS}</style>
        {nav}
        {hostRow}
        {rulesCard}
        {body}
      </main>
      {celebrate && solved && <PracticeWin seconds={solved.seconds} tries={solved.tries} onClose={closeWin} onAnother={another} />}
    </>
  );
}

/* ---------- the win moment (pretend) ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Vault size and position (as the real win moment; smaller on short phones so the headline stays up). */
function stage(w: number, h: number) {
  const size = h < 640 ? 120 : w < 360 ? 160 : 190;
  const top = h < 640 ? 30 : h < 760 ? 48 : 90;
  return { size, top, dx: Math.round(size * 0.285), content: top + size + 24, short: h < 640 };
}

const WIN_CSS = `
@keyframes zk-win-rise { from { opacity: 0; transform: translateY(14px) scale(.96) } to { opacity: 1; transform: none } }
@keyframes zk-win-vault { 0% { transform: scale(.55) rotate(-14deg); opacity: 0 } 55% { transform: scale(1.08) rotate(3deg); opacity: 1 } 100% { transform: none } }
`;

const rise = (reduced: boolean, delayMs: number): CSSProperties =>
  reduced ? {} : { animation: `zk-win-rise 420ms var(--zk-ease-spring) ${delayMs}ms both` };

function PracticeWin({ seconds, tries, onClose, onAnother }: { seconds: number; tries: number; onClose: () => void; onAnother: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(true);
  // Only ever mounted on the client (after a solve), so reading window up front is safe.
  const [reduced] = useState(() => reducedMotion());
  const [st] = useState(() => stage(Math.min(430, window.innerWidth), window.innerHeight));

  // Kept in refs so inline callbacks never re-run the focus/inert effect below.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const close = useCallback(() => {
    openRef.current = false;
    onCloseRef.current();
  }, []);

  // Fanfare now, a coin as the count-up lands.
  useEffect(() => {
    sfx("win");
    const t = setTimeout(() => openRef.current && sfx("coin"), reduced ? 450 : 1850);
    return () => {
      openRef.current = false;
      clearTimeout(t);
    };
  }, [reduced]);

  // While open: no page scroll behind, focus inside, Tab stays inside, Escape closes, the screen behind is inert.
  useEffect(() => {
    const root = dialogRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root?.focus({ preventScroll: true });
    const behind = root?.parentElement
      ? Array.from(root.parentElement.children).filter((el): el is HTMLElement => el !== root && el instanceof HTMLElement && el.tagName === "MAIN" && !el.inert)
      : [];
    behind.forEach((el) => (el.inert = true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      behind.forEach((el) => (el.inert = false));
    };
  }, [close]);

  const vaultCx = `calc(50% + ${st.dx}px)`;
  const vaultCy = st.top + st.size / 2;
  const ring = Math.round(st.size * 1.3);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="You'd have zecked it"
      tabIndex={-1}
      style={{
        position: "fixed",
        top: 0,
        bottom: 0,
        left: "var(--zk-col-x)",
        transform: "translateX(-50%)",
        width: "100%",
        maxWidth: 430,
        zIndex: 80,
        background: "var(--zk-bg-win)",
        color: "var(--zk-text)",
        fontFamily: "var(--zk-font-body)",
        outline: "none",
        containerType: "inline-size",
      }}
    >
      <style>{WIN_CSS}</style>
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        style={{
          position: "absolute",
          top: "calc(var(--zk-fixed-top) + var(--zk-space-8))",
          right: "var(--zk-space-12)",
          zIndex: 10,
          width: "var(--zk-tap-min)",
          height: "var(--zk-tap-min)",
          borderRadius: "50%",
          border: "1px solid var(--zk-border-strong)",
          background: "rgb(var(--zk-bg-rgb) / .55)",
          color: "var(--zk-text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          cursor: "pointer",
        }}
      >
        <Icon icon="close" size={20} stroke={2.6} />
      </button>

      <div style={{ position: "absolute", inset: 0, overflowX: "hidden", overflowY: "auto", overscrollBehavior: "contain" }}>
        <div style={{ position: "relative", minHeight: "100%", display: "flex", flexDirection: "column" }}>
          <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
            <div
              style={{
                position: "absolute",
                left: `calc(${vaultCx} - 450px)`,
                top: vaultCy - 450,
                width: 900,
                height: 900,
                borderRadius: "50%",
                background: "repeating-conic-gradient(rgb(var(--zk-gold-rgb) / .16) 0 9deg, transparent 9deg 22deg)",
                willChange: "transform",
                animation: reduced ? "none" : "zk-spin var(--zk-dur-sunburst) linear infinite",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `calc(${vaultCx} - ${ring / 2}px)`,
                top: vaultCy - ring / 2,
                width: ring,
                height: ring,
                borderRadius: "50%",
                border: "3px solid rgb(var(--zk-gold-rgb) / .6)",
                willChange: "transform, opacity",
                animation: reduced ? "none" : "zk-ring var(--zk-dur-ring) var(--zk-ease-out) infinite",
                opacity: reduced ? 0.5 : undefined,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `calc(${vaultCx} - ${st.size / 2}px)`,
                top: st.top,
                width: st.size,
                height: st.size,
                animation: reduced ? "none" : "zk-win-vault 650ms var(--zk-ease-spring) both",
              }}
            >
              <Vault mode="open" size={st.size} />
            </div>
            <div style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none", overflow: "hidden" }}>
              <Confetti count={70} seed={11} run={1} sound={false} />
            </div>
          </div>

          <div
            style={{
              flex: 1,
              position: "relative",
              zIndex: 6,
              display: "flex",
              flexDirection: "column",
              gap: "var(--zk-space-12)",
              padding: `${st.content}px var(--zk-screen-pad) 0`,
            }}
          >
            <div role="status" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-8)", textAlign: "center" }}>
              <h2
                style={{
                  margin: 0,
                  font: "var(--zk-type-hero)",
                  fontSize: "min(var(--zk-fs-52), 12.6cqi)",
                  color: "var(--zk-gold)",
                  letterSpacing: "var(--zk-track-tight)",
                  textShadow: "var(--zk-text-shadow-gold)",
                  animation: reduced ? "none" : "zk-pop var(--zk-dur-pop) var(--zk-ease-spring) both",
                  transform: reduced ? "rotate(-3deg)" : undefined,
                }}
              >
                <span style={{ display: "block", whiteSpace: "nowrap" }}>YOU’D HAVE</span>
                <span style={{ display: "block", whiteSpace: "nowrap" }}>ZECKED IT!</span>
              </h2>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", flexWrap: "wrap", columnGap: "var(--zk-space-8)", marginTop: "var(--zk-space-4)" }}>
                <span style={{ font: "var(--zk-type-mono-xl)", whiteSpace: "nowrap" }}>
                  <CountUp to={PRIZE_ZEC} decimals={2} prefix="+" suffix=" ZEC" run={1} />
                </span>
                <span style={{ font: "var(--zk-type-body-strong)", fontSize: "var(--zk-fs-16)", color: "var(--zk-gold-pale)" }}>(pretend)</span>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--zk-space-6)",
                  marginTop: "var(--zk-space-2)",
                  padding: "var(--zk-space-6) var(--zk-space-12)",
                  borderRadius: "var(--zk-radius-pill)",
                  background: "var(--zk-mint-tint)",
                  border: "1px solid rgb(var(--zk-mint-rgb) / .4)",
                  color: "var(--zk-mint)",
                  font: "var(--zk-type-small)",
                  fontWeight: "var(--zk-fw-bold)",
                  whiteSpace: "nowrap",
                  ...rise(reduced, 1500),
                }}
              >
                <Icon icon="clock" size={14} stroke={2.6} />
                Cracked in {formatDuration(seconds)} · {ORDINAL[tries - 1] ?? "last"} try
              </span>
            </div>

            {/* Short phones: the headline and the buttons are what matter, so this card sits out. */}
            {!st.short && (
              <div
                style={{
                  background: "var(--zk-scrim)",
                  borderRadius: "var(--zk-radius-2xl)",
                  border: "1.5px solid rgb(var(--zk-gold-rgb) / .3)",
                  padding: "var(--zk-space-12) var(--zk-space-14)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--zk-space-12)",
                  ...rise(reduced, 300),
                }}
              >
                <div aria-hidden="true" style={tile("var(--zk-grad-tile-gold)", "var(--zk-gold-deep)", "var(--zk-gold-ink)", 40)}>
                  <Icon icon="vault" size={20} stroke={2.4} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "var(--zk-type-h4)" }}>That’s the whole game</div>
                  <div style={{ font: "var(--zk-type-caption)", fontWeight: "var(--zk-fw-medium)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
                    On a real stash, the first right answer keeps the ZEC. It’s test ZEC (no real value), so go wild.
                  </div>
                </div>
              </div>
            )}

            {/* Sticky so the buttons stay in reach on short screens; the backdrop turns solid before them. */}
            <div
              style={{
                marginTop: "auto",
                marginLeft: "calc(-1 * var(--zk-screen-pad))",
                marginRight: "calc(-1 * var(--zk-screen-pad))",
                padding: "var(--zk-space-20) var(--zk-screen-pad) calc(env(safe-area-inset-bottom, 0px) + var(--zk-space-10))",
                position: "sticky",
                bottom: 0,
                zIndex: 2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "var(--zk-space-10)",
                background: "linear-gradient(180deg, rgb(var(--zk-bg-rgb) / 0), rgb(var(--zk-bg-rgb)) var(--zk-space-18))",
              }}
            >
              <Button label="Crack a real stash" iconRight="arrowRight" variant="primary" size="lg" href="/feed" />
              <Button label="Hide your own" icon="plus" variant="ghost" size="md" href="/hide" />
              <button
                type="button"
                data-sfx="whoosh"
                onClick={onAnother}
                style={{
                  minHeight: "var(--zk-tap-min)",
                  padding: "0 var(--zk-space-12)",
                  border: 0,
                  background: "transparent",
                  color: "var(--zk-gold)",
                  font: "var(--zk-type-small)",
                  fontWeight: "var(--zk-fw-bold)",
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                  cursor: "pointer",
                }}
              >
                Try another practice riddle
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
