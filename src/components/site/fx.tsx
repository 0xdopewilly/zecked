"use client";
// ZECKED motion toolkit: shared building blocks for the website's animation language.
// Springy, playful, GPU-friendly (transform/opacity only), and all of it respects prefers-reduced-motion
// via <MotionConfig reducedMotion="user"> in SmoothScroll.
import {
  animate,
  motion,
  useInView,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

export const SPRING = { type: "spring", stiffness: 140, damping: 18, mass: 0.8 } as const;
export const SPRING_SOFT = { type: "spring", stiffness: 80, damping: 20 } as const;
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Fade + rise + un-blur when scrolled into view. */
export function Reveal({
  children,
  delay = 0,
  y = 36,
  x = 0,
  scale = 1,
  blur = true,
  once = true,
  amount = 0.25,
  style,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  x?: number;
  scale?: number;
  blur?: boolean;
  once?: boolean;
  amount?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y, x, scale, filter: blur ? "blur(10px)" : "blur(0px)" }}
      whileInView={{ opacity: 1, y: 0, x: 0, scale: 1, filter: "blur(0px)" }}
      viewport={{ once, amount }}
      transition={{ duration: 0.9, delay, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/** Headline that springs up word-by-word (or char-by-char) through a mask. */
export function SplitText({
  text,
  as = "h2",
  by = "word",
  delay = 0,
  stagger = 0.045,
  style,
  className,
  wordStyle,
  highlight,
}: {
  text: string;
  as?: ElementType;
  by?: "word" | "char";
  delay?: number;
  stagger?: number;
  style?: CSSProperties;
  className?: string;
  wordStyle?: (word: string, i: number) => CSSProperties | undefined;
  highlight?: string[]; // words to paint gold
}) {
  const Tag = as;
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const words = text.split(" ");
  let n = 0;
  return (
    <Tag ref={ref} className={className} style={{ margin: 0, ...style }} aria-label={text}>
      {words.map((w, wi) => {
        const pieces = by === "char" ? [...w] : [w];
        const gold = highlight?.some((h) => w.replace(/[^\w]/g, "").toLowerCase() === h.toLowerCase());
        return (
          <Fragment key={wi}>
          <span aria-hidden style={{ display: "inline-block", overflow: "hidden", verticalAlign: "top", paddingBottom: "0.16em", marginBottom: "-0.16em", paddingInline: "0.02em", marginInline: "-0.02em" }}>
            {pieces.map((p, pi) => {
              const i = n++;
              return (
                <motion.span
                  key={pi}
                  style={{ display: "inline-block", willChange: "transform", color: gold ? "var(--zk-gold)" : undefined, ...(wordStyle?.(w, wi) || {}) }}
                  initial={{ y: "115%", rotate: 8, opacity: 0 }}
                  animate={inView ? { y: "0%", rotate: 0, opacity: 1 } : undefined}
                  transition={{ ...SPRING, delay: delay + i * stagger }}
                >
                  {p}
                </motion.span>
              );
            })}
          </span>
          {wi < words.length - 1 ? " " : ""}
          </Fragment>
        );
      })}
    </Tag>
  );
}

/** Magnetic hover: the child drifts toward the pointer. */
export function Magnetic({ children, strength = 0.35, style }: { children: ReactNode; strength?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 220, damping: 15, mass: 0.4 });
  const y = useSpring(0, { stiffness: 220, damping: 15, mass: 0.4 });
  return (
    <motion.div
      ref={ref}
      style={{ display: "inline-block", x, y, ...style }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = ref.current!.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/** 3D tilt toward the pointer, with a moving glare. */
export function Tilt({
  children,
  max = 12,
  glare = true,
  radius = 28,
  style,
  className,
}: {
  children: ReactNode;
  max?: number;
  glare?: boolean;
  radius?: number;
  style?: CSSProperties;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), { stiffness: 150, damping: 16 });
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), { stiffness: 150, damping: 16 });
  const gx = useTransform(px, (v) => `${v * 100}%`);
  const gy = useTransform(py, (v) => `${v * 100}%`);
  const bg = useMotionTemplate`radial-gradient(420px circle at ${gx} ${gy}, rgba(255,255,255,.14), transparent 45%)`;
  return (
    <div style={{ perspective: 1100, ...style }} className={className}>
      <motion.div
        ref={ref}
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d", position: "relative", borderRadius: radius }}
        onPointerMove={(e) => {
          const r = ref.current!.getBoundingClientRect();
          px.set((e.clientX - r.left) / r.width);
          py.set((e.clientY - r.top) / r.height);
        }}
        onPointerLeave={() => {
          px.set(0.5);
          py.set(0.5);
        }}
      >
        {children}
        {glare && <motion.div aria-hidden style={{ position: "absolute", inset: 0, borderRadius: radius, background: bg, pointerEvents: "none", mixBlendMode: "screen" }} />}
      </motion.div>
    </div>
  );
}

/** Moves the child vertically as it passes through the viewport. speed > 0 = slower than scroll (floats back). */
export function Parallax({ children, speed = 0.25, x = 0, rotate = 0, style }: { children: ReactNode; speed?: number; x?: number; rotate?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [speed * 160, speed * -160]);
  const tx = useTransform(scrollYProgress, [0, 1], [x * -1, x]);
  const rot = useTransform(scrollYProgress, [0, 1], [-rotate, rotate]);
  return (
    <motion.div ref={ref} style={{ y, x: tx, rotate: rot, ...style }}>
      {children}
    </motion.div>
  );
}

/** Gentle infinite bob (+ optional tilt). */
export function Float({ children, amplitude = 10, duration = 4.5, delay = 0, rotate = 0, style }: { children: ReactNode; amplitude?: number; duration?: number; delay?: number; rotate?: number; style?: CSSProperties }) {
  return (
    <motion.div
      style={{ display: "inline-block", ...style }}
      animate={{ y: [0, -amplitude, 0], rotate: [rotate, rotate + 2.5, rotate] }}
      transition={{ duration, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.div>
  );
}

/** Counts up when scrolled into view. */
export function CountUpInView({ to, decimals = 0, prefix = "", suffix = "", duration = 1.8, style }: { to: number; decimals?: number; prefix?: string; suffix?: string; duration?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (reduce) {
      setV(to);
      return;
    }
    if (!inView) return;
    const c = animate(0, to, { duration, ease: EASE_OUT, onUpdate: setV });
    return () => c.stop();
  }, [inView, to, duration, reduce]);
  const txt = v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <span ref={ref} style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {prefix}
      {txt}
      {suffix}
    </span>
  );
}

/** Infinite horizontal marquee (content duplicated; pauses on hover). */
export function Marquee({ children, speed = 38, reverse = false, gap = 28, style }: { children: ReactNode; speed?: number; reverse?: boolean; gap?: number; style?: CSSProperties }) {
  return (
    <div className="zks-marquee" style={{ ["--zks-speed" as string]: `${speed}s`, ["--zks-gap" as string]: `${gap}px`, ...style }}>
      <div className={`zks-marquee-track${reverse ? " is-reverse" : ""}`}>
        <div className="zks-marquee-group">{children}</div>
        <div className="zks-marquee-group" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}

/** A tilted, bobbing sticker pill (like the app's welcome stickers). */
export function Sticker({
  children,
  bg = "var(--zk-pink)",
  fg = "#fff",
  edge = "var(--zk-pink-deep)",
  rotate = -6,
  style,
}: {
  children: ReactNode;
  bg?: string;
  fg?: string;
  edge?: string;
  rotate?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderRadius: 999,
        background: bg,
        color: fg,
        font: "var(--zk-type-btn-sm)",
        boxShadow: `0 5px 0 ${edge}, 0 18px 40px rgba(0,0,0,.35)`,
        transform: `rotate(${rotate}deg)`,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Section eyebrow chip. */
export function Eyebrow({ children, color = "var(--zk-gold)" }: { children: ReactNode; color?: string }) {
  return (
    <Reveal y={16} blur={false}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 14px",
          borderRadius: 999,
          border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          color,
          font: "var(--zk-type-label)",
          letterSpacing: ".14em",
          textTransform: "uppercase",
        }}
      >
        {children}
      </span>
    </Reveal>
  );
}

/** Scroll-linked value for a section (0 → 1 as it scrolls through). Handy for pinned stories. */
export function useSectionProgress(offset: ["start start", "end end"] | ["start end", "end start"] = ["start start", "end end"]) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset });
  return { ref, progress: scrollYProgress as MotionValue<number> };
}

/** Thin gold progress bar pinned to the top of the page. */
export function ScrollProgressBar() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  return <motion.div aria-hidden style={{ position: "fixed", top: 0, left: 0, right: 0, height: 3, background: "var(--zk-grad-gold)", transformOrigin: "0% 50%", scaleX, zIndex: 120 }} />;
}

/** Big soft glow that follows the pointer (desktop only). */
export function CursorGlow() {
  const x = useSpring(-400, { stiffness: 90, damping: 20 });
  const y = useSpring(-400, { stiffness: 90, damping: 20 });
  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    if (!mq.matches) return;
    const on = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    window.addEventListener("pointermove", on);
    return () => window.removeEventListener("pointermove", on);
  }, [x, y]);
  return (
    <motion.div
      aria-hidden
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: 520,
        height: 520,
        marginLeft: -260,
        marginTop: -260,
        x,
        y,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(124,92,255,.18), rgba(244,183,40,.06) 40%, transparent 70%)",
        pointerEvents: "none",
        zIndex: 1,
        mixBlendMode: "screen",
      }}
    />
  );
}

/** Film grain overlay. */
export function Grain() {
  return <div aria-hidden className="zks-grain" />;
}
