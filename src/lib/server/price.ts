// ZEC/USD rate with a short cache. Falls back to the last known or a sane default.
let cache: { usd: number; at: number } | null = null;
const FALLBACK = Number(process.env.ZEC_USD_FALLBACK || 1500);

export async function zecUsd(): Promise<number> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.usd;
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd", {
      signal: AbortSignal.timeout(3500),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const j = (await r.json()) as { zcash?: { usd?: number } };
    const usd = Number(j?.zcash?.usd);
    if (usd > 0) {
      cache = { usd, at: Date.now() };
      return usd;
    }
  } catch {
    /* fall through */
  }
  return cache?.usd ?? FALLBACK;
}
