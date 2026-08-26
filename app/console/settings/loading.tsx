import { SkeletonCard, SkeletonPageHeader } from "@/components/skeleton";

/** Shown instantly when navigating to the settings page. */
export default function SettingsLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <div className="space-y-4">
        <SkeletonCard rows={3} />
        <SkeletonCard rows={2} />
        <SkeletonCard rows={4} />
      </div>
    </>
  );
}
