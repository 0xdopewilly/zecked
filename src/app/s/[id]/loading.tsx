import { StashSkeleton } from "./StashSkeleton";

// Shown the instant a stash is tapped (prefetched with the link), while the route and its data arrive.
export default function Loading() {
  return <StashSkeleton />;
}
