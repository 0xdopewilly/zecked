"use client";
// Prediction stashes card: a mini match card with score steppers and a call you can seal (lock-slam).
import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useId, useState } from "react";
import { Button, Countdown, Icon, LiveBadge, TeamBadge } from "@/components/zk";
import { EASE_OUT } from "@/components/site/fx";
import { BallTile, CardShell, PitchLines, RuleChips, Springy, WIN_ZEC } from "./parts";

const CREST = (espnId: number) => `https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/${espnId}.png&w=128&h=128`;
const HOME = { code: "BAR", name: "Barcelona", color: "#A50044", ink: "#fff", logo: CREST(83) };
const AWAY = { code: "CHE", name: "Chelsea", color: "#034694", ink: "#fff", logo: CREST(363) };
/** Demo kickoff: a fixed start so server and client render the same first frame, then it ticks. */
const KICKOFF_IN_SECONDS = 2 * 3600 + 14 * 60 + 37;

const NUM_SPRING = { type: "spring", stiffness: 560, damping: 20, mass: 0.6 } as const;
const numVariants = {
  enter: (d: number) => ({ y: d > 0 ? "75%" : "-75%", opacity: 0, scale: 0.5, rotate: d > 0 ? -14 : 14 }),
  center: { y: "0%", opacity: 1, scale: 1, rotate: 0 },
  exit: (d: number) => ({ y: d > 0 ? "-75%" : "75%", opacity: 0, scale: 0.6, rotate: d > 0 ? 10 : -10 }),
};

