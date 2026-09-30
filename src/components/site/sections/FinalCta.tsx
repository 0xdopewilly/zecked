"use client";
// The big finish: full-bleed, scroll-scaled headline over a spinning vault. Play pops confetti on hover or tap.
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef, useState } from "react";
import { Confetti, Icon, Vault } from "@/components/zk";
import { Eyebrow, Float, Magnetic, Parallax, Reveal, SplitText, Sticker } from "../fx";
import { GetAppButton, PhoneGlyph } from "../GetApp";
import { Burst } from "./extras/Burst";
import { SPLIT_FIX_CSS, srOnly, useReduced } from "./extras/kit";

const STICKERS = [
  { left: "6%", top: "16%", rotate: -9, speed: 0.5, icon: "lock", label: "Hide it", bg: "var(--zk-pink)", fg: "#fff", edge: "var(--zk-pink-deep)", cls: "" },
  { right: "6%", top: "13%", rotate: 8, speed: 0.35, icon: "key", label: "Crack it", bg: "var(--zk-sky)", fg: "var(--zk-sky-ink)", edge: "var(--zk-sky-deep)", cls: "" },
  { left: "9%", top: "76%", rotate: 6, speed: 0.25, icon: "shieldCheck", label: "Lands shielded", bg: "var(--zk-mint)", fg: "var(--zk-mint-ink)", edge: "var(--zk-mint-deep)", cls: " zkfc-st-wide" },
  { right: "8%", top: "80%", rotate: -6, speed: 0.45, icon: "sparkle", label: "Get Zecked", bg: "var(--zk-gold)", fg: "var(--zk-gold-ink)", edge: "var(--zk-gold-deep)", cls: " zkfc-st-wide" },
];

const CSS = `
${SPLIT_FIX_CSS}
.zkfc { position: relative; overflow: hidden; min-height: 100svh; display: grid; place-items: center; padding-block: clamp(120px, 14vw, 180px); isolation: isolate; }
.zkfc-bg { position: absolute; inset: 0; z-index: -3; background: radial-gradient(70% 55% at 50% 50%, #5A33E8 0%, #2A1470 38%, transparent 76%); }
.zkfc-sun { position: absolute; left: 50%; top: 50%; width: 1100px; height: 1100px; margin: -550px 0 0 -550px; z-index: -2; border-radius: 50%;
  background: var(--zk-sunburst-gold); opacity: .35; animation: zk-spin 120s linear infinite; will-change: transform; }
.zkfc-sunfade { position: absolute; left: 50%; top: 50%; width: 1120px; height: 1120px; margin: -560px 0 0 -560px; z-index: -2; border-radius: 50%; pointer-events: none;
  background: radial-gradient(closest-side, transparent 28%, rgb(var(--zk-bg-rgb) / .75) 70%, var(--zk-bg) 100%); }
.zkfc-vaultwrap { position: absolute; left: 50%; top: 50%; z-index: -1; width: 0; height: 0; pointer-events: none; }
.zkfc-vaultpos { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); opacity: .3; }
.zkfc-inner::before { content: ""; position: absolute; left: 50%; top: 50%; width: min(1100px, 140vw); height: 120%; transform: translate(-50%, -50%); z-index: -1; pointer-events: none;
  background: radial-gradient(closest-side, rgb(var(--zk-bg-rgb) / .55), transparent); }
.zkfc-glow { position: absolute; left: 50%; top: 58%; width: min(760px, 90vw); height: 38%; transform: translate(-50%, -50%); z-index: -1; pointer-events: none; border-radius: 50%;
  background: radial-gradient(closest-side, rgb(var(--zk-gold-rgb) / .24), transparent 80%); }
.zkfc-vault { width: min(640px, 125vw) !important; height: min(640px, 125vw) !important; }
.zkfc-vault svg { width: 100% !important; height: 100% !important; }
.zkfc-inner { position: relative; z-index: 2; display: grid; justify-items: center; text-align: center; gap: 26px; width: min(1360px, 100% - 32px); margin-inline: auto; }
.zkfc-title { margin: 0; font: 800 clamp(52px, 11.5vw, 176px)/1 var(--zk-font-display); letter-spacing: -.045em; }
.zkfc-line { display: block; }
.zkfc-line + .zkfc-line { margin-top: -.1em; }
.zkfc-lead { margin: 0 auto; max-width: 560px; }
.zkfc-actions { display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 22px 26px; margin-top: 12px; }
.zkfc-playwrap { position: relative; }
.zkfc-play { position: relative; height: 78px; padding: 0 40px; border-radius: 26px; font: 800 26px/1 var(--zk-font-display); }
.zkfc-play::after { content: ""; position: absolute; inset: -7px; border-radius: 32px; border: 2px solid rgb(var(--zk-gold-rgb) / .65); animation: zkfc-ring 2.4s ease-out infinite; pointer-events: none; }
@keyframes zkfc-ring { 0% { transform: scale(.96); opacity: .9 } 80%, 100% { transform: scale(1.14); opacity: 0 } }
.zkfc-demo { display: grid; justify-items: center; gap: 10px; }
.zkfc-demo .zks-btn { height: 78px; border-radius: 26px; }
.zkfc-note { display: inline-flex; align-items: center; gap: 7px; font: var(--zk-type-small); color: var(--zk-text-muted); }
.zkfc-st { position: absolute; z-index: 1; pointer-events: none; }
@media (max-width: 760px) { .zkfc-st-wide { display: none; } .zkfc-st { transform: scale(.82); } }
@media (max-width: 520px) { .zkfc-play, .zkfc-demo .zks-btn { height: 66px; font-size: 21px; padding: 0 26px; } }
`;

