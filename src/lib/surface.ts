// Which surface this deployment serves:
//  - "site": the marketing website, https://zecked.com (was zecked.vercel.app)
//  - "app":  the game on the Zcash testnet, https://app.zecked.com (was zecked-testnet.vercel.app)
export type Surface = "site" | "app";

export function surface(): Surface {
  return process.env.ZECKED_SURFACE === "site" ? "site" : "app";
}

export function appUrl() {
  return (process.env.ZECKED_APP_URL || "https://app.zecked.com").replace(/\/$/, "");
}

/** The old vercel.app addresses and where each now lives. Page loads there move to the new address once
 *  ZECKED_CANONICAL=on (set it after the domain is live). API calls are left alone, so a copy of the app
 *  installed from the old address keeps working. */
export const LEGACY_HOSTS: Record<string, string> = {
  "zecked.vercel.app": "https://zecked.com",
  "zecked-testnet.vercel.app": "https://app.zecked.com",
};
export function legacyTarget(host: string | null): string | null {
  if (process.env.ZECKED_CANONICAL !== "on" || !host) return null;
  return LEGACY_HOSTS[host.split(":")[0].toLowerCase()] ?? null;
}

/** When set, this deployment only forwards every request to that origin (the retired zecked-demo project uses it). */
export function redirectOrigin() {
  return process.env.ZECKED_REDIRECT_TO?.replace(/\/$/, "") || null;
}

/** App routes that must not be served by the website (they redirect to the app, keeping old links alive). */
export const APP_ROUTE_PREFIXES = ["/feed", "/hide", "/s/", "/me", "/wallet", "/leaderboard", "/signin", "/how", "/practice", "/u/", "/sounds", "/install", "/i/"];
