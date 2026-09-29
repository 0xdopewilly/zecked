"use client";
// "How it works": a pinned, scroll-driven story.
// Desktop (≥880px): the section is 380vh tall with a 100svh sticky stage. Scroll progress (0 → 1) picks the
// active step (4 equal bands) and each band's local progress scrubs that step's phone screen, rail segment
// and set pieces. Mobile: a vertical sequence, one phone per step, each scrubbed by its own scroll position.
import {
  AnimatePresence,
  motion,
  useAnimate,
  useInView,
  useMotionValue,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from "motion/react";
import { useLenis } from "lenis/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PhoneFrame } from "@/components/site/PhoneFrame";
import { EASE_OUT, Eyebrow, Float, Parallax, SPRING, SplitText } from "@/components/site/fx";
import { Icon } from "@/components/zk";
import { SCREENS } from "./how/screens";
import { ShareTile, StorySticker, type StickerSpec } from "./how/bits";
import { clamp, phoneHeight, phoneWidthForHeight, useElementSize, useMediaQuery, useMotionState, useReducedSafe } from "./how/hooks";

const STEPS = [
  { title: "Hide it", body: "Write a riddle or pick a match. Put a little ZEC inside.", glow: "124 92 255" },
  { title: "Share it", body: "Drop the link on X or Telegram. Then watch them sweat.", glow: "61 184 255" },
  { title: "Crack it or call it", body: "The first right answer, or the first correct match call, wins.", glow: "255 77 154" },
  { title: "Get Zecked", body: "The ZEC lands in your private wallet. Nobody sees who won.", glow: "244 183 40" },
] as const;

const TITLE = "Four moves. One winner.";

/** fx SplitText drops the space between words (it sits at the end of each inline-block and collapses). */


/** Two-line headline, each line springing in word by word. */
function Title({ className }: { className: string }) {
  return (
    <h2 className={className} aria-label={TITLE} style={{ margin: 0 }}>
      <SplitText as="span" text="Four moves." style={{ display: "block" }} />
      <SplitText as="span" text="One winner." highlight={["winner"]} delay={0.12} style={{ display: "block" }} />
    </h2>
  );
}

const SCREEN_SPRING = { type: "spring", stiffness: 170, damping: 22, mass: 0.9 } as const;
const FLY_SPRING = { stiffness: 190, damping: 19, mass: 0.9 };

export function HowItWorks() {
  const isDesktop = useMediaQuery("(min-width: 880px)", true);
  const reduce = useReducedSafe();
  // Keyed by `reduce` so every scroll-linked motion value is rebuilt if the preference flips after hydration.
  return isDesktop ? <HowDesktop key={reduce ? "d-r" : "d"} reduce={reduce} /> : <HowMobile key={reduce ? "m-r" : "m"} reduce={reduce} />;
}

/* ================================================================== Desktop: pinned story */

function HowDesktop({ reduce }: { reduce: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress: raw, scrollY } = useScroll({ target: sectionRef, offset: ["start start", "end end"] });
  // Proxy through a function transform: motion would otherwise hand range-mapped opacity to a ViewTimeline
  // WAAPI animation that ignores this offset (it drifts badly on a 380vh pinned section).
  const p = useTransform(raw, (v) => v);
  const step = useMotionState(p, (v) => clamp(Math.floor(v * 4), 0, 3));

  // Local progress of each step's band.
  const t0 = useTransform(p, [0, 0.25], [0, 1]);
  const t1 = useTransform(p, [0.25, 0.5], [0, 1]);
  const t2 = useTransform(p, [0.5, 0.75], [0, 1]);
  const t3 = useTransform(p, [0.75, 1], [0, 1]);
  const done = useMotionValue(1);
  const ts = reduce ? [done, done, done, done] : [t0, t1, t2, t3];

  // Replay the win moment every time step 4 comes on.
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (step === 3) setRun((r) => r + 1);
  }, [step]);

  // Stage size → phone size (fits the viewport height and the column).
  const stageRef = useRef<HTMLDivElement>(null);
  const { w: colW, h: colH } = useElementSize(stageRef, { w: 560, h: 720 });
  const phoneW = Math.round(clamp(Math.min(colW * 0.62, phoneWidthForHeight(colH * 0.86)), 230, 340));
  const phoneH = Math.round(phoneHeight(phoneW));

  // Phone body language: a slow 3D turn across the story, plus a lean from scroll velocity.
  const rotY = useTransform(p, [0, 1], [-14, 12]);
  const rotX = useTransform(p, [0, 0.5, 1], [7, 1, 5]);
  const vel = useVelocity(scrollY);
  const lean = useSpring(useTransform(vel, [-2600, 0, 2600], [3.5, 0, -3.5]), { stiffness: 170, damping: 26 });

  // A springy "bump" whenever the screen changes.
  const [bumpScope, bump] = useAnimate<HTMLDivElement>();
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    if (reduce || !bumpScope.current) return;
    bump(bumpScope.current, { scale: [1, 0.95, 1.025, 1] }, { duration: 0.6, ease: EASE_OUT });
  }, [step, reduce, bump, bumpScope]);

  const hintOpacity = useTransform(p, [0, 0.04], [1, 0]);

  const lenis = useLenis();
  const jump = (i: number) => {
    const el = sectionRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const range = el.offsetHeight - window.innerHeight;
    const y = top + range * (i / 4 + 0.07);
    if (lenis) lenis.scrollTo(y, { duration: 1.2 });
    else window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <section id="how" ref={sectionRef} className="zkh" aria-label="How it works">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="zkh-pin">
        <div aria-hidden className="zkh-bg">
          {STEPS.map((s, i) => (
            <motion.div
              key={i}
              className="zkh-bg-glow"
              initial={false}
              animate={{ opacity: i === step ? 1 : 0 }}
              transition={{ duration: 0.9, ease: EASE_OUT }}
              style={{ background: `radial-gradient(50% 55% at 72% 50%, rgb(${s.glow} / .22), transparent 70%)` }}
            />
          ))}
        </div>

        <div className="zks-container zkh-grid">
          <div className="zkh-copy">
            <Eyebrow>How it works</Eyebrow>
            <div className="zkh-title-wrap">
              <Title className="zkh-title" />
            </div>
            <ol className="zkh-steps">
              {STEPS.map((s, i) => (
                <DesktopStep key={i} i={i} title={s.title} body={s.body} step={step} t={ts[i]} reduce={reduce} onJump={jump} />
              ))}
            </ol>
            <motion.div aria-hidden className="zkh-hint" style={{ opacity: reduce ? 1 : hintOpacity }}>
              <Icon icon="arrowUp" size={14} stroke={2.6} style={{ transform: "rotate(180deg)" }} /> Scroll to play it out
            </motion.div>
          </div>

          <div ref={stageRef} className="zkh-stagecol">
            <div className="zkh-stage" style={{ width: phoneW, height: phoneH }}>
              <div aria-hidden className="zkh-numeral" style={{ fontSize: Math.round(phoneW * 0.92) }}>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={step}
                    initial={{ y: "35%", opacity: 0, rotate: 8 }}
                    animate={{ y: "0%", opacity: 1, rotate: 0 }}
                    exit={{ y: "-35%", opacity: 0, rotate: -8 }}
                    transition={SPRING}
                    style={{ display: "inline-block" }}
                  >
                    0{step + 1}
                  </motion.span>
                </AnimatePresence>
              </div>

              <Orbiters key={`o${phoneW}`} p={p} phoneW={phoneW} phoneH={phoneH} reduce={reduce} layer="back" />

              <motion.div
                className="zkh-phone"
                style={reduce ? undefined : { rotateY: rotY, rotateX: rotX, rotateZ: lean }}
              >
                <div ref={bumpScope} inert style={{ willChange: "transform" }}>
                  <PhoneFrame width={phoneW}>
                    {SCREENS.map((Screen, i) => (
                      <motion.div
                        key={i}
                        aria-hidden={i !== step}
                        initial={false}
                        animate={i === step ? "on" : i < step ? "past" : "next"}
                        variants={{
                          on: { opacity: 1, y: 0, scale: 1 },
                          past: { opacity: 0, y: -80, scale: 0.93 },
                          next: { opacity: 0, y: 110, scale: 1.04 },
                        }}
                        transition={{ y: SCREEN_SPRING, scale: SCREEN_SPRING, opacity: { duration: 0.32, ease: EASE_OUT } }}
                        style={{ position: "absolute", inset: 0 }}
                      >
                        <Screen t={ts[i]} active={i === step} run={run} detached={!reduce} />
                      </motion.div>
                    ))}
                  </PhoneFrame>
                </div>
              </motion.div>

              <Orbiters key={`f${phoneW}`} p={p} phoneW={phoneW} phoneH={phoneH} reduce={reduce} layer="front" />
              {!reduce && <FlyingShare key={`s${phoneW}`} t={t1} phoneW={phoneW} phoneH={phoneH} />}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DesktopStep({
  i,
  title,
  body,
  step,
  t,
  reduce,
  onJump,
}: {
  i: number;
  title: string;
  body: string;
  step: number;
  t: MotionValue<number>;
  reduce: boolean;
  onJump: (i: number) => void;
}) {
  const active = i === step;
  const past = i < step;
  const fill = useSpring(t, { stiffness: 140, damping: 26 });
  return (
    <motion.li
      className="zkh-step"
      initial={false}
      animate={{ opacity: active ? 1 : past ? 0.5 : 0.3, x: active ? 10 : 0 }}
      transition={SPRING}
    >
      <button
        type="button"
        className="zkh-num"
        data-on={active || past}
        aria-current={active ? "step" : undefined}
        aria-label={`Go to step ${i + 1}: ${title}`}
        onClick={() => onJump(i)}
      >
        <motion.span initial={false} animate={{ scale: active ? 1.14 : 1 }} transition={{ type: "spring", stiffness: 520, damping: 13 }} style={{ display: "inline-flex" }}>
          {past ? <Icon icon="check" size={18} stroke={3.2} /> : i + 1}
        </motion.span>
        {active && !reduce && <span aria-hidden className="zkh-num-ping" />}
      </button>
      {i < STEPS.length - 1 && (
        <div aria-hidden className="zkh-seg">
          <motion.div className="zkh-seg-fill" style={{ scaleY: reduce ? (past ? 1 : 0) : fill }} />
        </div>
      )}
      <div className="zkh-step-text">
        <h3 className="zkh-step-title">{title}</h3>
        <p className="zkh-step-body">{body}</p>
      </div>
    </motion.li>
  );
}

/* Stickers that orbit the phone on an ellipse as you scroll (behind or in front of it). */
const ORBIT: (StickerSpec & { a0: number; a1: number; layer: "back" | "front"; amp: number; dur: number })[] = [
  { tone: "pink", icon: "unlock", label: "+0.02 ZEC", rotate: -8, a0: 152, a1: 204, layer: "front", amp: 9, dur: 4.2 },
  { tone: "sky", icon: "ball", label: "BAR 2–1?", rotate: 7, a0: -8, a1: -48, layer: "back", amp: 11, dur: 5.1 },
  { tone: "mint", icon: "trophy", label: "First one wins", rotate: -5, a0: 46, a1: 8, layer: "front", amp: 8, dur: 4.6 },
  { tone: "purple", icon: "mask", label: "Private win", rotate: 8, a0: 128, a1: 168, layer: "back", amp: 10, dur: 5.6 },
];

function Orbiters({ p, phoneW, phoneH, reduce, layer }: { p: MotionValue<number>; phoneW: number; phoneH: number; reduce: boolean; layer: "back" | "front" }) {
  return (
    <>
      {ORBIT.map((o, i) =>
        o.layer === layer ? <Orbiter key={i} o={o} p={p} rx={phoneW * 0.8} ry={phoneH * 0.42} reduce={reduce} delay={i * 0.4} /> : null,
      )}
    </>
  );
}

function Orbiter({ o, p, rx, ry, reduce, delay }: { o: (typeof ORBIT)[number]; p: MotionValue<number>; rx: number; ry: number; reduce: boolean; delay: number }) {
  const a = useTransform(p, [0, 1], [o.a0, o.a1]);
  const x = useSpring(useTransform(a, (v) => Math.cos((v * Math.PI) / 180) * rx), { stiffness: 90, damping: 20 });
  const y = useSpring(useTransform(a, (v) => Math.sin((v * Math.PI) / 180) * ry), { stiffness: 90, damping: 20 });
  const mid = ((o.a0 + o.a1) / 2) * (Math.PI / 180);
  const still = { x: Math.cos(mid) * rx, y: Math.sin(mid) * ry };
  return (
    <motion.div aria-hidden className="zkh-orbit" style={{ x: reduce ? still.x : x, y: reduce ? still.y : y, zIndex: o.layer === "front" ? 4 : 1 }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: "max-content", transform: "translate(-50%, -50%)" }}>
        <Float amplitude={o.amp} duration={o.dur} delay={delay}>
          <StorySticker spec={o} />
        </Float>
      </div>
    </motion.div>
  );
}

