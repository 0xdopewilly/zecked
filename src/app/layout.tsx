import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter, Space_Mono } from "next/font/google";
import "@/styles/globals.css";
import { surface } from "@/lib/surface";
import { SmoothScroll } from "@/components/site/SmoothScroll";
import { Sfx } from "@/components/zk/Sfx";
import { LiveNotices } from "@/components/zk/LiveNotices";
import { NavTracker } from "@/lib/nav";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://zecked.vercel.app";

// Self-hosted by Next (no render-blocking request to Google). The tokens read these CSS variables.
const display = Bricolage_Grotesque({ subsets: ["latin"], axes: ["opsz"], variable: "--zk-ff-display", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--zk-ff-body", display: "swap" });
const mono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--zk-ff-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "ZECKED · Hide it. Crack it. Get Zecked.",
  description:
    "Hide ZEC behind a riddle or a match call. First to crack it keeps it, in a private wallet. Free to play. Built on Zcash.",
  applicationName: "ZECKED",
  openGraph: {
    title: "ZECKED · Hide it. Crack it. Get Zecked.",
    description: "Riddles and match calls with ZEC inside. First one to crack it keeps it.",
    siteName: "ZECKED",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "ZECKED", description: "Hide it. Crack it. Get Zecked." },
  appleWebApp: { capable: true, title: "ZECKED", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#0E0B1F",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isSite = surface() === "site";
  const testMode = !isSite && (process.env.ZECKED_NETWORK || "sim") !== "mainnet";
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        {isSite ? (
          <SmoothScroll>{children}</SmoothScroll>
        ) : (
          <>
            {testMode && (
              <div className="zk-testmode" style={{ viewTransitionName: "zk-ribbon" }}>
                {process.env.ZECKED_NETWORK === "testnet" ? "Testnet · test ZEC, not real money" : "Sim mode · play ZEC, not real money"}
              </div>
            )}
            <Sfx />
            <NavTracker />
            <LiveNotices />
            <div className="zk-app">{children}</div>
          </>
        )}
      </body>
    </html>
  );
}