export function FinalCta({ appUrl }: { appUrl: string }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReduced();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const p = useSpring(scrollYProgress, { stiffness: 110, damping: 26, mass: 0.5 });
  const titleScale = useTransform(p, [0, 0.5], [0.58, 1]);
  const titleY = useTransform(p, [0, 0.5, 1], [36, 0, -36]);
  const vaultRotate = useTransform(p, [0, 1], [-80, 80]);
  const vaultScale = useTransform(p, [0, 0.5, 1], [0.7, 1, 1.18]);

  const [fire, setFire] = useState(0);
  const last = useRef(0);
  const pop = () => {
    const now = performance.now();
    if (now - last.current < 900) return;
    last.current = now;
    setFire((f) => f + 1);
  };

  return (
    <section ref={ref} id="play" className="zkfc">
      <style>{CSS}</style>
      <div className="zkfc-bg" aria-hidden />
      <div className="zkfc-sun" aria-hidden />
      <div className="zkfc-sunfade" aria-hidden />
      <div className="zkfc-vaultwrap" aria-hidden>
        <motion.div style={reduce ? undefined : { rotate: vaultRotate, scale: vaultScale, willChange: "transform" }}>
          <div className="zkfc-vaultpos">
            <Vault mode="spin" size={520} className="zkfc-vault" />
          </div>
        </motion.div>
      </div>

      {STICKERS.map((s) => (
        <div key={s.label} className={`zkfc-st${s.cls}`} style={{ left: s.left, right: s.right, top: s.top }} aria-hidden>
          <Parallax speed={s.speed}>
            <Float amplitude={9} duration={4 + s.speed * 3} delay={s.speed}>
              <Sticker bg={s.bg} fg={s.fg} edge={s.edge} rotate={s.rotate}>
                <Icon icon={s.icon} size={16} stroke={2.6} /> {s.label}
              </Sticker>
            </Float>
          </Parallax>
        </div>
      ))}

      <div className="zkfc-inner">
        <Eyebrow>
          <Icon icon="flame" size={14} stroke={2.4} /> Your move
        </Eyebrow>
        <motion.div style={reduce ? { marginBottom: 12 } : { scale: titleScale, y: titleY, transformOrigin: "50% 100%", marginBottom: 12, willChange: "transform" }}>
          <h2 className="zkfc-title" style={{ position: "relative" }}>
            <span className="zkfc-glow" aria-hidden />
            <span style={srOnly}>Ready to get Zecked?</span>
            <span aria-hidden className="zkfc-line">
              <SplitText as="span" className="zkx-split" text="Ready to get" wordStyle={() => ({ textShadow: "0 .045em 0 var(--zk-purple)" })} />
            </span>
            <span aria-hidden className="zkfc-line">
              <SplitText
                as="span"
                className="zkx-split"
                text="Zecked?"
                by="char"
                stagger={0.05}
                delay={0.2}
                highlight={["Zecked"]}
                wordStyle={() => ({ textShadow: "0 .045em 0 var(--zk-gold-text-edge)" })}
              />
            </span>
          </h2>
        </motion.div>
        <Reveal delay={0.15} y={20}>
          <p className="zks-lead zkfc-lead">Riddles and match calls with ZEC inside. First one to crack it keeps it.</p>
        </Reveal>
        <Reveal delay={0.25} y={24} blur={false}>
          <div className="zkfc-actions">
            <div className="zkfc-playwrap">
              {reduce ? null : <Burst fire={fire} />}
              <Magnetic strength={0.45}>
                <a
                  className="zks-btn zks-btn-gold zkfc-play"
                  href={appUrl}
                  onPointerEnter={(e) => {
                    if (e.pointerType === "mouse") pop();
                  }}
                  onPointerDown={(e) => {
                    if (e.pointerType !== "mouse") pop();
                  }}
                >
                  Play now <Icon icon="arrowRight" size={26} stroke={2.8} />
                </a>
              </Magnetic>
            </div>
            <div className="zkfc-demo">
              <Magnetic strength={0.3}>
                <GetAppButton appUrl={appUrl} className="zks-btn zks-btn-purple">
                  <PhoneGlyph size={24} stroke={2.6} /> Get the app
                </GetAppButton>
              </Magnetic>
              <span className="zkfc-note">
                <Icon icon="bolt" size={14} stroke={2.4} /> On your Home Screen, no app store
              </span>
            </div>
            <div className="zkfc-demo">
              <Magnetic strength={0.25}>
                <a className="zks-btn zks-btn-ghost" href="#testzec">
                  <Icon icon="coin" size={22} stroke={2.4} /> Get free test ZEC
                </a>
              </Magnetic>
              <span className="zkfc-note">
                <Icon icon="sparkle" size={14} stroke={2.4} /> From the Zcash faucet, in a minute
              </span>
            </div>
          </div>
        </Reveal>
      </div>

      {fire > 0 && !reduce ? <Confetti run={fire} seed={fire * 7 + 3} count={70} /> : null}
    </section>
  );
}
