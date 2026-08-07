import { CopyField } from "@/components/copy-field";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Meter,
  Note,
  PageHeader,
  StatePill,
} from "@/components/ui";
import { IconPlus } from "@/components/icons";
import { databases, money, projectName, siteName } from "@/lib/mock-data";

const protectionLabel = {
  standard: "Standard",
  protected: "Protected",
  "warm-standby": "Warm Standby",
} as const;

export default function DatabasesPage() {
  return (
    <>
      <PageHeader
        title="Managed PostgreSQL"
        description="Private managed PostgreSQL with backup, recovery, and monitoring. MySQL is future work."
        action={
          <Button>
            <IconPlus className="h-4 w-4" />
            Create database
          </Button>
        }
      />

      <div className="mb-5">
        <Note>
          PostgreSQL-aware backup runs independently of VM image backup. A
          recovery point is not considered valid until a restore drill proves it
          can be used.
        </Note>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {databases.map((d) => (
          <Card key={d.id}>
            <CardHeader
              title={d.name}
              subtitle={`${projectName(d.projectId)} · ${siteName(d.siteId)}`}
              action={<StatePill state={d.state} />}
            />
            <div className="space-y-4 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone="sky">{d.engine}</Badge>
                <Badge>{d.plan}</Badge>
                <Badge tone={d.protection === "standard" ? "neutral" : "lemon"}>
                  {protectionLabel[d.protection]}
                </Badge>
              </div>

              <CopyField label="Private hostname" value={d.privateHostname} />

              <Meter
                label="Connections"
                caption={`${d.connections} / ${d.maxConnections}`}
                value={(d.connections / d.maxConnections) * 100}
              />

              <div className="grid grid-cols-2 gap-4 border-t border-ink-100 pt-4 text-sm">
                <div>
                  <p className="text-xs text-ink-400">Storage</p>
                  <p className="font-medium tabular-nums text-ink-900">
                    {d.storageGb} GB
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-400">Monthly maximum</p>
                  <p className="font-medium tabular-nums text-ink-900">
                    {money(d.monthlyMax)}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-ink-400">Last verified backup</p>
                  <p className="font-medium text-ink-900">
                    {d.lastBackupAt ?? "Not yet taken"}
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="secondary" size="sm">
                  Recovery points
                </Button>
                <Button variant="secondary" size="sm">
                  Restore to new target
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader title="Recovery rules" subtitle="These apply to every managed database." />
        <ul className="divide-y divide-ink-100 text-sm">
          {[
            ["Restores never overwrite silently", "A restore creates a separate target, or requires explicit confirmation to replace a live database."],
            ["Every restore is auditable", "Who restored what, from which recovery point, and when."],
            ["Deletion has a recovery window", "Permanent deletion follows the documented retention policy, not the delete click."],
            ["Off-site copies", "Encrypted copies are kept in at least two locations."],
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
