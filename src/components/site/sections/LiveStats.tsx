"use client";
// Live scoreboard straight from the app's /api/stats. Zeros become an invitation, never a sad "0".
import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { Icon } from "@/components/zk";
import { Eyebrow, Reveal, SPRING, SplitText } from "../fx";
import { Count } from "./extras/Count";
import { SPLIT_FIX_CSS, srOnly, useReduced, useScrolling } from "./extras/kit";

export type SiteStats = {
  network: string;
  stashesHidden: number;
  stashesZecked: number;
  zecZecked: number;
  players: number;
  liveNow: number;
  zecUsd: number;
};

type TileKey = "stashesHidden" | "stashesZecked" | "zecZecked" | "players";

const TILES: {
  key: TileKey;
  label: string;
  icon: string;
  grad: string;
  edge: string;
  ink: string;
  accent: string;
  rgb: string;
  zero: string;
  decimals?: number;
}[] = [
  {
    key: "stashesHidden",
    label: "Stashes hidden",
    icon: "lock",
    grad: "var(--zk-grad-tile-purple)",
    edge: "var(--zk-purple-shade)",
    ink: "#fff",
    accent: "var(--zk-purple-light)",
    rgb: "var(--zk-purple-rgb)",
    zero: "Be the first to hide one",
  },
  {
    key: "stashesZecked",
    label: "Stashes zecked",
    icon: "unlock",
    grad: "var(--zk-grad-tile-gold)",
    edge: "var(--zk-gold-deep)",
    ink: "var(--zk-gold-ink)",
    accent: "var(--zk-gold)",
    rgb: "var(--zk-gold-rgb)",
    zero: "Nobody’s cracked one yet",
  },
  {
    key: "zecZecked",
    label: "ZEC zecked",
    icon: "coin",
    grad: "var(--zk-grad-tile-mint)",
    edge: "var(--zk-mint-deep)",
    ink: "var(--zk-mint-ink)",
    accent: "var(--zk-mint)",
    rgb: "var(--zk-mint-rgb)",
    zero: "The first win could be yours",
    decimals: 4,
  },
  {
    key: "players",
    label: "Players",
    icon: "user",
    grad: "var(--zk-grad-tile-sky)",
    edge: "var(--zk-sky-shade)",
    ink: "#fff",
    accent: "var(--zk-sky)",
    rgb: "var(--zk-sky-rgb)",
    zero: "Be player one",
  },
];

