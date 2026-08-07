import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyField } from "@/components/copy-field";
import { OperationTimeline } from "@/components/operation-timeline";
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
import { IconLock, IconShield } from "@/components/icons";
import {
  instances,
  money,
  operations,
  projectName,
  siteName,
  volumes,
} from "@/lib/mock-data";

const protectionLabel = {
  standard: "Standard",
  protected: "Protected",
  "warm-standby": "Warm Standby",
} as const;

export function generateStaticParams() {
  return instances.map((i) => ({ id: i.id }));
}

export default async function InstanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const instance = instances.find((i) => i.id === id);
  if (!instance) notFound();

  const attached = volumes.filter((v) => v.attachedTo === instance.name);
  const op = operations.find((o) => o.resourceName === instance.name);

  return (
    <>
      <nav className="mb-4 text-xs text-ink-400">
        <Link href="/console/instances" className="hover:text-ink-700 hover:underline">
          Guild Instances
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-600">{instance.name}</span>
      </nav>

      <PageHeader
        title={instance.name}
        description={`${projectName(instance.projectId)} · ${siteName(instance.siteId)} · created ${instance.createdAt}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm">
              Resize
            </Button>
            <Button variant="secondary" size="sm">
              Snapshot
            </Button>
            <Button variant="secondary" size="sm">
              Restore
            </Button>
            <Button variant="danger" size="sm">
              Delete
            </Button>
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatePill state={instance.state} />
        <Badge tone={instance.protection === "standard" ? "neutral" : "lemon"}>
          {protectionLabel[instance.protection]} tier
        </Badge>
        <Badge tone="sky">{instance.image}</Badge>
        <Badge>{instance.plan}</Badge>
        <Badge tone={instance.passwordSshEnabled ? "amber" : "neutral"}>
          {instance.passwordSshEnabled ? "Password SSH on" : "SSH keys only"}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Connect"
              subtitle="Reachable only from your enrolled devices over the private overlay."
            />
            <div className="space-y-4 px-5 py-4">
              <CopyField
                label="SSH command"
                value={`ssh ${instance.adminUser}@${instance.privateHostname}`}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <CopyField label="Private hostname" value={instance.privateHostname} />
                <CopyField label="Private project IP" value={instance.privateIp} />
              </div>
              <Note>
                <span className="inline-flex items-start gap-2">
                  <IconLock className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                  <span>
                    There is no public SSH route to this instance. If your device
                    is not enrolled, the connection will fail before it reaches
                    the server. A browser recovery console exists for exceptional
                    recovery, not ordinary use.
                  </span>
                </span>
              </Note>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm">
                  Open recovery console
                </Button>
                <Button variant="ghost" size="sm">
                  Manage SSH keys
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Utilisation" subtitle="Last 5 minutes, sampled from the site worker." />
            <div className="grid gap-5 px-5 py-5 sm:grid-cols-3">
              <Meter label="CPU" caption={`${instance.cpuPct}%`} value={instance.cpuPct} />
              <Meter label="Memory" caption={`${instance.memoryPct}%`} value={instance.memoryPct} />
              <Meter label="Disk" caption={`${instance.diskPct}%`} value={instance.diskPct} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Attached volumes" subtitle="Expandable block storage. Shrinking is not offered." />
            {attached.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Size</Th>
                    <Th>Site</Th>
                    <Th className="text-right">Monthly max</Th>
                  </tr>
                </thead>
                <tbody>
                  {attached.map((v) => (
                    <tr key={v.id}>
                      <Td className="font-medium text-ink-900">{v.name}</Td>
                      <Td className="tabular-nums">{v.sizeGb} GB</Td>
                      <Td className="text-ink-500">{siteName(v.siteId)}</Td>
                      <Td className="text-right tabular-nums">{money(v.monthlyMax)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="px-5 py-6 text-sm text-ink-400">
                No volumes attached to this instance.
              </p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Cost" />
            <div className="space-y-3 px-5 py-4 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-500">Hourly price</span>
                <span className="font-medium tabular-nums">
                  ${instance.hourlyPrice.toFixed(3)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Monthly maximum</span>
                <span className="font-medium tabular-nums">
                  {money(instance.monthlyMax)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Protection tier</span>
                <span className="font-medium">
                  {protectionLabel[instance.protection]}
                </span>
              </div>
              <p className="pt-1 text-xs text-ink-400">
                Stopped instances still bill for retained storage. Deleting
                releases storage after the recovery window.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Protection" />
            <div className="space-y-3 px-5 py-4">
              <div className="flex items-start gap-2.5">
                <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-lemon-600" />
                <div className="text-sm">
                  <p className="font-medium text-ink-900">
                    {protectionLabel[instance.protection]}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {instance.lastBackupAt
                      ? `Last verified off-site copy ${instance.lastBackupAt}.`
                      : "No backup taken yet — protection attaches once the instance reaches Ready."}
                  </p>
                </div>
              </div>
              <Button variant="secondary" size="sm">
                View recovery points
              </Button>
            </div>
          </Card>

          {op ? (
            <Card>
              <CardHeader title="Latest operation" subtitle={`${op.kind} · ${op.startedAt}`} />
              <div className="px-5 py-4">
                <OperationTimeline operation={op} />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Access" />
            <div className="divide-y divide-ink-100 text-sm">
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Administrator</span>
                <span className="font-mono text-xs text-ink-800">
                  {instance.adminUser}
                </span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">SSH keys</span>
                <span className="font-medium text-ink-800">Enabled</span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Password SSH</span>
                <span className="font-medium text-ink-800">
                  {instance.passwordSshEnabled ? "Enabled (private only)" : "Disabled"}
                </span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Root password login</span>
                <span className="font-medium text-ink-800">Not offered</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
