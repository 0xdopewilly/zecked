// Shared types between the ZECKED server (src/lib/server) and the UI.

export type StashType = "riddle" | "prediction";

/**
 * Lifecycle:
 *  awaiting_funding → live → (riddle) zecked | expired → refunded
 *                         → (prediction) locked (after kickoff) → zecked | refunded | void
 */
export type StashStatus =
  | "awaiting_funding"
  | "live"
  | "locked"
  | "zecked"
  | "expired"
  | "refunded"
  | "void";

export type TierId = "rookie" | "cracker" | "safecracker" | "vault" | "oracle" | "legend";

export type BadgeId =
  | "first-crack"
  | "uncrackable"
  | "oracle"
  | "speed-demon"
  | "whale-hider"
  | "shielded"
  | "birthday-og";

export interface Team {
  code: string; // 3-letter, e.g. "BAR"
  name: string; // "Barcelona"
  color: string; // hex, e.g. "#A50044"
  ink: string; // text color on that fill
}

export type MatchStatus = "scheduled" | "live" | "final" | "postponed" | "canceled";

export interface MatchEvent {
  minute: string; // "12'"
  side: "home" | "away";
  text: string; // "Goal · Lewandowski"
}

export interface Match {
  id: string; // "espn:uefa.champions:740123" or "demo:xyz"
  league: string; // "uefa.champions"
  leagueName: string; // "Champions League"
  kickoff: string; // ISO
  status: MatchStatus;
  minute?: string; // "67'"
  home: Team;
  away: Team;
  homeScore?: number;
  awayScore?: number;
  events?: MatchEvent[];
  demo?: boolean; // test-mode quick match
}

export type PredictionKind = "exact" | "winner";
export type WinnerPick = "home" | "draw" | "away";

export interface PublicHider {
  handle: string; // "@satoshisghost"
  tier: TierId;
  stashesHidden: number;
}

export interface PublicStash {
  id: string;
  type: StashType;
  status: StashStatus;
  hider: PublicHider;
  amountZat: number; // 1 ZEC = 100_000_000 zat
  usd: number; // at current rate
  createdAt: string;
  liveAt?: string;
  expiresAt: string;
  whale: boolean;
  testMode: boolean;
  isMine: boolean; // viewer is the hider
  riddle?: {
    text: string;
    hint?: string; // present only once unlocked
    hasHint: boolean;
    hintUnlocksAt?: string;
    tries: number; // total guesses so far
    crackingNow: number; // viewers in the last few minutes
  };
  prediction?: {
    match: Match;
    kind: PredictionKind;
    calls: number; // sealed calls so far
    locksAt: string; // = kickoff
  };
  result?: {
    zeckedAt: string;
    winnerIsYou: boolean;
    winnerLabel: string; // "a mystery cracker" (handles stay hidden)
    victoryMessage?: string;
    crackSeconds?: number;
    finalScore?: string; // predictions: "2–1"
    correctCalls?: number;
  };
  funding?: {
    address: string;
    uri: string; // ZIP-321
    amountZat: number;
  };
}

export interface MyCall {
  kind: PredictionKind;
  home?: number;
  away?: number;
  pick?: WinnerPick;
  at: string;
}

export interface RunnerCall {
  handle: string;
  label: string; // "2–1" or "BAR win"
  isYou: boolean;
  matchesNow: boolean; // equals current live score / outcome
}

export interface GuessResult {
  correct: boolean;
  triesLeft: number;
  resetsAt?: string;
  verdict: string; // "Nope! Try again 😏"
  alreadyZecked?: boolean;
  win?: WinPayload;
}

export interface WinPayload {
  stashId: string;
  amountZat: number;
  usd: number;
  xpGained: number;
  badgesUnlocked: BadgeId[];
  player: Player;
  claimToken: string;
  credited: boolean; // true = already added to the winner's ZECKED wallet; false = guest must sign up to keep it
}

export interface Player {
  id: string;
  handle: string;
  createdAt: string;
  xp: number;
  tier: TierId;
  nextTier?: TierId;
  xpForNext?: number; // threshold of next tier
  xpTierStart: number;
  stats: {
    cracked: number;
    hidden: number;
    uncrackable: number;
    oracle: number; // exact scores called
    streak: number; // days in a row played
  };
  badges: BadgeId[];
  pendingClaims: string[]; // stash ids won but not yet claimed (guests) — credited to the wallet on sign-up
  shielded: boolean;
  account: {
    signedIn: boolean; // verified email account (guests can browse and play, but must sign up to keep winnings / hide)
    email?: string; // masked, e.g. "ni***@gmail.com"
  };
  balanceZat: number; // in-app ZECKED wallet balance (0 for guests)
}

// ---------- in-app wallet ----------
export type WalletTxKind = "deposit" | "win" | "refund" | "hide" | "withdraw" | "bonus";

export interface WalletTx {
  id: string;
  kind: WalletTxKind;
  amountZat: number; // signed: + credit, − debit
  at: string;
  label: string; // "Won a riddle stash", "Hid a stash", "Withdrew to u1…9x4q"
  stashId?: string;
  txid?: string;
  status: "done" | "pending" | "failed";
}

export interface WalletInfo {
  balanceZat: number;
  usd: number;
  pendingDepositZat: number; // seen on-chain, waiting for confirmation
  depositAddress?: string; // your personal ZEC address (signed-in only)
  depositUri?: string; // ZIP-321 (no amount) for the QR
  activity: WalletTx[]; // newest first
  minWithdrawZat: number;
  withdrawFeeZat: number;
  network: "sim" | "testnet" | "mainnet";
}

export interface AuthStartResult {
  sentTo: string; // masked email
  expiresAt: string;
  devCode?: string; // TEST MODE ONLY, when no email sender is configured: the code is shown on screen
}

export interface ClaimResult {
  txid: string;
  amountZat: number;
  usd: number;
  to: string; // shortened
  shielded: boolean;
  testMode: boolean;
}

export interface LeaderRow {
  rank: number;
  handle: string;
  tier: TierId;
  score: number;
  isYou: boolean;
}

export interface Leaderboard {
  board: "crackers" | "hiders" | "oracles";
  period: "today" | "week" | "all";
  rows: LeaderRow[];
  you?: LeaderRow & { deltaThisWeek?: number };
}

export interface TickerItem {
  id: string;
  text: string; // "@nightowl just ZECKED 0.02 ZEC"
  at: string;
  kind: "zecked" | "hidden" | "called";
}

export interface AppConfig {
  testMode: boolean; // play-money mode
  network: "sim" | "testnet" | "mainnet";
  zecUsd: number;
  maxStashUsd: number;
  minStashUsd: number;
}

export const ZAT = 100_000_000;