const CSS = `
${SPLIT_FIX_CSS}
.zkls-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 24px 40px; margin-bottom: clamp(36px, 5vw, 56px); }
.zkls-head-copy { display: grid; gap: 18px; justify-items: start; }
.zkls-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
@media (min-width: 520px) { .zkls-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1040px) { .zkls-grid { grid-template-columns: repeat(4, 1fr); gap: 18px; } }
.zkls-tile { position: relative; overflow: hidden; border-radius: 28px; padding: 24px 22px 22px; min-height: clamp(196px, 22vw, 236px); display: flex; flex-direction: column;
  background: radial-gradient(90% 70% at 100% 0%, rgb(var(--c) / .18), transparent 60%), linear-gradient(180deg, rgb(255 255 255 / .06), rgb(255 255 255 / .02)), var(--zk-surface);
  border: 1px solid rgb(var(--c) / .22); box-shadow: 0 24px 60px rgba(0,0,0,.35), inset 0 1px 0 rgb(255 255 255 / .07); cursor: default; }
.zkls-tile::after { content: ""; position: absolute; left: 22px; right: 22px; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: rgb(var(--c) / .8); opacity: .6; }
.zkls-ico { width: 52px; height: 52px; border-radius: 16px; display: grid; place-items: center; box-shadow: 0 5px 0 var(--edge), inset 0 2px 0 rgb(255 255 255 / .35); }
.zkls-label { font: var(--zk-type-label); letter-spacing: .14em; text-transform: uppercase; color: var(--zk-text-muted); margin-top: 22px; }
.zkls-num { font: 800 clamp(44px, 5vw, 68px)/1 var(--zk-font-display); letter-spacing: -.03em; margin-top: 10px; color: var(--zk-text); display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.zkls-unit { font: 800 18px/1 var(--zk-font-display); color: var(--acc); letter-spacing: 0; }
.zkls-sub { font: var(--zk-type-small); color: var(--zk-text-muted); margin-top: auto; padding-top: 14px; }
.zkls-zero { display: inline-flex; align-items: center; gap: 10px; }
@media (min-width: 1040px) and (max-width: 1279px) { .zkls-zero { font-size: .8em; gap: 6px; } }
.zkls-you { color: var(--acc); display: inline-block; }
.zkls-water { position: absolute; right: -18px; bottom: -22px; color: rgb(var(--c) / .1); pointer-events: none; }
.zkls-live { display: inline-flex; align-items: center; gap: 12px; padding: 12px 20px 12px 14px; border-radius: 999px; background: var(--zk-mint); color: var(--zk-mint-ink);
  font: 800 15px/1.2 var(--zk-font-body); box-shadow: 0 5px 0 var(--zk-mint-deep), 0 18px 50px rgb(var(--zk-mint-rgb) / .35); animation: zkls-breathe 2.4s ease-in-out infinite; }
.zkls-live b { white-space: nowrap; font-weight: 900; letter-spacing: .1em; text-transform: uppercase; font-size: 12px; padding: 5px 8px; border-radius: 8px; background: rgb(6 42 30 / .14); }
.zkls-dot { position: relative; width: 12px; height: 12px; flex: none; }
.zkls-dot i { position: absolute; inset: 0; border-radius: 50%; background: var(--zk-mint-ink); }
.zkls-dot i:first-child { animation: zk-ping 1.6s ease-out infinite; opacity: .6; }
@keyframes zkls-breathe { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.035) } }
.zkls-foot { margin-top: 26px; display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; font: var(--zk-type-small); color: var(--zk-text-faint); }
`;

