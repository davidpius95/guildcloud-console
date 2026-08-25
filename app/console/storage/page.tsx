import { ComingSoon } from "@/components/coming-soon";

export default function StoragePage() {
  return (
    <ComingSoon
      title="Object Storage"
      description="S3-compatible application and file storage."
      detail="Object storage isn't available yet, so there are no buckets or access keys to show. Instance disks and their backups are the durable storage available today."
      bullets={[
        "S3-compatible buckets with scoped access keys are the planned first release.",
        "Additional storage classes come after that.",
      ]}
    />
  );
}
