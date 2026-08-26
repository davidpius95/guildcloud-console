import { SkeletonCard, SkeletonPageHeader } from "@/components/skeleton";

/** Shown instantly when navigating to the networking page. */
export default function NetworkingLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <div className="space-y-4">
        <SkeletonCard rows={3} />
        <SkeletonCard rows={2} />
      </div>
    </>
  );
}
