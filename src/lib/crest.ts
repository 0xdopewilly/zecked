// Team crests and flags from ESPN's logo CDN, resized by ESPN's image combiner (a 128px crest is ~6KB).
// Shared by the server (live fixtures) and the client (badges, website mock cards).

const HOST = "https://a.espncdn.com";
const LOGO_PATH = /^\/i\/teamlogos\/(?:soccer|countries)\/500\/[\w.-]+\.png$/;

/** Combiner URL for an ESPN team-logo path such as `/i/teamlogos/soccer/500/83.png`. */
export function crestFromPath(path: string, px = 128): string | undefined {
  return LOGO_PATH.test(path) ? `${HOST}/combiner/i?img=${path}&w=${px}&h=${px}` : undefined;
}

/** Normalises a raw ESPN logo URL; anything that isn't an ESPN team logo is dropped. */
export function crestUrl(raw?: string | null): string | undefined {
  if (!raw?.startsWith(HOST)) return undefined;
  return crestFromPath(raw.slice(HOST.length));
}

/** A club crest by ESPN team id (Barcelona 83, Chelsea 363, Real Madrid 86…). */
export const clubCrest = (espnId: number) => crestFromPath(`/i/teamlogos/soccer/500/${espnId}.png`)!;

/** The same crest at another pixel size (combiner URLs only; others pass through). */
export function crestSized(url: string, px: number): string {
  return url.replace(/&w=\d+&h=\d+$/, `&w=${px}&h=${px}`);
}

/** Barcelona, the team the demo stickers ("BAR 2–1?") and the website's demo match use. */
export const DEMO_BARCELONA = { code: "BAR", name: "Barcelona", color: "#A50044", ink: "#fff", logo: clubCrest(83) };
