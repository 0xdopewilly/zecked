// Live football fixtures and results.
// Source: ESPN's public scoreboard JSON (no key). Swap for a licensed provider before a real-money launch.
// Test mode also offers quick "demo" matches that play out in a few minutes.
import type { Match, MatchEvent, MatchStatus, Team } from "@/lib/types";
import { hashSeed, prng } from "./util";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer";

/** Curated competitions shown in the match picker. */
export const LEAGUES: { slug: string; name: string }[] = [
  { slug: "uefa.champions", name: "Champions League" },
  { slug: "uefa.europa", name: "Europa League" },
  { slug: "uefa.nations", name: "Nations League" },
  { slug: "eng.1", name: "Premier League" },
  { slug: "esp.1", name: "LaLiga" },
  { slug: "ita.1", name: "Serie A" },
  { slug: "ger.1", name: "Bundesliga" },
  { slug: "fra.1", name: "Ligue 1" },
  { slug: "usa.1", name: "MLS" },
  { slug: "bra.1", name: "Brasileirão" },
  { slug: "fifa.friendly", name: "International Friendly" },
];
const LEAGUE_NAME = Object.fromEntries(LEAGUES.map((l) => [l.slug, l.name]));

// ---------- helpers ----------
function hex(c?: string | null) {
  if (!c) return undefined;
  const h = c.replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toUpperCase()}` : undefined;
}
function luminance(h: string) {
  const n = parseInt(h.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function teamFrom(abbr: string, name: string, color?: string | null, alt?: string | null): Team {
  let c = hex(color) || hex(alt) || "#7C5CFF";
  // Near-white primaries read poorly on dark cards; prefer the alternate if it has colour.
  if (luminance(c) > 0.85 && hex(alt) && luminance(hex(alt)!) < 0.85) c = hex(alt)!;
  const ink = luminance(c) > 0.45 ? "#0E0B1F" : "#FFFFFF";
  return { code: (abbr || name.slice(0, 3)).toUpperCase().slice(0, 3), name, color: c, ink };
}

type EspnCompetitor = {
  homeAway: "home" | "away";
  score?: string;
  team: { id?: string; abbreviation: string; displayName: string; shortDisplayName?: string; color?: string; alternateColor?: string };
};
type EspnEvent = {
  id: string;
  date: string;
  status: { displayClock?: string; type: { name: string; state: "pre" | "in" | "post"; completed: boolean } };
  competitions: {
    competitors: EspnCompetitor[];
    details?: { clock?: { displayValue?: string }; type?: { text?: string }; scoringPlay?: boolean; team?: { id?: string }; athletesInvolved?: { displayName?: string }[] }[];
  }[];
};

function mapStatus(s: EspnEvent["status"]): MatchStatus {
  const n = s.type.name;
  if (/POSTPONED|SUSPENDED|DELAYED/i.test(n)) return "postponed";
  if (/CANCELED|CANCELLED|ABANDONED|FORFEIT/i.test(n)) return "canceled";
  if (s.type.state === "post" || s.type.completed) return "final";
  if (s.type.state === "in") return "live";
  return "scheduled";
}

function fromEspn(e: EspnEvent, league: string): Match {
  const c = e.competitions[0];
  const home = c.competitors.find((x) => x.homeAway === "home")!;
  const away = c.competitors.find((x) => x.homeAway === "away")!;
  const status = mapStatus(e.status);
  const events: MatchEvent[] = (c.details || [])
    .filter((d) => d.scoringPlay || /goal/i.test(d.type?.text || ""))
    .map((d) => ({
      minute: d.clock?.displayValue || "",
      side: d.team?.id && d.team.id === away.team.id ? "away" : "home",
      text: `${d.type?.text || "Goal"}${d.athletesInvolved?.[0]?.displayName ? ` · ${d.athletesInvolved[0].displayName}` : ""}`,
    }));
  return {
    id: `espn:${league}:${e.id}`,
    league,
    leagueName: LEAGUE_NAME[league] || league,
    kickoff: new Date(e.date).toISOString(),
    status,
    minute: status === "live" ? e.status.displayClock : undefined,
    home: teamFrom(home.team.abbreviation, home.team.shortDisplayName || home.team.displayName, home.team.color, home.team.alternateColor),
    away: teamFrom(away.team.abbreviation, away.team.shortDisplayName || away.team.displayName, away.team.color, away.team.alternateColor),
    homeScore: status === "scheduled" ? undefined : Number(home.score ?? 0),
    awayScore: status === "scheduled" ? undefined : Number(away.score ?? 0),
    events,
  };
}

const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function scoreboard(league: string, yyyymmdd: string): Promise<EspnEvent[]> {
  return cached(`sb:${league}:${yyyymmdd}`, 60_000, async () => {
    try {
      const r = await fetch(`${ESPN}/${league}/scoreboard?dates=${yyyymmdd}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (!r.ok) return [];
      const j = (await r.json()) as { events?: EspnEvent[] };
      return j.events || [];
    } catch {
      return [];
    }
  });
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

