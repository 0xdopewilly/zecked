"use client";
// Riddle stashes card with a playable mini-demo: wrong answers shake, the right one ("map") pays out.
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { Button, Confetti, Icon, Input, LiveBadge, Vault } from "@/components/zk";
import { CardShell, LockTile, RuleChips, Springy, WIN_ZEC, ZecCounter } from "./parts";

const RIDDLE = "I have cities, but no houses. Forests, but no trees. Water, but no fish. What am I?";
const TRIES = 3;

/** Case-insensitive; ignores punctuation and a leading "a", "an" or "the" (same rule as the app). */
function isRight(guess: string) {
  const g = guess
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(a|an|the) /, "");
  return g === "map";
}

export function RiddleCard({ appUrl, reduce }: { appUrl: string; reduce: boolean }) {
  const titleId = useId();
  const [value, setValue] = useState("");
  const [shake, setShake] = useState(0);
  const [error, setError] = useState(false);
  const [wrong, setWrong] = useState(0); // wrong guesses this round
  const [nope, setNope] = useState(0); // bumps to re-pop the "Nope!" sticker
  const [won, setWon] = useState(false);
  const [run, setRun] = useState(0);

  const outOfTries = wrong >= TRIES;
  const triesLeft = TRIES - Math.min(wrong, TRIES);

  const submit = () => {
    if (won) return;
    if (!value.trim()) {
      setShake((s) => s + 1);
      return;
    }
    if (isRight(value)) {
      setError(false);
      setWon(true);
      setRun((r) => r + 1);
      return;
    }
    setShake((s) => s + 1);
    setError(true);
    setNope((n) => n + 1);
    setWrong((w) => (w >= TRIES ? 1 : w + 1));
  };

  const replay = () => {
    setWon(false);
    setValue("");
    setWrong(0);
    setError(false);
  };

  const message = error
    ? outOfTries
      ? "That’s 3. The real game makes you wait 10 min. This one’s on us, go again."
      : wrong === 2
        ? "Hint: people used to keep one folded in the glovebox."
        : "Not quite. Think bigger. Much bigger."
    : "Not case-sensitive. “a”, “an” and “the” are ignored.";

  return (
    <CardShell
      tone="purple"
      reduce={reduce}
      won={won}
      labelledBy={titleId}
      tile={<LockTile />}
      deco={
        <>
          <div className="zkg-glow" style={{ right: "-20%", top: "-25%", background: "radial-gradient(closest-side, rgb(var(--zk-purple-rgb) / .5), transparent)" }} />
          <div className="zkg-glow" style={{ left: "-30%", bottom: "-30%", background: "radial-gradient(closest-side, rgb(var(--zk-pink-rgb) / .22), transparent)" }} />
          <div className="zkg-watermark" style={{ right: "-8%", bottom: "-10%", transform: "rotate(-14deg)" }}>
            <Icon icon="lock" size={360} stroke={1.1} />
          </div>
        </>
      }
    >
      <div className="zkg-fx">{won && <Confetti count={90} seed={21} run={run} />}</div>

      <div>
        <span className="zkg-kind" style={{ color: "var(--zk-purple-light)" }}>
          <Icon icon="lock" size={14} stroke={2.6} /> Riddle stashes
        </span>
        <h3 id={titleId} className="zks-h3 zkg-title">
          Crack it first. Keep the ZEC.
        </h3>
        <p className="zks-body zkg-copy">Someone hides ZEC behind a riddle. The first person to answer it right takes the lot.</p>
      </div>

      <div className="zkg-demo">
        <div className="zkg-demo-top">
          <LiveBadge state={won ? "ended" : "live"} label={won ? "Cracked by you" : "Try it right here"} />
          <AnimatePresence mode="popLayout" initial={false}>
            {won ? (
              <motion.button
                key="replay"
                type="button"
                className="zkg-mini"
                onClick={replay}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: "spring", stiffness: 500, damping: 18 }}
              >
                <Icon icon="back" size={14} stroke={2.8} /> Play again
              </motion.button>
            ) : (
              <motion.span key="prize" className="zkg-prize" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}>
                {WIN_ZEC} ZEC
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <p className="zkg-riddle">“{RIDDLE}”</p>

        <div className="zkg-stack">
          {/* Play state */}
          <motion.div
            inert={won}
            initial={false}
            animate={won ? { opacity: 0, scale: 0.94, y: -12 } : { opacity: 1, scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
            style={{ position: "relative" }}
          >
            <Input
              label="Your answer"
              value={value}
              onChange={(v) => {
                setValue(v);
                if (error) setError(false);
                if (outOfTries) setWrong(0);
              }}
              onEnter={submit}
              placeholder="Type your answer…"
              state={error ? "error" : undefined}
              shake={reduce ? 0 : shake}
              message={message}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
            />
            <AnimatePresence>
              {error && (
                <motion.div
                  key={nope}
                  aria-hidden
                  className="zkg-nope"
                  initial={{ scale: 0.2, rotate: -22, opacity: 0, y: 10 }}
                  animate={{ scale: 1, rotate: 6, opacity: 1, y: 0 }}
                  exit={{ scale: 0.5, opacity: 0, transition: { duration: 0.15 } }}
                  transition={{ type: "spring", stiffness: 520, damping: 13 }}
                >
                  Nope! Try again 😏
                </motion.div>
              )}
            </AnimatePresence>
            <div style={{ marginTop: 14 }}>
              <Springy>
                <Button label="ZECK IT" iconRight="unlock" onClick={submit} />
              </Springy>
            </div>
            <div className="zkg-tries" aria-hidden>
              {Array.from({ length: TRIES }, (_, i) => (
                <motion.span
                  key={i}
                  initial={false}
                  animate={{ scale: i < triesLeft ? 1 : 0.7, opacity: i < triesLeft ? 1 : 0.4 }}
                  transition={{ type: "spring", stiffness: 500, damping: 14 }}
                  className="zkg-dot"
                  data-on={i < triesLeft}
                />
              ))}
              <span>
                {triesLeft} {triesLeft === 1 ? "try" : "tries"} left (resets in 10 min)
              </span>
            </div>
          </motion.div>

          {/* Win state */}
          <motion.div
            inert={!won}
            initial={false}
            animate={won ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.9, y: 16 }}
            transition={{ type: "spring", stiffness: 280, damping: 18 }}
            className="zkg-win"
          >
            <div className="zkg-win-row">
              <motion.div
                key={`v${run}`}
                initial={reduce ? false : { scale: 0.3, rotate: -40 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.05 }}
                style={{ flex: "none" }}
              >
                <Vault mode="open" size={96} />
              </motion.div>
              <div style={{ minWidth: 0 }}>
                <div className="zkg-win-amt">
                  <ZecCounter run={run} reduce={reduce} /> ZEC
                </div>
                <motion.div
                  key={`t${run}`}
                  initial={reduce ? false : { scale: 0.4, rotate: -10, opacity: 0 }}
                  animate={{ scale: 1, rotate: -2, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 12, delay: 0.35 }}
                  className="zkg-win-title"
                >
                  You zecked it!
                </motion.div>
                <p className="zkg-win-sub">In the real game it lands in your private wallet. Nobody sees who won.</p>
              </div>
            </div>
            <div className="zkg-win-actions">
              <Springy>
                <Button label="Play for real" iconRight="arrowRight" size="md" href={`${appUrl}/feed`} />
              </Springy>
            </div>
          </motion.div>
        </div>

        <span className="zkg-sr" role="status" aria-live="polite">
          {won ? `Correct! You zecked ${WIN_ZEC} ZEC.` : error ? `Nope, try again. ${triesLeft} tries left.` : ""}
        </span>
      </div>

      <RuleChips
        items={[
          { icon: "trophy", label: "First right answer wins", color: "var(--zk-gold)" },
          { icon: "hourglass", label: "3 tries / 10 min", color: "var(--zk-purple-light)" },
          { icon: "home", label: "Uncracked? ZEC goes home.", color: "var(--zk-mint)" },
        ]}
      />
    </CardShell>
  );
}
