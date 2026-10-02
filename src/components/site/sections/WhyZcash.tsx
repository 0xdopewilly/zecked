"use client";
// Why Zcash: three illustrated feature cards, then a giant scroll-skewed statement marquee.
import { motion, useScroll, useSpring, useTransform, useVelocity } from "motion/react";
import { useRef, type ComponentType } from "react";
import { Icon } from "@/components/zk";
import { Eyebrow, Marquee, Reveal, SplitText, Tilt } from "../fx";
import { SPLIT_FIX_CSS, srOnly, useReduced } from "./extras/kit";
import { MemoArt, NinjaArt, VerifyArt } from "./extras/WhyArt";

type Feature = { n: string; tag: string; icon: string; rgb: string; color: string; title: string; body: string; Art: ComponentType };

const FEATURES: Feature[] = [
  {
    n: "01",
    tag: "On-chain prizes",
    icon: "eye",
    rgb: "var(--zk-sky-rgb)",
    color: "var(--zk-sky)",
    title: "Prizes that are really there",
    body: "A stash only goes live once its ZEC has landed on the Zcash blockchain, in its own shielded address. No ZEC, no stash.",
    Art: VerifyArt,
  },
  {
    n: "02",
    tag: "Shielded payouts",
    icon: "mask",
    rgb: "var(--zk-mint-rgb)",
    color: "var(--zk-mint)",
    title: "Winners stay anonymous",
    body: "Prizes pay out shielded, so nobody sees who won or where the ZEC went. Your win, your business.",
    Art: NinjaArt,
  },
  {
    n: "03",
    tag: "Encrypted memos",
    icon: "lock",
    rgb: "var(--zk-pink-rgb)",
    color: "var(--zk-pink)",
    title: "Messages only the winner reads",
    body: "Every shielded payment can carry an encrypted memo that only the receiver can open. Perfect for a victory note.",
    Art: MemoArt,
  },
];

const WORDS = ["ENCRYPTED", "PRIVATE BY DEFAULT", "FIRST ONE WINS", "HIDE IT", "CRACK IT", "GET ZECKED"];
const TAPE = ["SHIELDED PAYOUTS", "VERIFIED PRIZES", "ENCRYPTED MEMOS", "FREE TO PLAY", "FIRST ONE WINS"];

const CSS = `
${SPLIT_FIX_CSS}
.zkwz-head { text-align: center; display: grid; justify-items: center; gap: 20px; margin-bottom: clamp(48px, 7vw, 80px); }
.zkwz-head .zks-lead { margin-inline: auto; }
.zkwz-tilt, .zkwz-tilt > div { height: 100%; }
.zkwz-card { padding: 0 !important; overflow: hidden; border-radius: 28px; height: 100%; display: flex; flex-direction: column; }
.zkwz-stage { position: relative; aspect-ratio: 4 / 3; overflow: hidden; border-bottom: 1px solid var(--zk-border);
  background: radial-gradient(75% 75% at 50% 45%, rgb(var(--c) / .2), transparent 72%), linear-gradient(180deg, rgb(255 255 255 / .035), transparent); }
.zkwz-stage::before { content: ""; position: absolute; left: 50%; top: 50%; width: 180%; aspect-ratio: 1; margin: -90% 0 0 -90%;
  background: repeating-conic-gradient(rgb(var(--c) / .07) 0 8deg, transparent 8deg 20deg); border-radius: 50%; animation: zk-spin 70s linear infinite; }
.zkwz-stage::after { content: ""; position: absolute; inset: auto 0 0 0; height: 30%; background: linear-gradient(180deg, transparent, rgb(var(--zk-surface-rgb) / .55)); pointer-events: none; }
.zkart { position: absolute; inset: 4% 3% 0; z-index: 1; }
.zkart svg { display: block; width: 100%; height: 100%; overflow: visible; }
.zkwz-copy { padding: clamp(22px, 2.6vw, 30px); display: grid; gap: 12px; align-content: start; }
.zkwz-tag { display: inline-flex; align-items: center; gap: 7px; justify-self: start; padding: 6px 11px; border-radius: 999px;
  font: var(--zk-type-label); letter-spacing: .12em; text-transform: uppercase; color: var(--cc);
  background: rgb(var(--c) / .12); border: 1px solid rgb(var(--c) / .3); }
.zkwz-num { position: absolute; top: 16px; right: 18px; z-index: 2; font: 700 12px/1 var(--zk-font-mono); letter-spacing: .1em; color: rgb(255 255 255 / .45);
  padding: 6px 9px; border-radius: 10px; background: rgb(var(--zk-bg-rgb) / .45); border: 1px solid var(--zk-border); backdrop-filter: blur(6px); }
.zkwz-band { position: relative; margin-top: clamp(90px, 12vw, 150px); padding-block: 10px 30px; }
.zkwz-row { will-change: transform; }
.zkwz-word { font: 800 clamp(58px, 10.5vw, 168px)/1 var(--zk-font-display); letter-spacing: -.035em; white-space: nowrap; padding-block: .06em; }
.zkwz-word.is-outline { color: transparent; -webkit-text-stroke: 2px rgb(255 255 255 / .6); }
.zkwz-word.is-fill { color: var(--zk-text); text-shadow: 0 .05em 0 var(--zk-purple); }
.zkwz-word.is-gold { color: var(--zk-gold); text-shadow: 0 .05em 0 var(--zk-gold-text-edge), 0 0 60px rgb(var(--zk-gold-rgb) / .35); }
.zkwz-dot { font: 800 clamp(40px, 6vw, 96px)/1 var(--zk-font-display); color: var(--zk-gold); align-self: center; }
.zkwz-tape { position: relative; margin: -6px -32px 0; transform: rotate(-2.2deg); background: var(--zk-grad-gold); padding-block: 14px;
  box-shadow: 0 8px 0 var(--zk-gold-deep), 0 30px 60px rgb(0 0 0 / .45); width: 110%; margin-left: -5%; }
.zkwz-tapeword { font: 800 clamp(20px, 2.6vw, 34px)/1 var(--zk-font-display); letter-spacing: -.01em; color: var(--zk-gold-ink); white-space: nowrap; }
.zkwz-tapestar { color: var(--zk-gold-ink); display: inline-flex; align-self: center; opacity: .75; }
`;

