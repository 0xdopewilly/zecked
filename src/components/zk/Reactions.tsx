"use client";
// Emoji reactions on a stash. Two looks:
//  - the full bar (stash screens): six chunky pills with counts, yours ringed in gold. A tap toggles your
//    reaction at once (the server confirms; a failure rolls it back with a friendly message), pops the pill
//    and floats a little burst of the emoji up, like live-stream reactions. When the screen's poll brings
//    higher counts for emojis you didn't just tap (someone else reacting), those float up too.
//  - compact (stash cards): a small read-only summary of the top three ("🔥 12  😂 4").
// Reduced motion: no floating or popping, the counts just update.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { api } from "@/lib/api";
import { sfx } from "@/lib/sfx";
import { REACTIONS, type Reaction } from "@/lib/types";
import { Toast } from "@/components/zk/Toast";

export type ReactionCounts = Partial<Record<Reaction, number>>;

export interface ReactionsProps {
  stashId: string;
  /** The latest counts from the server (the screen's poll). */
  counts?: ReactionCounts;
  /** The viewer's own reactions, from the server. */
  mine?: Reaction[];
  /** The small read-only summary for cards (top three). */
  compact?: boolean;
  /** A player-ready message when a reaction didn't go through (the screen shows it in its toast). */
  onError?: (text: string) => void;
  style?: CSSProperties;
}

/** Spoken names (the pills' labels). */
const NAME: Record<Reaction, string> = {
  "🔥": "Fire",
  "😂": "Laughing",
  "🤯": "Mind blown",
  "🧠": "Big brain",
  "😤": "Fuming",
  "👀": "Eyes",
};

/** After you touch an emoji, a poll can't overwrite it for this long (it may have left before your tap). */
const GUARD_MS = 5_000;
const MAX_FLOATS = 36;

const CSS = `
@keyframes zk-rx-float {
  0% { transform: translate(-50%, 0) scale(.3); opacity: 0 }
  14% { transform: translate(calc(-50% + var(--zk-rx-dx1)), calc(var(--zk-rx-rise) * .16)) scale(1.2); opacity: 1 }
  55% { transform: translate(calc(-50% - var(--zk-rx-dx1)), calc(var(--zk-rx-rise) * .6)) scale(1) rotate(calc(var(--zk-rx-rot) * -.5)); opacity: .95 }
  100% { transform: translate(calc(-50% + var(--zk-rx-dx)), var(--zk-rx-rise)) scale(.8) rotate(var(--zk-rx-rot)); opacity: 0 }
}
@keyframes zk-rx-count { from { transform: translateY(60%); opacity: 0 } to { transform: none; opacity: 1 } }
`;

type Float = { id: number; emoji: Reaction; x: number; y: number; dx: number; dx1: number; rise: number; rot: number; size: number; dur: number; delay: number };

