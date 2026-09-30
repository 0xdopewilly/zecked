"use client";
import { useCallback, useId, useState, type CSSProperties, type ReactElement } from "react";
import { Logo } from "./Logo";

/* Player avatar: their uploaded photo, or a generated "buddy" face picked from the handle (the same
   handle always gets the same buddy). Inline SVG, no network, no emoji. The house gets the gold Z mark. */

export type AvatarRing = "sticker" | "none";

export interface AvatarProps {
  handle: string;
  /** Uploaded photo URL. Falls back to the buddy if it fails to load. */
  src?: string | null;
  /** px, or any CSS length ("clamp(44px, 13vw, 52px)"). Omit it to size the avatar from `className`. */
  size?: number | string;
  /** "sticker" (default): ink edge + hard drop, like the app's cards. "none": bring your own via `style`. */
  ring?: AvatarRing;
  /** The ZECKED house account (@zecked): the gold Z mark instead of a face. */
  house?: boolean;
  className?: string;
  style?: CSSProperties;
}

const INK = "#07051A";

/* ---------- the buddy ---------- */

type Tone = readonly [light: string, shade: string];
const CREAM: Tone = ["#FFF8EC", "#FFDDB0"];
const LEMON: Tone = ["#FFF3C4", "#FFD452"];
const MINT: Tone = ["#E0FFF3", "#86EFC9"];
const SKY: Tone = ["#E0F4FF", "#92D6FF"];
const LILAC: Tone = ["#F4F0FF", "#C7B6FF"];
const BLUSH: Tone = ["#FFE6F1", "#FFA6CD"];
const PEACH: Tone = ["#FFEDE0", "#FFBB94"];

// Brand-palette backgrounds, each with the face tones that pop on it.
const BACKS: { a: string; b: string; faces: Tone[] }[] = [
  { a: "#FFD869", b: "#FF8A4D", faces: [LILAC, MINT, SKY, BLUSH] }, // sunset
  { a: "#9C7CFF", b: "#FF4D9A", faces: [LEMON, MINT, CREAM, PEACH] }, // grape
  { a: "#2EE6A6", b: "#3DB8FF", faces: [LEMON, BLUSH, CREAM, LILAC] }, // lagoon
  { a: "#3DB8FF", b: "#7C5CFF", faces: [LEMON, BLUSH, MINT, PEACH] }, // twilight
  { a: "#FF6FAE", b: "#FF8A4D", faces: [LEMON, MINT, SKY, LILAC] }, // candy
  { a: "#FF8FC0", b: "#8F72FF", faces: [LEMON, MINT, SKY, CREAM] }, // bubblegum
  { a: "#F4B728", b: "#FF4D9A", faces: [MINT, SKY, LILAC, CREAM] }, // peachy
  { a: "#A48CFF", b: "#5B3BE8", faces: [LEMON, MINT, BLUSH, PEACH] }, // grape soda
];

type Shape = { hw: number; hh: number; el: (p: Record<string, string | number>) => ReactElement };
const SHAPES: Shape[] = [
  { hw: 24.5, hh: 24.5, el: (p) => <circle r={24.5} {...p} /> },
  { hw: 25, hh: 23, el: (p) => <rect x={-25} y={-23} width={50} height={46} rx={19} {...p} /> },
  { hw: 27, hh: 22.5, el: (p) => <ellipse rx={27} ry={22.5} {...p} /> },
  { hw: 22, hh: 25.5, el: (p) => <rect x={-22} y={-25.5} width={44} height={51} rx={20} {...p} /> },
];

type Eyes = "dot" | "oval" | "happy" | "content" | "wink" | "sparkle" | "shades";
type Mouth = "smile" | "grin" | "o" | "cat" | "tongue" | "smirk" | "bucky";
type Top = "none" | "pointy" | "round" | "sprout" | "antenna" | "bow";

// Generated handles are adjective + animal ("@quietpanda"): the animal picks the ears.
const POINTY = ["cat", "fox", "lynx", "wolf", "tiger", "zebra", "owl", "hawk", "raven"];
const ROUND = ["panda", "koala", "otter"];

function rng(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let t = h >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function weighted<T extends string>(r: () => number, table: [T, number][]): T {
  let x = r() * table.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of table) if ((x -= w) < 0) return v;
  return table[0][0];
}

