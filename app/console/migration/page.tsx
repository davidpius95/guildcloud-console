import { ComingSoon } from "@/components/coming-soon";

export default function MigrationPage() {
  return (
    <ComingSoon
      title="Migration"
      description="Bring workloads in from another provider."
      detail="Guided migration isn't available yet, so there are no migration jobs to show. Instances can be created directly in the meantime and cut over manually."
      bullets={[
        "Discovery, plan mapping, and guided cutover are the planned flow.",
        "AWS, DigitalOcean, and Hetzner are the intended first sources.",
      ]}
    />
  );
}
