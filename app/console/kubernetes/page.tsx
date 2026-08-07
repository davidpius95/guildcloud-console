import {
  Badge,
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
import { IconPlus } from "@/components/icons";
import { clusters, money, projectName, siteName } from "@/lib/mock-data";

export default function KubernetesPage() {
  return (
    <>
      <PageHeader
        title="Guild Kubernetes"
        description="One project-isolated shared managed cluster per site. Dedicated clusters are a future premium module."
        action={
          <Button>
            <IconPlus className="h-4 w-4" />
            Add namespace
          </Button>
        }
      />

      <div className="mb-5">
        <Note>
          Backups cover manifests and persistent volumes. Multi-site application
          placement applies only to compatible stateless workloads, and is a
          controlled capability rather than ordinary VM protection.
        </Note>
      </div>

      <Card>
        <CardHeader title={`${clusters.length} clusters`} subtitle="Shared managed control plane, project-isolated namespaces." />
        <Table>
          <thead>
            <tr>
              <Th>Cluster</Th>
              <Th>State</Th>
              <Th>Version</Th>
              <Th>Mode</Th>
              <Th>Site</Th>
              <Th>Namespaces</Th>
              <Th>Workloads</Th>
              <Th className="text-right">Monthly max</Th>
            </tr>
          </thead>
          <tbody>
            {clusters.map((c) => (
              <tr key={c.id} className="transition-colors hover:bg-ink-50">
                <Td>
                  <span className="font-medium text-ink-900">{c.name}</span>
                  <p className="text-xs text-ink-400">{projectName(c.projectId)}</p>
                </Td>
                <Td>
                  <StatePill state={c.state} />
                </Td>
                <Td className="tabular-nums text-ink-500">{c.version}</Td>
                <Td>
                  <Badge>Shared managed</Badge>
                </Td>
                <Td className="text-ink-500">{siteName(c.siteId)}</Td>
                <Td className="tabular-nums">{c.namespaces}</Td>
                <Td className="tabular-nums">{c.workloads}</Td>
                <Td className="text-right tabular-nums font-medium">
                  {money(c.monthlyMax)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="What the MVP includes" />
          <ul className="divide-y divide-ink-100 text-sm">
            {[
              "Project-isolated namespaces with enforced resource quotas",
              "Private ingress inside the project network only",
              "Manifest and persistent-volume backup on the project protection tier",
              "Cluster and workload health in Monitoring",
            ].map((item) => (
              <li key={item} className="px-5 py-3 text-ink-700">
                {item}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Explicit boundaries" />
          <ul className="divide-y divide-ink-100 text-sm">
            {[
              "Dedicated clusters are a future premium module, not available today",
              "Public application ingress and custom domains arrive with the edge design",
              "Active-active placement is limited to compatible stateless workloads",
              "No contractual SLA is published before support performance is measured",
            ].map((item) => (
              <li key={item} className="px-5 py-3 text-ink-500">
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
