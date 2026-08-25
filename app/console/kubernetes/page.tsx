import { ComingSoon } from "@/components/coming-soon";

export default function KubernetesPage() {
  return (
    <ComingSoon
      title="Guild Kubernetes"
      description="One project-isolated shared managed cluster per site."
      detail="Managed Kubernetes isn't available yet. Guild Instances are the supported compute surface today, and you can run your own container runtime on them."
      bullets={[
        "A shared, project-isolated managed cluster per site is the planned first release.",
        "Dedicated clusters are a later premium module.",
      ]}
    />
  );
}
