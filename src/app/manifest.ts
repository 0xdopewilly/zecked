import type { MetadataRoute } from "next";
import { surface } from "@/lib/surface";

export default function manifest(): MetadataRoute.Manifest {
  // The website isn't the app: it links to the app's own install page instead of being installable itself.
  if (surface() === "site") {
    return { name: "ZECKED", short_name: "ZECKED", start_url: "/", display: "browser", background_color: "#0E0B1F", theme_color: "#0E0B1F", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] };
  }
  return {
    id: "/",
    name: "ZECKED · Hide it. Crack it. Get Zecked.",
    short_name: "ZECKED",
    description: "Hide ZEC behind a riddle or a match call. First to crack it keeps it. Built on Zcash.",
    start_url: "/feed",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0E0B1F",
    theme_color: "#0E0B1F",
    categories: ["games", "entertainment", "finance"],
    // Long-press the home-screen icon.
    shortcuts: [
      { name: "Hide a stash", short_name: "Hide", url: "/hide", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "My wallet", short_name: "Wallet", url: "/wallet", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
