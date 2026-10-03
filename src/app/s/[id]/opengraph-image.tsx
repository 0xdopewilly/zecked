import { headers } from "next/headers";
import { kv } from "@/lib/server/kv";
import { toPublic, type StashRecord } from "@/lib/server/game";
import { shareCard } from "@/lib/server/og";

export const alt = "A ZECKED stash: first to crack it keeps the ZEC";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const host = (await headers()).get("host") || "app.zecked.com";
  const rec = await kv().get<StashRecord>(`stash:${id}`);
  const stash = rec ? await toPublic(rec) : null;
  return shareCard(stash, host.replace(/^www\./, ""));
}
