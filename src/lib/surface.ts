// Which surface this deployment serves:
//  - "site": the marketing website (zecked.vercel.app → zecked.com)
//  - "app":  the game (zecked-testnet.vercel.app → app.zecked.com, zecked-demo.vercel.app → demo.zecked.com)
export type Surface = "site" | "app";

export function surface(): Surface {
  return process.env.ZECKED_SURFACE === "site" ? "site" : "app";
}

export function appUrl() {
  return (process.env.ZECKED_APP_URL || "https://zecked-testnet.vercel.app").replace(/\/$/, "");
}

export function demoUrl() {
  return (process.env.ZECKED_DEMO_URL || "https://zecked-demo.vercel.app").replace(/\/$/, "");
}

/** App routes that must not be served by the website (they redirect to the demo app, keeping old links alive). */
export const APP_ROUTE_PREFIXES = ["/feed", "/hide", "/s/", "/me", "/wallet", "/leaderboard", "/signin", "/how"];
