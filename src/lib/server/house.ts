// The ZECKED house account (@zecked). Its balance is test ZEC the owner tops up from a faucet (send it
// to the house wallet address, see /api/admin/house). It pays for:
//  - a welcome gift for every new account, so first-timers can hide a stash straight away;
//  - house drops: a fresh riddle from the bank every few hours, so the feed is never empty.
// Sim mode (local dev) has its own seed and bonus, so none of this runs there.
import { networkName } from "@/lib/zcash/engine";
import { createStash, fundFromBalance, loadStash, type StashRecord } from "./game";
import { kv } from "./kv";
import { claimHandle, getPlayer, savePlayer, type PlayerRecord } from "./players";
import { zecUsd } from "./price";
import { nowIso } from "./util";
import { balanceOf, credit, debit, syncDeposits, walletInfo } from "./wallet";

export const HOUSE_ID = "house";
/** Off in sim mode (it has its own seed and bonus) unless ZECKED_HOUSE=on, for local testing. */
const houseOn = () => networkName() !== "sim" || process.env.ZECKED_HOUSE === "on";
const GIFT_USD = Number(process.env.ZECKED_GIFT_USD || 2);
const GIFTS_PER_IP_PER_DAY = 3;
const DROP_EVERY_MS = Number(process.env.ZECKED_DROP_HOURS || 3) * 3600_000;
const DROP_USD = [1, 2, 2, 3];

/** Classic riddles with forgiving answers ("|" separates accepted alternatives).
 *  Never reuse the practice riddles' answers here (vault, tree/bark, mushroom, sponge, glove, library):
 *  /practice reveals its answers, so a house stash with one of them would be free money. */
const BANK: { text: string; answer: string; hint?: string }[] = [
  { text: "I have cities, but no houses. Forests, but no trees. Water, but no fish. What am I?", answer: "a map|map", hint: "You'd fold me to put me away." },
  { text: "The more you take, the more you leave behind. What am I?", answer: "footsteps|footprints|steps", hint: "Look down while you walk." },
  { text: "I speak without a mouth and hear without ears. I have no body, but I come alive with the wind. What am I?", answer: "an echo|echo", hint: "Shout into a canyon." },
  { text: "What has keys but can't open a single lock?", answer: "a piano|piano|keyboard|a keyboard", hint: "It makes music." },
  { text: "I'm tall when I'm young and short when I'm old. What am I?", answer: "a candle|candle", hint: "Light me up." },
  { text: "What has to be broken before you can use it?", answer: "an egg|egg", hint: "Breakfast." },
  { text: "What gets wetter the more it dries?", answer: "a towel|towel", hint: "Bathroom." },
  { text: "What has a neck but no head?", answer: "a bottle|bottle", hint: "You pour from it." },
  { text: "What can travel around the world while staying in a corner?", answer: "a stamp|stamp|postage stamp", hint: "Envelopes." },
  { text: "What has hands but can't clap?", answer: "a clock|clock|watch|a watch", hint: "Tick tock." },
  { text: "The more of me there is, the less you see. What am I?", answer: "darkness|the dark|dark", hint: "Turn the lights off." },
  { text: "What has one eye but can't see?", answer: "a needle|needle", hint: "Sewing." },
  { text: "What goes up but never comes down?", answer: "age|your age", hint: "Birthdays." },
  { text: "I have branches, but no fruit, trunk or leaves. What am I?", answer: "a bank|bank", hint: "It holds money." },
  { text: "What belongs to you, but other people use it more than you do?", answer: "your name|name|my name", hint: "People call you by it." },
  { text: "What runs, but never walks, has a mouth but never talks?", answer: "a river|river", hint: "It flows to the sea." },
  { text: "What can you catch, but not throw?", answer: "a cold|cold", hint: "Achoo." },
  { text: "What has many teeth, but can't bite?", answer: "a comb|comb|a zipper|zipper", hint: "Hair." },
  { text: "I'm light as a feather, yet the strongest person can't hold me for five minutes. What am I?", answer: "breath|your breath|a breath", hint: "Inhale." },
  { text: "What comes once in a minute, twice in a moment, but never in a thousand years?", answer: "the letter m|m|letter m", hint: "Spell it out." },
  { text: "Born in October 2016, I hide what you send but show what you choose. What am I?", answer: "zcash|zec", hint: "Starts with Z. Obviously." },
  { text: "I'm a key that opens nothing, but I let you look inside a Zcash wallet without touching it. What am I?", answer: "a viewing key|viewing key", hint: "Look, don't touch." },
  { text: "What has words, but never speaks?", answer: "a book|book", hint: "Libraries are full of them." },
  { text: "What can fill a room but takes up no space?", answer: "light|air", hint: "Flip a switch." },
  { text: "If you drop me I'm sure to crack, but give me a smile and I'll always smile back. What am I?", answer: "a mirror|mirror", hint: "Look at yourself." },
];

let houseCache: PlayerRecord | null = null;

