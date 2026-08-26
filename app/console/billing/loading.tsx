import { SkeletonCard, SkeletonPageHeader } from "@/components/skeleton";

/** Shown instantly when navigating to the billing page. */
export default function BillingLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <div className="space-y-4">
        <SkeletonCard rows={4} />
        <SkeletonCard rows={3} />
      </div>
    </>
  );
}
