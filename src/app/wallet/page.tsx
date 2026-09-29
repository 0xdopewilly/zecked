import type { Metadata } from "next";
import { Suspense } from "react";
import Wallet from "@/components/screens/Wallet";
import { TabBar } from "@/components/zk";

export const metadata: Metadata = { title: "Wallet · ZECKED" };

/** The wallet reads `?action=add|withdraw`, so it renders inside a Suspense boundary. */
export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="zk-screen has-tabs" style={{ background: "var(--zk-bg-hero-gold)" }}>
          <TabBar active="profile" />
        </main>
      }
    >
      <Wallet />
    </Suspense>
  );
}
