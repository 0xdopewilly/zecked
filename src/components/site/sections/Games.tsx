"use client";
// "Two ways to get Zecked": two huge playable cards (riddle + prediction) and a drifting strip of stash cards.
import { Eyebrow, Reveal, SplitText } from "@/components/site/fx";
import { useReducedSafe } from "./how/hooks";
import { PredictionCard } from "./games/PredictionCard";
import { RiddleCard } from "./games/RiddleCard";
import { StashMarquee } from "./games/StashMarquee";

const HEADLINE = "Two ways to get Zecked";
const WORDS = HEADLINE.split(" ").length;
/** fx SplitText drops the space between words (it collapses at the end of each inline-block), so add it back. */


export function Games({ appUrl }: { appUrl: string }) {
  const reduce = useReducedSafe();
  return (
    <section id="games" className="zks-section zkg" aria-label="The games">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div aria-hidden className="zkg-bg" />
      <div className="zks-container">
        <div className="zkg-head">
          <Eyebrow color="var(--zk-pink)">The games</Eyebrow>
          <div style={{ marginTop: 18 }}>
            <SplitText as="h2" text={HEADLINE} highlight={["Zecked"]} className="zks-h2" />
          </div>
          <Reveal delay={0.15} y={20}>
            <p className="zks-lead" style={{ marginTop: 20 }}>
              Hide ZEC behind a riddle or a real football match. Crack it or call it first and it’s yours. Both are playable right here.
            </p>
          </Reveal>
        </div>

        <div className="zks-grid-2 zkg-cards">
          <Reveal y={70} amount={0.15} style={{ height: "100%" }}>
            <RiddleCard appUrl={appUrl} reduce={reduce} />
          </Reveal>
          <Reveal y={70} amount={0.15} delay={0.12} style={{ height: "100%" }}>
            <PredictionCard appUrl={appUrl} reduce={reduce} />
          </Reveal>
        </div>
      </div>

      <StashMarquee />
    </section>
  );
}