function buddyFor(handle: string) {
  const name = handle.replace(/^@+/, "").toLowerCase();
  const r = rng(name);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  const back = pick(BACKS);
  const noun = [...POINTY, ...ROUND].find((n) => name.replace(/\d+$/, "").endsWith(n));
  const randomTop = weighted<Top>(r, [["none", 4], ["sprout", 2], ["antenna", 2], ["bow", 2], ["pointy", 1], ["round", 1]]);
  return {
    back,
    angle: pick([-35, -15, 20, 45, 70, 115]),
    face: pick(back.faces),
    shape: pick(SHAPES),
    tilt: pick([-11, -8, -5, 5, 8, 11]),
    dx: pick([-3, -1.5, 0, 1.5, 3]),
    dy: pick([0, 1.5, 3]),
    gap: pick([9.5, 10.5, 11.5]),
    eyes: weighted<Eyes>(r, [["dot", 5], ["oval", 4], ["happy", 3], ["content", 2], ["wink", 3], ["sparkle", 4], ["shades", 2]]),
    mouth: weighted<Mouth>(r, [["smile", 5], ["grin", 4], ["o", 2], ["cat", 3], ["tongue", 3], ["smirk", 3], ["bucky", 3]]),
    cheeks: weighted<"blush" | "freckles" | "none">(r, [["blush", 6], ["freckles", 1], ["none", 2]]),
    top: noun ? (POINTY.includes(noun) ? "pointy" : "round") : randomTop,
    sparkleLeft: r() < 0.5,
  } as const;
}

const line = { fill: "none", stroke: INK, strokeWidth: 2.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function eyePair(kind: Eyes, g: number, y: number, small: boolean) {
  const glint = (x: number, yy: number, rr: number) => (small ? null : <circle cx={x} cy={yy} r={rr} fill="#fff" />);
  const dot = (x: number) => (
    <g key={x}>
      <circle cx={x} cy={y} r={4.3} fill={INK} />
      {glint(x - 1.3, y - 1.5, 1.4)}
    </g>
  );
  const arc = (x: number, up: boolean) => (
    <path key={x} d={up ? `M${x - 4.4} ${y + 1.8}Q${x} ${y - 4.4} ${x + 4.4} ${y + 1.8}` : `M${x - 4.4} ${y - 1.4}Q${x} ${y + 4.2} ${x + 4.4} ${y - 1.4}`} {...line} />
  );
  switch (kind) {
    case "dot":
      return [dot(-g), dot(g)];
    case "oval":
      return [-g, g].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy={y} rx={3.4} ry={4.9} fill={INK} />
          {glint(x - 1.1, y - 2, 1.3)}
        </g>
      ));
    case "happy":
      return [arc(-g, true), arc(g, true)];
    case "content":
      return [arc(-g, false), arc(g, false)];
    case "wink":
      return [dot(-g), arc(g, true)];
    case "sparkle":
      return [-g, g].map((x) => (
        <g key={x}>
          <circle cx={x} cy={y} r={5.4} fill={INK} />
          {glint(x - 1.8, y - 1.9, 2)}
          {glint(x + 1.9, y + 1.9, 0.95)}
        </g>
      ));
    case "shades":
      return (
        <g>
          <path d={`M${-g - 6.5} ${y - 3}H${-g - 11}M${g + 6.5} ${y - 3}H${g + 11}M${-g + 6} ${y - 2.6}H${g - 6}`} {...line} strokeWidth={2.4} />
          {[-g, g].map((x) => (
            <rect key={x} x={x - 6.8} y={y - 5} width={13.6} height={9.4} rx={4.2} fill={INK} />
          ))}
          {!small && [-g, g].map((x) => <path key={x} d={`M${x - 3.8} ${y - 1.8}l2.4 -1.6`} stroke="#fff" strokeWidth={1.6} strokeLinecap="round" opacity={0.85} />)}
        </g>
      );
  }
}

function mouthAt(kind: Mouth, y: number) {
  const tongue = "#FF6FAE";
  switch (kind) {
    case "smile":
      return <path d={`M-6.5 ${y - 1}Q0 ${y + 6} 6.5 ${y - 1}`} {...line} />;
    case "grin":
      return (
        <g>
          <path d={`M-8 ${y - 2.5}H8Q8 ${y + 8} 0 ${y + 8}Q-8 ${y + 8} -8 ${y - 2.5}Z`} fill={INK} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
          <ellipse cx={0} cy={y + 5.3} rx={3.8} ry={2.1} fill={tongue} />
        </g>
      );
    case "o":
      return <ellipse cx={0} cy={y + 1.5} rx={3.3} ry={4} fill={INK} />;
    case "cat":
      return <path d={`M-6.5 ${y}Q-3.25 ${y + 4.6} 0 ${y}Q3.25 ${y + 4.6} 6.5 ${y}`} {...line} strokeWidth={2.6} />;
    case "tongue":
      return (
        <g>
          <path d={`M-3.2 ${y + 1.6}V${y + 5}a3.2 3.2 0 0 0 6.4 0V${y + 1.6}`} fill={tongue} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          <path d={`M-6.5 ${y - 1}Q0 ${y + 6} 6.5 ${y - 1}`} {...line} />
        </g>
      );
    case "smirk":
      return <path d={`M-5 ${y + 1}Q1.5 ${y + 4.8} 6.5 ${y - 2}`} {...line} />;
    case "bucky":
      return (
        <g>
          <path d={`M-7 ${y - 2.5}H7Q7 ${y + 7} 0 ${y + 7}Q-7 ${y + 7} -7 ${y - 2.5}Z`} fill={INK} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
          <path d={`M-3.6 ${y - 2.2}h7.2v2.6a1 1 0 0 1 -1 1h-5.2a1 1 0 0 1 -1 -1z`} fill="#fff" />
          <path d={`M0 ${y - 2.2}v3.4`} stroke={INK} strokeWidth={1} />
        </g>
      );
  }
}

