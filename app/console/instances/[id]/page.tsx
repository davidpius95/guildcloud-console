import Link from "next/link";
import { notFound } from "next/navigation";
import { CopyField } from "@/components/copy-field";
import { InstanceActions, RecoveryConsoleButton } from "@/components/instance-actions";
import { DeleteInstanceButton } from "@/components/delete-instance-button";
import { OperationTimeline } from "@/components/operation-timeline";
import { OperationProgress } from "@/components/operation-progress";
import { DeletionProgress } from "@/components/deletion-progress";
import { RevealPasswordButton } from "@/components/reveal-password-button";
import { RemoteAccessGuide } from "@/components/remote-access-guide";
import { getInstanceWithOperation, getCatalogPlans } from "@/lib/supabase/queries";
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
import { IconLock, IconShield, OSLogo, imageIdFromLabel } from "@/components/icons";

const protectionLabel = {
  standard: "Standard",
  protected: "Protected",
  "warm-standby": "Warm Standby",
} as const;

export default async function InstanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Real (Phase 2) instances are created with a crypto.randomUUID() id via
  // createInstance and never appear in lib/mock-data.ts's Instance[] -
  // check the real table first and render the provisioning-progress view
  // for those, falling back to the existing all-mock rendering below for
  // every id that came from mock-data.
  const real = await getInstanceWithOperation(id);
  if (real) {
    const { instance: realInstance, operation, stages, snapshots } = real;
    const availablePlans = await getCatalogPlans();

    const plan = realInstance.catalog_plans as unknown as {
      name: string;
      vcpu: number;
      memory_gb: number;
      disk_gb: number;
      hourly_price: number;
      monthly_max: number;
    } | null;

    const project = realInstance.projects as unknown as { name: string } | null;

    return (
      <>
        <nav className="mb-4 text-xs text-ink-500">
          <Link href="/console/instances" className="hover:text-ink-700 hover:underline">
            Guild Instances
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink-600">{realInstance.name}</span>
        </nav>

        <PageHeader
          title={realInstance.name}
          description={`${project?.name ?? realInstance.site_id} · ${realInstance.site_id} · ${plan ? plan.name : realInstance.catalog_plan_id}`}
          action={
            realInstance.state === "deleting" ? undefined : (
              <InstanceActions
                instance={{
                  id: realInstance.id,
                  name: realInstance.name,
                  state: realInstance.state,
                  catalog_plan_id: realInstance.catalog_plan_id,
                  diskGb: plan?.disk_gb ?? 40,
                }}
                availablePlans={availablePlans}
                snapshots={snapshots}
                isReal={true}
              />
            )
          }
        />

        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Badge
            tone={
              realInstance.state === "ready"
                ? "lemon"
                : realInstance.state === "failed" || realInstance.state === "deleting"
                  ? "rose"
                  : "sky"
            }
          >
            {realInstance.state}
          </Badge>
          {plan ? (
            <Badge tone="sky">
              {plan.name} ({plan.vcpu} vCPU · {plan.memory_gb} GB RAM)
            </Badge>
          ) : null}
          {/* Same identifier, without naming the execution plane at the
              customer: GuildCloud owns the control plane and customers never
              address Proxmox directly (§5), so surfacing its vendor name here
              only invites them to reason about a system they are promised
              they never have to. Still shown, because it is the number
              support will ask for. */}
          {realInstance.proxmox_vmid ? (
            <Badge tone="neutral">Server ID {realInstance.proxmox_vmid}</Badge>
          ) : null}
          {realInstance.catalog_image_id ? (
            <span className="inline-flex items-center gap-1">
              <OSLogo imageId={realInstance.catalog_image_id} className="h-4 w-4" />
              <Badge tone="sky">
                {(realInstance.catalog_images as unknown as { name: string; version: string } | null)?.name ?? realInstance.catalog_image_id}
              </Badge>
            </span>
          ) : null}
        </div>

        {realInstance.state === "deleting" ? (
          <div className="mb-6">
            <DeletionProgress />
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            {operation ? (
              <OperationProgress operation={operation} stages={stages} />
            ) : (
              <Note tone="warning">No operation found for this instance yet.</Note>
            )}

            {snapshots && snapshots.length > 0 ? (
              <Card>
                <CardHeader
                  title="Snapshots & Recovery Points"
                  subtitle={`${snapshots.length} point-in-time recovery point${snapshots.length === 1 ? "" : "s"} available.`}
                />
                <Table>
                  <thead>
                    <tr>
                      <Th>Name</Th>
                      <Th>Proxmox ID</Th>
                      <Th>Status</Th>
                      <Th className="text-right">Created</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => (
                      <tr key={s.id}>
                        <Td className="font-medium text-ink-900">{s.name}</Td>
                        <Td className="font-mono text-xs text-ink-600">{s.proxmox_snapname}</Td>
                        <Td>
                          <Badge tone={s.state === "ready" ? "lemon" : "sky"}>{s.state}</Badge>
                        </Td>
                        <Td className="text-right text-xs text-ink-500">
                          {new Date(s.created_at).toLocaleString()}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            ) : null}
          </div>
          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Connect"
                subtitle={
                  realInstance.private_hostname
                    ? "Reachable only from your enrolled devices over the private overlay."
                    : "Private networking enrolls once the instance reaches Ready."
                }
              />
              <div className="space-y-4 px-5 py-4">
                {realInstance.private_hostname ? (
                  <>
                    <CopyField
                      label="SSH command"
                      value={`ssh guildvm@${realInstance.private_hostname}`}
                    />
                    <div className="space-y-4">
                      <CopyField label="Private hostname" value={realInstance.private_hostname} />
                      <CopyField
                        label="Private project IP"
                        value={realInstance.private_ip ? String(realInstance.private_ip) : "—"}
                      />
                    </div>
                  </>
                ) : (
                  <Note>
                    <span className="inline-flex items-start gap-2">
                      <IconLock className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                      <span>
                        A private IP and hostname are assigned once this
                        instance reaches the network step in the progress
                        timeline — SSH connection details will appear here
                        automatically.
                      </span>
                    </span>
                  </Note>
                )}
                <Note>
                  <span className="inline-flex items-start gap-2">
                    <IconLock className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                    <span>
                      There is no public SSH route to this instance. If your
                      device is not enrolled on the private overlay, the
                      connection will fail before it reaches the server.
                    </span>
                  </span>
                </Note>
                <RemoteAccessGuide variant="compact" />

                {realInstance.password_ssh_enabled ? (
                  realInstance.state === "ready" ? (
                    <div className="space-y-2">
                      <RevealPasswordButton instanceId={realInstance.id} />
                      <p className="text-xs text-ink-500">
                        Change this (<code className="font-mono">passwd</code>) once
                        you're in, and{" "}
                        <Link
                          href="/console/settings"
                          className="font-medium text-lemon-700 underline hover:text-lemon-800"
                        >
                          add an SSH key
                        </Link>{" "}
                        so you don't need a password next time.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-ink-500">
                      Password SSH is enabled — the password can be revealed
                      once this instance reaches Ready.
                    </p>
                  )
                ) : null}
              </div>
            </Card>

            {plan ? (
              <Card>
                <CardHeader title="Plan Specs & Pricing" />
                <div className="space-y-3 px-5 py-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink-500">Plan</span>
                    <span className="font-medium">{plan.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-500">vCPU</span>
                    <span className="font-medium tabular-nums">{plan.vcpu} core{plan.vcpu > 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-500">Memory</span>
                    <span className="font-medium tabular-nums">{plan.memory_gb} GB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-500">Disk</span>
                    <span className="font-medium tabular-nums">{plan.disk_gb} GB</span>
                  </div>
                  <div className="flex justify-between border-t border-ink-100 pt-2">
                    <span className="text-ink-500">Monthly Maximum</span>
                    <span className="font-medium tabular-nums">${Number(plan.monthly_max).toFixed(2)}</span>
                  </div>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  // Every instance is a real Supabase row. This page used to fall through to
  // a ~200-line mock rendering path keyed off lib/mock-data's fictional
  // instances (fake utilisation meters, fake volumes, fake cost, a fake
  // "recovery console"), reachable by visiting any of those hardcoded ids.
  notFound();
}
