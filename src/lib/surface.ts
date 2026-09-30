// Which surface this deployment serves:
//  - "site": the marketing website (zecked.vercel.app → zecked.com)
//  - "app":  the game on the Zcash testnet (zecked-testnet.vercel.app → app.zecked.com)
export type Surface = "site" | "app";

export function surface(): Surface {
  return process.env.ZECKED_SURFACE === "site" ? "site" : "app";
}

export function appUrl() {
  return (process.env.ZECKED_APP_URL || "https://zecked-testnet.vercel.app").replace(/\/$/, "");
}

/** When set, this deployment only forwards every request to that origin (the retired zecked-demo project uses it). */
export function redirectOrigin() {
  return process.env.ZECKED_REDIRECT_TO?.replace(/\/$/, "") || null;
}

/** App routes that must not be served by the website (they redirect to the app, keeping old links alive). */
export const APP_ROUTE_PREFIXES = ["/feed", "/hide", "/s/", "/me", "/wallet", "/leaderboard", "/signin", "/how"];
