"use client";
// Footer: brand, link columns, legal line, and a giant faint wordmark that rises into place.
import { useLenis } from "lenis/react";
import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef } from "react";
import { Icon, Logo } from "@/components/zk";
import { Magnetic, Reveal, SPRING } from "../fx";
import { useReduced } from "./extras/kit";

const LETTERS = ["Z", "E", "C", "K", "E", "D"];

const CSS = `
.zkft { position: relative; overflow: hidden; padding-top: clamp(80px, 10vw, 120px); border-top: 1px solid var(--zk-border);
  background: radial-gradient(60% 50% at 50% 100%, rgb(var(--zk-purple-rgb) / .16), transparent 70%), linear-gradient(180deg, var(--zk-bg), #0A0818); }
.zkft-top { display: grid; gap: 44px 28px; grid-template-columns: 1fr 1fr; }
.zkft-brandcell { grid-column: 1 / -1; }
.zkft-brand { display: grid; gap: 16px; justify-items: start; max-width: 420px; }
.zkft-tag { margin: 0; font: 800 clamp(24px, 2.6vw, 32px)/1.1 var(--zk-font-display); letter-spacing: -.02em; }
.zkft-desc { margin: 0; font: var(--zk-type-body-lg); color: var(--zk-text-muted); }
.zkft-col { display: grid; gap: 14px; align-content: start; }
@media (max-width: 639px) { .zkft-col-wide { grid-column: 1 / -1; } }
.zkft-col h2 { margin: 0; font: var(--zk-type-label); letter-spacing: .16em; text-transform: uppercase; color: var(--zk-text-faint); }
.zkft-col ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.zkft-link { position: relative; display: inline-flex; align-items: center; gap: 8px; color: var(--zk-text); text-decoration: none; font: 600 16px/1.3 var(--zk-font-body); padding: 2px 0; }
.zkft-link::after { content: ""; position: absolute; left: 0; right: 0; bottom: -2px; height: 2px; border-radius: 2px; background: var(--zk-gold); transform: scaleX(0); transform-origin: 100% 50%; transition: transform .35s var(--zk-ease-out); }
.zkft-link:hover { color: var(--zk-gold-light); }
.zkft-link:hover::after, .zkft-link:focus-visible::after { transform: scaleX(1); transform-origin: 0% 50%; }
.zkft-link svg { transition: transform .3s var(--zk-ease-spring); opacity: .7; }
.zkft-link:hover svg { transform: translate(3px, -1px); opacity: 1; }
.zkft-soon { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--zk-text-muted); font: 600 16px/1.3 var(--zk-font-body); }
.zkft-soon em { font-style: normal; font: 700 11px/1 var(--zk-font-mono); letter-spacing: .04em; color: var(--zk-text-faint); padding: 5px 8px; border-radius: 8px; background: rgb(255 255 255 / .05); border: 1px solid var(--zk-border); }
@media (min-width: 640px) { .zkft-top { grid-template-columns: repeat(3, 1fr); } }
@media (min-width: 960px) { .zkft-top { grid-template-columns: 1.6fr 1fr 1fr 1fr; } .zkft-brandcell { grid-column: auto; } }
.zkft-bar { margin-top: clamp(48px, 7vw, 80px); padding-block: 22px; border-top: 1px solid var(--zk-border); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px 20px; }
.zkft-pills { display: flex; flex-wrap: wrap; gap: 10px; }
.zkft-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 13px; border-radius: 999px; font: var(--zk-type-caption); font-weight: 700; color: var(--zk-text-muted); background: rgb(255 255 255 / .04); border: 1px solid var(--zk-border); }
.zkft-pill i { width: 7px; height: 7px; border-radius: 50%; background: var(--zk-mint); box-shadow: 0 0 10px var(--zk-mint); }
.zkft-copy { font: var(--zk-type-small); color: var(--zk-text-faint); }
.zkft-top-btn { display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 16px; border-radius: 999px; border: 1.5px solid var(--zk-border-strong); background: rgb(255 255 255 / .04);
  color: var(--zk-text); font: var(--zk-type-btn-sm); cursor: pointer; transition: background-color .2s, border-color .2s; }
.zkft-top-btn:hover { background: rgb(255 255 255 / .09); border-color: rgb(var(--zk-gold-rgb) / .5); }
.zkft-top-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--zk-purple); }
.zkft-mark { display: flex; justify-content: center; white-space: nowrap; user-select: none; margin-top: clamp(10px, 3vw, 30px); margin-bottom: -.16em;
  font: 800 23.5vw/.8 var(--zk-font-display); letter-spacing: -.05em; }
.zkft-mark span { display: inline-block; color: rgb(255 255 255 / .045); -webkit-text-stroke: 1px rgb(255 255 255 / .09); cursor: default; }
`;

