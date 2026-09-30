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
  // `share` is the link-preview copy (first person, from the hider); `title` is the neutral tab title.
  let share = `Crack my riddle and ZECK ${zec} ZEC 🔐`;
  let title = `Riddle stash · ${zec} ZEC · ZECKED`;
  let description = s.riddle ? `“${s.riddle.text}” First one to crack it keeps it.` : "First correct call keeps the ZEC.";
  if (s.prediction) {
    const m = await getMatch(s.prediction.matchId);
    const usd = s.usdAtHide ?? Math.round((s.amountZat / 1e8) * (await zecUsd()));
    if (m) {
      share = s.prediction.kind === "exact" ? `First to call ${m.home.code} vs ${m.away.code} exactly ZECKS $${usd} ⚽` : `First to call the ${m.home.code} vs ${m.away.code} winner ZECKS $${usd} ⚽`;
      title = `${m.home.name} vs ${m.away.name} · prediction stash · ZECKED`;
      description = `${m.home.name} vs ${m.away.name} · ${m.leagueName}. Calls lock at kickoff. Free to play on ZECKED.`;
    }
  }
  return { title, description, openGraph: { title: share, description }, twitter: { card: "summary_large_image", title: share, description } };
}

export default function StashLayout({ children }: { children: React.ReactNode }) {
  return children;
}
