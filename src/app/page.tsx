import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Welcome from "@/components/screens/Welcome";
import { sessionIsAccount } from "@/lib/server/auth";
import { Landing } from "@/components/site/Landing";
import type { SiteStats } from "@/components/site/sections/LiveStats";
import { appUrl, surface } from "@/lib/surface";

export const revalidate = 60;

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { next: { revalidate: 60 }, signal: AbortSignal.timeout(4000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export default async function Page() {
  if (surface() !== "site") {
    // Returning players skip the splash and land on the stashes.
    if (await sessionIsAccount((await cookies()).get("zk_sid")?.value)) redirect("/feed");
    return <Welcome />;
  }
  const app = appUrl();
  const [stats, ticker] = await Promise.all([getJson<SiteStats>(`${app}/api/stats`), getJson<{ items: { text: string }[] }>(`${app}/api/ticker`)]);
  return <Landing appUrl={app} stats={stats} ticker={(ticker?.items || []).map((i) => i.text).slice(0, 12)} />;
}