/** The ears/hat part, drawn behind the face (ears) or on top of it (the rest). */
function topPart(kind: Top, hw: number, hh: number, fill: string, behind: boolean) {
  const edge = { stroke: INK, strokeWidth: 2.6, strokeLinejoin: "round" } as const;
  if (behind && kind === "pointy") {
    return [-1, 1].map((s) => (
      <g key={s}>
        <path d={`M${s * hw * 0.98} ${-hh * 0.28}L${s * hw * 0.8} ${-hh - 9.5}L${s * hw * 0.16} ${-hh * 0.94}Z`} fill={fill} {...edge} />
        <path d={`M${s * hw * 0.82} ${-hh * 0.62}L${s * hw * 0.76} ${-hh - 4.5}L${s * hw * 0.42} ${-hh * 0.92}Z`} fill="#FF8FC0" opacity={0.75} />
      </g>
    ));
  }
  if (behind && kind === "round") {
    return [-1, 1].map((s) => (
      <g key={s}>
        <circle cx={s * hw * 0.74} cy={-hh * 0.82} r={8.6} fill={fill} {...edge} />
        <circle cx={s * hw * 0.76} cy={-hh * 0.86} r={4.4} fill="#FF8FC0" opacity={0.75} />
      </g>
    ));
  }
  if (behind) return null;
  if (kind === "sprout") {
    return (
      <g>
        <path d={`M0 ${-hh + 1}Q-1 ${-hh - 5} 1 ${-hh - 8.5}`} fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
        <path d={`M1 ${-hh - 8}q5 -7.5 12 -3.5q-5 6.5 -12 3.5z`} fill="#2EE6A6" {...edge} strokeWidth={2.2} />
        <path d={`M0 ${-hh - 7}q-4 -5.5 -9.5 -2.8q3.8 5 9.5 2.8z`} fill="#86EFC9" {...edge} strokeWidth={2.2} />
      </g>
    );
  }
  if (kind === "antenna") {
    return (
      <g>
        <path d={`M0 ${-hh + 1}V${-hh - 8}`} stroke={INK} strokeWidth={2.6} strokeLinecap="round" />
        <circle cx={0} cy={-hh - 11} r={3.9} fill="#FF4D9A" {...edge} strokeWidth={2.2} />
        <circle cx={-1.2} cy={-hh - 12.2} r={1.1} fill="#fff" opacity={0.9} />
      </g>
    );
  }
  if (kind === "bow") {
    const x = hw * 0.5;
    const y = -hh * 0.86;
    return (
      <g transform={`translate(${x} ${y}) rotate(18)`}>
        <path d="M0 0L-8.5 -5.5Q-10.5 0 -8.5 5.5Z M0 0L8.5 -5.5Q10.5 0 8.5 5.5Z" fill="#FF4D9A" {...edge} strokeWidth={2.2} />
        <circle r={2.7} fill="#FF7DB5" {...edge} strokeWidth={2} />
      </g>
    );
  }
  return null;
}

/** A 4-point sparkle. */
const star = (x: number, y: number, s: number) => `M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`;

