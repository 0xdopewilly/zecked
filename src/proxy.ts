import { NextResponse, type NextRequest } from "next/server";
import { APP_ROUTE_PREFIXES, appUrl, legacyTarget, redirectOrigin, surface } from "@/lib/surface";

const SID = "zk_sid";
const INVITE_COOKIE = "zk_ref"; // = invites.ts (the proxy stays free of server-only imports)
const SID_MAX_AGE = 60 * 60 * 24 * 180;

/** 32 random bytes, base64url: the session id a new browser gets on its first page load. */
function newSid() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // A retired deployment (the old play-money demo) sends every link, old share links included, to the app.
  const forward = redirectOrigin();
  if (forward) return NextResponse.redirect(`${forward}${pathname}${search}`, 308);
  // The old vercel.app address of this surface: same page on the real domain (zecked.com / app.zecked.com).
  const moved = legacyTarget(request.headers.get("host"));
  if (moved) return NextResponse.redirect(`${moved}${pathname}${search}`, 308);
  if (surface() !== "site") {
    // An invite link (/i/<code>): remember who sent it, then show the feed with a "@x invited you" welcome.
    const inv = pathname.match(/^\/i\/([a-z2-9]{6,12})\/?$/);
    if (inv) {
      const res = NextResponse.redirect(new URL(`/feed?invite=${inv[1]}`, request.url), 307);
      res.cookies.set(INVITE_COOKIE, inv[1], { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 30 * 86400 });
      if (!request.cookies.get(SID)?.value) {
        res.cookies.set(SID, newSid(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SID_MAX_AGE });
      }
      return res;
    }
    // First page load in a new browser: hand out the session id now, so the page's parallel API calls
    // all share one guest instead of racing to create several (and a late one clobbering a sign-in).
    const isPage = request.method === "GET" && !pathname.startsWith("/api/") && (request.headers.get("accept") || "").includes("text/html");
    if (isPage && !request.cookies.get(SID)?.value) {
      const res = NextResponse.next();
      res.cookies.set(SID, newSid(), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SID_MAX_AGE });
      return res;
    }
    return NextResponse.next();
  }
  // On the website surface, app routes live on the app, so old share links keep working.
  if (APP_ROUTE_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))) {
    return NextResponse.redirect(`${appUrl()}${pathname}${search}`, 307);
  }
  return NextResponse.next();
}

export const config = {
  // Real page loads only. Client-side navigations and prefetches (RSC requests) skip the proxy, so they
  // come straight from the edge cache near the player instead of detouring through a server region.
  // API routes skip it too.
  matcher: [
    {
      source: "/((?!_next/|api/|icons/|splash/|sw\\.js|favicon.ico|icon.svg|apple-icon|manifest.webmanifest|opengraph-image).*)",
      missing: [
        { type: "header", key: "rsc" },
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
