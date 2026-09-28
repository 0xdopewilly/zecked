import type { Metadata } from "next";
import { kv } from "@/lib/server/kv";
import type { StashRecord } from "@/lib/server/game";
import { zecUsd } from "@/lib/server/price";
import { getMatch } from "@/lib/server/sports";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const s = await kv().get<StashRecord>(`stash:${id}`);
  if (!s) return { title: "ZECKED · Hide it. Crack it. Get Zecked." };
  const zec = (s.amountZat / 1e8).toFixed(4).replace(/(\.\d{2}\d*?)0+$/, "$1");
  let title = `Crack my riddle and ZECK ${zec} ZEC 🔐`;
  let description = s.riddle ? `“${s.riddle.text}” First one to crack it keeps it.` : "First correct call keeps the ZEC.";
  if (s.prediction) {
    const m = await getMatch(s.prediction.matchId);
    const usd = Math.round((s.amountZat / 1e8) * (await zecUsd()));
    if (m) {
      title = s.prediction.kind === "exact" ? `First to call ${m.home.code} vs ${m.away.code} exactly ZECKS $${usd} ⚽` : `First to call the ${m.home.code} vs ${m.away.code} winner ZECKS $${usd} ⚽`;
      description = `${m.home.name} vs ${m.away.name} · ${m.leagueName}. Calls lock at kickoff. Free to play on ZECKED.`;
    }
  }
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

export default function StashLayout({ children }: { children: React.ReactNode }) {
  return children;
}
