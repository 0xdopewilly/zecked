"use client";
import { CursorGlow, Grain, ScrollProgressBar } from "./fx";
import { Nav } from "./Nav";
import { Faq } from "./sections/Faq";
import { FinalCta } from "./sections/FinalCta";
import { Footer } from "./sections/Footer";
import { Games } from "./sections/Games";
import { GetTestZec } from "./sections/GetTestZec";
import { Hero } from "./sections/Hero";
import { HowItWorks } from "./sections/HowItWorks";
import { LiveStats, type SiteStats } from "./sections/LiveStats";
import { TickerStrip } from "./sections/TickerStrip";
import { WhyZcash } from "./sections/WhyZcash";

export function Landing({ appUrl, demoUrl, stats, ticker }: { appUrl: string; demoUrl: string; stats: SiteStats | null; ticker: string[] }) {
  return (
    <main className="zks">
      <ScrollProgressBar />
      <CursorGlow />
      <Grain />
      <Nav appUrl={appUrl} />
      <Hero appUrl={appUrl} demoUrl={demoUrl} network={stats?.network} />
      <TickerStrip items={ticker} />
      <HowItWorks />
      <Games appUrl={appUrl} />
      <WhyZcash />
      <LiveStats stats={stats} />
      <GetTestZec appUrl={appUrl} />
      <Faq />
      <FinalCta appUrl={appUrl} demoUrl={demoUrl} />
      <Footer appUrl={appUrl} demoUrl={demoUrl} />
    </main>
  );
}
