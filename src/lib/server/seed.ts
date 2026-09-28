// Test-mode seed: a lively feed on first boot (sim network only).
import { networkName } from "@/lib/zcash/engine";
import { kv } from "./kv";
import { bumpBoard, getPlayer, savePlayer, type PlayerRecord } from "./players";
import { createStash, checkFunding, simulateFund, makeCall, loadStash } from "./game";
import { upcomingMatches, demoMatches } from "./sports";
import { nowIso } from "./util";

const HIDERS = [
  { id: "seed_satoshisghost", handle: "@satoshisghost", xp: 1240, hidden: 6 },
  { id: "seed_zwhale", handle: "@zwhale", xp: 2710, hidden: 14 },
  { id: "seed_goalhanger", handle: "@goalhanger", xp: 640, hidden: 3 },
  { id: "seed_riddlr", handle: "@riddlr", xp: 1580, hidden: 9 },
  { id: "seed_quietfox", handle: "@quietfox", xp: 4120, hidden: 21 },
];
const CALLERS = ["@m0nk", "@kaboom", "@shieldmaiden", "@ghostkey", "@nullpointer", "@nightjar", "@zkat", "@cipherella", "@orchardboi", "@halo_kid", "@sapling", "@lowkeyzec"];

async function mkPlayer(id: string, handle: string, xp = 0, hidden = 0): Promise<PlayerRecord> {
  const existing = await getPlayer(id);
  if (existing) return existing;
  const p: PlayerRecord = {
    id,
    handle,
    createdAt: nowIso(),
    xp,
    stats: { cracked: Math.floor(xp / 110), hidden, uncrackable: Math.floor(hidden / 4), oracle: Math.floor(xp / 1500), streak: 1 + (xp % 7) },
    badges: xp > 1000 ? ["first-crack", "uncrackable"] : ["first-crack"],
    pendingClaims: [],
    shielded: true,
  };
  await savePlayer(p);
  await kv().set(`handle:${handle.toLowerCase()}`, id);
  return p;
}

export async function ensureSeeded() {
  if (networkName() !== "sim" || process.env.ZECKED_SEED === "off") return;
  if (!(await kv().set("seeded:v1", nowIso(), { nx: true }))) return;
  try {
    const hiders = await Promise.all(HIDERS.map((h) => mkPlayer(h.id, h.handle, h.xp, h.hidden)));
    const callers = await Promise.all(CALLERS.map((h, i) => mkPlayer(`seed_c${i}`, h, 200 + i * 173)));
    const [ghost, whale, goal, riddlr, fox] = hiders;

    const riddles: [PlayerRecord, string, string, number, number, string?][] = [
      [ghost, "I have cities, but no houses. Forests, but no trees. Water, but no fish. What am I?", "a map", 30, 24, "You'd fold me to put me away."],
      [whale, "The more you take, the more you leave behind. What am I?", "footsteps|footprints", 80, 72],
      [riddlr, "I have keys but open no locks. I have space but no room. You can enter, but you can't go outside. What am I?", "a keyboard", 10, 24],
      [fox, "Born in October 2016, I turn ten this month. I hide what you send, but show what you choose. What am I?", "zcash|zec", 20, 168, "Starts with Z. Obviously."],
    ];
    for (const [p, text, answer, usd, hrs, hint] of riddles) {
      const s = await createStash(p, { type: "riddle", riddle: { text, answer, hint }, usd, expiryHours: hrs }, { seeded: true });
      await simulateFund(s, p);
    }

    // Predictions: one quick demo match (plays out in minutes) + real upcoming fixtures.
    const demo = demoMatches().find((m) => Date.parse(m.kickoff) > Date.now() + 90_000);
    const BIG = new Set(["GER", "ENG", "ESP", "FRA", "POR", "BRA", "ARG", "ITA", "NED", "BEL", "CRO", "USA", "MEX", "JPN", "BAR", "RMA", "MCI", "LIV", "ARS", "CHE", "MUN", "PSG", "BAY", "JUV", "INT", "MIL", "ATM", "DOR", "TOT", "NEW", "DEN", "SRB", "SUI", "AUT", "TUR", "COL", "URU"]);
    const all = await upcomingMatches(6, false);
    const score = (m: (typeof all)[number]) => Number(BIG.has(m.home.code)) + Number(BIG.has(m.away.code));
    const real = [...all].sort((x, y) => score(y) - score(x) || x.kickoff.localeCompare(y.kickoff)).slice(0, 3);
    const preds: { p: PlayerRecord; matchId: string; kind: "exact" | "winner"; usd: number }[] = [];
    if (demo) preds.push({ p: goal, matchId: demo.id, kind: "exact", usd: 15 });
    if (real[0]) preds.push({ p: goal, matchId: real[0].id, kind: "exact", usd: 20 });
    if (real[1]) preds.push({ p: whale, matchId: real[1].id, kind: "winner", usd: 60 });
    if (real[2]) preds.push({ p: fox, matchId: real[2].id, kind: "exact", usd: 25 });
    for (const pr of preds) {
      try {
        const s = await createStash(pr.p, { type: "prediction", prediction: { matchId: pr.matchId, kind: pr.kind }, usd: pr.usd }, { seeded: true });
        await simulateFund(s, pr.p);
        await checkFunding(s);
        const n = 3 + Math.floor(Math.random() * 9);
        for (let i = 0; i < n; i++) {
          const c = callers[(i * 5 + pr.usd) % callers.length];
          const body = pr.kind === "exact" ? { home: Math.floor(Math.random() * 4), away: Math.floor(Math.random() * 3) } : { pick: (["home", "draw", "away"] as const)[i % 3] };
          await makeCall(await loadStash(s.id), c, body).catch(() => undefined);
        }
      } catch (e) {
        console.warn("seed prediction skipped", pr.matchId, (e as Error).message);
      }
    }

    // Leaderboard + ticker flavour.
    for (const [i, p] of [...hiders, ...callers].entries()) {
      await bumpBoard("crackers", p.id, Math.max(1, 45 - i * 3));
      await bumpBoard("hiders", p.id, Math.max(1, (p.stats.hidden || 1)));
      await bumpBoard("oracles", p.id, Math.max(0, 9 - i));
    }
    const lines = [
      "@nightjar just ZECKED 0.02 ZEC",
      "@goalhanger just hid 0.0134 ZEC on a match ⚽",
      "@zkat just ZECKED 0.0067 ZEC",
      "@zwhale just hid 0.0533 ZEC behind a riddle 🔐",
      "@shieldmaiden just ZECKED 0.013 ZEC",
    ];
    for (const [i, text] of lines.entries()) {
      await kv().lpushTrim("ticker", { id: `seed${i}`, text, at: new Date(Date.now() - (lines.length - i) * 90_000).toISOString(), kind: i % 2 ? "hidden" : "zecked" }, 30);
    }
  } catch (e) {
    console.error("seed failed", e);
    await kv().del("seeded:v1");
  }
}
