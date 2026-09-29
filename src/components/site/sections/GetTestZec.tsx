"use client";
// Get free test ZEC: three steps joined by a dashed trail that draws itself as you scroll.
import { motion, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/zk";
import { Eyebrow, Magnetic, Reveal, SplitText, Tilt } from "../fx";
import { SPLIT_FIX_CSS, useReduced, useSafeId } from "./extras/kit";

const FAUCET = "https://faucet.testnet.valargroup.dev";
const FAUCET_BACKUP = "https://zcashfaucet.jinolabs.xyz";

// Desktop trail: hops from badge centre to badge centre (viewBox 1000 x 120, badges at y = 100).
const TRAIL = "M160 100Q330 -30 500 100Q670 -30 840 100";

const STEPS: { n: number; icon: string; color: string; rgb: string; title: string; body: ReactNode; extra: "address" | "faucet" | "land" }[] = [
  {
    n: 1,
    icon: "user",
    color: "var(--zk-purple-light)",
    rgb: "var(--zk-purple-rgb)",
    title: "Sign up, grab your address",
    body: (
      <>
        Sign up at ZECKED with your email. Your personal Zcash address is waiting in <b>Wallet → Add ZEC</b>.
      </>
    ),
    extra: "address",
  },
  {
    n: 2,
    icon: "copy",
    color: "var(--zk-sky)",
    rgb: "var(--zk-sky-rgb)",
    title: "Paste it into the faucet",
    body: <>A faucet hands out free testnet coins. Paste your address, ask for some, done.</>,
    extra: "faucet",
  },
  {
    n: 3,
    icon: "clock",
    color: "var(--zk-mint)",
    rgb: "var(--zk-mint-rgb)",
    title: "It lands in about a minute",
    body: <>Watch it pop into your ZECKED wallet. Then hide a stash, or go crack one.</>,
    extra: "land",
  },
];

const CSS = `
${SPLIT_FIX_CSS}
.zktz-head { display: grid; gap: 20px; justify-items: start; max-width: 780px; }
.zktz-wrap { position: relative; margin-top: 56px; }
.zktz-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 22px; position: relative; }
.zktz-step { position: relative; padding-left: 68px; }
.zktz-badge { position: absolute; left: 0; top: 18px; width: 52px; height: 52px; border-radius: 50%; z-index: 3; }
.zktz-badge-face { position: absolute; inset: 0; border-radius: 50%; display: grid; place-items: center; font: 800 22px/1 var(--zk-font-display); }
.zktz-badge-off { background: var(--zk-surface-raised); color: var(--zk-text-faint); border: 2px dashed var(--zk-border-strong); }
.zktz-badge-on { background: var(--zk-grad-gold); color: var(--zk-gold-ink); box-shadow: 0 5px 0 var(--zk-gold-deep), 0 0 34px rgb(var(--zk-gold-rgb) / .55); }
.zktz-link { position: absolute; left: 24.5px; top: 76px; width: 3px; height: calc(100% - 42px); overflow: hidden; border-radius: 3px; z-index: 2;
  background: repeating-linear-gradient(180deg, rgb(255 255 255 / .12) 0 8px, transparent 8px 16px); }
.zktz-link-fill { position: absolute; inset: 0; background: repeating-linear-gradient(180deg, var(--zk-gold) 0 8px, transparent 8px 16px); }
.zktz-path { display: none; }
.zktz-tilt, .zktz-tilt > div, .zktz-card { height: 100%; }
.zktz-card-inner { display: grid; gap: 12px; align-content: start; }
.zktz-glow { position: absolute; inset: -1px; border-radius: 28px; pointer-events: none; border: 1.5px solid rgb(var(--c) / .55); box-shadow: 0 0 0 5px rgb(var(--c) / .08), 0 20px 60px rgb(var(--c) / .18); }
.zktz-ico { width: 46px; height: 46px; border-radius: 14px; display: grid; place-items: center; color: var(--cc); background: rgb(var(--c) / .14); border: 1px solid rgb(var(--c) / .3); }
.zktz-kicker { font: var(--zk-type-label); letter-spacing: .14em; text-transform: uppercase; color: var(--cc); }
.zktz-body { font: 500 15.5px/1.55 var(--zk-font-body); color: var(--zk-text-muted); margin: 0; }
.zktz-body b { color: var(--zk-text); font-weight: 700; }
.zktz-mini { margin-top: 6px; border-radius: 18px; padding: 12px; background: rgb(var(--zk-bg-rgb) / .6); border: 1px solid var(--zk-border); display: grid; gap: 10px; }
.zktz-crumbs { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font: var(--zk-type-caption); color: var(--zk-text-muted); }
.zktz-crumb { padding: 6px 10px; border-radius: 10px; background: var(--zk-surface-raised); color: var(--zk-text); font-weight: 700; }
.zktz-addr { position: relative; overflow: hidden; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border-radius: 12px;
  background: var(--zk-surface); border: 1px dashed rgb(var(--zk-purple-rgb) / .45); font: var(--zk-type-mono-sm); color: var(--zk-purple-light); }
.zktz-shine { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgb(255 255 255 / .12) 50%, transparent 70%); animation: zktz-shine 2.8s ease-in-out infinite; }
@keyframes zktz-shine { 0% { transform: translateX(-100%) } 60%, 100% { transform: translateX(100%) } }
.zktz-faucet { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; border-radius: 14px; text-decoration: none;
  background: var(--zk-sky); color: var(--zk-sky-ink); font: 800 14px/1.2 var(--zk-font-body); box-shadow: 0 4px 0 var(--zk-sky-deep); overflow-wrap: anywhere;
  transition: transform .18s var(--zk-ease-out), box-shadow .18s var(--zk-ease-out), filter .2s; }
.zktz-faucet:hover { color: var(--zk-sky-ink); filter: brightness(1.08); transform: translateY(-2px); box-shadow: 0 6px 0 var(--zk-sky-deep); }
.zktz-faucet:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--zk-sky-deep); }
.zktz-backup { font: var(--zk-type-small); color: var(--zk-text-muted); overflow-wrap: anywhere; }
.zktz-backup a { color: var(--zk-sky-light); font-weight: 700; }
.zktz-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.zktz-chip { display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 999px; font: var(--zk-type-caption); font-weight: 800; }
.zktz-cta { margin-top: clamp(44px, 6vw, 64px); display: flex; flex-wrap: wrap; align-items: center; gap: 18px 26px; }
.zktz-note { display: inline-flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 16px; font: var(--zk-type-small); color: var(--zk-gold-pale);
  background: rgb(var(--zk-gold-rgb) / .08); border: 1px solid rgb(var(--zk-gold-rgb) / .28); }
@media (min-width: 880px) {
  .zktz-wrap { margin-top: 150px; }
  .zktz-steps { grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .zktz-step { padding-left: 0; }
  .zktz-badge { left: 50%; margin-left: -32px; top: -32px; width: 64px; height: 64px; }
  .zktz-badge-face { font-size: 26px; }
  .zktz-link { display: none; }
  .zktz-path { display: block; position: absolute; left: 0; top: -100px; width: 100%; height: 120px; pointer-events: none; z-index: 2; overflow: visible; }
  .zktz-card-inner { padding-top: 26px; }
}
`;

function Badge({ n, on }: { n: number; on: boolean }) {
  return (
    <motion.div
      className="zktz-badge"
      aria-hidden
      initial={false}
      animate={on ? { scale: [1, 1.3, 1], rotate: [0, -10, 0] } : { scale: 1, rotate: 0 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
    >
      <div className="zktz-badge-face zktz-badge-off">{n}</div>
      <motion.div className="zktz-badge-face zktz-badge-on" initial={false} animate={{ opacity: on ? 1 : 0 }} transition={{ duration: 0.25 }}>
        {n}
      </motion.div>
    </motion.div>
  );
}

function Extra({ kind }: { kind: "address" | "faucet" | "land" }) {
  if (kind === "address")
    return (
      <div className="zktz-mini" aria-hidden>
        <div className="zktz-crumbs">
          <span className="zktz-crumb">Wallet</span>
          <Icon icon="arrowRight" size={14} />
          <span className="zktz-crumb" style={{ background: "var(--zk-purple)", color: "#fff" }}>
            Add ZEC
          </span>
        </div>
        <div className="zktz-addr">
          <span className="zktz-shine" />
          <span>utest1…</span>
          <Icon icon="copy" size={16} />
        </div>
      </div>
    );
  if (kind === "faucet")
    return (
      <div className="zktz-mini">
        <a className="zktz-faucet" href={FAUCET} target="_blank" rel="noopener noreferrer">
          <span>faucet.testnet.valargroup.dev</span>
          <Icon icon="share" size={17} stroke={2.4} />
        </a>
        <span className="zktz-backup">
          Busy? Try the backup:{" "}
          <a href={FAUCET_BACKUP} target="_blank" rel="noopener noreferrer">
            zcashfaucet.jinolabs.xyz
          </a>
          <span style={{ display: "block", marginTop: 6, color: "var(--zk-text-faint)" }}>Faucets often call test coins “TAZ”. Same thing.</span>
        </span>
      </div>
    );
  return (
    <div className="zktz-mini" aria-hidden>
      <div className="zktz-chips">
        <span className="zktz-chip" style={{ background: "rgb(var(--zk-mint-rgb) / .14)", color: "var(--zk-mint)" }}>
          <Icon icon="clock" size={14} stroke={2.4} /> ~1 minute
        </span>
        <span className="zktz-chip" style={{ background: "rgb(var(--zk-purple-rgb) / .16)", color: "var(--zk-purple-light)" }}>
          <Icon icon="lock" size={14} stroke={2.4} /> Hide a stash
        </span>
        <span className="zktz-chip" style={{ background: "rgb(var(--zk-gold-rgb) / .14)", color: "var(--zk-gold)" }}>
          <Icon icon="key" size={14} stroke={2.4} /> Crack one
        </span>
      </div>
    </div>
  );
}

function Connector({ progress, from, reduce }: { progress: MotionValue<number>; from: number; reduce: boolean }) {
  const y = useTransform(progress, [from, from + 0.5], ["-100%", "0%"]);
  return (
    <div className="zktz-link" aria-hidden>
      <motion.div className="zktz-link-fill" style={{ y: reduce ? "0%" : y }} />
    </div>
  );
}

export function GetTestZec({ appUrl }: { appUrl: string }) {
  const listRef = useRef<HTMLDivElement>(null);
  const reduce = useReduced();
  const mid = useSafeId("zktz");
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 85%", "end 65%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 24, mass: 0.4 });
  const [reached, setReached] = useState(0);
  useMotionValueEvent(progress, "change", (v) => {
    const r = v > 0.95 ? 3 : v > 0.47 ? 2 : v > 0.01 ? 1 : 0;
    setReached((prev) => (prev === r ? prev : r));
  });
  const lit = reduce ? 3 : reached;

  return (
    <section id="testzec" className="zks-section" style={{ overflow: "hidden" }}>
      <style>{CSS}</style>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "radial-gradient(55% 45% at 85% 20%, rgb(var(--zk-sky-rgb) / .12), transparent 70%), radial-gradient(45% 40% at 10% 90%, rgb(var(--zk-gold-rgb) / .08), transparent 70%)",
        }}
      />
      <div className="zks-container" style={{ position: "relative" }}>
        <div className="zktz-head">
          <Eyebrow color="var(--zk-sky)">
            <Icon icon="coin" size={14} stroke={2.4} /> Test mode
          </Eyebrow>
          <SplitText text="Get free test ZEC in 1 minute" className="zks-h2 zkx-split" highlight={["free"]} />
          <Reveal delay={0.2} y={20}>
            <p className="zks-lead">ZECKED runs on the Zcash testnet right now. Test coins are free, so grab a handful and start playing.</p>
          </Reveal>
        </div>

        <div ref={listRef} className="zktz-wrap">
          <svg className="zktz-path" viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden>
            <defs>
              <mask id={`${mid}m`} maskUnits="userSpaceOnUse" x="0" y="-40" width="1000" height="180">
                <motion.path d={TRAIL} fill="none" stroke="#fff" strokeWidth="16" strokeLinecap="butt" style={{ pathLength: reduce ? 1 : progress }} />
              </mask>
            </defs>
            <path d={TRAIL} fill="none" stroke="rgb(255 255 255 / .12)" strokeWidth="3" strokeDasharray="10 12" strokeLinecap="round" />
            <path d={TRAIL} fill="none" stroke="var(--zk-gold)" strokeWidth="4" strokeDasharray="10 12" strokeLinecap="round" mask={`url(#${mid}m)`} />
          </svg>
          <ol className="zktz-steps">

          {STEPS.map((s, i) => (
            <li key={s.n} className="zktz-step">
              <Badge n={s.n} on={lit >= s.n} />
              {i < STEPS.length - 1 ? <Connector progress={progress} from={i * 0.5} reduce={reduce} /> : null}
              <Reveal delay={i * 0.12} y={40} style={{ height: "100%" }}>
                <Tilt max={6} radius={28} className="zktz-tilt">
                  <div className="zks-card zktz-card" style={{ ["--c" as string]: s.rgb, ["--cc" as string]: s.color }}>
                    <motion.div className="zktz-glow" aria-hidden initial={false} animate={{ opacity: lit >= s.n ? 1 : 0 }} transition={{ duration: 0.4 }} />
                    <div className="zktz-card-inner">
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <span className="zktz-ico">
                          <Icon icon={s.icon} size={22} stroke={2.4} />
                        </span>
                        <span className="zktz-kicker">Step {s.n}</span>
                      </div>
                      <h3 className="zks-h3" style={{ fontSize: "clamp(22px, 2.2vw, 28px)" }}>
                        {s.title}
                      </h3>
                      <p className="zktz-body">{s.body}</p>
                      <Extra kind={s.extra} />
                    </div>
                  </div>
                </Tilt>
              </Reveal>
            </li>
          ))}
          </ol>
        </div>

        <Reveal y={24} blur={false}>
          <div className="zktz-cta">
            <Magnetic strength={0.3}>
              <a className="zks-btn zks-btn-gold" href={`${appUrl}/signin?next=/wallet&reason=wallet`}>
                Open the app <Icon icon="arrowRight" size={22} stroke={2.6} />
              </a>
            </Magnetic>
            <p className="zktz-note" style={{ margin: 0 }}>
              <Icon icon="info" size={18} stroke={2.2} />
              <span>Testnet ZEC has no value. It’s for playing and testing.</span>
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
