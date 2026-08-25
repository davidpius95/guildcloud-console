import { ComingSoon } from "@/components/coming-soon";

export default function MonitoringPage() {
  return (
    <ComingSoon
      title="Monitoring"
      description="Service health, performance, protection, and alerts."
      detail="Monitoring and alerting aren't wired up yet, so there is no health or alert history to show. Live provisioning progress is visible on each instance's own page in the meantime."
      bullets={[
        "Per-instance CPU, memory, and disk trends are planned.",
        "Alerting will only notify on conditions that are actually measured — nothing is being collected yet.",
      ]}
    />
  );
}
