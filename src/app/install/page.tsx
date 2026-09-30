import type { Metadata } from "next";
import { redirect } from "next/navigation";
import InstallScreen from "@/components/screens/InstallScreen";
import { appUrl, surface } from "@/lib/surface";

export const metadata: Metadata = {
  title: "Get the app · ZECKED",
  description: "Put ZECKED on your Home Screen: full screen, one tap away. Free, no app store.",
};

export default function Page() {
  // Installing only works on the app's own site (the proxy sends website visitors there too).
  if (surface() === "site") redirect(`${appUrl()}/install`);
  return <InstallScreen />;
}
