import { createHash, randomBytes } from "node:crypto";
import { customAlphabet } from "nanoid";

export const newId = customAlphabet("23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", 6);
export const newToken = () => randomBytes(18).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const nowIso = () => new Date().toISOString();

/** Riddle answer normalization: trim, lowercase, strip punctuation, collapse spaces, drop a leading a/an/the. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the) /, "");
}

export function hashAnswer(answer: string, salt: string) {
  return sha256(`${salt}:${normalizeAnswer(answer)}`);
}

export function isShieldedAddress(a: string) {
  return /^(u1|utest1|zs1|ztestsapling1)[0-9a-z]{20,}$/i.test(a.trim());
}
export function isTransparentAddress(a: string) {
  return /^(t1|t3|tm|t2|tex1|textest1)[0-9A-Za-z]{20,}$/.test(a.trim());
}
export function isValidAddress(a: string) {
  return isShieldedAddress(a) || isTransparentAddress(a);
}
export function shortAddr(a: string) {
  return a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Deterministic PRNG (mulberry32) for demo matches and seeds. */
export function prng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
