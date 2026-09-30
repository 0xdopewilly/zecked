"use client";
// Typed client for the ZECKED API. All screens talk to the server through this file.
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";
import type {
  AppConfig,
  Notice,
  AuthStartResult,
  WalletInfo,
  ClaimResult,
  GuessResult,
  Leaderboard,
  Match,
  MyCall,
  Player,
  PredictionKind,
  PublicStash,
  RunnerCall,
  TickerItem,
  WinPayload,
  WinnerPick,
} from "./types";

export type SignedIn = { player: Player; creditedZat: number; isNew?: boolean };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { error?: string }).error || `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export type FeedFilter = "all" | "riddles" | "predictions" | "ending" | "biggest";

export const api = {
  config: () => req<AppConfig>("/config"),
  feed: (filter: FeedFilter = "all") => req<{ stashes: PublicStash[]; house?: { nextDropAt: string | null; liveId: string | null } | null }>(`/stashes?filter=${filter}`),
  stash: (id: string) => req<{ stash: PublicStash; myCall?: MyCall; runners?: RunnerCall[]; myTries?: { left: number; resetsAt?: string }; win?: WinPayload }>(`/stashes/${id}`),
  guess: (id: string, answer: string) =>
    req<GuessResult>(`/stashes/${id}/guess`, { method: "POST", body: JSON.stringify({ answer }) }),
  call: (id: string, body: { home?: number; away?: number; pick?: WinnerPick }) =>
    req<{ myCall: MyCall; calls: number }>(`/stashes/${id}/call`, { method: "POST", body: JSON.stringify(body) }),
  create: (body: {
    type: "riddle" | "prediction";
    riddle?: { text: string; answer: string; hint?: string };
    prediction?: { matchId: string; kind: PredictionKind };
    usd: number;
    expiryHours: number;
    refundAddress?: string;
  }) => req<{ stash: PublicStash }>("/stashes", { method: "POST", body: JSON.stringify(body) }),
  checkFunding: (id: string) =>
    req<{ stash: PublicStash; fundedZat: number }>(`/stashes/${id}/fund-check`, { method: "POST" }),
  /** Test mode only: pretend the hider paid. */
  simulateFund: (id: string) =>
    req<{ stash: PublicStash }>(`/stashes/${id}/simulate-fund`, { method: "POST" }),
  claim: (id: string, body: { claimToken: string; address: string; message?: string }) =>
    req<ClaimResult>(`/stashes/${id}/claim`, { method: "POST", body: JSON.stringify(body) }),
  setRefundAddress: (id: string, address: string) =>
    req<{ ok: true }>(`/stashes/${id}/refund-address`, { method: "PATCH", body: JSON.stringify({ address }) }),
  matches: () => req<{ matches: Match[] }>("/matches"),
  me: () => req<{ player: Player }>("/me"),
  setHandle: (handle: string) =>
    req<{ player: Player }>("/me", { method: "PATCH", body: JSON.stringify({ handle }) }),
  myStashes: () => req<{ stashes: PublicStash[] }>("/me/stashes"),
  leaderboard: (board: Leaderboard["board"], period: Leaderboard["period"]) =>
    req<Leaderboard>(`/leaderboard?board=${board}&period=${period}`),
  ticker: () => req<{ items: TickerItem[] }>("/ticker"),

  // ---- accounts (email code sign-in) ----
  authStart: (email: string) => req<AuthStartResult>("/auth/email/start", { method: "POST", body: JSON.stringify({ email }) }),
  authVerify: (email: string, code: string) =>
    req<SignedIn>("/auth/email/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
  logout: () => req<{ ok: true }>("/auth/logout", { method: "POST" }),
  notifications: (after?: string) => req<{ items: Notice[]; now: string }>(`/notifications${after ? `?after=${encodeURIComponent(after)}` : ""}`),
  passkeyRegisterOptions: () => req<PublicKeyCredentialCreationOptionsJSON>("/auth/passkey/register/options", { method: "POST" }),
  passkeyRegisterVerify: (response: RegistrationResponseJSON) =>
    req<SignedIn>("/auth/passkey/register/verify", { method: "POST", body: JSON.stringify({ response }) }),
  passkeyLoginOptions: () => req<PublicKeyCredentialRequestOptionsJSON>("/auth/passkey/login/options", { method: "POST" }),
  passkeyLoginVerify: (response: AuthenticationResponseJSON) =>
    req<SignedIn>("/auth/passkey/login/verify", { method: "POST", body: JSON.stringify({ response }) }),
  /** Full-page hop to Google (and back to /signin). */
  googleUrl: (next: string) => `/api/auth/google/start?next=${encodeURIComponent(next)}`,

  // ---- in-app wallet ----
  wallet: () => req<WalletInfo>("/wallet"),
  withdraw: (address: string, amountZat: number) =>
    req<{ txid: string; amountZat: number; feeZat: number; to: string; wallet: WalletInfo }>("/wallet/withdraw", {
      method: "POST",
      body: JSON.stringify({ address, amountZat }),
    }),
  /** Test mode (sim) only: pretend ZEC arrived at your deposit address. */
  simulateDeposit: (amountZat?: number) =>
    req<WalletInfo>("/wallet/simulate-deposit", { method: "POST", body: JSON.stringify({ amountZat }) }),
  /** Fund an awaiting stash straight from your ZECKED balance (instant, no QR). */
  victory: (id: string, message: string) =>
    req<{ ok: true }>(`/stashes/${id}/victory`, { method: "POST", body: JSON.stringify({ message }) }),
  fundFromBalance: (id: string) => req<{ stash: PublicStash; wallet: WalletInfo }>(`/stashes/${id}/fund-from-balance`, { method: "POST" }),
};

export function formatZec(zat: number, decimals = 4): string {
  const zec = zat / 100_000_000;
  const s = zec.toFixed(decimals);
  // trim to at most `decimals`, keep at least 2
  return s.replace(/(\.\d{2}\d*?)0+$/, "$1");
}

export function formatUsd(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(usd < 10 ? 2 : 0)}`;
}
