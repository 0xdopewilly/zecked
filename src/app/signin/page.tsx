import type { Metadata } from "next";
import { Suspense } from "react";
import SignIn from "@/components/screens/SignIn";

export const metadata: Metadata = { title: "Sign in · ZECKED" };

/** `?next=` (default /feed) and `?reason=win|hide|wallet` are read by SignIn via useSearchParams, so it sits in Suspense. */
export default function Page() {
  return (
    <Suspense fallback={<main className="zk-screen" style={{ background: "var(--zk-bg-hero-purple)" }} />}>
      <SignIn />
    </Suspense>
  );
}
