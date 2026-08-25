import { ComingSoon } from "@/components/coming-soon";

export default function VolumesPage() {
  return (
    <ComingSoon
      title="Guild Volumes"
      description="Expandable block storage for instances and persistent workloads."
      detail="Standalone block volumes aren't available yet. Each Guild Instance already includes its own disk, sized by the plan you pick at creation."
      bullets={[
        "Instance disks can be expanded today from an instance's Resize action.",
        "Disk shrinking is deliberately not offered.",
        "Attachable volumes that outlive an instance are planned, not built.",
      ]}
    />
  );
}
