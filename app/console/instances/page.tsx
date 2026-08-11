import Link from "next/link";
import {
  Button,
  Card,
  CardHeader,
  Note,
  PageHeader,
  StatePill,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { IconLock, IconPlus, OSLogo } from "@/components/icons";
import { formatDate } from "@/lib/mock-data";
import { getCurrentUserOrg, getInstancesForOrg } from "@/lib/supabase/queries";
import type { ResourceState } from "@/lib/types";

const money = (value: number) => `$${value.toFixed(2)}`;

export default async function InstancesPage() {
  const userOrg = await getCurrentUserOrg();
  const instances = userOrg ? await getInstancesForOrg(userOrg.organization.id) : [];
  const totalMonthly = instances.reduce((sum, i) => sum + (i.plan?.monthly_max ?? 0), 0);

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
          title={`${instances.length} instance${instances.length === 1 ? "" : "s"}`}
          subtitle={
            instances.length
              ? `Combined monthly maximum ${money(totalMonthly)} · billed hourly for actual use`
              : undefined
          }
        />
        {instances.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-ink-500">No instances yet.</p>
            <p className="mt-1 text-xs text-ink-400">
              Create one to get a real Proxmox VM with a private IP and
              hostname enrolled over Tailscale.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>State</Th>
                <Th>Plan</Th>
                <Th>Image</Th>
                <Th>Site</Th>
                <Th>Private hostname</Th>
                <Th>Created</Th>
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
                    <p className="text-xs text-ink-400">{i.projectName}</p>
                  </Td>
                  <Td>
                    <StatePill state={i.state as ResourceState} />
                  </Td>
                  <Td>
                    <span className="whitespace-nowrap">{i.plan?.name ?? "—"}</span>
                    {i.plan ? (
                      <p className="text-xs text-ink-400">
                        {i.plan.vcpu} vCPU · {i.plan.memory_gb} GB · {i.plan.disk_gb} GB
                      </p>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-500">
                    <span className="inline-flex items-center gap-1.5">
                      {i.imageId ? <OSLogo imageId={i.imageId} className="h-4 w-4" /> : null}
                      {i.imageLabel}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-ink-500">{i.siteId}</Td>
                  <Td>
                    {i.privateHostname ? (
                      <>
                        <span className="font-mono text-xs text-ink-600">
                          {i.privateHostname}
                        </span>
                        <p className="font-mono text-xs text-ink-400">{i.privateIp ?? "—"}</p>
                      </>
                    ) : (
                      <span className="text-xs text-ink-400">Assigning…</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-500">{formatDate(i.createdAt)}</Td>
                  <Td className="text-right tabular-nums font-medium">
                    {i.plan ? money(i.plan.monthly_max) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6">
        <Card>
          <CardHeader title="Lifecycle boundaries" subtitle="What the MVP does and does not promise." />
          <div className="divide-y divide-ink-100 text-sm">
            {[
              ["CPU and memory resize", "Up or down, with restart or migration warnings before you confirm."],
              ["Disk expansion", "Supported. Disk shrinking is not offered in the MVP."],
              ["Snapshots and restore", "Restores never silently overwrite a live workload."],
              ["Deletion", "Stops and permanently destroys the underlying server — see the Delete button on each instance's page."],
              ["Password SSH", "Opt-in, private route only, revealed once and never stored long-term, rate-limited and audited."],
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
