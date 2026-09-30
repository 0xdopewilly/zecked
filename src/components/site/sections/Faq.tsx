"use client";
// FAQ: spring-height accordion. Buttons carry aria-expanded/aria-controls; ↑ ↓ Home End move between questions.
import { motion } from "motion/react";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/zk";
import { EASE_OUT, Eyebrow, Float, Reveal, SplitText, Sticker } from "../fx";
import { SPLIT_FIX_CSS, useReduced, useSafeId } from "./extras/kit";

const QA: { q: string; a: ReactNode }[] = [
  {
    q: "Is it free?",
    a: "Yes. Players never pay to play. The person who hides a stash puts up the prize.",
  },
  {
    q: "Is this real money?",
    a: "Not yet. ZECKED runs on the Zcash testnet with free test ZEC, which has no market value. Real ZEC comes after a security review.",
  },
  {
    q: "How do you pick the winner?",
    a: (
      <>
        <b>Riddles:</b> the first exact answer wins, and you get 3 tries per 10 minutes. <b>Predictions:</b> calls lock at kickoff and stay sealed. When the result comes in, the first
        correct call wins.
      </>
    ),
  },
  {
    q: "What if nobody cracks it?",
    a: "The ZEC goes back to the hider’s ZECKED wallet, and they earn the Uncrackable badge.",
  },
  {
    q: "Why Zcash?",
    a: (
      <>
        Zcash has private, shielded payments and viewing keys. That’s what makes verifiable prizes and anonymous winners possible. <a href="#why">See how it works</a>.
      </>
    ),
  },
  {
    q: "Do I need a wallet?",
    a: "No. Sign up with your email and you get a ZECKED wallet. You can withdraw to any Zcash wallet, anytime.",
  },
  {
    q: "Is it betting?",
    a: "No. It’s a free skill contest. Players never pay to enter.",
  },
  {
    q: "Who holds the ZEC?",
    a: "While a stash is live, ZECKED holds it and pays the winner automatically. Zcash has no smart contracts, so someone has to. In test mode, it’s test ZEC only.",
  },
];