/* Desktop only: the share card lifts off the phone screen and pops out toward you, then flies away. */
function FlyingShare({ t, phoneW, phoneH }: { t: MotionValue<number>; phoneW: number; phoneH: number }) {
  const s0 = (phoneW - 24) / 390;
  const k = [0.28, 0.42, 0.86, 1];
  const x = useSpring(useTransform(t, k, [0, -phoneW * 0.1, -phoneW * 0.14, -phoneW * 1.05]), FLY_SPRING);
  const y = useSpring(useTransform(t, k, [0, -phoneH * 0.07, -phoneH * 0.1, -phoneH * 0.66]), FLY_SPRING);
  const rotate = useSpring(useTransform(t, k, [-2, -7, -4, -26]), FLY_SPRING);
  const scale = useSpring(useTransform(t, k, [s0, 1.02, 1.05, 0.7]), FLY_SPRING);
  const opacity = useTransform(t, [0.28, 0.3, 0.9, 1], [0, 1, 1, 0]);
  const xPop = useMotionState(t, (v) => v >= 0.44 && v < 0.97);
  const tgPop = useMotionState(t, (v) => v >= 0.6 && v < 0.97);
  return (
    <motion.div aria-hidden className="zkh-fly" style={{ x, y, rotate, scale, opacity }}>
      <ShareTile xPop={xPop} tgPop={tgPop} />
    </motion.div>
  );
}

