import {
  Skeleton,
  SkeletonCard,
  SkeletonPageHeader,
} from "@/components/skeleton";

/** Shown instantly when navigating to a single instance detail page. */
export default function InstanceDetailLoading() {
  return (
    <>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Skeleton className="h-3.5 w-40" />
      </div>

      <SkeletonPageHeader />

      {/* Badges row */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-36 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main column: operation progress skeleton */}
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <div className="overflow-hidden rounded-2xl border border-ink-100 bg-white">
            <div className="border-b border-ink-100 px-5 py-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-1.5 h-3.5 w-72" />
            </div>
            <div className="px-5 py-5">
              {/* Progress bar area */}
              <Skeleton className="mb-2 h-3 w-20" />
              <Skeleton className="mb-4 h-6 w-full max-w-xl" />
              <Skeleton className="h-3 w-64" />
              <div className="mt-5">
                <Skeleton className="h-2.5 w-full rounded-full" />
              </div>
              {/* Stage group cards */}
              <div className="mt-5 grid gap-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
            </div>
            {/* Stage list */}
            <div className="divide-y divide-ink-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3.5">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-4 flex-1" style={{ maxWidth: `${55 + (i * 11) % 30}%` }} />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar column */}
        <div className="space-y-4">
          <SkeletonCard rows={3} />
          <SkeletonCard rows={4} />
        </div>
      </div>
    </>
  );
}
