import type { ReactNode } from "react";
import { PageTransition } from "@/components/zk/PageTransition";

// Templates re-mount on every navigation (layouts don't), so this is where screen transitions live.
export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