function ZeroState({ accent }: { accent: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { amount: 0.5 });
  const reduce = useReduced();
  // Loops rest while the page scrolls (see useScene), then pick up again.
  const moving = useScrolling();
  const live = seen && !reduce && !moving;
  return (
    <span ref={ref} className="zkls-zero">
      <span style={srOnly}>Zero so far. You could be first.</span>
      <span aria-hidden>0</span>
      <motion.span
        aria-hidden
        style={{ display: "inline-flex", color: accent }}
        animate={live ? { x: [0, 8, 0] } : { x: 0 }}
        transition={live ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
      >
        <Icon icon="arrowRight" size={34} stroke={3} />
      </motion.span>
      <motion.span
        aria-hidden
        className="zkls-you"
        initial={{ rotate: -6, scale: 0.6, opacity: 0 }}
        animate={seen ? (live ? { rotate: [-6, 4, -6], y: [0, -4, 0], scale: 1, opacity: 1 } : { rotate: -6, y: 0, scale: 1, opacity: 1 }) : undefined}
        transition={
          live
            ? { rotate: { duration: 2.2, repeat: Infinity, ease: "easeInOut" }, y: { duration: 2.2, repeat: Infinity, ease: "easeInOut" }, default: { type: "spring", stiffness: 380, damping: 12, delay: 0.3 } }
            : { type: "spring", stiffness: 380, damping: 12, delay: 0.3 }
        }
      >
        you?
      </motion.span>
    </span>
  );
}

function Tile({ t, i, stats }: { t: (typeof TILES)[number]; i: number; stats: SiteStats | null }) {
  const value = stats ? Number(stats[t.key]) || 0 : null;
  const mainnet = stats?.network === "mainnet";
  const usd = mainnet && t.key === "zecZecked" && value && stats?.zecUsd ? value * stats.zecUsd : 0;
  return (
    <Reveal delay={i * 0.09} y={40}>
      <motion.div
        className="zkls-tile"
        style={{ ["--c" as string]: t.rgb, ["--acc" as string]: t.accent }}
        initial="rest"
        whileHover="hover"
        animate="rest"
        variants={{ rest: { y: 0 }, hover: { y: -8 } }}
        transition={SPRING}
      >
        <motion.div aria-hidden className="zkls-water" variants={{ rest: { rotate: 0, scale: 1 }, hover: { rotate: -10, scale: 1.1 } }} transition={SPRING}>
          <Icon icon={t.icon} size={150} stroke={1.6} />
        </motion.div>
        <motion.div
          className="zkls-ico"
          style={{ background: t.grad, color: t.ink, ["--edge" as string]: t.edge }}
          variants={{ rest: { rotate: 0, scale: 1 }, hover: { rotate: -8, scale: 1.08 } }}
          transition={{ type: "spring", stiffness: 400, damping: 12 }}
        >
          <Icon icon={t.icon} size={26} stroke={2.4} />
        </motion.div>
        <div className="zkls-label">{t.label}</div>
        <div className="zkls-num">
          {value === null ? (
            <span style={{ color: "var(--zk-text-faint)" }}>
              <span aria-hidden>?</span>
              <span style={srOnly}>Not available right now</span>
            </span>
          ) : value === 0 ? (
            <ZeroState accent={t.accent} />
          ) : (
            <>
              <Count to={value} decimals={t.decimals ?? 0} />
              {t.key === "zecZecked" ? <span className="zkls-unit">{mainnet ? "ZEC" : "test ZEC"}</span> : null}
            </>
          )}
        </div>
        <div className="zkls-sub">
          {value === null
            ? "Open the app for the live count"
            : value === 0
              ? t.zero
              : usd
                ? `≈ $${usd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                : t.key === "zecZecked" && !mainnet
                  ? "Test coins, zero value, all bragging rights"
                  : "and counting"}
        </div>
      </motion.div>
    </Reveal>
  );
}

function LivePill({ stats }: { stats: SiteStats | null }) {
  const n = stats ? Math.max(0, Math.floor(stats.liveNow || 0)) : null;
  return (
    <Reveal delay={0.2} y={20} blur={false}>
      <div className="zkls-live">
        <span className="zkls-dot" aria-hidden>
          <i />
          <i />
        </span>
        <b>Live now</b>
        <span>
          {n === null ? (
            "See what’s waiting in the app"
          ) : n === 0 ? (
            "A fresh vault. Hide the first stash"
          ) : (
            <>
              <Count to={n} duration={1.2} /> {n === 1 ? "stash" : "stashes"} waiting
            </>
          )}
        </span>
      </div>
    </Reveal>
  );
}

export function LiveStats({ stats }: { stats: SiteStats | null }) {
  const net = stats?.network;
  const source = net === "mainnet" ? "Live from the app" : net === "sim" ? "Live from the play-money app" : "Live from the testnet app";
  return (
    <section id="stats" className="zks-section" style={{ overflow: "hidden" }}>
      <style>{CSS}</style>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "radial-gradient(60% 50% at 50% 40%, rgb(var(--zk-purple-rgb) / .14), transparent 70%)",
          WebkitMaskImage: "linear-gradient(180deg, transparent, #000 20%, #000 80%, transparent)",
          maskImage: "linear-gradient(180deg, transparent, #000 20%, #000 80%, transparent)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          opacity: 0.5,
          backgroundImage: "linear-gradient(rgb(255 255 255 / .035) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / .035) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          WebkitMaskImage: "radial-gradient(60% 60% at 50% 50%, #000, transparent)",
          maskImage: "radial-gradient(60% 60% at 50% 50%, #000, transparent)",
        }}
      />
      <div className="zks-container" style={{ position: "relative" }}>
        <div className="zkls-head">
          <div className="zkls-head-copy">
            <Eyebrow color="var(--zk-mint)">
              <Icon icon="signal" size={14} stroke={2.4} /> {source}
            </Eyebrow>
            <SplitText text="Straight from the vault" className="zks-h2 zkx-split" highlight={["vault"]} />
          </div>
          <LivePill stats={stats} />
        </div>
        <div className="zkls-grid">
          {TILES.map((t, i) => (
            <Tile key={t.key} t={t} i={i} stats={stats} />
          ))}
        </div>
        <Reveal delay={0.3} y={10} blur={false}>
          <div className="zkls-foot">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icon icon="info" size={15} /> Real counts from the ZECKED app, updated about once a minute.
            </span>
            {net !== "mainnet" ? <span>Test mode: every coin here is test ZEC.</span> : null}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
