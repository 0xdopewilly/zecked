import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://zecked.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "ZECKED · Hide it. Crack it. Get Zecked.",
  description:
    "Hide ZEC behind a riddle or a match call. First to crack it keeps it, in a private wallet. Free to play. Built on Zcash.",
  applicationName: "ZECKED",
  openGraph: {
    title: "ZECKED · Hide it. Crack it. Get Zecked.",
    description: "Riddles and match calls with real ZEC inside. First one to crack it keeps it.",
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
  const testMode = (process.env.ZECKED_NETWORK || "sim") !== "mainnet";
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {testMode && <div className="zk-testmode">Test mode · play ZEC, not real money</div>}
        <div className="zk-app">{children}</div>
      </body>
    </html>
  );
}
