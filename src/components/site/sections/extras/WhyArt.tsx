"use client";
// Hand-drawn cartoon scenes for the WhyZcash cards. Pure SVG + motion; intros play once in view,
// loops only run while on screen, and reduced motion gets a still final frame.
import { motion, type Transition } from "motion/react";
import { useEffect, useState } from "react";
import { FB, K, seeded, useSafeId, useScene } from "./kit";

const loop = (duration: number, delay = 0): Transition => ({ duration, delay, repeat: Infinity, ease: "easeInOut" });
const settle: Transition = { duration: 0.3 };

const STAR = "M0 -8L2.2 -2.2L8 0L2.2 2.2L0 8L-2.2 2.2L-8 0L-2.2 -2.2Z";
const SHIELD = "M0 -22L18 -15V-1C18 11 10 19 0 23C-10 19 -18 11 -18 -1V-15Z";

function Sparkle({ x, y, s, delay, live, color = "#fff" }: { x: number; y: number; s: number; delay: number; live: boolean; color?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <motion.path
        d={STAR}
        fill={color}
        style={FB}
        initial={{ scale: 0 }}
        animate={live ? { scale: [0, 1, 0], rotate: [0, 90] } : { scale: 0 }}
        transition={live ? { duration: 1.5, delay, repeat: Infinity, repeatDelay: 0.6, ease: "easeInOut" } : settle}
      />
    </g>
  );
}

/* ───────────── (a) Prizes you can verify: a viewing-key eye scans the vault ───────────── */

let VBOLTS = "";
for (let i = 0; i < 8; i++) {
  const a = (i * Math.PI) / 4 - Math.PI / 2;
  const x = 128 + 54 * Math.cos(a);
  const y = 122 + 54 * Math.sin(a);
  VBOLTS += `M${(x - 4).toFixed(2)} ${y.toFixed(2)}a4 4 0 1 0 8 0a4 4 0 1 0-8 0`;
}

