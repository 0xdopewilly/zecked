import { shareCard } from "@/lib/server/og";
import { appUrl, surface } from "@/lib/surface";

// The link preview for the website and the app's own pages (stash links have their own card).
export const alt = "ZECKED: hide ZEC behind a riddle. First to crack it keeps it.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const host = surface() === "site" ? "zecked.com" : new URL(appUrl()).host;
  return shareCard(null, host);
}
