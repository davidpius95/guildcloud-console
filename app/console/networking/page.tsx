import { Suspense } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Note,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { IconLock } from "@/components/icons";
import { AccessPolicyCard } from "@/components/access-policy-card";
import { EnrolledDevicesCard } from "@/components/enrolled-devices-card";
import { PrivateAddressTable } from "@/components/private-address-table";
import { RemoteAccessGuide } from "@/components/remote-access-guide";
import { sites } from "@/lib/mock-data";
import {
  getAccessGrantsForOrg,
  getCurrentUserOrg,
  getInstancesForOrg,
  getInstancesWithPrivateNetworkForOrg,
  getMembersForOrg,
  getProjectsForOrg,
} from "@/lib/supabase/queries";

const zones = [
  {
    name: "Management",
    purpose: "Proxmox management, site workers, switches, and operators.",
    reachable: "Never customer reachable",
    tone: "neutral" as const,
  },
  {
    name: "Tenant",
    purpose: "Project-isolated Guild Instance and service networks.",
    reachable: "Allowed project users and workloads only",
    tone: "lemon" as const,
  },
  {
    name: "Backup",
    purpose: "Backup server and replication traffic.",
    reachable: "Never customer reachable",
    tone: "neutral" as const,
  },
  {
    name: "Edge (future)",
    purpose: "Public DNS, TLS, and ingress via outbound site tunnel.",
    reachable: "Only explicitly published applications, later",
    tone: "amber" as const,
  },
];

export default async function NetworkingPage() {
  const userOrg = await getCurrentUserOrg();
  const realInstances = userOrg
    ? await getInstancesWithPrivateNetworkForOrg(userOrg.organization.id)
    : [];
  const [accessGrants, members, projects, instancesForGrants] = userOrg
    ? await Promise.all([
        getAccessGrantsForOrg(userOrg.organization.id),
        getMembersForOrg(userOrg.organization.id),
        getProjectsForOrg(userOrg.organization.id),
        getInstancesForOrg(userOrg.organization.id),
      ])
    : [[], [], [], []];

  return (
    <>
      <PageHeader
        title="Networking and private access"
        description="Each instance gets a stable private project IP and a friendly private hostname. Your devices connect outbound over an encrypted overlay — there is no inbound port forwarding."
      />

      <div className="mb-5">
        <Note>
          <span className="inline-flex items-start gap-2">
            <IconLock className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
            <span>
              You should never need to understand tailnets, routes, or enrollment
              secrets. GuildCloud manages private access; your project policy
              decides who can reach what.
            </span>
          </span>
        </Note>
      </div>

      <RemoteAccessGuide className="mb-5" />

      <div className="mb-4">
        <AccessPolicyCard
          grants={accessGrants}
          members={members}
          projects={projects}
          realInstances={instancesForGrants.map((i) => ({ id: i.id, name: i.name, projectId: i.projectId }))}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="Network zones" subtitle="The boundary customers are actually promised." />
          <div className="divide-y divide-ink-100">
            {zones.map((z) => (
              <div key={z.name} className="px-5 py-3.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-ink-900">{z.name}</p>
                  <Badge tone={z.tone}>{z.reachable}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-400">{z.purpose}</p>
              </div>
            ))}
          </div>
        </Card>

        <Suspense fallback={<Card className="min-w-0"><div /></Card>}>
          <EnrolledDevicesCard members={members} currentUserId={userOrg?.userId ?? null} />
        </Suspense>
      </div>

      <PrivateAddressTable instances={realInstances} />

      <Card className="mt-4">
        <CardHeader title="Site connectivity" subtitle="Sites connect outbound; no inbound public access is required." />
        <Table>
          <thead>
            <tr>
              <Th>Site</Th>
              <Th>Location</Th>
              <Th>Status</Th>
              <Th>Admission</Th>
              <Th>Capacity reserve</Th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium text-ink-900">{s.name}</Td>
                <Td className="text-ink-500">{s.location}</Td>
                <Td>
                  <Badge tone={s.status === "healthy" ? "lemon" : "amber"}>
                    {s.status === "healthy" ? "Healthy" : "Admission paused"}
                  </Badge>
                </Td>
                <Td className="text-ink-500">
                  {s.acceptingNewWork ? "Accepting new work" : "Paused"}
                </Td>
                <Td className="tabular-nums">{s.capacityReservePct}%</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" href="/console/settings">
          Manage SSH keys
        </Button>
        <Button variant="secondary" href="/console/settings">
          Invite teammate
        </Button>
        <Button variant="ghost">View access audit</Button>
      </div>
    </>
  );
}