function FooterLink({ href, children, external }: { href: string; children: string; external?: boolean }) {
  return (
    <li>
      <a className="zkft-link" href={href}>
        {children}
        {external ? <Icon icon="arrowRight" size={14} stroke={2.4} /> : null}
      </a>
    </li>
  );
}

export function Footer({ appUrl }: { appUrl: string }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReduced();
  const lenis = useLenis();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 100, damping: 24, mass: 0.5 });
  const markY = useTransform(p, [0, 1], ["48%", "0%"]);
  const markOpacity = useTransform(p, [0.2, 1], [0.2, 1]);

  const toTop = () => {
    if (lenis) lenis.scrollTo(0, { duration: 1.6 });
    else window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <footer ref={ref} className="zkft">
      <style>{CSS}</style>
      <div className="zks-container">
        <div className="zkft-top">
          <Reveal y={24} className="zkft-brandcell">
            <div className="zkft-brand">
              <Logo size={40} />
              <p className="zkft-tag">
                Hide it. Crack it. <span style={{ color: "var(--zk-gold)", whiteSpace: "nowrap" }}>Get Zecked.</span>
              </p>
              <p className="zkft-desc">A free-to-play social game on Zcash. Riddles and match calls with ZEC inside.</p>
            </div>
          </Reveal>

          <nav className="zkft-col" aria-label="Play">
            <h2>Play</h2>
            <ul>
              <FooterLink href={appUrl} external>
                App
              </FooterLink>
              <FooterLink href="#how">How it works</FooterLink>
            </ul>
          </nav>

          <nav className="zkft-col" aria-label="Learn">
            <h2>Learn</h2>
            <ul>
              <FooterLink href="#why">Why Zcash</FooterLink>
              <FooterLink href="#faq">FAQ</FooterLink>
              <FooterLink href="#testzec">Get test ZEC</FooterLink>
            </ul>
          </nav>

          <div className="zkft-col zkft-col-wide">
            <h2>Community</h2>
            <ul>
              <li>
                <span className="zkft-soon">
                  X <em>@PlayZecked (soon)</em>
                </span>
              </li>
              <li>
                <span className="zkft-soon">
                  Telegram <em>(soon)</em>
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div className="zkft-bar">
          <div className="zkft-pills">
            <span className="zkft-pill">
              <Icon icon="coin" size={15} stroke={2.2} /> Built on Zcash
            </span>
            <span className="zkft-pill">
              <i aria-hidden /> Free to play · Test mode
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <span className="zkft-copy">© 2026 ZECKED</span>
            <Magnetic strength={0.3}>
              <button type="button" className="zkft-top-btn" onClick={toTop}>
                <Icon icon="arrowUp" size={16} stroke={2.6} /> Back to top
              </button>
            </Magnetic>
          </div>
        </div>
      </div>

      <motion.div aria-hidden className="zkft-mark" style={reduce ? undefined : { y: markY, opacity: markOpacity, willChange: "transform, opacity" }}>
        {LETTERS.map((l, i) => (
          <motion.span key={i} whileHover={{ y: "-10%", color: "rgba(244, 183, 40, 0.28)" }} transition={SPRING}>
            {l}
          </motion.span>
        ))}
      </motion.div>
    </footer>
  );
}