/* ================================================================== Mobile: one phone per step */

type MobileSticker = StickerSpec & { at: CSSProperties };
/* Two stickers per step, parked over each screen's quiet areas so they never cover the story. */
const MOBILE_STICKERS: [MobileSticker, MobileSticker][] = [
  [
    { tone: "pink", icon: "lock", label: "$30 inside", rotate: 6, at: { right: -4, top: "9%" } },
    { tone: "sky", icon: "ball", label: "or call a match", rotate: -6, at: { left: 14, bottom: "7%" } },
  ],
  [
    { tone: "light", icon: "share", label: "Post it", rotate: -7, at: { right: -4, top: "10%" } },
    { tone: "purple", icon: "bolt", label: "Drop it in the group", rotate: -5, at: { right: -4, bottom: "24%" } },
  ],
  [
    { tone: "red", icon: "close", label: "Nope!", rotate: 8, at: { right: -4, top: "6%" } },
    { tone: "mint", icon: "key", label: "3 tries / 10 min", rotate: -5, at: { left: 14, bottom: "7%" } },
  ],
  [
    { tone: "gold", icon: "coin", label: "+0.02 ZEC", rotate: -7, at: { right: -4, top: "3%" } },
    { tone: "mint", icon: "mask", label: "Private win", rotate: 6, at: { left: 6, top: "30%" } },
  ],
];

