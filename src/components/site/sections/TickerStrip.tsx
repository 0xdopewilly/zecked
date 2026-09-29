"use client";
// Two crossed "caution tape" marquees: live wins from the app on one, hype words on the other.
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { Icon } from "@/components/zk";
import { Marquee } from "../fx";

const HYPE = ["HIDE IT", "CRACK IT", "GET ZECKED", "FIRST ONE WINS", "PRIVATE BY DEFAULT", "FREE TO PLAY", "BUILT ON ZCASH", "NOBODY SEES WHO WON"];

export function TickerStrip({ items }: { items: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const x1 = useTransform(scrollYProgress, [0, 1], [-80, 80]);
  const x2 = useTransform(scrollYProgress, [0, 1], [80, -80]);
  const live = items.length ? items : ["Fresh stashes drop every day", "Crack a riddle, keep the ZEC", "Call the score before kickoff", "Winners stay anonymous"];
  return (
    <div ref={ref} aria-label="Live activity" style={{ position: "relative", height: 190, margin: "-40px 0 0", zIndex: 5, overflow: "hidden" }}>
      <motion.div style={{ position: "absolute", left: "-5%", right: "-5%", top: 38, rotate: -3, x: x1, willChange: "transform", background: "var(--zk-grad-gold)", color: "var(--zk-gold-ink)", padding: "16px 0", boxShadow: "0 8px 0 var(--zk-gold-deep), 0 30px 60px rgba(0,0,0,.45)" }}>
        <Marquee speed={34} gap={42} fade={false} clip={false}>
          {live.map((t, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 12, font: "800 22px/1 var(--zk-font-display)", whiteSpace: "nowrap" }}>
              <Icon icon={i % 2 ? "unlock" : "bolt"} size={20} stroke={2.6} /> {t}
            </span>
          ))}
        </Marquee>
      </motion.div>
      <motion.div style={{ position: "absolute", left: "-5%", right: "-5%", top: 98, rotate: 2.5, x: x2, willChange: "transform", background: "var(--zk-purple)", color: "#fff", padding: "14px 0", boxShadow: "0 7px 0 var(--zk-purple-deep), 0 30px 60px rgba(0,0,0,.45)" }}>
        <Marquee speed={42} gap={34} reverse fade={false} clip={false}>
          {HYPE.map((t, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 34, font: "800 20px/1 var(--zk-font-display)", letterSpacing: ".04em", whiteSpace: "nowrap" }}>
              {t} <span style={{ color: "var(--zk-gold)" }}>✦</span>
            </span>
          ))}
        </Marquee>
      </motion.div>
    </div>
  );
}
