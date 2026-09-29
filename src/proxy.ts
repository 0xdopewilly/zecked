import { NextResponse, type NextRequest } from "next/server";
import { APP_ROUTE_PREFIXES, demoUrl, surface } from "@/lib/surface";

// On the website surface, app routes live on the demo app, so old share links keep working.
export function proxy(request: NextRequest) {
  if (surface() !== "site") return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (APP_ROUTE_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p))) {
    return NextResponse.redirect(`${demoUrl()}${pathname}${search}`, 307);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|api/|icons/|favicon.ico|icon.svg|apple-icon|manifest.webmanifest|opengraph-image).*)"],
};