function FeatureCard({ f, i }: { f: Feature; i: number }) {
  const { Art } = f;
  return (
    <Reveal delay={i * 0.12} y={50} style={{ height: "100%" }}>
      <Tilt max={7} radius={28} className="zkwz-tilt">
        <article className="zks-card zkwz-card" style={{ ["--c" as string]: f.rgb, ["--cc" as string]: f.color }}>
          <div className="zkwz-stage">
            <span className="zkwz-num" aria-hidden>
              {f.n}
            </span>
            <Art />
          </div>
          <div className="zkwz-copy">
            <span className="zkwz-tag">
              <Icon icon={f.icon} size={14} stroke={2.4} />
              {f.tag}
            </span>
            <h3 className="zks-h3">{f.title}</h3>
            <p className="zks-body">{f.body}</p>
          </div>
        </article>
      </Tilt>
    </Reveal>
  );
}

function StatementBand() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReduced();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const x1 = useTransform(scrollYProgress, [0, 1], ["6%", "-10%"]);
  const x2 = useTransform(scrollYProgress, [0, 1], ["-8%", "4%"]);
  // Scroll speed bends the type: fling the page and the words lean into it.
  const { scrollY } = useScroll();
  const velocity = useSpring(useVelocity(scrollY), { damping: 40, stiffness: 300 });
  const skew = useTransform(velocity, [-2600, 0, 2600], [9, 0, -9], { clamp: true });

  return (
    <div ref={ref} className="zkwz-band">
      <p style={srOnly}>Encrypted. Private by default. First one wins. Hide it. Crack it. Get Zecked.</p>
      <div aria-hidden>
        <motion.div className="zkwz-row" style={reduce ? undefined : { x: x1, skewX: skew, willChange: "transform" }}>
          <Marquee speed={70} gap={36} fade={false} clip={false}>
            {WORDS.map((w, i) => (
              <span key={w} style={{ display: "inline-flex", gap: 36, alignItems: "center" }}>
                <span className={`zkwz-word ${w === "GET ZECKED" ? "is-gold" : i % 2 === 0 ? "is-outline" : "is-fill"}`}>{w}</span>
                <span className="zkwz-dot">•</span>
              </span>
            ))}
          </Marquee>
        </motion.div>
        <div className="zkwz-tape">
          <motion.div style={reduce ? undefined : { x: x2, willChange: "transform" }}>
            <Marquee speed={36} gap={28} reverse fade={false} clip={false}>
              {TAPE.map((w) => (
                <span key={w} style={{ display: "inline-flex", gap: 28, alignItems: "center" }}>
                  <span className="zkwz-tapeword">{w}</span>
                  <span className="zkwz-tapestar">
                    <Icon icon="sparkle" size={22} stroke={2.6} />
                  </span>
                </span>
              ))}
            </Marquee>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export function WhyZcash() {
  return (
    <section id="why" className="zks-section" style={{ overflow: "hidden", paddingBottom: "clamp(60px, 8vw, 110px)" }}>
      <style>{CSS}</style>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(40% 35% at 15% 20%, rgb(var(--zk-sky-rgb) / .12), transparent 70%), radial-gradient(40% 35% at 85% 35%, rgb(var(--zk-pink-rgb) / .1), transparent 70%), radial-gradient(50% 40% at 50% 70%, rgb(var(--zk-mint-rgb) / .07), transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div className="zks-container" style={{ position: "relative" }}>
        <div className="zkwz-head">
          <Eyebrow color="var(--zk-mint)">
            <Icon icon="shieldCheck" size={14} stroke={2.4} /> Why Zcash
          </Eyebrow>
          <SplitText text="Only possible on Zcash" className="zks-h2 zkx-split" highlight={["Zcash"]} />
          <Reveal delay={0.2} y={20}>
            <p className="zks-lead">
              Most blockchains are glass boxes: every prize, every winner, every wallet on show. Zcash can prove a prize is real and still keep the winner private.
            </p>
          </Reveal>
        </div>
        <div className="zks-grid-3">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.n} f={f} i={i} />
          ))}
        </div>
      </div>
      <StatementBand />
    </section>
  );
}