function reducedMotion(): boolean {
  try {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** "7", "999", "1.2k", "12k". */
function fmtCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

const clean = (c?: ReactionCounts): ReactionCounts => {
  const out: ReactionCounts = {};
  for (const e of REACTIONS) {
    const n = Math.max(0, Math.round(c?.[e] ?? 0));
    if (n > 0) out[e] = n;
  }
  return out;
};
/** A stable key for a counts object, so a fresh-but-equal poll result doesn't count as a change. */
const countsKey = (c?: ReactionCounts) => REACTIONS.map((e) => c?.[e] ?? 0).join(",");
const mineKey = (m?: Reaction[]) => REACTIONS.filter((e) => m?.includes(e)).join("");

/** Friendly copy for a reaction that didn't land (never "Failed to fetch"). */
function reactError(e: unknown): string {
  const status = (e as { status?: number } | null)?.status;
  if (status == null || e instanceof TypeError) return "Can’t reach ZECKED. Check your connection";
  if (status >= 500) return "Your reaction didn’t land. Try again";
  const m = e instanceof Error ? e.message : "";
  return m && !/^Request failed/i.test(m) ? m : "Your reaction didn’t land. Try again";
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The top reactions by count ("🔥 12  😂 4"), read-only. Nothing when there are none.
 * `fit`: for a squeezed spot (a card's prize row). Give it a one-line box whose extra items wrap out of
 * sight; if even the top one doesn't fit, the whole summary hides rather than showing half an emoji.
 */
export function ReactionSummary({ counts, max = 3, fit = false, style }: { counts?: ReactionCounts; max?: number; fit?: boolean; style?: CSSProperties }) {
  const top = REACTIONS.map((e, i) => ({ e, n: counts?.[e] ?? 0, i }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, max);
  const ref = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  const key = top.map((r) => `${r.e}${r.n}`).join("");
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!fit || !el) return;
    const check = () => {
      const first = el.firstElementChild as HTMLElement | null;
      setFits(!!first && first.offsetWidth <= el.clientWidth + 0.5);
    };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, key]);
  if (top.length === 0) return null;
  return (
    <span
      ref={ref}
      role="img"
      aria-label={`Reactions: ${top.map((r) => `${NAME[r.e]} ${r.n}`).join(", ")}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--zk-space-8)",
        minWidth: 0,
        whiteSpace: "nowrap",
        ...(fit ? { flexWrap: "wrap", justifyContent: "flex-end", height: 18, overflow: "hidden", rowGap: 4, visibility: fits ? undefined : "hidden" } : null),
        ...style,
      }}
    >
      {top.map((r, i) => (
        <span key={r.e} data-rx-i={i} aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>{r.e}</span>
          <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text-muted)", fontVariantNumeric: "tabular-nums" }}>{fmtCount(r.n)}</span>
        </span>
      ))}
    </span>
  );
}

export function Reactions(props: ReactionsProps) {
  if (props.compact) return <ReactionSummary counts={props.counts} fit style={props.style} />;
  return <ReactionBar {...props} />;
}

function ReactionBar({ stashId, counts: countsProp, mine: mineProp, onError, style }: ReactionsProps) {
  const [counts, setCountsState] = useState<ReactionCounts>(() => clean(countsProp));
  const [mine, setMineState] = useState<Reaction[]>(() => mineProp ?? []);
  const [floats, setFloats] = useState<Float[]>([]);
  const [pressed, setPressed] = useState<Reaction | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);

  // Mirrors of what's on screen, so effects and async handlers read the latest without re-subscribing.
  const countsRef = useRef(counts);
  const mineRef = useRef(mine);
  /** The last state the server confirmed (a failed tap falls back to it). */
  const confirmed = useRef<{ counts: ReactionCounts; mine: Reaction[] }>({ counts, mine });
  const touched = useRef<Partial<Record<Reaction, number>>>({});
  const pending = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const wrap = useRef<HTMLDivElement>(null);
  const pills = useRef<Partial<Record<Reaction, HTMLButtonElement | null>>>({});
  const emojis = useRef<Partial<Record<Reaction, HTMLSpanElement | null>>>({});
  const floatId = useRef(0);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  const setCounts = (c: ReactionCounts) => {
    countsRef.current = c;
    setCountsState(c);
  };
  const setMine = (m: Reaction[]) => {
    mineRef.current = m;
    setMineState(m);
  };

  useEffect(() => {
    const ts = timers.current;
    return () => {
      ts.forEach((t) => clearTimeout(t));
      ts.clear();
    };
  }, []);

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };

  const fail = useCallback((text: string) => {
    if (onErrorRef.current) onErrorRef.current(text);
    else setToast((t) => ({ text, n: (t?.n ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  /** Float `n` copies of an emoji up from its pill. */
  const burst = useCallback((emoji: Reaction, n: number, own: boolean) => {
    if (n <= 0 || reducedMotion()) return;
    const pill = pills.current[emoji];
    const box = wrap.current;
    if (!pill || !box) return;
    const x = pill.offsetLeft + pill.offsetWidth / 2;
    const y = pill.offsetTop - 6;
    const made: Float[] = [];
    for (let i = 0; i < Math.min(n, 6); i++) {
      const dur = 1300 + Math.random() * 700;
      const delay = i * (own ? 70 : 160) + Math.random() * 60;
      made.push({
        id: ++floatId.current,
        emoji,
        x: x + (Math.random() - 0.5) * 14,
        y,
        dx: (Math.random() - 0.5) * 70,
        dx1: (Math.random() - 0.5) * 26,
        rise: -(130 + Math.random() * 110),
        rot: (Math.random() - 0.5) * 50,
        size: (own ? 24 : 20) + Math.random() * 10,
        dur,
        delay,
      });
    }
    setFloats((f) => [...f, ...made].slice(-MAX_FLOATS));
    // Cleanup by timer too: animations pause off screen, so animationend may never come.
    const ids = new Set(made.map((m) => m.id));
    later(() => setFloats((f) => f.filter((x) => !ids.has(x.id))), Math.max(...made.map((m) => m.dur + m.delay)) + 200);
  }, []);

  const pop = (emoji: Reaction, on: boolean) => {
    if (reducedMotion()) return;
    const el = emojis.current[emoji];
    const pill = pills.current[emoji];
    try {
      el?.animate(
        on
          ? [
              { transform: "scale(1) rotate(0)" },
              { transform: "scale(1.6) rotate(-12deg)", offset: 0.35 },
              { transform: "scale(.9) rotate(6deg)", offset: 0.7 },
              { transform: "scale(1) rotate(0)" },
            ]
          : [{ transform: "scale(1)" }, { transform: "scale(.72)", offset: 0.4 }, { transform: "scale(1)" }],
        { duration: on ? 520 : 300, easing: "cubic-bezier(.3,1.6,.5,1)" },
      );
      if (on) pill?.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)", offset: 0.4 }, { transform: "scale(1)" }], { duration: 360, easing: "cubic-bezier(.3,1.6,.5,1)" });
    } catch {}
  };

  /** Show a server state; emojis that went up without you touching them float up (someone else reacted). */
  const show = useCallback(
    (next: ReactionCounts, nextMine: Reaction[] | undefined, guard: boolean) => {
      const now = Date.now();
      const cur = countsRef.current;
      const out: ReactionCounts = {};
      const outMine: Reaction[] = [];
      for (const e of REACTIONS) {
        const held = guard && now - (touched.current[e] ?? 0) < GUARD_MS;
        const n = held ? (cur[e] ?? 0) : (next[e] ?? 0);
        if (n > 0) out[e] = n;
        const isMine = held || !nextMine ? mineRef.current.includes(e) : nextMine.includes(e);
        if (isMine) outMine.push(e);
        if (!held && n > (cur[e] ?? 0)) burst(e, n - (cur[e] ?? 0), false);
      }
      if (countsKey(out) !== countsKey(cur)) setCounts(out);
      if (mineKey(outMine) !== mineKey(mineRef.current)) setMine(outMine);
      confirmed.current = { counts: out, mine: outMine };
    },
    [burst],
  );

  // A poll brought new counts (or your reactions from another tab): take them, unless a tap is still on its way.
  const propKey = countsKey(countsProp);
  const propMineKey = mineProp ? mineKey(mineProp) : null;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (pending.current > 0) return;
    show(clean(countsProp), mineProp, true);
    // Keyed on the values (not the objects): a fresh-but-equal poll result isn't a change.
  }, [propKey, propMineKey, show]);

  const toggle = (emoji: Reaction) => {
    const on = !mineRef.current.includes(emoji);
    touched.current[emoji] = Date.now();
    setMine(on ? [...mineRef.current, emoji] : mineRef.current.filter((e) => e !== emoji));
    const n = Math.max(0, (countsRef.current[emoji] ?? 0) + (on ? 1 : -1));
    const c = { ...countsRef.current };
    if (n > 0) c[emoji] = n;
    else delete c[emoji];
    setCounts(c);
    sfx(on ? "pop" : "select");
    pop(emoji, on);
    if (on) burst(emoji, 4, true);

    // One request at a time, in tap order, so the last answer is the true state.
    pending.current++;
    chain.current = chain.current.then(async () => {
      try {
        const r = await api.react(stashId, emoji);
        pending.current--;
        touched.current[emoji] = Date.now();
        confirmed.current = { counts: clean(r.reactions), mine: r.mine };
        // Later taps are still on their way: their answer is newer.
        if (pending.current === 0) show(clean(r.reactions), r.mine, false);
      } catch (e) {
        pending.current--;
        if (pending.current === 0) {
          // Back to what the server last said, quietly (no floats for our own rollback).
          setCounts(confirmed.current.counts);
          setMine(confirmed.current.mine);
        }
        fail(reactError(e));
      }
    });
  };

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>, emoji: Reaction) => {
    if (e.button === 0) setPressed(emoji);
  };
  const up = () => setPressed(null);

  return (
    <div ref={wrap} style={{ position: "relative", ...style }}>
      <style href="zk-reactions" precedence="zk-components">
        {CSS}
      </style>
      <div
        role="group"
        aria-label="Reactions"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${REACTIONS.length}, minmax(0, 1fr))`,
          // Six 44px pills still fit a 320px phone: the gaps give way first.
          columnGap: "clamp(3px, calc((100% - 264px) / 5), var(--zk-space-8))",
        }}
      >
        {REACTIONS.map((e) => {
          const on = mine.includes(e);
          const n = counts[e] ?? 0;
          const down = pressed === e;
          return (
            <button
              key={e}
              ref={(el) => {
                pills.current[e] = el;
              }}
              type="button"
              aria-pressed={on}
              aria-label={`${NAME[e]}${n > 0 ? `, ${n}` : ""}`}
              data-sfx="none"
              onClick={() => toggle(e)}
              onPointerDown={(ev) => onDown(ev, e)}
              onPointerUp={up}
              onPointerLeave={up}
              onPointerCancel={up}
              style={{
                minWidth: 0,
                height: 46,
                padding: "0 2px",
                margin: 0,
                border: 0,
                borderRadius: "var(--zk-radius-lg)",
                background: on ? "var(--zk-gold-tint)" : "var(--zk-surface)",
                boxShadow: on
                  ? `inset 0 0 0 2px var(--zk-gold), 0 ${down ? 1 : 3}px 0 var(--zk-gold-deep)`
                  : `inset 0 0 0 1.5px var(--zk-border), 0 ${down ? 1 : 3}px 0 var(--zk-bg)`,
                transform: down ? "translateY(2px)" : "none",
                color: on ? "var(--zk-gold)" : "var(--zk-text-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 3,
                cursor: "pointer",
                WebkitTapHighlightColor: "transparent",
                touchAction: "manipulation",
                transition:
                  "transform var(--zk-dur-fast) var(--zk-ease-out), box-shadow var(--zk-dur-fast) var(--zk-ease-out), background var(--zk-dur-fast) var(--zk-ease-out)",
              }}
            >
              <span
                ref={(el) => {
                  emojis.current[e] = el;
                }}
                aria-hidden="true"
                style={{ display: "inline-block", fontSize: 20, lineHeight: 1, flex: "none" }}
              >
                {e}
              </span>
              {n > 0 ? (
                <span
                  key={n}
                  aria-hidden="true"
                  style={{
                    font: "var(--zk-fw-black) var(--zk-fs-12)/1 var(--zk-font-body)",
                    fontVariantNumeric: "tabular-nums",
                    minWidth: 0,
                    overflow: "hidden",
                    animation: "zk-rx-count 220ms var(--zk-ease-out) both",
                  }}
                >
                  {fmtCount(n)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* The floating emojis: above everything nearby, never in the way of a tap. */}
      {floats.length > 0 && (
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 6 }}>
          {floats.map((f) => (
            <span
              key={f.id}
              onAnimationEnd={() => setFloats((all) => all.filter((x) => x.id !== f.id))}
              style={
                {
                  position: "absolute",
                  left: f.x,
                  top: f.y,
                  fontSize: f.size,
                  lineHeight: 1,
                  willChange: "transform, opacity",
                  filter: "drop-shadow(0 3px 6px rgb(0 0 0 / .35))",
                  "--zk-rx-dx": `${f.dx}px`,
                  "--zk-rx-dx1": `${f.dx1}px`,
                  "--zk-rx-rise": `${f.rise}px`,
                  "--zk-rx-rot": `${f.rot}deg`,
                  animation: `zk-rx-float ${f.dur}ms cubic-bezier(.2,.7,.3,1) ${f.delay}ms both`,
                } as CSSProperties
              }
            >
              {f.emoji}
            </span>
          ))}
        </div>
      )}

      {/* Only when the screen doesn't handle errors itself: a toast at the top. */}
      {toast && (
        <div
          key={toast.n}
          style={{
            position: "fixed",
            left: "var(--zk-col-x)",
            top: "calc(var(--zk-fixed-top) + var(--zk-space-10))",
            transform: "translateX(-50%)",
            width: "calc(min(var(--zk-col-w), 430px) - 2 * var(--zk-screen-pad))",
            zIndex: 80,
            pointerEvents: "none",
          }}
        >
          <Toast text={toast.text} variant="error" />
        </div>
      )}
    </div>
  );
}

export default Reactions;