export function VerifyArt() {
  const { ref, on, live } = useScene();
  const id = useSafeId("zkva");
  return (
    <div ref={ref} className="zkart">
      <svg viewBox="0 0 320 240" role="img" aria-label="A key with an eye scans a vault, then a Live and verified badge pops up">
        <defs>
          <radialGradient id={`${id}f`} cx=".35" cy=".3" r=".8">
            <stop offset="0" stopColor={K.faceHi} />
            <stop offset="1" stopColor={K.faceLo} />
          </radialGradient>
          <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={K.goldPale} />
            <stop offset="1" stopColor={K.bolt} />
          </linearGradient>
          <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={K.sky} stopOpacity="0" />
            <stop offset=".85" stopColor={K.sky} stopOpacity=".5" />
            <stop offset="1" stopColor={K.skyLight} stopOpacity=".95" />
          </linearGradient>
          <linearGradient id={`${id}c`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={K.skyLight} stopOpacity=".55" />
            <stop offset="1" stopColor={K.sky} stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}glow`}>
            <stop offset="0" stopColor={K.gold} stopOpacity=".28" />
            <stop offset="1" stopColor={K.gold} stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${id}k`}>
            <circle cx="128" cy="122" r="62" />
          </clipPath>
        </defs>

        <circle cx="128" cy="122" r="112" fill={`url(#${id}glow)`} />
        <ellipse cx="128" cy="214" rx="80" ry="8" fill="#000" opacity=".3" />

        {/* Vault */}
        <motion.g style={FB} initial={{ scale: 0.55, opacity: 0 }} animate={on ? { scale: 1, opacity: 1 } : undefined} transition={{ type: "spring", stiffness: 240, damping: 15 }}>
          <circle cx="128" cy="129" r="74" fill={K.goldShadow} />
          <circle cx="128" cy="122" r="74" fill={K.rim} />
          <circle cx="128" cy="122" r="70" fill={K.gold} />
          <circle cx="128" cy="122" r="62" fill={`url(#${id}f)`} />
          <path d={VBOLTS} fill={`url(#${id}g)`} stroke={K.boltEdge} strokeWidth=".8" />
          <circle cx="128" cy="122" r="38" fill="none" stroke="rgba(244,183,40,.35)" strokeWidth="2" strokeDasharray="4 4" />
          <motion.g
            style={FB}
            animate={live ? { rotate: [0, 0, 26, -12, 0] } : { rotate: 0 }}
            transition={live ? { duration: 3.2, delay: 2.6, repeat: Infinity, times: [0, 0.6, 0.72, 0.86, 1], ease: "easeInOut" } : settle}
          >
            {[0, 60, 120].map((r) => (
              <rect key={r} x="94" y="118" width="68" height="8" rx="4" transform={`rotate(${r} 128 122)`} fill={`url(#${id}g)`} />
            ))}
            <circle cx="128" cy="122" r="14" fill={`url(#${id}g)`} stroke={K.goldDeep} strokeWidth="1.5" />
            <text x="128" y="128" textAnchor="middle" fill={K.hubInk} style={{ font: "800 16px var(--zk-font-display)" }}>
              Z
            </text>
          </motion.g>
        </motion.g>

        {/* Light cone from the eye */}
        <motion.polygon
          points="240,78 96,66 168,194"
          fill={`url(#${id}c)`}
          initial={{ opacity: 0 }}
          animate={live ? { opacity: [0.3, 0.75, 0.3] } : { opacity: on ? 0.3 : 0 }}
          transition={live ? loop(1.6, 0.6) : settle}
        />

        {/* Scan line sweeping the vault face */}
        <g clipPath={`url(#${id}k)`}>
          <motion.g
            initial={{ y: -84, opacity: 0 }}
            animate={live ? { y: [-84, -64, 52, 72], opacity: [0, 1, 1, 0] } : { y: -84, opacity: 0 }}
            transition={live ? { duration: 1.6, delay: 0.6, repeat: Infinity, ease: "linear", times: [0, 0.12, 0.88, 1] } : settle}
          >
            <rect x="60" y="98" width="140" height="24" fill={`url(#${id}s)`} />
            <rect x="60" y="120.5" width="140" height="2.5" fill={K.skyLight} />
          </motion.g>
        </g>

        {/* The viewing key, with an eye for a bow */}
        <g transform="translate(256 64)">
          <motion.g
            style={FB}
            initial={{ x: 80, y: -40, rotate: 50, opacity: 0 }}
            animate={on ? { x: 0, y: 0, rotate: 0, opacity: 1 } : undefined}
            transition={{ type: "spring", stiffness: 150, damping: 13, delay: 0.25 }}
          >
            <motion.g animate={live ? { y: [0, -6, 0], x: [0, -4, 0] } : { y: 0, x: 0 }} transition={live ? loop(2.8) : settle}>
              <g transform="rotate(-24)">
                <rect x="-92" y="-3" width="66" height="13" rx="6.5" fill={K.skyDeep} />
                <rect x="-92" y="-7" width="66" height="13" rx="6.5" fill={K.sky} />
                <rect x="-88" y="3" width="10" height="17" rx="3" fill={K.skyDeep} />
                <rect x="-72" y="3" width="8" height="12" rx="3" fill={K.skyDeep} />
                <rect x="-86" y="-5" width="52" height="3" rx="1.5" fill="#fff" opacity=".4" />
                <circle cx="0" cy="4" r="32" fill={K.skyDeep} />
                <circle cx="0" cy="0" r="32" fill={K.sky} />
                <path d="M-22 -18A28 28 0 0 1 10 -28" stroke="#fff" strokeOpacity=".5" strokeWidth="4" fill="none" strokeLinecap="round" />
                <motion.g
                  style={FB}
                  animate={live ? { scaleY: [1, 1, 0.08, 1, 1] } : { scaleY: 1 }}
                  transition={live ? { duration: 3.4, delay: 1, repeat: Infinity, times: [0, 0.84, 0.88, 0.92, 1] } : settle}
                >
                  <circle r="23" fill="#fff" />
                  <motion.g
                    initial={{ x: 0, y: 0 }}
                    animate={live ? { x: -7, y: [-6, 6] } : { x: on ? -6 : 0, y: 0 }}
                    transition={live ? { x: { duration: 0.4 }, y: { duration: 1.6, delay: 0.6, repeat: Infinity, ease: "linear" } } : settle}
                  >
                    <circle r="12" fill={K.vivid} />
                    <circle r="6" fill={K.ink} />
                    <circle cx="-3.5" cy="-4" r="3" fill="#fff" />
                  </motion.g>
                </motion.g>
                <circle r="23" fill="none" stroke={K.skyDeep} strokeWidth="3" />
              </g>
            </motion.g>
          </motion.g>
        </g>

        {/* LIVE · VERIFIED badge */}
        <g transform="translate(222 204) rotate(-5)">
          <motion.rect
            x="-88"
            y="-18"
            width="176"
            height="36"
            rx="18"
            fill="none"
            stroke={K.mint}
            strokeWidth="2.5"
            style={FB}
            initial={{ opacity: 0 }}
            animate={live ? { scale: [1, 1.2], opacity: [0.8, 0] } : { opacity: 0 }}
            transition={live ? { duration: 1.6, delay: 2.6, repeat: Infinity, ease: "easeOut" } : settle}
          />
          <motion.g
            style={FB}
            initial={{ scale: 0, rotate: -24, opacity: 0 }}
            animate={on ? { scale: 1, rotate: 0, opacity: 1 } : undefined}
            transition={{ type: "spring", stiffness: 380, damping: 12, delay: 2.1 }}
          >
            <rect x="-88" y="-14" width="176" height="36" rx="18" fill={K.mintDeep} />
            <rect x="-88" y="-18" width="176" height="36" rx="18" fill={K.mint} />
            <rect x="-76" y="-14" width="138" height="7" rx="3.5" fill="#fff" opacity=".3" />
            <circle cx="-66" cy="0" r="11" fill={K.mintInk} />
            <path d="M-71 .5l3.6 3.6 7.2-7.4" fill="none" stroke={K.mint} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            <text x="-48" y="4.5" fill={K.mintInk} style={{ font: "800 12px var(--zk-font-body)", letterSpacing: ".06em" }}>
              LIVE · VERIFIED
            </text>
          </motion.g>
        </g>

        <Sparkle x={146} y={176} s={0.9} delay={2.5} live={live} />
        <Sparkle x={306} y={170} s={0.7} delay={2.9} live={live} color={K.mintLight} />
        <Sparkle x={278} y={232} s={0.55} delay={3.3} live={live} />
      </svg>
    </div>
  );
}

