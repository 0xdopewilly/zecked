import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hide a stash · ZECKED" };

export default function HideLayout({ children }: { children: React.ReactNode }) {
  return children;
}
