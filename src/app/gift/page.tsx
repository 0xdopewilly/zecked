import type { Metadata } from "next";
import { Suspense } from "react";
import { GiftFlow } from "@/components/screens/GiftFlow";

export const metadata: Metadata = { title: "Send a gift · ZECKED" };

export default function GiftPage() {
  return (
    <Suspense fallback={<main className="zk-screen" style={{ background: "var(--zk-bg)" }} />}>
      <GiftFlow />
    </Suspense>
  );
}
