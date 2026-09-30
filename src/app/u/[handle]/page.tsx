import type { Metadata } from "next";
import PublicProfile from "@/components/screens/PublicProfile";

/** "/u/goldfox488", "/u/@goldfox488" or "/u/%40goldfox488" → "@goldfox488". */
function toHandle(raw: string): string {
  let h = raw;
  try {
    h = decodeURIComponent(raw);
  } catch {}
  return `@${h.trim().replace(/^@+/, "")}`;
}

// The title comes straight from the link (no lookup): "@goldfox488 · ZECKED".
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const handle = toHandle((await params).handle);
  const ok = /^@[A-Za-z0-9_]{2,24}$/.test(handle);
  const title = ok ? `${handle} · ZECKED` : "Player · ZECKED";
  const description = ok
    ? `${handle} on ZECKED: their stashes, tier and badges. Hide ZEC behind a riddle or a match call; first to crack it keeps it.`
    : "A player on ZECKED. Hide ZEC behind a riddle or a match call; first to crack it keeps it.";
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const handle = toHandle((await params).handle);
  return <PublicProfile key={handle} handle={handle} />;
}
