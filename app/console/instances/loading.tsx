import { SkeletonPageHeader, SkeletonTable } from "@/components/skeleton";

/** Shown instantly when navigating to the instances list. */
export default function InstancesLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonTable cols={8} rows={4} />
    </>
  );
}