const CSS = `
${SPLIT_FIX_CSS}
.zkfaq-grid { display: grid; gap: clamp(40px, 6vw, 72px); align-items: start; }
@media (min-width: 960px) { .zkfaq-grid { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); } .zkfaq-side { position: sticky; top: 110px; } }
.zkfaq-side { display: grid; gap: 20px; justify-items: start; }
.zkfaq-stickers { position: relative; height: 150px; width: 100%; max-width: 360px; margin-top: 10px; }
@media (max-width: 959px) { .zkfaq-stickers { display: none; } }
.zkfaq-list { display: grid; gap: 12px; list-style: none; margin: 0; padding: 0; }
.zkfaq-item { position: relative; border-radius: 24px; background: linear-gradient(180deg, rgb(255 255 255 / .05), rgb(255 255 255 / .015)), var(--zk-surface);
  border: 1px solid var(--zk-border); transition: border-color .25s, background-color .25s, box-shadow .25s; }
.zkfaq-item:hover { border-color: var(--zk-border-strong); }
.zkfaq-item[data-open="true"] { border-color: rgb(var(--zk-gold-rgb) / .4); box-shadow: 0 0 0 4px rgb(var(--zk-gold-rgb) / .06), 0 24px 60px rgb(0 0 0 / .3);
  background: radial-gradient(90% 120% at 0% 0%, rgb(var(--zk-gold-rgb) / .09), transparent 60%), linear-gradient(180deg, rgb(255 255 255 / .05), rgb(255 255 255 / .015)), var(--zk-surface); }
.zkfaq-q { margin: 0; }
.zkfaq-btn { width: 100%; display: flex; align-items: center; gap: 16px; padding: 20px 20px 20px 22px; background: none; border: 0; color: var(--zk-text); cursor: pointer;
  text-align: left; border-radius: 24px; font: 800 clamp(18px, 1.9vw, 22px)/1.25 var(--zk-font-display); letter-spacing: -.01em; }
.zkfaq-btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--zk-purple); }
.zkfaq-num { font: 700 12px/1 var(--zk-font-mono); color: var(--zk-text-faint); letter-spacing: .08em; flex: none; width: 24px; transition: color .25s; }
.zkfaq-item[data-open="true"] .zkfaq-num { color: var(--zk-gold); }
.zkfaq-text { flex: 1; min-width: 0; }
.zkfaq-plus { position: relative; flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid var(--zk-border-strong);
  background: rgb(255 255 255 / .04); color: var(--zk-text); transition: background-color .25s, border-color .25s, color .25s; }
.zkfaq-item[data-open="true"] .zkfaq-plus { background: var(--zk-grad-gold); border-color: transparent; color: var(--zk-gold-ink); box-shadow: 0 3px 0 var(--zk-gold-deep); }
.zkfaq-plus i { position: absolute; width: 14px; height: 2.5px; border-radius: 2px; background: currentColor; }
.zkfaq-plus i + i { transform: rotate(90deg); }
.zkfaq-panel { overflow: hidden; }
.zkfaq-a { margin: 0; padding: 0 24px 24px 62px; font: 500 16px/1.6 var(--zk-font-body); color: var(--zk-text-muted); max-width: 640px; }
.zkfaq-a b { color: var(--zk-text); }
.zkfaq-a a { font-weight: 700; }
@media (max-width: 520px) { .zkfaq-a { padding-left: 22px; } .zkfaq-num { display: none; } .zkfaq-btn { padding: 18px 16px 18px 20px; } }
`;

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useSafeId("zkfaq");
  const reduce = useReduced();

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = QA.length;
    const j = e.key === "ArrowDown" ? (i + 1) % n : e.key === "ArrowUp" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    btns.current[j]?.focus();
  };

  return (
    <section id="faq" className="zks-section">
      <style>{CSS}</style>
      <div className="zks-container">
        <div className="zkfaq-grid">
          <div className="zkfaq-side">
            <Eyebrow color="var(--zk-pink)">
              <Icon icon="bulb" size={14} stroke={2.4} /> FAQ
            </Eyebrow>
            <SplitText text="Questions? Cracked." className="zks-h2 zkx-split" highlight={["Cracked"]} />
            <Reveal delay={0.15} y={20}>
              <p className="zks-lead">The quick answers, before your first stash.</p>
            </Reveal>
            <div className="zkfaq-stickers" aria-hidden>
              <Float amplitude={8} duration={4.6} style={{ position: "absolute", left: 0, top: 10 }}>
                <Sticker bg="var(--zk-mint)" fg="var(--zk-mint-ink)" edge="var(--zk-mint-deep)" rotate={-7}>
                  <Icon icon="sparkle" size={16} stroke={2.6} /> Free to play
                </Sticker>
              </Float>
              <Float amplitude={10} duration={5.2} delay={0.6} style={{ position: "absolute", left: 150, top: 56 }}>
                <Sticker bg="var(--zk-sky)" fg="var(--zk-sky-ink)" edge="var(--zk-sky-deep)" rotate={6}>
                  <Icon icon="coin" size={16} stroke={2.6} /> Test ZEC only
                </Sticker>
              </Float>
              <Float amplitude={7} duration={4.2} delay={1.2} style={{ position: "absolute", left: 30, top: 104 }}>
                <Sticker rotate={-3}>
                  <Icon icon="medal" size={16} stroke={2.6} /> First one wins
                </Sticker>
              </Float>
            </div>
          </div>

          <ul className="zkfaq-list">
            {QA.map((item, i) => {
              const isOpen = open === i;
              const qid = `${base}q${i}`;
              const aid = `${base}a${i}`;
              return (
                <motion.li
                  key={item.q}
                  className="zkfaq-item"
                  data-open={isOpen}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.8, delay: Math.min(i, 5) * 0.05, ease: EASE_OUT }}
                >
                    <h3 className="zkfaq-q">
                      <button
                        ref={(el) => {
                          btns.current[i] = el;
                        }}
                        id={qid}
                        type="button"
                        className="zkfaq-btn"
                        aria-expanded={isOpen}
                        aria-controls={aid}
                        onClick={() => setOpen(isOpen ? null : i)}
                        onKeyDown={(e) => onKey(e, i)}
                      >
                        <span className="zkfaq-num" aria-hidden>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <motion.span className="zkfaq-text" animate={{ x: isOpen ? 4 : 0 }} transition={{ type: "spring", stiffness: 300, damping: 22 }}>
                          {item.q}
                        </motion.span>
                        <motion.span
                          className="zkfaq-plus"
                          aria-hidden
                          initial={false}
                          animate={{ rotate: isOpen ? 135 : 0, scale: isOpen ? 1.06 : 1 }}
                          whileHover={{ scale: 1.12 }}
                          whileTap={{ scale: 0.9 }}
                          transition={{ type: "spring", stiffness: 320, damping: 16 }}
                        >
                          <i />
                          <i />
                        </motion.span>
                      </button>
                    </h3>
                    <motion.div
                      id={aid}
                      role="region"
                      aria-labelledby={qid}
                      className="zkfaq-panel"
                      inert={!isOpen}
                      initial={false}
                      animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                      transition={
                        reduce
                          ? { duration: 0 }
                          : { height: { type: "spring", stiffness: 210, damping: 26, mass: 0.9 }, opacity: { duration: isOpen ? 0.35 : 0.18, delay: isOpen ? 0.06 : 0 } }
                      }
                    >
                      <motion.p className="zkfaq-a" initial={false} animate={{ y: isOpen ? 0 : -10 }} transition={{ type: "spring", stiffness: 260, damping: 24 }}>
                        {item.a}
                      </motion.p>
                    </motion.div>
                </motion.li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
