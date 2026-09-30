"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { HideFlow } from "@/components/screens/HideFlow";

/**
 * Reads `?resume=<stashId>` so a hider can come back to an unfunded stash. (`?step=` is the flow's own
 * history: HideFlow reads it on load and on back / forward.)
 */
function HideRoute() {
  const params = useSearchParams();
  return <HideFlow resumeId={params.get("resume")} />;
}

export default function HidePage() {
  return (
    <Suspense fallback={<main className="zk-screen" style={{ background: "var(--zk-bg)" }} />}>
      <HideRoute />
    </Suspense>
  );
}
