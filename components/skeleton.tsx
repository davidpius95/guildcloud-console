/**
 * Reusable skeleton primitive for loading states.
 *
 * Use inside loading.tsx files to show shimmer placeholders while the real
 * server component renders in the background. Keeps every loading state
 * visually consistent without duplicating animation CSS.
 */
export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-lg bg-ink-100 ${className}`}
      style={style}
    />
  );
}

/** A full-width skeleton that mimics a page header (title + subtitle). */
export function SkeletonPageHeader() {
  return (
    <div className="mb-6">
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="h-4 w-80" />
    </div>
  );
}

/** A card-shaped skeleton with a header bar and N rows. */
export function SkeletonCard({
  rows = 3,
  className = "",
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-ink-100 bg-white ${className}`}
    >
      <div className="border-b border-ink-100 px-5 py-4">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-1.5 h-3.5 w-56" />
      </div>
      <div className="divide-y divide-ink-100">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3.5">
            <Skeleton className="h-6 w-6 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Four stat-card skeletons in a row, matching the dashboard layout. */
export function SkeletonStats() {
  return (
    <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl border border-ink-100 bg-white px-5 py-4"
        >
          <Skeleton className="mb-2 h-3.5 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/** A table skeleton with a header row and N body rows. */
export function SkeletonTable({
  cols = 6,
  rows = 4,
  className = "",
}: {
  cols?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-ink-100 bg-white ${className}`}
    >
      <div className="border-b border-ink-100 px-5 py-4">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="mt-1.5 h-3.5 w-56" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-ink-100">
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i} className="px-5 py-3 text-left">
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r} className="border-b border-ink-100 last:border-b-0">
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c} className="px-5 py-3.5">
                    <Skeleton
                      className="h-4"
                      style={{ width: `${50 + ((c * 17 + r * 13) % 40)}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
