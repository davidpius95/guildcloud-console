import { SkeletonCard, SkeletonPageHeader } from "@/components/skeleton";

/** Shown instantly when navigating to the projects page. */
export default function ProjectsLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonCard rows={4} />
    </>
  );
}