/** The house player, created on first use (@zecked). */
export async function housePlayer(): Promise<PlayerRecord> {
  if (houseCache) return houseCache;
  let p = await getPlayer(HOUSE_ID);
  if (!p) {
    const handle = (await claimHandle("@zecked", HOUSE_ID)) ? "@zecked" : "@zeckedhouse";
    if (handle === "@zeckedhouse") await claimHandle(handle, HOUSE_ID);
    p = {
      id: HOUSE_ID,
      handle,
      createdAt: nowIso(),
      xp: 0,
      stats: { cracked: 0, hidden: 0, uncrackable: 0, oracle: 0, streak: 0 },
      badges: [],
      pendingClaims: [],
      shielded: false,
      house: true,
      verifiedAt: nowIso(),
    };
    await savePlayer(p);
  }
  houseCache = p;
  return p;
}

async function refreshHouse() {
  const house = await housePlayer();
  // Pull in any faucet top-ups (throttled).
  if (await kv().set("house:sync", 1, { nx: true, exSeconds: 60 })) await syncDeposits(house).catch(() => 0);
  return house;
}

const zatFor = async (usd: number) => Math.max(10_000, Math.round(((usd / (await zecUsd())) * 1e8) / 10_000) * 10_000);

/** A small welcome gift for a brand-new account (once per account, capped per network address per day). */
export async function welcomeGift(p: PlayerRecord, ip: string): Promise<number> {
  if (!houseOn() || p.house) return 0;
  if (!(await kv().set(`gift:${p.id}`, nowIso(), { nx: true }))) return 0;
  const day = new Date().toISOString().slice(0, 10);
  if ((await kv().incr(`gift:ip:${ip}:${day}`)) > GIFTS_PER_IP_PER_DAY) return 0;
  await kv().set(`gift:ip:${ip}:${day}`, (await kv().get<number>(`gift:ip:${ip}:${day}`)) || 1, { exSeconds: 2 * 86400 });
  await refreshHouse();
  const zat = await zatFor(GIFT_USD);
  try {
    await debit(HOUSE_ID, zat, "bonus", `Welcome gift → ${p.handle}`);
  } catch {
    return 0; // the house is out of test ZEC; the owner tops it up
  }
  await credit(p.id, zat, "bonus", "Welcome gift from ZECKED 🎁");
  return zat;
}

type DropState = { lastId?: string; nextAt?: number };

/** When the next house drop is due, for the feed ("Next drop in 1:24:09"). null = one is live now or the house is empty. */
export async function houseStatus(): Promise<{ nextDropAt: string | null; liveId: string | null }> {
  if (!houseOn()) return { nextDropAt: null, liveId: null };
  const st = (await kv().get<DropState>("house:drop")) || {};
  const last = st.lastId ? await loadStash(st.lastId).catch(() => null) : null;
  const live = last && (last.status === "live" || last.status === "awaiting_funding") ? last.id : null;
  const canPay = (await balanceOf(HOUSE_ID)) >= (await zatFor(Math.min(...DROP_USD)));
  return { nextDropAt: live || !canPay ? null : new Date(Math.max(Date.now(), st.nextAt || 0)).toISOString(), liveId: live };
}

/** Called from feed reads: hides the next house riddle when one is due. Cheap and safe to call often. */
export async function maybeHouseDrop(force = false): Promise<StashRecord | null> {
  if (!houseOn()) return null;
  if (!force && !(await kv().set("house:check", 1, { nx: true, exSeconds: 90 }))) return null;
  if (!(await kv().set("house:droplock", 1, { nx: true, exSeconds: 60 }))) return null;
  try {
    const st = (await kv().get<DropState>("house:drop")) || {};
    if (st.lastId) {
      const last = await loadStash(st.lastId).catch(() => null);
      if (last && (last.status === "live" || last.status === "awaiting_funding")) return null; // one at a time
    }
    if (!force && Date.now() < (st.nextAt || 0)) return null;
    const house = await refreshHouse();
    const usd = DROP_USD[Math.floor(Math.random() * DROP_USD.length)];
    if ((await balanceOf(HOUSE_ID)) < (await zatFor(usd))) return null;
    const idx = ((await kv().incr("house:bank")) - 1) % BANK.length;
    const r = BANK[idx];
    const s = await createStash(house, { type: "riddle", riddle: r, usd, expiryHours: 24 });
    await fundFromBalance(s, house);
    await kv().set("house:drop", { lastId: s.id, nextAt: Date.now() + DROP_EVERY_MS } satisfies DropState);
    return s;
  } finally {
    await kv().del("house:droplock");
  }
}

/** Owner view: balance and the address to top the house up from a faucet. */
export async function houseAdmin() {
  const house = await refreshHouse();
  const w = await walletInfo(house);
  return { handle: house.handle, balanceZat: await balanceOf(HOUSE_ID), wallet: w, status: await houseStatus() };
}

/** Local sim testing only: put play ZEC in the house. */
export async function houseTopUpSim(amountZat: number) {
  if (networkName() !== "sim") throw new Error("sim only");
  await housePlayer();
  await credit(HOUSE_ID, amountZat, "deposit", "Sim top-up");
  return balanceOf(HOUSE_ID);
}