const CSS = `
.zkg { overflow: clip; }
.zkg-bg { position: absolute; inset: 0; pointer-events: none; background:
  radial-gradient(40% 35% at 18% 38%, rgb(var(--zk-purple-rgb) / .16), transparent 70%),
  radial-gradient(40% 35% at 82% 42%, rgb(var(--zk-sky-rgb) / .12), transparent 70%); }
.zkg-head { position: relative; max-width: 780px; margin-bottom: clamp(48px, 7vw, 84px); }
.zkg-cards { position: relative; align-items: stretch; }

/* Card shell: lift wrapper → Tilt (flex column so the card fills the row height) → 3D card */
.zkg-lift { height: 100%; }
.zkg-tilt { height: 100%; display: flex; flex-direction: column; }
.zkg-tilt > div { flex: 1; display: flex; flex-direction: column; }
.zkg-card { position: relative; flex: 1; display: flex; flex-direction: column; gap: 20px; padding: clamp(22px, 3vw, 36px); border-radius: 32px; border: 1.5px solid var(--zk-border-strong); transition: border-color .4s, box-shadow .4s; }
.zkg-card--purple { background: linear-gradient(160deg, #2C2063 0%, #1B1538 52%, #130E2A 100%); border-color: rgb(var(--zk-purple-rgb) / .45); box-shadow: 0 40px 90px rgb(0 0 0 / .45), 0 0 60px rgb(var(--zk-purple-rgb) / .14), inset 0 1px 0 rgb(255 255 255 / .08); }
.zkg-card--sky { background: linear-gradient(160deg, #0E3152 0%, #14213D 52%, #0F182E 100%); border-color: rgb(var(--zk-sky-rgb) / .4); box-shadow: 0 40px 90px rgb(0 0 0 / .45), 0 0 60px rgb(var(--zk-sky-rgb) / .12), inset 0 1px 0 rgb(255 255 255 / .08); }
.zkg-card[data-won="true"] { border-color: rgb(var(--zk-gold-rgb) / .8); box-shadow: 0 40px 90px rgb(0 0 0 / .45), 0 0 90px rgb(var(--zk-gold-rgb) / .35), inset 0 1px 0 rgb(255 255 255 / .1); }
.zkg-deco { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none; }
.zkg-card > :not(.zkg-deco):not(.zkg-fx) { position: relative; z-index: 1; }
.zkg > .zks-container { position: relative; }
.zkg-glow { position: absolute; width: 90%; aspect-ratio: 1; }
.zkg-watermark { position: absolute; color: rgb(255 255 255 / .045); }
.zkg-fx { position: absolute; inset: 0; border-radius: inherit; overflow: hidden; pointer-events: none; z-index: 6; }
.zkg-tile { position: absolute; top: -34px; right: clamp(16px, 3vw, 34px); z-index: 3; transform: translateZ(70px); pointer-events: none; }

.zkg-kind { display: inline-flex; align-items: center; gap: 8px; font: var(--zk-type-label); letter-spacing: .14em; text-transform: uppercase; }
.zkg-title { margin-top: 12px; padding-right: 110px; }
.zkg-copy { margin-top: 10px; max-width: 460px; }

.zkg-demo { position: relative; border-radius: 24px; padding: clamp(16px, 2.2vw, 22px); background: rgb(var(--zk-bg-rgb) / .6); border: 1px solid var(--zk-border-strong); box-shadow: inset 0 1px 0 rgb(255 255 255 / .05), 0 18px 40px rgb(0 0 0 / .25); }
.zkg-demo-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.zkg-prize { font: var(--zk-type-mono-lg); color: var(--zk-gold); white-space: nowrap; }
.zkg-riddle { font: 800 clamp(19px, 1.9vw, 24px)/1.22 var(--zk-font-display); letter-spacing: -0.01em; margin: 14px 0 18px; text-wrap: pretty; }
.zkg-stack { display: grid; }
.zkg-stack > * { grid-area: 1 / 1; min-width: 0; }
.zkg-nope { position: absolute; right: -8px; top: -6px; z-index: 4; padding: 9px 14px; border-radius: 999px; background: var(--zk-red); color: #fff; font: var(--zk-type-btn-sm); white-space: nowrap; box-shadow: 0 4px 0 var(--zk-red-deep), 0 14px 30px rgb(0 0 0 / .35); pointer-events: none; }
.zkg-tries { margin-top: 12px; display: flex; align-items: center; gap: 8px; font: var(--zk-type-caption); color: var(--zk-text-muted); }
.zkg-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--zk-red-deep); flex: none; }
.zkg-dot[data-on="true"] { background: var(--zk-gold); }
.zkg-win { align-self: center; }
.zkg-win-row { display: flex; align-items: center; gap: 16px; }
.zkg-win-amt { font: 800 clamp(34px, 3.4vw, 44px)/1 var(--zk-font-display); color: var(--zk-gold); text-shadow: var(--zk-text-shadow-gold); white-space: nowrap; }
.zkg-win-title { display: inline-block; margin-top: 8px; font: var(--zk-type-h2); color: var(--zk-text); }
.zkg-win-sub { margin: 6px 0 0; font: var(--zk-type-small); color: var(--zk-text-muted); max-width: 300px; }
.zkg-win-actions, .zkg-sealed-actions { margin-top: 14px; }
.zkg-mini { display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px; border-radius: 999px; border: 1.5px solid var(--zk-border-strong); background: rgb(255 255 255 / .05); color: var(--zk-text); font: var(--zk-type-btn-sm); cursor: pointer; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
.zkg-mini:hover { background: rgb(255 255 255 / .1); }
.zkg-mini:focus-visible { outline: 3px solid var(--zk-gold); outline-offset: 2px; }

.zkg-league { margin-top: 14px; text-align: center; font: var(--zk-type-caption); color: var(--zk-text-muted); }
.zkg-teams { margin-top: 10px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
.zkg-team { display: flex; flex-direction: column; align-items: center; gap: 8px; font: var(--zk-type-body-strong); min-width: 0; text-align: center; }
.zkg-vs { font: 800 22px/1 var(--zk-font-display); color: var(--zk-text-faint); }
.zkg-lockin { margin-top: 14px; display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; font: var(--zk-type-small); color: var(--zk-text-muted); }
.zkg-steppers { margin-top: 16px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 6px; padding: 14px 10px; border-radius: 20px; background: rgb(255 255 255 / .04); border: 1px solid var(--zk-border); transition: opacity .3s; }
.zkg-steppers[data-sealed="true"] { opacity: .5; }
.zkg-stepper { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
.zkg-stepper-team { font: var(--zk-type-label); letter-spacing: .12em; color: var(--zk-text-muted); }
.zkg-stepper-row { display: flex; align-items: center; gap: clamp(4px, 1vw, 10px); }
.zkg-step-btn { width: 44px; height: 44px; flex: none; border-radius: 14px; border: 0; padding: 0; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; background: var(--zk-surface-raised); color: var(--zk-text); box-shadow: 0 4px 0 rgb(0 0 0 / .4); -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.zkg-step-btn.is-plus { background: var(--zk-purple); box-shadow: 0 4px 0 var(--zk-purple-deep); }
.zkg-step-btn:disabled { cursor: not-allowed; }
.zkg-step-btn:focus-visible { outline: 3px solid var(--zk-gold); outline-offset: 2px; }
.zkg-score { width: 1.1ch; text-align: center; font: 800 52px/1 var(--zk-font-display); font-variant-numeric: tabular-nums; }
.zkg-dash { font: 800 30px/1 var(--zk-font-display); color: var(--zk-text-faint); padding-bottom: 8px; }
.zkg-note { margin: 10px 0 0; text-align: center; font: var(--zk-type-caption); color: var(--zk-text-muted); }
.zkg-sealed { position: relative; height: var(--zk-h-btn-lg); border-radius: var(--zk-radius-2xl); background: var(--zk-mint); color: var(--zk-mint-ink); box-shadow: var(--zk-shadow-btn-mint), 0 16px 40px rgb(var(--zk-mint-rgb) / .3); display: flex; align-items: center; justify-content: center; gap: 10px; font: var(--zk-type-btn-lg); white-space: nowrap; padding: 0 16px; }
.zkg-lock { display: inline-block; font-size: 24px; line-height: 1; }
.zkg-shock { position: absolute; inset: -4px; border-radius: inherit; border: 3px solid var(--zk-mint); pointer-events: none; }

.zkg-chips { list-style: none; margin: auto 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.zkg-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* Marquee of stash cards */
.zkg-marquee { position: relative; margin-top: clamp(64px, 9vw, 120px); }
.zkg-marquee-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 26px; }
.zkg-marquee-note { font: var(--zk-type-caption); color: var(--zk-text-faint); }
.zkg-marquee .zks-marquee { padding: 22px 0 30px; }
.zkg-mcard { width: 340px; flex: none; }

@media (max-width: 520px) {
  .zkg-title { padding-right: 84px; }
  .zkg-win-row { flex-direction: column; text-align: center; gap: 10px; }
  .zkg-win-sub { margin-inline: auto; }
  .zkg-steppers { padding: 12px 6px; gap: 2px; }
  .zkg-dash { font-size: 24px; }
  .zkg-tile { top: -28px; transform: translateZ(70px) scale(.78); transform-origin: 100% 0; }
  .zkg-score { font-size: 44px; }
  .zkg-step-btn { width: 40px; height: 40px; border-radius: 12px; }
  .zkg-sealed { font: var(--zk-type-btn-md); }
  .zkg-mcard { width: 300px; }
}
/* Narrow phones: each stepper becomes a vertical slot wheel (+ on top, − below). */
@media (max-width: 440px) {
  .zkg-steppers { align-items: center; padding: 12px 10px; }
  .zkg-stepper-row { flex-direction: column-reverse; gap: 6px; }
  .zkg-score { font-size: 46px; width: auto; min-width: 1.2ch; }
  .zkg-dash { padding-bottom: 0; margin-top: 22px; }
}
`;
