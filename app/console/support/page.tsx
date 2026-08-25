import { ComingSoon } from "@/components/coming-soon";

export default function SupportPage() {
  return (
    <ComingSoon
      title="Support"
      description="Self-service first, then an in-console request that carries safe diagnostics."
      detail="In-console support requests aren't available yet, so there is no ticket history here. Reach the team directly at support@guildcloud.io in the meantime, quoting the Server ID shown on the instance you're asking about."
      bullets={[
        "Requests will attach operation and stage context automatically, so you don't have to reconstruct what happened.",
        "Diagnostics attached will be scoped to the resource you're asking about.",
      ]}
    />
  );
}