function HowMobile({ reduce }: { reduce: boolean }) {
  return (
    <section id="how" className="zks-section zkhm" aria-label="How it works">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div aria-hidden className="zkhm-bg" />
      <div className="zks-container">
        <Eyebrow>How it works</Eyebrow>
        <div style={{ marginTop: 16 }}>
          <Title className="zks-h2" />
        </div>
        <ol className="zkhm-list">
          {STEPS.map((s, i) => (
            <MobileStep key={i} i={i} title={s.title} body={s.body} glow={s.glow} reduce={reduce} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function MobileStep({ i, title, body, glow, reduce }: { i: number; title: string; body: string; glow: string; reduce: boolean }) {
  const liRef = useRef<HTMLLIElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const { w } = useElementSize(stageRef, { w: 330, h: 0 });
  const phoneW = Math.round(clamp(w - 64, 210, 300));

  // Screen story: 0 when the phone's top is near the bottom of the viewport, 1 when it's centred.
  const { scrollYProgress: tRaw } = useScroll({ target: phoneRef, offset: ["start 0.85", "center 0.5"] });
  // Rail segment: fills as this step passes the middle of the screen.
  const { scrollYProgress: segRaw } = useScroll({ target: liRef, offset: ["start 0.55", "end 0.55"] });
  // Function transforms keep these on the main thread (see HowDesktop).
  const tScroll = useTransform(tRaw, (v) => v);
  const segP = useTransform(segRaw, (v) => v);
  const done = useMotionValue(1);
  const t = reduce ? done : tScroll;
  const seg = useSpring(segP, { stiffness: 140, damping: 26 });
  const lit = useMotionState(segP, (v) => v > 0);

  const inView = useInView(phoneRef, { amount: 0.55 });
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (inView) setRun((r) => r + 1);
  }, [inView]);

  const Screen = SCREENS[i];
  const [s1, s2] = MOBILE_STICKERS[i];

  return (
    <li ref={liRef} className="zkhm-step">
      <div className="zkhm-head">
        <motion.div
          className="zkh-num"
          data-on={lit || reduce}
          initial={false}
          animate={{ scale: lit ? [1, 1.2, 1] : 1 }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
          aria-hidden
        >
          {i + 1}
        </motion.div>
        <div style={{ minWidth: 0 }}>
          <h3 className="zkh-step-title">
            <span className="zkhm-kicker">Step {i + 1}</span>
            {title}
          </h3>
          <p className="zkh-step-body">{body}</p>
        </div>
      </div>
      {i < STEPS.length - 1 && (
        <div aria-hidden className="zkhm-seg">
          <motion.div className="zkh-seg-fill" style={{ scaleY: reduce ? 1 : seg }} />
        </div>
      )}
      <div ref={stageRef} className="zkhm-stage">
        <div aria-hidden className="zkhm-glow" style={{ background: `radial-gradient(closest-side, rgb(${glow} / .28), transparent)` }} />
        <div ref={phoneRef} inert className="zkhm-phone">
          <PhoneFrame width={phoneW}>
            <Screen t={t} active={inView || reduce} run={run} />
          </PhoneFrame>
        </div>
        <div aria-hidden className="zkhm-stk" style={s1.at}>
          <Parallax speed={0.35} rotate={4}>
            <Float amplitude={7} duration={4.4} delay={i * 0.3}>
              <StorySticker spec={s1} small />
            </Float>
          </Parallax>
        </div>
        <div aria-hidden className="zkhm-stk" style={s2.at}>
          <Parallax speed={-0.25} rotate={-4}>
            <Float amplitude={8} duration={5.2} delay={i * 0.3 + 0.6}>
              <StorySticker spec={s2} small />
            </Float>
          </Parallax>
        </div>
      </div>
    </li>
  );
}

/* ================================================================== Styles (scoped by the zkh- prefix) */

const CSS = `
.zkh { position: relative; height: 380vh; }
.zkh-pin { position: sticky; top: 0; height: 100vh; height: 100svh; overflow: clip; display: flex; align-items: center; }
.zkh-bg { position: absolute; inset: 0; pointer-events: none; }
.zkh-bg-glow { position: absolute; inset: 0; }
.zkh-grid { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(24px, 4vw, 64px); align-items: center; height: 100%; padding-top: 72px; box-sizing: border-box; }
.zkh-copy { max-width: 470px; }
.zkh-title-wrap { margin: 18px 0 clamp(18px, 4vh, 40px); }
.zkh-title { font: 800 clamp(34px, min(4.4vw, 7.4vh), 66px)/0.95 var(--zk-font-display); letter-spacing: -0.03em; }
.zkh-steps { --zkh-gap: clamp(8px, 2.2vh, 22px); list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--zkh-gap); }
.zkh-step { position: relative; display: grid; grid-template-columns: 44px minmax(0, 1fr); column-gap: 18px; }
.zkh-step-text { min-width: 0; padding-top: 4px; }
.zkh-step-title { font: 800 clamp(21px, min(2.2vw, 3.6vh), 30px)/1.05 var(--zk-font-display); letter-spacing: -0.02em; margin: 4px 0 6px; color: var(--zk-text); }
.zkh-step-body { font: 500 clamp(14px, min(1.2vw, 2.1vh), 16px)/1.5 var(--zk-font-body); color: var(--zk-text-muted); margin: 0; text-wrap: pretty; }
.zkh-num { position: relative; width: 44px; height: 44px; border-radius: 50%; border: 1.5px solid var(--zk-border-strong); background: var(--zk-surface); color: var(--zk-text-muted); display: inline-flex; align-items: center; justify-content: center; font: 800 17px/1 var(--zk-font-display); cursor: pointer; padding: 0; transition: background .3s, color .3s, box-shadow .3s, border-color .3s; -webkit-tap-highlight-color: transparent; }
.zkh-num:hover { border-color: rgb(var(--zk-gold-rgb) / .6); color: var(--zk-text); }
.zkh-num:focus-visible { outline: 3px solid var(--zk-gold); outline-offset: 3px; }
.zkh-num[data-on="true"] { background: var(--zk-grad-gold); color: var(--zk-gold-ink); border-color: transparent; box-shadow: 0 4px 0 var(--zk-gold-deep), 0 0 28px rgb(var(--zk-gold-rgb) / .45); }
.zkh-num-ping { position: absolute; inset: -2px; border-radius: 50%; border: 2px solid var(--zk-gold); animation: zk-ping var(--zk-dur-pulse) ease-out infinite; pointer-events: none; }
.zkh-seg { position: absolute; left: 20.5px; top: 50px; bottom: calc(6px - var(--zkh-gap)); width: 3px; border-radius: 2px; background: rgb(255 255 255 / .1); overflow: hidden; }
.zkh-seg-fill { position: absolute; inset: 0; background: linear-gradient(180deg, var(--zk-gold-light), var(--zk-gold)); transform-origin: 50% 0%; box-shadow: 0 0 12px rgb(var(--zk-gold-rgb) / .8); }
.zkh-hint { margin-top: clamp(16px, 3vh, 30px); display: inline-flex; align-items: center; gap: 8px; font: var(--zk-type-label); letter-spacing: .14em; text-transform: uppercase; color: var(--zk-text-faint); }
.zkh-stagecol { position: relative; height: 100%; display: flex; align-items: center; justify-content: center; min-width: 0; }
.zkh-stage { position: relative; perspective: 1400px; }
.zkh-phone { position: relative; z-index: 2; transform-style: preserve-3d; }
.zkh-numeral { position: absolute; right: -52%; top: -9%; z-index: 0; font-family: var(--zk-font-display); font-weight: 800; line-height: .8; letter-spacing: -0.06em; color: transparent; -webkit-text-stroke: 2px rgb(255 255 255 / .09); pointer-events: none; user-select: none; }
.zkh-orbit { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; }
.zkh-fly { position: absolute; left: 50%; top: 50%; width: 354px; height: 199px; margin: -99.5px 0 0 -177px; z-index: 5; pointer-events: none; will-change: transform, opacity; }
@media (max-height: 700px) and (min-width: 880px) { .zkh-step-body { display: none; } .zkh-hint { display: none; } }

/* Mobile sequence */
.zkhm { overflow: clip; }
.zkhm-bg { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(80% 30% at 50% 10%, rgb(var(--zk-purple-rgb) / .16), transparent 70%); }
.zkhm > .zks-container { position: relative; }
.zkhm-list { list-style: none; margin: 44px 0 0; padding: 0; display: flex; flex-direction: column; gap: 64px; }
.zkhm-step { position: relative; }
.zkhm-head { display: grid; grid-template-columns: 44px minmax(0, 1fr); column-gap: 14px; align-items: start; }
.zkhm-head .zkh-num { cursor: default; }
.zkhm-kicker { display: block; font: var(--zk-type-label); letter-spacing: .14em; text-transform: uppercase; color: var(--zk-gold); margin-bottom: 6px; }
.zkhm-seg { position: absolute; left: 20.5px; top: 52px; bottom: -60px; width: 3px; border-radius: 2px; background: rgb(255 255 255 / .1); overflow: hidden; }
.zkhm-stage { position: relative; margin-top: 26px; display: flex; justify-content: center; }
.zkhm-glow { position: absolute; left: 50%; top: 50%; width: 130%; aspect-ratio: 1; transform: translate(-50%, -50%); pointer-events: none; }
.zkhm-phone { position: relative; z-index: 1; }
.zkhm-stk { position: absolute; z-index: 2; pointer-events: none; }

/* Phone-screen helpers */
.zkh-caret { display: inline-block; width: 3px; height: 22px; margin-left: 2px; vertical-align: -3px; border-radius: 2px; background: var(--zk-purple-light); animation: zkh-blink 1s steps(1) infinite; }
@keyframes zkh-blink { 50% { background: transparent; } }
.zkh-spin { animation: zk-spin var(--zk-dur-sunburst) linear infinite; will-change: transform; }
.zkh-pulse { position: absolute; left: 18px; right: 18px; top: 0; height: 62px; border-radius: 24px; border: 3px solid var(--zk-gold); animation: zkh-pulse 1.1s var(--zk-ease-out) infinite; pointer-events: none; }
@keyframes zkh-pulse { from { transform: scale(1); opacity: .9; } to { transform: scale(1.12, 1.35); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .zkh-caret, .zkh-spin, .zkh-pulse, .zkh-num-ping { animation: none !important; } }
`;