function Buddy({ handle, uid, small }: { handle: string; uid: string; small: boolean }) {
  const b = buddyFor(handle);
  const { hw, hh } = b.shape;
  const bg = `${uid}bg`;
  const fc = `${uid}fc`;
  const ey = -4;
  const my = 8.5;
  const cx = 40 + b.dx;
  const cy = 45 + b.dy + (b.top === "none" ? -1.5 : 1.5);
  const showSparkle = !small && (b.top === "none" || b.top === "bow");
  const left = b.sparkleLeft || b.top === "bow"; // the bow sits on the right
  const sx = left ? 16 : 64;
  return (
    <svg viewBox="0 0 80 80" width="100%" height="100%" aria-hidden="true" focusable="false" style={{ display: "block" }}>
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1" gradientTransform={`rotate(${b.angle} .5 .5)`}>
          <stop offset="0" stopColor={b.back.a} />
          <stop offset="1" stopColor={b.back.b} />
        </linearGradient>
        <linearGradient id={fc} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".3" stopColor={b.face[0]} />
          <stop offset="1" stopColor={b.face[1]} />
        </linearGradient>
      </defs>
      <rect width={80} height={80} fill={`url(#${bg})`} />
      <circle cx={18} cy={14} r={26} fill="#fff" opacity={0.13} />
      {showSparkle && (
        <g fill="#fff">
          <path d={star(sx, 17, 5.5)} opacity={0.92} />
          <circle cx={left ? sx + 7.5 : sx - 7.5} cy={24} r={1.6} opacity={0.75} />
        </g>
      )}
      <g transform={`translate(${cx} ${cy}) rotate(${b.tilt})`}>
        {topPart(b.top, hw, hh, `url(#${fc})`, true)}
        {/* hard drop under the face, like a sticker */}
        <g transform="translate(0 3.2)">{b.shape.el({ fill: INK, opacity: 0.22 })}</g>
        {b.shape.el({ fill: `url(#${fc})`, stroke: INK, strokeWidth: 2.6 })}
        <path
          d={`M${-hw * 0.64} ${-hh * 0.26}Q${-hw * 0.6} ${-hh * 0.76} ${-hw * 0.16} ${-hh * 0.84}`}
          fill="none"
          stroke="#fff"
          strokeWidth={3.2}
          strokeLinecap="round"
          opacity={0.8}
        />
        {b.cheeks === "blush" &&
          [-1, 1].map((s) => <ellipse key={s} cx={s * (b.gap + 7)} cy={ey + 9} rx={4.6} ry={2.9} fill="#FF4D9A" opacity={0.4} />)}
        {b.cheeks === "freckles" &&
          !small &&
          [-1, 1].map((s) => (
            <g key={s} fill="#B0592B" opacity={0.55}>
              <circle cx={s * (b.gap + 5)} cy={ey + 8} r={0.95} />
              <circle cx={s * (b.gap + 8)} cy={ey + 7.2} r={0.95} />
              <circle cx={s * (b.gap + 6.8)} cy={ey + 10.2} r={0.95} />
            </g>
          ))}
        {eyePair(b.eyes, b.gap, ey, small)}
        {mouthAt(b.mouth, my)}
        {topPart(b.top, hw, hh, `url(#${fc})`, false)}
      </g>
    </svg>
  );
}

/* ---------- the avatar ---------- */

export function Avatar({ handle, src, size, ring = "sticker", house, className, style }: AvatarProps) {
  // SSR-safe unique ids (useId output can contain characters that break url(#…)).
  const uid = "zka" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [broken, setBroken] = useState<string | null>(null);
  const px = typeof size === "number" ? size : null;
  // An <img> that failed before hydration never fires onError: check it once it's in the DOM.
  const imgRef = useCallback(
    (el: HTMLImageElement | null) => {
      if (el && el.complete && !el.naturalWidth && src) setBroken(src);
    },
    [src],
  );
  const thin = px != null && px <= 36;
  const box: CSSProperties = {
    width: size,
    height: size,
    flex: "none",
    position: "relative",
    display: "block",
    overflow: "hidden",
    borderRadius: "50%",
    boxSizing: "border-box",
    background: "var(--zk-surface-raised, #231C4A)",
    ...(ring === "sticker"
      ? { border: `${thin ? 2 : 2.5}px solid var(--zk-ink, ${INK})`, boxShadow: `0 ${thin ? 2 : 3}px 0 var(--zk-ink, ${INK})` }
      : null),
    ...style,
  };
  if (house) {
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--zk-grad-tile-gold)" }}
      >
        <Logo variant="mark" size={px ? Math.round(px * 0.58) : 26} stroke="var(--zk-gold-deep)" />
      </span>
    );
  }
  const photo = src && broken !== src ? src : null;
  return (
    <span aria-hidden="true" className={className} style={box}>
      {photo ? (
        <img
          ref={imgRef}
          key={photo}
          src={photo}
          alt=""
          decoding="async"
          loading="lazy"
          draggable={false}
          onError={() => setBroken(photo)}
          style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", pointerEvents: "none", WebkitUserSelect: "none", userSelect: "none" }}
        />
      ) : (
        <Buddy handle={handle} uid={uid} small={px != null && px < 30} />
      )}
    </span>
  );
}
