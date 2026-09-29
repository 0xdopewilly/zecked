"use client";
// A drifting strip of real StashCards built from mock data (demo stashes, not live figures).
import { motion } from "motion/react";
import { useState } from "react";
import type { Match, PublicStash, Team } from "@/lib/types";
import { StashCard } from "@/components/zk";
import { Marquee } from "@/components/site/fx";

/** Illustrative USD rate for the mock cards only (the app's own fallback rate). Not a price claim. */
const DEMO_RATE = 1500;
const H = 3_600_000;

const TEAMS: Record<string, Team> = {
  MAD: { code: "MAD", name: "Real Madrid", color: "#FFFFFF", ink: "#3B1F7A" },
  LIV: { code: "LIV", name: "Liverpool", color: "#C8102E", ink: "#FFFFFF" },
  PSG: { code: "PSG", name: "Paris SG", color: "#004170", ink: "#FFFFFF" },
  BAY: { code: "BAY", name: "Bayern", color: "#DC052D", ink: "#FFFFFF" },
};

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Dates hang off an anchor rounded to the hour, so the server and the browser build identical props
 * (StashCard's own clock-driven text is already hydration-safe). Every deadline sits hours away,
 * so nothing flips into the "urgent" style between server and client.
 */
function buildMocks(anchor: number): PublicStash[] {
  const base = {
    testMode: false,
    isMine: false,
    whale: false,
  };
  const riddle = (
    id: string,
    handle: string,
    tier: PublicStash["hider"]["tier"],
    zec: number,
    text: string,
    tries: number,
    liveH: number,
    endH: number,
    extra: Partial<PublicStash> = {},
  ): PublicStash => ({
    ...base,
    id,
    type: "riddle",
    status: "live",
    hider: { handle, tier, stashesHidden: 1 },
    amountZat: Math.round(zec * 1e8),
    usd: zec * DEMO_RATE,
    createdAt: iso(anchor - liveH * H),
    liveAt: iso(anchor - liveH * H),
    expiresAt: iso(anchor + endH * H),
    riddle: { text, hasHint: false, tries, crackingNow: 0 },
    ...extra,
  });
  const match = (id: string, home: string, away: string, kickoffH: number, extra: Partial<Match> = {}): Match => ({
    id: `demo:${id}`,
    league: "uefa.champions",
    leagueName: "Champions League",
    kickoff: iso(anchor + kickoffH * H),
    status: "scheduled",
    home: TEAMS[home],
    away: TEAMS[away],
    demo: true,
    ...extra,
  });
  const prediction = (
    id: string,
    handle: string,
    zec: number,
    m: Match,
    kind: "exact" | "winner",
    calls: number,
    status: PublicStash["status"] = "live",
  ): PublicStash => ({
    ...base,
    id,
    type: "prediction",
    status,
    hider: { handle, tier: "oracle", stashesHidden: 1 },
    amountZat: Math.round(zec * 1e8),
    usd: zec * DEMO_RATE,
    createdAt: iso(anchor - 6 * H),
    liveAt: iso(anchor - 6 * H),
    expiresAt: m.kickoff,
    prediction: { match: m, kind, calls, locksAt: m.kickoff },
  });

  return [
    riddle("m1", "@vaultgoblin", "cracker", 0.02, "What has keys but can’t open a single lock?", 38, 2, 10),
    prediction("m2", "@offsidequeen", 0.0134, match("m2", "MAD", "LIV", 5), "exact", 142),
    riddle("m3", "@satoshisghost", "safecracker", 0.1, "The more you take, the more you leave behind. What am I?", 211, 4, 20, { whale: true }),
    prediction(
      "m4",
      "@nutmegnode",
      0.0334,
      match("m4", "PSG", "BAY", -1, { status: "live", minute: "67’", homeScore: 1, awayScore: 1 }),
      "winner",
      64,
      "locked",
    ),
    riddle("m5", "@nightowl", "rookie", 0.0067, "I speak without a mouth and hear without ears. What am I?", 17, 3, 21, {
      status: "zecked",
      result: { zeckedAt: iso(anchor - 1 * H), winnerIsYou: false, winnerLabel: "a mystery cracker", crackSeconds: 252 },
    }),
    riddle("m6", "@memofield", "vault", 0.0134, "I’m tall when I’m young and short when I’m old. What am I?", 9, 1, 30),
  ];
}

export function StashMarquee() {
  const [stashes] = useState(() => buildMocks(Math.floor(Date.now() / H) * H));
  return (
    <div className="zkg-marquee">
      <div className="zks-container zkg-marquee-head">
        <span className="zkg-kind" style={{ color: "var(--zk-text)" }}>
          A peek at the feed
        </span>
        <span className="zkg-marquee-note">Demo stashes</span>
      </div>
      <Marquee speed={70} gap={26}>
        {stashes.map((s, i) => (
          <div key={s.id} className="zkg-mcard">
            <motion.div
              initial={false}
              style={{ rotate: i % 2 ? 1.6 : -1.6 }}
              whileHover={{ y: -10, rotate: 0, scale: 1.02 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
            >
              <StashCard stash={s} />
            </motion.div>
          </div>
        ))}
      </Marquee>
    </div>
  );
}
