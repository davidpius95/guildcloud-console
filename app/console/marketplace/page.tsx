import {
  Badge,
  Button,
  Card,
  CardHeader,
  Note,
  PageHeader,
} from "@/components/ui";
import { marketplace } from "@/lib/mock-data";

const statusTone = {
  Available: "lemon",
  "In testing": "amber",
  Planned: "neutral",
} as const;

export default function MarketplacePage() {
  return (
    <>
      <PageHeader
        title="Marketplace"
        description="Curated solutions with a named owner, a tested template, and a deprecation policy. The catalogue starts small on purpose."
      />

      <div className="mb-5">
        <Note>
          A template only appears as Available once it has a version, an owner, a
          security-update process, a site synchronization procedure, and a
          passing private-access test.
        </Note>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {marketplace.map((m) => (
          <Card key={m.id}>
            <div className="p-5">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink-900">{m.name}</h3>
                <Badge tone={statusTone[m.status as keyof typeof statusTone]}>
                  {m.status}
                </Badge>
              </div>
              <p className="text-xs text-ink-400">{m.summary}</p>
              <p className="mt-3 text-xs text-ink-400">Owner: {m.owner}</p>
              <div className="mt-4">
                <Button
                  href={m.status === "Available" ? "/console/instances/new" : undefined}
                  variant={m.status === "Available" ? "primary" : "secondary"}
                  size="sm"
                  disabled={m.status !== "Available"}
                >
                  {m.status === "Available" ? "Deploy" : "Not yet available"}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader title="Template lifecycle" subtitle="What every marketplace entry must carry." />
        <ul className="divide-y divide-ink-100 text-sm">
          {[
            ["Version and owner", "A named owner is accountable for updates and incidents."],
            ["Security update process", "Documented cadence for patching the base image."],
            ["Site synchronization", "The template exists and is tested at each site that offers it."],
            ["Private-access test", "Provisioning proves the private hostname and SSH route work."],
            ["Deprecation policy", "Customers are told before a template stops being maintained."],
          ].map(([title, detail]) => (
            <li key={title} className="px-5 py-3">
              <p className="font-medium text-ink-900">{title}</p>
              <p className="mt-0.5 text-xs text-ink-400">{detail}</p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
