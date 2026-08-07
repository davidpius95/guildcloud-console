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
import { instances, projectName, sites, team } from "@/lib/mock-data";

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

export default function NetworkingPage() {
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

        <Card className="min-w-0">
          <CardHeader title="Enrolled devices" subtitle="Removing a teammate revokes network permission and server login together." />
          <Table minWidth="24rem">
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Role</Th>
                <Th>Device</Th>
                <Th>Last active</Th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <span className="font-medium text-ink-900">{m.name}</span>
                    <p className="text-xs text-ink-400">{m.email}</p>
                  </Td>
                  <Td className="text-ink-500">{m.role}</Td>
                  <Td>
                    <Badge tone={m.deviceEnrolled ? "lemon" : "neutral"}>
                      {m.deviceEnrolled ? "Enrolled" : "Not enrolled"}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">
                    {m.lastActive}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Private address allocation" subtitle="One stable project IP and private DNS name per instance." />
        <Table>
          <thead>
            <tr>
              <Th>Instance</Th>
              <Th>Project</Th>
              <Th>Private IP</Th>
              <Th>Private hostname</Th>
              <Th>Public IP</Th>
            </tr>
          </thead>
          <tbody>
            {instances.map((i) => (
              <tr key={i.id}>
                <Td className="font-medium text-ink-900">{i.name}</Td>
                <Td className="text-ink-500">{projectName(i.projectId)}</Td>
                <Td className="font-mono text-xs">{i.privateIp}</Td>
                <Td className="font-mono text-xs">{i.privateHostname}</Td>
                <Td>
                  <Badge>None</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

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
        <Button variant="secondary">Manage SSH keys</Button>
        <Button variant="secondary">Invite teammate</Button>
        <Button variant="ghost">View access audit</Button>
      </div>
    </>
  );
}
