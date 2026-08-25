import { ComingSoon } from "@/components/coming-soon";

export default function DatabasesPage() {
  return (
    <ComingSoon
      title="Managed PostgreSQL"
      description="Private managed PostgreSQL with backup, recovery, and monitoring."
      detail="Managed PostgreSQL isn't available yet. You can run PostgreSQL yourself on a Guild Instance today — it stays on your private network with no public route, same as any other workload."
      bullets={[
        "Managed backup, point-in-time recovery, and monitoring are the planned first release.",
        "MySQL is later work, not part of the first release.",
      ]}
    />
  );
}
