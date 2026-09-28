import type { Metadata } from "next";
import LeaderboardScreen from "@/components/screens/LeaderboardScreen";

export const metadata: Metadata = { title: "Leaderboard · ZECKED" };

export default function Page() {
  return <LeaderboardScreen />;
}