/* ───────────── (b) Winners stay anonymous: ninja, shield, coins into a closed wallet ───────────── */

export function NinjaArt() {
  const { ref, on, live } = useScene();
  const id = useSafeId("zkna");
  return (
    <div ref={ref} className="zkart">
      <svg viewBox="0 0 320 240" role="img" aria-label="A masked ninja wearing a shield badge while coins fly into a closed wallet">
        <defs>
          <radialGradient id={`${id}glow`}>
            <stop offset="0" stopColor={K.mint} stopOpacity=".3" />
            <stop offset="1" stopColor={K.mint} stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${id}h`}>
            <circle cx="98" cy="100" r="46" />
          </clipPath>
        </defs>

        <circle cx="98" cy="128" r="108" fill={`url(#${id}glow)`} />

        {/* Floating question marks: who won? */}
        {[
          { x: 166, y: 124, d: 0.2 },
          { x: 28, y: 100, d: 1.3 },
        ].map((q) => (
          <motion.text
            key={q.x}
            x={q.x}
            y={q.y}
            fill={K.purpleLight}
            style={{ font: "800 24px var(--zk-font-display)" }}
            initial={{ opacity: 0 }}
            animate={live ? { y: [0, -22], opacity: [0, 1, 0] } : { opacity: 0 }}
            transition={live ? { duration: 2.2, delay: q.d, repeat: Infinity, ease: "easeOut" } : settle}
          >
            ?
          </motion.text>
        ))}

        {/* Ninja */}
        <motion.g animate={live ? { y: [0, -3, 0] } : { y: 0 }} transition={live ? loop(2.6) : settle}>
          <path d="M26 244C28 186 56 146 98 146C140 146 168 186 170 244Z" fill={K.night} />
          <path d="M40 240C44 196 64 164 92 158" stroke="#fff" strokeOpacity=".12" strokeWidth="6" fill="none" strokeLinecap="round" />
          <g transform="translate(140 80)">
            <motion.g
              style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }}
              animate={live ? { rotate: [0, 12, -4, 0] } : { rotate: 0 }}
              transition={live ? loop(1.6) : settle}
            >
              <path d="M0 -2C16 -16 30 -4 46 -18" stroke={K.pink} strokeWidth="8" fill="none" strokeLinecap="round" />
              <path d="M0 4C14 10 26 22 42 18" stroke={K.pinkDeep} strokeWidth="7" fill="none" strokeLinecap="round" />
            </motion.g>
          </g>
          <circle cx="98" cy="106" r="46" fill={K.night} />
          <circle cx="98" cy="100" r="46" fill={K.shade} />
          <path d="M64 76A40 40 0 0 1 116 60" stroke="#fff" strokeOpacity=".22" strokeWidth="5" fill="none" strokeLinecap="round" />
          <g clipPath={`url(#${id}h)`}>
            <rect x="40" y="68" width="120" height="11" fill={K.pink} />
            <rect x="40" y="77" width="120" height="3" fill={K.pinkDeep} />
          </g>
          <circle cx="142" cy="80" r="7.5" fill={K.pink} />
          <rect x="54" y="86" width="88" height="30" rx="15" fill={K.purplePale} />
          <path d="M70 91L90 97M126 91L106 97" stroke={K.ink} strokeWidth="4.5" strokeLinecap="round" />
          <motion.g
            animate={live ? { x: [0, 5, 5, 0, 0] } : { x: 0 }}
            transition={live ? { duration: 4.2, repeat: Infinity, times: [0, 0.2, 0.55, 0.75, 1], ease: "easeInOut" } : settle}
          >
            <motion.g
              style={FB}
              animate={live ? { scaleY: [1, 1, 0.1, 1, 1] } : { scaleY: 1 }}
              transition={live ? { duration: 3.1, repeat: Infinity, times: [0, 0.82, 0.86, 0.9, 1] } : settle}
            >
              <ellipse cx="84" cy="103" rx="5.5" ry="6.5" fill={K.ink} />
              <ellipse cx="112" cy="103" rx="5.5" ry="6.5" fill={K.ink} />
              <circle cx="86" cy="100.5" r="1.8" fill="#fff" />
              <circle cx="114" cy="100.5" r="1.8" fill="#fff" />
            </motion.g>
          </motion.g>
          <g transform="translate(98 196)">
            <motion.circle
              r="30"
              fill={K.mint}
              style={FB}
              initial={{ opacity: 0 }}
              animate={live ? { opacity: [0.12, 0.34, 0.12], scale: [1, 1.14, 1] } : { opacity: on ? 0.15 : 0 }}
              transition={live ? loop(2) : settle}
            />
            <motion.g
              style={FB}
              initial={{ scale: 0, rotate: -40 }}
              animate={on ? { scale: 1, rotate: 0 } : undefined}
              transition={{ type: "spring", stiffness: 320, damping: 12, delay: 0.5 }}
            >
              <path d={SHIELD} transform="translate(0 3)" fill={K.mintDeep} />
              <path d={SHIELD} fill={K.mint} />
              <path d="M-8 0l5.5 5.5 10-11" stroke={K.mintInk} strokeWidth="3.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </motion.g>
          </g>
        </motion.g>

        {/* Coins arcing into the wallet (drawn before it, so they drop inside) */}
        {[0, 1, 2].map((i) => (
          <g key={i} transform="translate(152 60)">
            <motion.g
              style={FB}
              initial={{ opacity: 0 }}
              animate={
                live
                  ? { x: [0, 44, 80, 86], y: [0, -50, 60, 84], opacity: [0, 1, 1, 0], scale: [0.5, 1, 0.85, 0.7], rotate: [0, 200, 320, 360] }
                  : { opacity: 0, x: 0, y: 0 }
              }
              transition={
                live
                  ? { duration: 1.05, delay: 0.9 + i * 0.6, repeat: Infinity, repeatDelay: 0.75, times: [0, 0.42, 0.85, 1], ease: ["easeOut", "easeIn", "linear"] }
                  : settle
              }
            >
              <circle r="13" cy="2.5" fill={K.goldDeep} />
              <circle r="13" fill={K.gold} />
              <circle r="8.5" fill="none" stroke={K.goldPale} strokeWidth="2" />
              <text y="4.5" textAnchor="middle" fill={K.goldInk} style={{ font: "800 12px var(--zk-font-display)" }}>
                Z
              </text>
            </motion.g>
          </g>
        ))}

        {/* Closed wallet */}
        <g transform="translate(248 172)">
          <motion.g
            style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={
              !on ? undefined : live ? { opacity: 1, scale: 1, scaleY: [1, 0.88, 1.06, 1], scaleX: [1, 1.07, 0.98, 1] } : { opacity: 1, scale: 1, scaleX: 1, scaleY: 1 }
            }
            transition={
              live
                ? { opacity: { duration: 0.3 }, scale: { type: "spring", stiffness: 260, damping: 14, delay: 0.2 }, default: { duration: 0.5, repeat: Infinity, repeatDelay: 0.1, delay: 1.9, times: [0, 0.3, 0.65, 1] } }
                : { type: "spring", stiffness: 260, damping: 14, delay: 0.2 }
            }
          >
            <rect x="-54" y="-30" width="108" height="66" rx="16" fill={K.purpleDeep} />
            <rect x="-54" y="-36" width="108" height="66" rx="16" fill={K.purple} />
            <rect x="-54" y="-36" width="108" height="26" rx="14" fill={K.purpleLight} />
            <rect x="-46" y="-31" width="62" height="5" rx="2.5" fill="#fff" opacity=".4" />
            <rect x="8" y="-18" width="52" height="28" rx="11" fill={K.vivid} />
            <circle cx="36" cy="-4" r="8.5" fill={K.gold} stroke={K.goldDeep} strokeWidth="2" />
            <rect x="34.4" y="-7" width="3.2" height="7" rx="1.6" fill={K.goldInk} />
            <g transform="translate(-26 13) scale(.5)">
              <path d={SHIELD} fill={K.mint} />
              <path d="M-8 0l5.5 5.5 10-11" stroke={K.mintInk} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </motion.g>
        </g>

        {/* Redacted winner tag */}
        <g transform="translate(66 24)">
          <motion.g
            style={FB}
            initial={{ opacity: 0, y: 12, scale: 0.8 }}
            animate={on ? { opacity: 1, y: 0, scale: 1 } : undefined}
            transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.8 }}
          >
            <rect x="-58" y="-16" width="116" height="32" rx="12" fill={K.surface} stroke="rgba(255,255,255,.16)" strokeWidth="1.5" />
            <text x="-46" y="4" fill={K.muted} style={{ font: "700 10px var(--zk-font-mono)", letterSpacing: ".1em" }}>
              WINNER
            </text>
            {[
              { x: 6, w: 26, d: 0 },
              { x: 35, w: 14, d: 0.4 },
            ].map((b) => (
              <motion.rect
                key={b.x}
                x={b.x}
                y="-7"
                width={b.w}
                height="14"
                rx="4"
                fill={K.purpleLight}
                initial={{ opacity: 0.45 }}
                animate={live ? { opacity: [0.45, 0.95, 0.45] } : { opacity: 0.45 }}
                transition={live ? loop(1.2, b.d) : settle}
              />
            ))}
          </motion.g>
        </g>
      </svg>
    </div>
  );
}

