"use client";
// Opening a stash feels instant: the card starts fetching it on touch (before the tap even lands), and
// the stash screen picks that request up instead of starting from zero.
import { api } from "@/lib/api";

type Detail = Awaited<ReturnType<typeof api.stash>>;
const TTL_MS = 8_000;
const cache = new Map<string, { at: number; p: Promise<Detail> }>();

export function prefetchStash(id: string) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return;
  const p = api.stash(id);
  p.catch(() => cache.delete(id));
  cache.set(id, { at: Date.now(), p });
}

/** A fresh in-flight/finished fetch for this stash, or a new one. */
export function takeStash(id: string): Promise<Detail> {
  const hit = cache.get(id);
  cache.delete(id);
  return hit && Date.now() - hit.at < TTL_MS ? hit.p : api.stash(id);
}
