"use client";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { Logo } from "@/components/zk";
import { useScrollTo } from "./SmoothScroll";
import { Magnetic } from "./fx";
import { GetAppButton, PhoneGlyph } from "./GetApp";

const LINKS = [
  { id: "how", label: "How it works" },
  { id: "games", label: "Games" },
  { id: "why", label: "Why Zcash" },
  { id: "faq", label: "FAQ" },
];

export function Nav({ appUrl }: { appUrl: string }) {
  const { scrollY } = useScroll();
  const [hidden, setHidden] = useState(false);
  const [solid, setSolid] = useState(false);
  const scrollTo = useScrollTo();
  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setSolid(y > 40);
    setHidden(y > 220 && y > prev + 2);
    if (y < prev - 2) setHidden(false);
  });
  return (
    <motion.header
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: hidden ? -110 : 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      style={{ position: "fixed", top: 14, left: 0, right: 0, zIndex: 100, display: "flex", justifyContent: "center", pointerEvents: "none" }}
    >
      <nav
        aria-label="Main"
        style={{
          pointerEvents: "auto",
          width: "min(1160px, calc(100% - 24px))",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 10px 10px 18px",
          borderRadius: 22,
          // No backdrop blur: blurring what scrolls underneath costs a GPU pass every frame.
          background: solid ? "rgb(14 11 31 / .97)" : "rgb(14 11 31 / .55)",
          border: `1px solid ${solid ? "var(--zk-border)" : "transparent"}`,
          boxShadow: solid ? "0 20px 50px rgba(0,0,0,.35)" : "none",
          transition: "background .3s, border-color .3s, box-shadow .3s",
        }}
      >
        <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="ZECKED home" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", display: "flex" }}>
          <Logo variant="wordmark" size={28} />
        </button>
        <div className="zks-nav-links">
          {LINKS.map((l) => (
            <button key={l.id} className="zks-nav-link" onClick={() => scrollTo(l.id)}>
              {l.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <a href={appUrl} className="zks-nav-link zks-nav-play">
            Play<span className="zks-nav-play-more">&nbsp;in browser</span>
          </a>
          <Magnetic strength={0.25}>
            <GetAppButton appUrl={appUrl} className="zks-btn zks-btn-gold zks-nav-getapp" style={{ height: 46, padding: "0 18px", gap: 8, borderRadius: 16, font: "var(--zk-type-btn-sm)" }}>
              <PhoneGlyph size={18} /> Get the app
            </GetAppButton>
          </Magnetic>
        </div>
      </nav>
    </motion.header>
  );
}
