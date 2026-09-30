import { NextResponse, type NextRequest } from "next/server";
import { APP_ROUTE_PREFIXES, appUrl, redirectOrigin, surface } from "@/lib/surface";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // A retired deployment (the old play-money demo) sends every link, old share links included, to the app.
  const forward = redirectOrigin();
  if (forward) return NextResponse.redirect(`${forward}${pathname}${search}`, 308);
  if (surface() !== "site") return NextResponse.next();
  // On the website surface, app routes live on the app, so old share links keep working.
  if (APP_ROUTE_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))) {
    return NextResponse.redirect(`${appUrl()}${pathname}${search}`, 307);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except build assets; /api is included so a retired deployment forwards API calls too.
  matcher: ["/((?!_next/|icons/|favicon.ico|icon.svg|apple-icon|manifest.webmanifest|opengraph-image).*)"],
};
