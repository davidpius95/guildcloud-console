import { ComingSoon } from "@/components/coming-soon";

export default function MarketplacePage() {
  return (
    <ComingSoon
      title="Marketplace"
      description="Curated solutions with a named owner, a tested template, and a deprecation policy."
      detail="The marketplace isn't open yet. Curated one-click solutions will appear here once each has a named owner and a template that passes the same provisioning tests as the base images."
      bullets={[
        "Every listing will carry an owner and a documented deprecation policy.",
        "The catalogue starts deliberately small rather than broad and untested.",
      ]}
    />
  );
}
