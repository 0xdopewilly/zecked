import type { Metadata } from "next";
import Feed from "@/components/screens/Feed";

export const metadata: Metadata = { title: "Stashes · ZECKED" };

export default function Page() {
  return <Feed />;
}