function Stepper({
  team,
  value,
  onChange,
  disabled,
  reduce,
}: {
  team: typeof HOME;
  value: number;
  onChange: (n: number) => void;
  disabled: boolean;
  reduce: boolean;
}) {
  const [dir, setDir] = useState(1);
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const change = (d: number) => {
    const n = value + d;
    if (n < 0 || n > 9) {
      if (!reduce && scope.current) animate(scope.current, { x: [0, -7, 7, -4, 4, 0] }, { duration: 0.4 });
      return;
    }
    setDir(d);
    onChange(n);
  };
  return (
    <div className="zkg-stepper">
      <span className="zkg-stepper-team">{team.code}</span>
      <div className="zkg-stepper-row">
        <motion.button
          type="button"
          className="zkg-step-btn"
          whileTap={{ scale: 0.84 }}
          whileHover={{ y: -2 }}
          transition={{ type: "spring", stiffness: 500, damping: 15 }}
          onClick={() => change(-1)}
          disabled={disabled}
          aria-label={`${team.name}: one goal less`}
        >
          <Icon icon="minus" size={20} stroke={3} />
        </motion.button>
        <div ref={scope} className="zkg-score" aria-hidden>
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.span
              key={value}
              custom={dir}
              variants={numVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={NUM_SPRING}
              style={{ display: "inline-block" }}
            >
              {value}
            </motion.span>
          </AnimatePresence>
        </div>
        <motion.button
          type="button"
          className="zkg-step-btn is-plus"
          whileTap={{ scale: 0.84 }}
          whileHover={{ y: -2 }}
          transition={{ type: "spring", stiffness: 500, damping: 15 }}
          onClick={() => change(1)}
          disabled={disabled}
          aria-label={`${team.name}: one goal more`}
        >
          <Icon icon="plus" size={20} stroke={3} />
        </motion.button>
      </div>
    </div>
  );
}

export function PredictionCard({ appUrl, reduce }: { appUrl: string; reduce: boolean }) {
  const titleId = useId();
  const [home, setHome] = useState(2);
  const [away, setAway] = useState(1);
  const [sealed, setSealed] = useState(false);
  const [slam, setSlam] = useState(0);
  const [panel, animatePanel] = useAnimate<HTMLDivElement>();

  const seal = () => {
    setSealed(true);
    setSlam((s) => s + 1);
    // The thud: the match card dips as the lock lands.
    if (!reduce && panel.current) animatePanel(panel.current, { y: [0, 0, 7, -2, 0] }, { duration: 0.55, times: [0, 0.3, 0.45, 0.7, 1], ease: EASE_OUT });
  };

  return (
    <CardShell
      tone="sky"
      reduce={reduce}
      labelledBy={titleId}
      tile={<BallTile />}
      deco={
        <>
          <div className="zkg-glow" style={{ right: "-25%", top: "-25%", background: "radial-gradient(closest-side, rgb(var(--zk-mint-rgb) / .28), transparent)" }} />
          <div className="zkg-glow" style={{ left: "-30%", bottom: "-30%", background: "radial-gradient(closest-side, rgb(var(--zk-sky-rgb) / .38), transparent)" }} />
          <PitchLines />
        </>
      }
    >
      <div>
        <span className="zkg-kind" style={{ color: "var(--zk-sky)" }}>
          <Icon icon="ball" size={14} stroke={2.4} /> Prediction stashes
        </span>
        <h3 id={titleId} className="zks-h3 zkg-title">
          Call the score. Take the stash.
        </h3>
        <p className="zks-body zkg-copy">Someone hides ZEC on a real football match. The first correct call takes it.</p>
      </div>

      <div ref={panel} className="zkg-demo">
        <div className="zkg-demo-top">
          <LiveBadge label={sealed ? "Your call is in" : "Calls open · demo"} />
          <AnimatePresence mode="popLayout" initial={false}>
            {sealed ? (
              <motion.button
                key="again"
                type="button"
                className="zkg-mini"
                onClick={() => setSealed(false)}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: "spring", stiffness: 500, damping: 18 }}
              >
                <Icon icon="back" size={14} stroke={2.8} /> Change call
              </motion.button>
            ) : (
              <motion.span key="prize" className="zkg-prize" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}>
                {WIN_ZEC} ZEC
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="zkg-league">Champions League · demo match</div>

        <div className="zkg-teams">
          <div className="zkg-team">
            <TeamBadge code={HOME.code} color={HOME.color} ink={HOME.ink} logo={HOME.logo} name={HOME.name} size={60} />
            <span>{HOME.name}</span>
          </div>
          <span className="zkg-vs" aria-hidden>
            VS
          </span>
          <div className="zkg-team">
            <TeamBadge code={AWAY.code} color={AWAY.color} ink={AWAY.ink} logo={AWAY.logo} name={AWAY.name} size={60} />
            <span>{AWAY.name}</span>
          </div>
        </div>

        <div className="zkg-lockin">
          <span>Calls lock in</span>
          <Countdown seconds={KICKOFF_IN_SECONDS} variant="boxed" size="sm" tone="default" />
        </div>

        <div className="zkg-steppers" data-sealed={sealed}>
          <Stepper team={HOME} value={home} onChange={setHome} disabled={sealed} reduce={reduce} />
          <span className="zkg-dash" aria-hidden>
            –
          </span>
          <Stepper team={AWAY} value={away} onChange={setAway} disabled={sealed} reduce={reduce} />
        </div>

        <div className="zkg-stack" style={{ marginTop: 16 }}>
          <motion.div
            inert={sealed}
            initial={false}
            animate={sealed ? { opacity: 0, scale: 0.92 } : { opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 340, damping: 24 }}
          >
            <Springy>
              <Button label="LOCK MY CALL" iconRight="lock" onClick={seal} />
            </Springy>
            <p className="zkg-note">Calls stay sealed until kickoff. Nobody can copy yours.</p>
          </motion.div>

          <motion.div
            inert={!sealed}
            initial={false}
            animate={sealed ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 1.12, y: -10 }}
            transition={{ type: "spring", stiffness: 420, damping: 20 }}
          >
            <div className="zkg-sealed">
              <span>
                CALL SEALED {home}–{away}
              </span>
              <AnimatePresence>
                {sealed && (
                  <motion.span
                    key={slam}
                    className="zkg-lock"
                    initial={reduce ? false : { y: -80, scale: 2.4, rotate: -35, opacity: 0 }}
                    animate={{ y: 0, scale: 1, rotate: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 700, damping: 17, mass: 0.8, delay: 0.08 }}
                    aria-hidden
                  >
                    🔒
                  </motion.span>
                )}
              </AnimatePresence>
              {sealed && !reduce && (
                <motion.span
                  key={`shock${slam}`}
                  aria-hidden
                  className="zkg-shock"
                  initial={{ scale: 0.5, opacity: 0.9 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  transition={{ duration: 0.65, delay: 0.24, ease: EASE_OUT }}
                />
              )}
            </div>
            <div className="zkg-sealed-actions">
              <Springy>
                <Button label="Play for real" iconRight="arrowRight" size="md" href={`${appUrl}/feed`} />
              </Springy>
            </div>
          </motion.div>
        </div>

        <span className="zkg-sr" role="status" aria-live="polite">
          {sealed ? `Call sealed: ${HOME.name} ${home}, ${AWAY.name} ${away}.` : `Your call: ${HOME.name} ${home}, ${AWAY.name} ${away}.`}
        </span>
      </div>

      <RuleChips
        items={[
          { icon: "lock", label: "Calls sealed until kickoff", color: "var(--zk-sky)" },
          { icon: "signal", label: "Live results feed", color: "var(--zk-mint)" },
          { icon: "medal", label: "First correct call wins", color: "var(--zk-gold)" },
        ]}
      />
    </CardShell>
  );
}
