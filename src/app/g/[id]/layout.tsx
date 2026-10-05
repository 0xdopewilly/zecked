import type { Metadata } from "next";
import { kv } from "@/lib/server/kv";
import type { GiftRecord } from "@/lib/server/gifts";
import { getPlayer } from "@/lib/server/players";

/** Link preview for a gift. Chat apps fetch this, so it never says the amount, the message or the question. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const g = /^[0-9A-Za-z]{4,12}$/.test(id) ? await kv().get<GiftRecord>(`gifts:${id}`) : null;
  if (!g) return { title: "ZECKED · Hide it. Crack it. Get Zecked." };
  const from = (await getPlayer(g.fromId))?.handle || "A friend";
  const title = "You’ve got a ZECKED gift 🎁";
  const description =
    (g.status !== "open" || Date.parse(g.expiresAt) <= Date.now())
      ? `${from} sent a ZECKED gift. It has already been ${g.status === "claimed" ? "opened" : "returned"}.`
      : g.lock
        ? `${from} sent you ZEC on ZECKED. Answer ${from}’s question to open it.`
        : `${from} sent you ZEC on ZECKED. Open the link to add it to your wallet.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

export default function GiftLayout({ children }: { children: React.ReactNode }) {
  return children;
}
