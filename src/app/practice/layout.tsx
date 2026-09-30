import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Practice riddle · ZECKED",
  description: "Try a free practice riddle: no ZEC, no sign-up, just for fun. Then crack a real stash.",
};

export default function PracticeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
