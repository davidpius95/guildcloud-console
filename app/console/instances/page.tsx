import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Meter,
  Note,
  PageHeader,
  StatePill,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { IconLock, IconPlus } from "@/components/icons";
import { instances, money, projectName, siteName } from "@/lib/mock-data";

const protectionLabel = {
  standard: "Standard",
  protected: "Protected",
  "warm-standby": "Warm Standby",
} as const;

export default function InstancesPage() {
  const totalMonthly = instances.reduce((sum, i) => sum + i.monthlyMax, 0);

  return (
    <>
      <PageHeader
        title="Guild Instances"
        description="Private virtual servers on a stable project IP and private hostname. No public VPS IP or public SSH exists in the MVP."
        action={
          <Button href="/console/instances/new">
            <IconPlus className="h-4 w-4" />
            Create instance
          </Button>
        }
      />

      <div className="mb-5">
        <Note>
          <span className="inline-flex items-center gap-2">
            <IconLock className="h-4 w-4 shrink-0 text-ink-500" />
            Every instance below is reachable only through your enrolled
            devices. Removing a teammate revokes both private network permission
            and their server login.
          </span>
        </Note>
      </div>

      <Card>
        <CardHeader
          title={`${instances.length} instances`}
          subtitle={`Combined monthly maximum ${money(totalMonthly)} · billed hourly for actual use`}
        />
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>State</Th>
              <Th>Plan</Th>
              <Th>Image</Th>
              <Th>Site</Th>
              <Th>Private hostname</Th>
              <Th>Protection</Th>
              <Th className="text-right">Monthly max</Th>
            </tr>
          </thead>
          <tbody>
            {instances.map((i) => (
              <tr key={i.id} className="transition-colors hover:bg-ink-50">
                <Td>
                  <Link
                    href={`/console/instances/${i.id}`}
                    className="font-medium text-ink-900 hover:text-lemon-700 hover:underline"
                  >
                    {i.name}
                  </Link>
                  <p className="text-xs text-ink-400">{projectName(i.projectId)}</p>
                </Td>
                <Td>
                  <StatePill state={i.state} />
                </Td>
                <Td>
                  <span className="whitespace-nowrap">{i.plan}</span>
                  <p className="text-xs text-ink-400">
                    {i.vcpu} vCPU · {i.memoryGb} GB · {i.diskGb} GB
                  </p>
                </Td>
                <Td className="whitespace-nowrap text-ink-500">{i.image}</Td>
                <Td className="whitespace-nowrap text-ink-500">
                  {siteName(i.siteId)}
                </Td>
                <Td>
                  <span className="font-mono text-xs text-ink-600">
                    {i.privateHostname}
                  </span>
                  <p className="font-mono text-xs text-ink-400">{i.privateIp}</p>
                </Td>
                <Td>
                  <Badge tone={i.protection === "standard" ? "neutral" : "lemon"}>
                    {protectionLabel[i.protection]}
                  </Badge>
                </Td>
                <Td className="text-right tabular-nums font-medium">
                  {money(i.monthlyMax)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Resource pressure" subtitle="Live utilisation for running instances." />
          <div className="space-y-4 px-5 py-4">
            {instances
              .filter((i) => i.state === "ready" || i.state === "degraded")
              .map((i) => (
                <div key={i.id}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm font-medium text-ink-800">
                      {i.name}
                    </span>
                    <span className="text-xs text-ink-400">
                      CPU {i.cpuPct}% · MEM {i.memoryPct}% · DISK {i.diskPct}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Meter value={i.cpuPct} />
                    <Meter value={i.memoryPct} />
                    <Meter value={i.diskPct} />
                  </div>
                </div>
              ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Lifecycle boundaries" subtitle="What the MVP does and does not promise." />
          <div className="divide-y divide-ink-100 text-sm">
            {[
              ["CPU and memory resize", "Up or down, with restart or migration warnings before you confirm."],
              ["Disk expansion", "Supported. Disk shrinking is not offered in the MVP."],
              ["Snapshots and restore", "Restores never silently overwrite a live workload."],
              ["Deletion", "A documented recovery window applies before permanent deletion."],
              ["Password SSH", "Opt-in, private route only, never stored by GuildCloud, rate-limited and audited."],
            ].map(([title, detail]) => (
              <div key={title} className="px-5 py-3">
                <p className="font-medium text-ink-900">{title}</p>
                <p className="mt-0.5 text-xs text-ink-400">{detail}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
