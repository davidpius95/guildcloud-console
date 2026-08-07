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
import { IconPlus } from "@/components/icons";
import { StorageKeysCard } from "@/components/storage-keys-card";
import { buckets, money, projectName, siteName, storageAccessKeys } from "@/lib/mock-data";

export default function StoragePage() {
  const totalGb = buckets.reduce((s, b) => s + b.usedGb, 0);
  const totalObjects = buckets.reduce((s, b) => s + b.objects, 0);
  const totalCost = buckets.reduce((s, b) => s + b.monthlyMax, 0);

  return (
    <>
      <PageHeader
        title="Object Storage"
        description="S3-compatible application and file storage. Storage classes expand after the MVP."
        action={
          <Button>
            <IconPlus className="h-4 w-4" />
            Create bucket
          </Button>
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-ink-400">Total stored</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
              {totalGb.toFixed(1)} GB
            </p>
          </div>
        </Card>
        <Card>
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-ink-400">Objects</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
              {totalObjects.toLocaleString()}
            </p>
          </div>
        </Card>
        <Card>
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-ink-400">Monthly maximum</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-lemon-700">
              {money(totalCost)}
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Buckets" subtitle="Every bucket is private. Public application ingress arrives with the edge design." />
        <Table>
          <thead>
            <tr>
              <Th>Bucket</Th>
              <Th>Project</Th>
              <Th>Site</Th>
              <Th>Used</Th>
              <Th>Objects</Th>
              <Th>Versioning</Th>
              <Th>Visibility</Th>
              <Th className="text-right">Monthly max</Th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.id} className="transition-colors hover:bg-ink-50">
                <Td className="font-medium text-ink-900">{b.name}</Td>
                <Td className="text-ink-500">{projectName(b.projectId)}</Td>
                <Td className="text-ink-500">{siteName(b.siteId)}</Td>
                <Td className="tabular-nums">{b.usedGb.toFixed(1)} GB</Td>
                <Td className="tabular-nums">{b.objects.toLocaleString()}</Td>
                <Td>
                  <Badge tone={b.versioning ? "lemon" : "neutral"}>
                    {b.versioning ? "Enabled" : "Off"}
                  </Badge>
                </Td>
                <Td>
                  <Badge>Private</Badge>
                </Td>
                <Td className="text-right tabular-nums font-medium">
                  {money(b.monthlyMax)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="my-5">
        <Note>
          Object versioning is how object storage participates in the protection
          tiers. An independent object copy in a third location is planned, not
          promised.
        </Note>
      </div>

      <StorageKeysCard initialKeys={storageAccessKeys} />
    </>
  );
}
