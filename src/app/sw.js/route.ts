import { SW_SOURCE } from "@/lib/sw-source";

// /sw.js, built once per deployment: the id inside changes with every deployment, which is how phones
// notice there's a new version (see src/lib/sw-source.ts). In dev it only does push (no caching).
export const dynamic = "force-static";

const BUILD =
  process.env.NODE_ENV === "development"
    ? "dev"
    : process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now().toString(36)}`;

export function GET() {
  return new Response(SW_SOURCE.replaceAll("__BUILD__", BUILD), {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate" },
  });
}
