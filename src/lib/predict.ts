// Pure helpers for prediction stashes: formatting calls, reading the live score,
// and the tension meter (0–100 closeness of a call to the current score).
import type { Match, MatchEvent, MyCall, Team, WinnerPick } from "./types";

/** The parts of a call these helpers read. `MyCall` fits, so does a draft call. */
export type CallLike = Pick<MyCall, "kind" | "home" | "away" | "pick">;

export const MATCH_MINUTES = 90;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** "2–1" (en dash, as in the design). */
export function formatScore(home: number, away: number): string {
  return `${home}–${away}`;
}

/** "2–1" for exact calls, "BAR win" / "Draw" for winner calls. */
export function formatCall(call: CallLike | null | undefined, match: Pick<Match, "home" | "away">): string {
  if (!call) return "";
  if (call.kind === "exact") return formatScore(call.home ?? 0, call.away ?? 0);
  if (call.pick === "draw") return "Draw";
  if (call.pick === "home") return `${match.home.code} win`;
  if (call.pick === "away") return `${match.away.code} win`;
  return "";
}

/** "Tue 30 Sep · 20:00" in the viewer's local time. Call it on the client only (time zones differ). */
export function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const wd = d.toLocaleDateString("en-US", { weekday: "short" });
  const mo = d.toLocaleDateString("en-US", { month: "short" });
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${wd} ${d.getDate()} ${mo} · ${hh}:${mm}`;
}

/** "67'" → 67, "45+2'" → 47, "HT" → 45, "FT" → 90. */
export function parseMinute(minute?: string): number {
  if (!minute) return 0;
  const s = minute.trim();
  if (/^HT$/i.test(s)) return 45;
  if (/^(FT|AET|PEN)/i.test(s)) return MATCH_MINUTES;
  const m = /(\d+)(?:\s*\+\s*(\d+))?/.exec(s);
  if (!m) return 0;
  return Number(m[1]) + (m[2] ? Number(m[2]) : 0);
}

/** "67'" → "67’" (typographic apostrophe, as in the design). Bare numbers get one added. */
export function prettyMinute(minute?: string): string {
  if (!minute) return "";
  const s = minute.trim().replace(/'/g, "’");
  return /^\d+(\s*\+\s*\d+)?$/.test(s) ? `${s}’` : s;
}

/** How far through the 90 minutes the match is, 0–1. */
export function matchTime(match: Pick<Match, "status" | "minute">): number {
  if (match.status === "final") return 1;
  if (match.status !== "live") return 0;
  return clamp(parseMinute(match.minute) / MATCH_MINUTES, 0, 1);
}

/** Match-time bar width, 0–100. */
export function matchProgress(match: Pick<Match, "status" | "minute">): number {
  return Math.round(matchTime(match) * 100);
}

export function liveScore(match: Pick<Match, "homeScore" | "awayScore">): { home: number; away: number } {
  return { home: match.homeScore ?? 0, away: match.awayScore ?? 0 };
}

export function outcomeOf(home: number, away: number): WinnerPick {
  return home > away ? "home" : home < away ? "away" : "draw";
}

/** Does the call equal this score (exact) or this outcome (winner)? */
export function callMatchesScore(call: CallLike | null | undefined, home: number, away: number): boolean {
  if (!call) return false;
  if (call.kind === "exact") return call.home === home && call.away === away;
  return call.pick === outcomeOf(home, away);
}

/** Does the call equal the match's current (or final) score? */
export function callMatches(call: CallLike | null | undefined, match: Pick<Match, "homeScore" | "awayScore">): boolean {
  const s = liveScore(match);
  return callMatchesScore(call, s.home, s.away);
}

export interface GoalsAway {
  /** Goals still needed for the call to be right. */
  needed: number;
  /** Who has to score them. */
  side: "home" | "away" | "both" | null;
  /** An exact call that the score has already passed can never come true. */
  dead: boolean;
}

/** How many goals, and from whom, the call still needs from the current score. */
export function goalsAway(call: CallLike, home: number, away: number): GoalsAway {
  if (call.kind === "exact") {
    const dh = (call.home ?? 0) - home;
    const da = (call.away ?? 0) - away;
    if (dh < 0 || da < 0) return { needed: 0, side: null, dead: true };
    return { needed: dh + da, side: dh > 0 && da > 0 ? "both" : dh > 0 ? "home" : da > 0 ? "away" : null, dead: false };
  }
  if (call.pick === "home") return { needed: Math.max(0, away - home + 1), side: "home", dead: false };
  if (call.pick === "away") return { needed: Math.max(0, home - away + 1), side: "away", dead: false };
  // draw: the trailing side has to catch up
  return { needed: Math.abs(home - away), side: home > away ? "away" : home < away ? "home" : null, dead: false };
}

/**
 * Tension meter value, 0–100: how close the call is to the current score.
 * Spot on sits at 88–100 (rising as the clock runs down). Every goal still needed
 * roughly halves it, and needing goals late in the match costs more.
 */
export function closeness(call: CallLike | null | undefined, match: Match): number {
  if (!call) return 0;
  const { home, away } = liveScore(match);
  const g = goalsAway(call, home, away);
  if (g.dead) return 0;
  const t = matchTime(match);
  if (g.needed === 0) return Math.round(88 + 12 * t);
  if (match.status === "final") return 0;
  const base = 80 * Math.pow(0.6, g.needed - 1);
  const late = 1 - 0.2 * t - 0.5 * Math.pow(t, 8);
  return clamp(Math.round(base * late), 1, 87);
}

function teamFor(side: GoalsAway["side"], match: Pick<Match, "home" | "away">): Team | null {
  return side === "home" ? match.home : side === "away" ? match.away : null;
}

/** The meter's label: "Spot on right now 🔥", "One BAR goal away", "Needs a miracle"… */
export function tensionLabel(call: CallLike | null | undefined, match: Match): string {
  if (!call) return "";
  const { home, away } = liveScore(match);
  const g = goalsAway(call, home, away);
  if (g.dead) return "Out of the running";
  if (g.needed === 0) return "Spot on right now 🔥";
  if (match.status === "final") return "Out of the running";
  const team = teamFor(g.side, match);
  const t = matchTime(match);
  if (g.needed === 1) return team ? `One ${team.code} goal away` : "One goal away";
  if (g.needed === 2 && t < 0.85) {
    if (g.side === "both") return "A goal each away";
    return team ? `Two ${team.code} goals away` : "Two goals away";
  }
  // Three or more goals is fine early on; late in the match it's a long shot.
  if (g.needed <= 4 && t < 0.5) return `${g.needed} goals away`;
  return "Needs a miracle";
}

/** Color for the meter label at a given closeness. */
export function tensionColor(value: number): string {
  if (value >= 88) return "var(--zk-mint)";
  if (value >= 50) return "var(--zk-pink)";
  if (value >= 20) return "var(--zk-purple-light)";
  return "var(--zk-text-muted)";
}

/** Goal events in match order. */
export function sortedEvents(events: MatchEvent[] | undefined): MatchEvent[] {
  return (events ?? []).map((e, i) => ({ e, i })).sort((a, b) => parseMinute(a.e.minute) - parseMinute(b.e.minute) || a.i - b.i).map((x) => x.e);
}

/** "12’ Barcelona · Lewandowski" from { minute: "12'", side: "home", text: "Goal · Lewandowski" }. */
export function eventLine(e: MatchEvent, match: Pick<Match, "home" | "away">): { text: string; goal: boolean } {
  const team = e.side === "home" ? match.home : match.away;
  const goal = /\b(goal|pen)/i.test(e.text) || !e.text;
  const detail = e.text.replace(/^\s*goal\s*·?\s*/i, "").trim();
  const min = prettyMinute(e.minute);
  return { text: `${min} ${team.name}${detail ? ` · ${detail}` : ""}`, goal };
}

/** Final score from the match, or from the result's "2–1" string when the match has none. */
export function finalScore(match: Match, resultScore?: string): { home: number; away: number } | null {
  if (typeof match.homeScore === "number" && typeof match.awayScore === "number") {
    return { home: match.homeScore, away: match.awayScore };
  }
  const m = resultScore ? /(\d+)\s*[–-]\s*(\d+)/.exec(resultScore) : null;
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null;
}
