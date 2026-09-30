"use client";
// Opening a stash feels instant:
//  - the feed quietly warms its top live cards with a "peek" read (doesn't count as viewing them);
//  - a card starts fetching for real on touch, before the tap even lands;
//  - the stash screen picks up whichever is freshest instead of starting from zero.
import { api } from "@/lib/api";

type Detail = Awaited<ReturnType<typeof api.stash>>;
const TAP_TTL_MS = 8_000;
const PEEK_TTL_MS = 20_000;
type Read = { at: number; p: Promise<Detail>; value?: Detail };
const taps = new Map<string, Read>();
const peeks = new Map<string, Read>();

/** Keeps the result on the entry once it lands, so the stash screen can draw it on its first frame. */
function track(map: Map<string, Read>, id: string, p: Promise<Detail>) {
  const r: Read = { at: Date.now(), p };
  p.then((v) => (r.value = v)).catch(() => map.get(id) === r && map.delete(id));
  map.set(id, r);
}

/** On touch/hover of a card: the real read (counts as a view, since they're opening it). */
export function prefetchStash(id: string) {
  const hit = taps.get(id);
  if (hit && Date.now() - hit.at < TAP_TTL_MS) return;
  // Already warmed by the feed: open from that (takeStash registers the view), no new request.
  const peek = peeks.get(id);
  if (peek && Date.now() - peek.at < PEEK_TTL_MS) return;
  track(taps, id, api.stash(id));
}

/** Background warm-up from the feed. */
export function warmStash(id: string) {
  const hit = peeks.get(id);
  if (hit && Date.now() - hit.at < PEEK_TTL_MS) return;
  track(peeks, id, api.stash(id, true));
}

/** A read that has already arrived (fresh enough), for drawing the stash straight away; else null. */
export function readyStash(id: string): Detail | null {
  const now = Date.now();
  const tap = taps.get(id);
  if (tap?.value && now - tap.at < TAP_TTL_MS) return tap.value;
  const peek = peeks.get(id);
  if (peek?.value && now - peek.at < PEEK_TTL_MS) return peek.value;
  return null;
}

/** The freshest usable read for the stash screen, or a new one. */
export function takeStash(id: string): Promise<Detail> {
  const tap = taps.get(id);
  taps.delete(id);
  if (tap && Date.now() - tap.at < TAP_TTL_MS) return tap.p;
  const peek = peeks.get(id);
  peeks.delete(id);
  if (peek && Date.now() - peek.at < PEEK_TTL_MS) {
    // Shown straight away; this read also registers the view the peek skipped.
    void api.stash(id).catch(() => {});
    return peek.p;
  }
  return api.stash(id);
}
