import { headers } from "next/headers";
import { kv } from "@/lib/server/kv";
import type { GiftRecord } from "@/lib/server/gifts";
import { getPlayer } from "@/lib/server/players";
import { giftCard } from "@/lib/server/og-gift";

export const alt = "You’ve got a ZECKED gift";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = ((await headers()).get("host") || "app.zecked.com").replace(/^www\./, "");
  const g = /^[0-9A-Za-z]{4,12}$/.test(id) ? await kv().get<GiftRecord>(`gifts:${id}`) : null;
  if (!g) return giftCard(null, host);
  const from = await getPlayer(g.fromId);
  return giftCard({ id: g.id, fromHandle: from?.handle || "@someone", locked: !!g.lock, status: g.status, testMode: g.network !== "mainnet" }, host);
}
