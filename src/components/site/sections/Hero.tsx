"use client";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef } from "react";
import { Icon, TeamBadge, Vault } from "@/components/zk";
import { DEMO_BARCELONA } from "@/lib/crest";
import { EASE_OUT, Float, Magnetic, Sticker, Tilt } from "../fx";
import { GetAppButton, PhoneGlyph } from "../GetApp";

const LINES: { text: string; gold?: boolean }[] = [{ text: "Hide it." }, { text: "Crack it." }, { text: "Get Zecked.", gold: true }];

function Blob({ color, size, x, y, delay, dur }: { color: string; size: number; x: string; y: string; delay: number; dur: number }) {
  // CSS keyframes (compositor-only, pausable when off screen) instead of a JS loop.
  return (
    <div
      aria-hidden
      className="zks-blob"
      style={{
        left: x,
        top: y,
        width: size * 1.6,
        height: size * 1.6,
        background: `radial-gradient(circle at center, ${color} 0%, transparent 62%)`,
        animationDuration: `${dur}s`,
        animationDelay: `${-delay}s`,
      }}
    />
  );
}

export function Hero({ appUrl, network }: { appUrl: string; network?: string }) {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 });
  // Scroll choreography: text lifts and fades, vault spins away, stickers fly outward.
  const textY = useTransform(p, [0, 1], [0, -140]);
  const textO = useTransform(p, [0, 0.7], [1, 0]);
  const vaultY = useTransform(p, [0, 1], [0, 180]);
  const vaultR = useTransform(p, [0, 1], [0, -28]);
  const vaultS = useTransform(p, [0, 1], [1, 0.72]);
  const fly = (dx: number, dy: number, r: number) => ({
    x: useTransform(p, [0, 1], [0, dx]),
    y: useTransform(p, [0, 1], [0, dy]),
    rotate: useTransform(p, [0, 1], [0, r]),
    willChange: "transform",
  });
  const s1 = fly(-260, -120, -40);
  const s2 = fly(240, -160, 35);
  const s3 = fly(-220, 200, 25);
  const s4 = fly(260, 160, -30);
  const s5 = fly(0, -260, 12);
  const gridY = useTransform(p, [0, 1], [0, 120]);

  return (
    <section ref={ref} style={{ position: "relative", minHeight: "100svh", overflow: "hidden", display: "flex", alignItems: "center", paddingTop: 110, paddingBottom: 70 }}>
      {/* Background */}
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(90% 70% at 70% 35%, #2F1F7A 0%, #170F3A 40%, var(--zk-bg) 75%)" }} />
      <Blob color="var(--zk-purple)" size={520} x="55%" y="0%" delay={0} dur={16} />
      <Blob color="var(--zk-pink)" size={380} x="-8%" y="52%" delay={2} dur={19} />
      <div aria-hidden className="zks-hero-sun" />
      {/* Retro grid floor */}
      <motion.div aria-hidden className="zks-gridwrap" style={{ position: "absolute", left: "-20%", right: "-20%", bottom: -40, height: "42%", perspective: 600, y: gridY, pointerEvents: "none", willChange: "transform" }}>
        <div className="zks-gridfloor" />
      </motion.div>

      <div className="zks-container" style={{ position: "relative", zIndex: 2, display: "grid", gap: 40, alignItems: "center" }}>
        <div className="zks-hero-grid">
          {/* Copy */}
          <motion.div style={{ y: textY, opacity: textO, willChange: "transform, opacity" }}>
            <motion.span
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.8, ease: EASE_OUT }}
              style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 14px", borderRadius: 999, border: "1px solid rgb(var(--zk-mint-rgb) / .35)", background: "rgb(var(--zk-mint-rgb) / .1)", color: "var(--zk-mint)", font: "var(--zk-type-label)", letterSpacing: ".14em", textTransform: "uppercase" }}
            >
              <span style={{ position: "relative", width: 8, height: 8 }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--zk-mint)", animation: "zk-ping var(--zk-dur-pulse) ease-out infinite" }} />
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--zk-mint)" }} />
              </span>
              {network === "mainnet" ? "Live on Zcash" : "Live on Zcash testnet"}
            </motion.span>

            <h1 className="zks-h1" aria-label="Hide it. Crack it. Get Zecked." style={{ marginTop: 22 }}>
              {LINES.map((l, i) => (
                <span key={l.text} aria-hidden style={{ display: "block", overflow: "hidden", paddingBottom: "0.06em" }}>
                  <motion.span
                    className={l.gold ? "zks-shimmer" : undefined}
                    style={{ display: "inline-block", transformOrigin: "0% 100%" }}
                    initial={{ y: "110%", rotate: 6, scaleY: 1.2 }}
                    animate={{ y: "0%", rotate: 0, scaleY: 1 }}
                    transition={{ type: "spring", stiffness: 120, damping: 14, mass: 0.9, delay: 0.25 + i * 0.13 }}
                  >
                    {l.text}
                  </motion.span>
                </span>
              ))}
            </h1>

            <motion.p
              className="zks-lead"
              style={{ marginTop: 26 }}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.75, duration: 0.9, ease: EASE_OUT }}
            >
              Hide ZEC behind a riddle or a match call. The first one to crack it keeps it, in a private wallet. Nobody sees who won.
            </motion.p>

            <motion.div
              className="zks-hero-cta"
              style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 34, alignItems: "center" }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.95, duration: 0.8, ease: EASE_OUT }}
            >
              <Magnetic>
                <GetAppButton appUrl={appUrl} className="zks-btn zks-btn-gold">
                  <PhoneGlyph size={22} stroke={2.6} /> Get the app
                </GetAppButton>
              </Magnetic>
              <Magnetic strength={0.25}>
                <a href={appUrl} className="zks-btn zks-btn-purple">
                  Play now <Icon icon="arrowRight" size={22} stroke={2.6} />
                </a>
              </Magnetic>
              <Magnetic strength={0.2}>
                <a href="#testzec" className="zks-btn zks-btn-ghost">
                  <Icon icon="coin" size={20} stroke={2.4} /> Get free test ZEC
                </a>
              </Magnetic>
            </motion.div>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2 }}
              style={{ marginTop: 18, font: "var(--zk-type-small)", color: "var(--zk-text-faint)" }}
            >
              Free to play · Test ZEC, not real money yet · Built on Zcash
            </motion.p>
          </motion.div>

          {/* Vault + orbiting stickers */}
          <div style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", minHeight: 420 }}>
            {/* Scroll layer (own GPU layer, only shrinks) wraps the one-off intro zoom so the vault stays sharp. */}
            <motion.div style={{ y: vaultY, rotate: vaultR, scale: vaultS, willChange: "transform" }}>
              <motion.div
                initial={{ opacity: 0, scale: 0.6, rotate: -25 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 70, damping: 12, delay: 0.3 }}
              >
                <Tilt max={14} radius={999} flat>
                  <div className="zks-vault-wrap">
                    <div aria-hidden className="zks-vault-glow" />
                    <Vault mode="loop" size={440} />
                  </div>
                </Tilt>
              </motion.div>
            </motion.div>

            <motion.div style={{ position: "absolute", left: "2%", top: "10%", ...s1 }}>
              <Float amplitude={12} duration={4.2} rotate={-8}>
                <Sticker bg="var(--zk-pink)" edge="var(--zk-pink-deep)" rotate={-8}>
                  <Icon icon="unlock" size={18} stroke={2.6} /> +0.02 ZEC
                </Sticker>
              </Float>
            </motion.div>
            <motion.div style={{ position: "absolute", right: "0%", top: "22%", ...s2 }}>
              <Float amplitude={10} duration={5} delay={0.6} rotate={7}>
                <Sticker bg="var(--zk-sky)" fg="var(--zk-sky-ink)" edge="var(--zk-sky-deep)" rotate={7}>
                  <TeamBadge {...DEMO_BARCELONA} size={24} /> BAR 2–1?
                </Sticker>
              </Float>
            </motion.div>
            <motion.div style={{ position: "absolute", left: "6%", bottom: "12%", ...s3 }}>
              <Float amplitude={14} duration={4.8} delay={1.1} rotate={5}>
                <Sticker bg="var(--zk-mint)" fg="var(--zk-mint-ink)" edge="var(--zk-mint-deep)" rotate={5}>
                  <Icon icon="key" size={18} stroke={2.4} /> 38 tries
                </Sticker>
              </Float>
            </motion.div>
            <motion.div style={{ position: "absolute", right: "4%", bottom: "8%", ...s4 }}>
              <Float amplitude={11} duration={4.4} delay={0.3} rotate={-6}>
                <Sticker bg="var(--zk-grad-gold)" fg="var(--zk-gold-ink)" edge="var(--zk-gold-deep)" rotate={-6}>
                  YOU ZECKED IT!
                </Sticker>
              </Float>
            </motion.div>
            <motion.div style={{ position: "absolute", left: "38%", top: "-2%", ...s5 }}>
              <Float amplitude={8} duration={3.8} delay={0.9} rotate={-3}>
                <Sticker bg="var(--zk-surface-raised)" fg="var(--zk-mint)" edge="#0a0818" rotate={-3} style={{ border: "1px solid rgb(var(--zk-mint-rgb) / .35)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 9, background: "var(--zk-mint)" }} /> LIVE · VERIFIED
                </Sticker>
              </Float>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Scroll cue */}
      <motion.div
        aria-hidden
        style={{ position: "absolute", bottom: 22, left: "50%", x: "-50%", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--zk-text-faint)", font: "var(--zk-type-label)", letterSpacing: ".2em", zIndex: 3, opacity: textO, willChange: "opacity" }}
      >
        SCROLL
        <div style={{ width: 26, height: 42, borderRadius: 14, border: "2px solid var(--zk-border-strong)", display: "flex", justifyContent: "center", paddingTop: 7 }}>
          <div className="zks-cue-dot" />
        </div>
      </motion.div>

      <style>{`
        .zks-hero-grid { display: grid; grid-template-columns: 1fr; gap: 28px; align-items: center; }
        /* Phones: "Get the app" and "Play now" share a row, test ZEC gets the next one. */
        @media (max-width: 520px) {
          .zks-hero-cta > * { flex: 1 1 100%; }
          .zks-hero-cta > :nth-child(-n+2) { flex: 1 1 0; min-width: 0; }
          .zks-hero-cta .zks-btn { width: 100%; }
          .zks-hero-cta > :nth-child(-n+2) .zks-btn { padding: 0 12px; gap: 8px; }
        }
        @media (max-width: 370px) { .zks-hero-cta > :nth-child(-n+2) { flex-basis: 100%; } }
        @media (min-width: 980px) { .zks-hero-grid { grid-template-columns: 1.08fr 1fr; gap: 20px; } }
        @media (max-width: 979px) { .zks-hero-grid > div:first-child { text-align: left; } }
        .zks-blob { position: absolute; border-radius: 50%; opacity: .5; will-change: transform; animation: zks-blob 16s ease-in-out infinite; pointer-events: none; }
        @keyframes zks-blob { 0%, 100% { transform: translate3d(0,0,0) scale(1) } 33% { transform: translate3d(60px,-50px,0) scale(1.15) } 66% { transform: translate3d(-40px,30px,0) scale(.92) } }
        .zks-hero-sun { position: absolute; left: 72%; top: 44%; width: 1000px; height: 1000px; margin: -500px 0 0 -500px; background: var(--zk-sunburst-gold); opacity: .22; border-radius: 50%; will-change: transform; animation: zk-spin 90s linear infinite; pointer-events: none; }
        .zks-cue-dot { width: 4px; height: 8px; border-radius: 4px; background: var(--zk-gold); animation: zks-cue 1.8s ease-in-out infinite; }
        @keyframes zks-cue { 0%, 100% { transform: translate3d(0,0,0); opacity: 1 } 50% { transform: translate3d(0,12px,0); opacity: .2 } }
        @media (prefers-reduced-motion: reduce) { .zks-hero-sun, .zks-cue-dot, .zks-blob { animation: none } }
        .zks-vault-wrap { position: relative; }
        .zks-vault-glow { position: absolute; inset: -14%; border-radius: 50%; background: radial-gradient(circle, rgb(var(--zk-gold-rgb) / .28) 0%, rgb(var(--zk-gold-rgb) / .08) 42%, transparent 66%), radial-gradient(circle at 50% 62%, rgba(0,0,0,.5) 0%, transparent 60%); pointer-events: none; }
        .zks-vault-wrap > svg, .zks-vault-wrap > div:not(.zks-vault-glow) { position: relative; }
        @media (max-width: 560px) { .zks-vault-wrap > * { width: 300px !important; height: 300px !important; } }
        /* One tilted plane that slides itself (compositor-only), with no clip inside the 3D transform.
           The fade is a static mask on the flat wrapper, so it stays put while the grid moves under it. */
        .zks-gridfloor {
          position: absolute; left: 0; right: 0; top: -64px; bottom: 0; transform-origin: 50% 100%; will-change: transform;
          background-image: linear-gradient(rgb(var(--zk-purple-rgb) / .35) 1.5px, transparent 1.5px), linear-gradient(90deg, rgb(var(--zk-purple-rgb) / .35) 1.5px, transparent 1.5px);
          background-size: 64px 64px; transform: rotateX(62deg); animation: zks-grid 3.2s linear infinite;
        }
        .zks-gridwrap { -webkit-mask-image: linear-gradient(to top, #000 8%, transparent 72%); mask-image: linear-gradient(to top, #000 8%, transparent 72%); }
        @keyframes zks-grid { from { transform: rotateX(62deg) translate3d(0,0,0) } to { transform: rotateX(62deg) translate3d(0,64px,0) } }
        @media (prefers-reduced-motion: reduce) { .zks-gridfloor { animation: none } }
      `}</style>
    </section>
  );
}
