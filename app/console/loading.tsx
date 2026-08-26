import {
  SkeletonCard,
  SkeletonPageHeader,
  SkeletonStats,
} from "@/components/skeleton";

/** Shown instantly when navigating to /console (dashboard). */
export default function ConsoleDashboardLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStats />
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonCard rows={5} className="min-w-0 lg:col-span-2" />
        <div className="space-y-4">
          <SkeletonCard rows={3} />
          <SkeletonCard rows={3} />
        </div>
      </div>
    </>
  );
}