/* ───────────── (c) Messages only the winner reads: locked envelope, memo types itself ───────────── */

const MEMOS = ["0.05 ZEC paid to\nutest1q8f…x2m", "Who won it?\nNobody can tell.", "Shielded. Sealed.\nNo trace of you."];
const CHAR_W = 7.2; // Space Mono advance at 12px

const GLYPHS = (() => {
  const r = seeded(42);
  const chars = "#%&*@$?!~^0123456789abcdefxyz";
  const colors = [K.sky, K.mint, K.purpleLight, K.gold];
  return Array.from({ length: 8 }, (_, i) => {
    const left = i % 2 === 0;
    return {
      x: Math.round(left ? 16 + r() * 44 : 254 + r() * 44),
      y: Math.round(150 + r() * 50),
      s: Array.from({ length: 3 }, () => chars[Math.floor(r() * chars.length)]).join(""),
      c: colors[i % 4],
      d: Number((2.6 + r() * 1.4).toFixed(2)),
      delay: Number((r() * 2.5).toFixed(2)),
      rise: Math.round(70 + r() * 50),
    };
  });
})();

export function MemoArt() {
  const { ref, on, live, reduce } = useScene();
  const id = useSafeId("zkma");
  const [idx, setIdx] = useState(0);
  const [n, setN] = useState(0);
  const memo = MEMOS[idx];
  const full = memo.length;
  const done = n >= full;

  // Typewriter: types, holds, moves to the next memo. Pauses off-screen; reduced motion shows it whole.
  useEffect(() => {
    if (!on) return;
    if (reduce) {
      setIdx(0);
      setN(MEMOS[0].length);
      return;
    }
    if (!live) return;
    const prev = memo[n - 1];
    const wait = done ? 2600 : n === 0 ? 900 : prev === " " || prev === "\n" ? 110 : 52;
    const t = window.setTimeout(() => {
      if (!done) setN(n + 1);
      else {
        setIdx((idx + 1) % MEMOS.length);
        setN(0);
      }
    }, wait);
    return () => window.clearTimeout(t);
  }, [on, live, reduce, n, done, idx, memo]);

  const lines = memo.slice(0, n).split("\n");
  const caretLine = lines.length - 1;
  const caretX = 104 + (lines[caretLine]?.length ?? 0) * CHAR_W + 1;
  const mono = { font: "700 12px var(--zk-font-mono)", whiteSpace: "pre" } as const;

  return (
    <div ref={ref} className="zkart">
      <svg viewBox="0 0 320 240" role="img" aria-label="A sealed envelope: the payout to the winner is shielded, so nobody can see who won">
        <defs>
          <radialGradient id={`${id}g`}>
            <stop offset="0" stopColor={K.pink} stopOpacity=".3" />
            <stop offset="1" stopColor={K.pink} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="160" cy="140" r="118" fill={`url(#${id}g)`} />
        <ellipse cx="160" cy="232" rx="98" ry="7" fill="#000" opacity=".3" />

        {/* Cipher glyphs drifting up: what everyone else sees */}
        {GLYPHS.map((g, i) => (
          <motion.text
            key={i}
            x={g.x}
            y={g.y}
            fill={g.c}
            style={{ font: "700 13px var(--zk-font-mono)" }}
            initial={{ opacity: 0 }}
            animate={live ? { y: [0, -g.rise], opacity: [0, 0.85, 0] } : { opacity: 0 }}
            transition={live ? { duration: g.d, delay: g.delay, repeat: Infinity, ease: "easeOut" } : settle}
          >
            {g.s}
          </motion.text>
        ))}

        <motion.g animate={live ? { y: [0, -4, 0] } : { y: 0 }} transition={live ? loop(3) : settle}>
          {/* Envelope back + open flap */}
          <rect x="70" y="118" width="180" height="108" rx="14" fill={K.pinkDeep} />
          <path d="M72 122L160 64L248 122Z" fill={K.pinkShade} strokeLinejoin="round" />

          {/* The memo */}
          <motion.g initial={{ y: 64 }} animate={on ? { y: 0 } : undefined} transition={{ type: "spring", stiffness: 120, damping: 14, delay: 0.3 }}>
            <rect x="88" y="30" width="144" height="136" rx="12" fill={K.paper} />
            <rect x="88.75" y="30.75" width="142.5" height="134.5" rx="11.5" fill="none" stroke="#E9DFFF" strokeWidth="1.5" />
            <rect x="104" y="40" width="9" height="8" rx="2" fill={K.purple} />
            <path d="M106 40V38a2.5 2.5 0 0 1 5 0v2" stroke={K.purple} strokeWidth="1.6" fill="none" />
            <text x="118" y="47.5" fill={K.purple} style={{ font: "700 8.5px var(--zk-font-mono)", letterSpacing: ".14em" }}>
              SHIELDED PAYOUT
            </text>
            <line x1="102" y1="57" x2="218" y2="57" stroke="#E6DDF7" strokeWidth="1.5" strokeDasharray="3 3" />
            <text x="104" y="80" fill={K.ink} style={mono}>
              {lines[0] ?? ""}
            </text>
            <text x="104" y="98" fill={K.ink} style={mono}>
              {lines[1] ?? ""}
            </text>
            <motion.rect
              x={caretX}
              y={caretLine === 0 ? 69 : 87}
              width="2.5"
              height="14"
              rx="1"
              fill={K.purple}
              animate={live ? { opacity: [1, 1, 0, 0] } : { opacity: 1 }}
              transition={live ? { duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: "linear" } : settle}
            />
            <text x="104" y="121" fill="#8A84A8" style={{ font: "700 8px var(--zk-font-mono)", letterSpacing: ".12em" }}>
              TO: THE WINNER
            </text>
          </motion.g>

          {/* Envelope front pocket */}
          <path d="M70 124L160 180L250 124V212Q250 226 236 226H84Q70 226 70 212Z" fill={K.pink} />
          <path d="M74 128L160 182L246 128" stroke={K.pinkLight} strokeWidth="3" fill="none" opacity=".7" strokeLinejoin="round" strokeLinecap="round" />
          <rect x="80" y="214" width="70" height="4" rx="2" fill="#fff" opacity=".18" />

          {/* Padlock seal: clicks each time a memo finishes */}
          <g transform="translate(160 198)">
            <motion.g
              style={FB}
              animate={done && live ? { rotate: [0, -14, 10, -5, 0], scale: [1, 1.16, 1] } : { rotate: 0, scale: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            >
              <path d="M-10 -8V-15A10 10 0 0 1 10 -15V-8" stroke={K.goldDeep} strokeWidth="6" fill="none" strokeLinecap="round" />
              <path d="M-10 -8V-15A10 10 0 0 1 10 -15V-8" stroke={K.goldLight} strokeWidth="2" fill="none" strokeLinecap="round" opacity=".7" />
              <rect x="-16" y="-7" width="32" height="26" rx="7" fill={K.goldDeep} />
              <rect x="-16" y="-10" width="32" height="26" rx="7" fill={K.gold} />
              <rect x="-12" y="-7" width="24" height="5" rx="2.5" fill="#fff" opacity=".4" />
              <circle cy="1" r="3.6" fill={K.goldInk} />
              <rect x="-1.6" y="2" width="3.2" height="7" rx="1.6" fill={K.goldInk} />
            </motion.g>
          </g>
        </motion.g>

        {/* Winner-only sticker */}
        <g transform="translate(262 44) rotate(10)">
          <motion.g
            style={FB}
            initial={{ scale: 0, opacity: 0 }}
            animate={on ? { scale: 1, opacity: 1 } : undefined}
            transition={{ type: "spring", stiffness: 360, damping: 13, delay: 1.1 }}
          >
            <rect x="-44" y="-10" width="88" height="26" rx="13" fill={K.mintDeep} />
            <rect x="-44" y="-13" width="88" height="26" rx="13" fill={K.mint} />
            <text x="0" y="3.5" textAnchor="middle" fill={K.mintInk} style={{ font: "800 9.5px var(--zk-font-body)", letterSpacing: ".08em" }}>
              WINNER ONLY
            </text>
          </motion.g>
        </g>

        <Sparkle x={70} y={40} s={0.7} delay={0.4} live={live && done} color={K.goldPale} />
        <Sparkle x={250} y={100} s={0.5} delay={0.8} live={live && done} />
      </svg>
    </div>
  );
}