/** Upcoming fixtures (next `days` days) across curated leagues, plus demo matches in test mode. */
export async function upcomingMatches(days = 6, includeDemo = true): Promise<Match[]> {
  const list = await cached(`upcoming:${days}`, 10 * 60_000, async () => {
    const dates = Array.from({ length: days }, (_, i) => ymd(new Date(Date.now() + i * 86400_000)));
    const jobs = LEAGUES.flatMap((l) => dates.map((d) => ({ l: l.slug, d })));
    const out: Match[] = [];
    // limited concurrency
    for (let i = 0; i < jobs.length; i += 24) {
      const chunk = await Promise.all(jobs.slice(i, i + 24).map(async (j) => (await scoreboard(j.l, j.d)).map((e) => fromEspn(e, j.l))));
      chunk.forEach((c) => out.push(...c));
    }
    const seen = new Set<string>();
    return out
      .filter((m) => m.status === "scheduled" && new Date(m.kickoff).getTime() > Date.now() + 10 * 60_000)
      .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
      .sort((a, b) => a.kickoff.localeCompare(b.kickoff))
      .slice(0, 60);
  });
  return includeDemo ? [...demoMatches(), ...list] : list;
}

/** Current state of one match (cached ~20s). */
export async function getMatch(id: string): Promise<Match | null> {
  if (id.startsWith("demo:")) return demoMatch(id);
  const [, league, eventId] = id.split(":");
  if (!league || !eventId) return null;
  return cached(`m:${id}`, 20_000, async () => {
    try {
      const r = await fetch(`${ESPN}/${league}/summary?event=${eventId}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (!r.ok) return null;
      const j = (await r.json()) as { header?: { competitions?: (EspnEvent["competitions"][0] & { date: string; status: EspnEvent["status"] })[] } };
      const comp = j.header?.competitions?.[0];
      if (!comp) return null;
      const ev: EspnEvent = { id: eventId, date: comp.date, status: comp.status, competitions: [comp] };
      const m = fromEspn(ev, league);
      // Summary doesn't always carry goal details; enrich from the scoreboard for that day.
      if (m.status !== "scheduled" && !(m.events && m.events.length)) {
        const sb = await scoreboard(league, ymd(new Date(m.kickoff)));
        const full = sb.find((x) => x.id === eventId);
        if (full) m.events = fromEspn(full, league).events;
      }
      return m;
    } catch {
      return null;
    }
  });
}

// ---------- demo matches (test mode) ----------
const DEMO_TEAMS: [Team, Team][] = [
  [teamFrom("ZFC", "ZEC FC", "F4B728", null), teamFrom("SHD", "Shield United", "7C5CFF", null)],
  [teamFrom("ORC", "Orchard City", "2EE6A6", null), teamFrom("IRW", "Ironwood", "FF4D9A", null)],
  [teamFrom("HAL", "Halo Rovers", "3DB8FF", null), teamFrom("SAP", "Sapling Town", "FF5A5A", null)],
];
const DEMO_SLOT_MIN = 8; // a new demo match kicks off every 8 minutes
const DEMO_MINUTE_SECONDS = 4; // 1 match minute = 4 real seconds (a match lasts ~6.5 min)

export function demoMatches(): Match[] {
  const slot = Math.floor(Date.now() / (DEMO_SLOT_MIN * 60_000));
  return [1, 2, 3].map((k) => demoMatch(`demo:${slot + k}`)!).filter(Boolean);
}

export function demoMatch(id: string): Match | null {
  const slot = Number(id.split(":")[1]);
  if (!Number.isFinite(slot)) return null;
  const kickoffMs = slot * DEMO_SLOT_MIN * 60_000;
  const [home, away] = DEMO_TEAMS[slot % DEMO_TEAMS.length];
  const rnd = prng(hashSeed(id));
  const goals: { min: number; side: "home" | "away" }[] = [];
  const n = Math.floor(rnd() * 5); // 0–4 goals
  for (let i = 0; i < n; i++) goals.push({ min: 3 + Math.floor(rnd() * 86), side: rnd() < 0.5 ? "home" : "away" });
  goals.sort((a, b) => a.min - b.min);

  const elapsedMin = (Date.now() - kickoffMs) / 1000 / DEMO_MINUTE_SECONDS;
  let status: MatchStatus = "scheduled";
  if (elapsedMin >= 0) status = elapsedMin >= 95 ? "final" : "live";
  const shown = status === "final" ? goals : goals.filter((g) => g.min <= elapsedMin);
  const minute = status === "live" ? `${Math.min(90, Math.max(1, Math.floor(elapsedMin)))}'` : undefined;
  return {
    id,
    league: "demo",
    leagueName: "ZECKED Test League",
    kickoff: new Date(kickoffMs).toISOString(),
    status,
    minute,
    home,
    away,
    homeScore: status === "scheduled" ? undefined : shown.filter((g) => g.side === "home").length,
    awayScore: status === "scheduled" ? undefined : shown.filter((g) => g.side === "away").length,
    events: shown.map((g) => ({ minute: `${g.min}'`, side: g.side, text: "Goal" })),
    demo: true,
  };
}
