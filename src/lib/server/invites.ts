// Invite links: every account gets app.zecked.com/i/<code>. The proxy remembers the code in a cookie
// (zk_ref) when a friend arrives through it. When that friend signs up AND plays (a riddle guess or a
// match call), the inviter gets a small reward from the house, so players bring players. Rewards are
// capped per inviter, per day and in total, and paid once per friend.
import { randomInt } from "node:crypto";
import { appUrl } from "@/lib/surface";
import { houseReward } from "./house";
import { kv } from "./kv";
import { notify } from "./notify";
import { avatarUrl, getPlayer, isAccount, patchPlayer, type PlayerRecord } from "./players";
import { nowIso } from "./util";

export const INVITE_COOKIE = "zk_ref";
export const INVITE_CODE_RE = /^[a-z2-9]{6,12}$/;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i
const REWARD_USD = Number(process.env.ZECKED_INVITE_USD || 1);
const MAX_PER_DAY = 10;
const MAX_TOTAL = 50;

const K = {
  code: (c: string) => `invite:${c}`,
  ref: (pid: string) => `invite:ref:${pid}`, // invitee → inviter
  paid: (pid: string) => `invite:paid:${pid}`, // invitee rewarded already
  joined: (pid: string) => `invite:joined:${pid}`,
  rewarded: (pid: string) => `invite:rewarded:${pid}`,
  earned: (pid: string) => `invite:earned:${pid}`,
  day: (pid: string, d: string) => `invite:day:${pid}:${d}`,
};

function newCode() {
  let c = "";
  for (let i = 0; i < 7; i++) c += ALPHABET[randomInt(ALPHABET.length)];
  return c;
}

/** The account's invite code, created on first ask. */
export async function inviteCodeFor(p: PlayerRecord): Promise<string | null> {
  if (!isAccount(p) || p.house) return null;
  if (p.inviteCode) return p.inviteCode;
  for (let i = 0; i < 5; i++) {
    const c = newCode();
    if (await kv().set(K.code(c), p.id, { nx: true })) {
      await patchPlayer(p, (x) => void (x.inviteCode = x.inviteCode || c));
      return p.inviteCode || c;
    }
  }
  return null;
}

export async function myInvite(p: PlayerRecord) {
  const code = await inviteCodeFor(p);
  if (!code) return { code: null, url: null, joined: 0, rewarded: 0, earnedZat: 0, rewardUsd: REWARD_USD };
  const [joined, rewarded, earned] = await Promise.all([kv().get<number>(K.joined(p.id)), kv().get<number>(K.rewarded(p.id)), kv().get<number>(K.earned(p.id))]);
  return { code, url: `${appUrl()}/i/${code}`, joined: joined || 0, rewarded: rewarded || 0, earnedZat: earned || 0, rewardUsd: REWARD_USD };
}

/** Who invited you, for the "@x invited you" welcome. Handles only, never ids. */
export async function inviter(code: string) {
  if (!INVITE_CODE_RE.test(code)) return null;
  const pid = await kv().get<string>(K.code(code));
  const p = pid ? await getPlayer(pid) : null;
  return p ? { handle: p.handle, avatarUrl: avatarUrl(p) } : null;
}

/** A brand-new account that arrived through an invite link: remember who invited them. */
export async function linkInvite(account: PlayerRecord, code: string | undefined) {
  if (!code || !INVITE_CODE_RE.test(code) || account.house) return;
  const from = await kv().get<string>(K.code(code));
  if (!from || from === account.id) return;
  if (!(await kv().set(K.ref(account.id), from, { nx: true }))) return;
  await kv().incr(K.joined(from));
  if (account.lastPlayedDay) await rewardInvite(account); // played as a guest before signing up
  else await notify(from, { kind: "invite", text: `${account.handle} joined with your invite. When they play their first riddle, you get +$${REWARD_USD} of test ZEC.` });
}

/** After a play: if this account was invited and hasn't earned their inviter a reward yet, pay it. */
export async function rewardInvite(p: PlayerRecord) {
  if (!isAccount(p)) return;
  const from = await kv().get<string>(K.ref(p.id));
  if (!from) return;
  if (!(await kv().set(K.paid(p.id), nowIso(), { nx: true }))) return;
  const day = new Date().toISOString().slice(0, 10);
  const today = await kv().incr(K.day(from, day));
  if (today === 1) await kv().set(K.day(from, day), 1, { exSeconds: 2 * 86400 });
  const total = await kv().incr(K.rewarded(from));
  if (today > MAX_PER_DAY || total > MAX_TOTAL) return;
  const zat = await houseReward(from, REWARD_USD, `Invite reward: ${p.handle} played 🎉`, `Invite reward → ${p.handle}'s inviter`);
  if (!zat) return;
  await kv().incr(K.earned(from), zat);
  await notify(from, { kind: "invite", text: `${p.handle} played their first riddle. +$${REWARD_USD} of test ZEC for the invite 🎁`, amountZat: zat });
}
