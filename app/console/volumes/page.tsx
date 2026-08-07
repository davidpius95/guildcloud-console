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
import { money, projectName, siteName, volumes } from "@/lib/mock-data";

export default function VolumesPage() {
  const totalGb = volumes.reduce((s, v) => s + v.sizeGb, 0);

  return (
    <>
      <PageHeader
        title="Guild Volumes"
        description="Expandable block storage for instances and persistent workloads."
        action={
          <Button>
            <IconPlus className="h-4 w-4" />
            Create volume
          </Button>
        }
      />

      <div className="mb-5">
        <Note tone="warning">
          Disk expansion is supported and takes effect without recreating the
          instance. Disk shrinking is not offered in the MVP — size up
          deliberately.
        </Note>
      </div>

      <Card>
        <CardHeader
          title={`${volumes.length} volumes · ${totalGb} GB provisioned`}
          subtitle="Volumes live in the same site as the instance they serve."
        />
        <Table>
          <thead>
            <tr>
              <Th>Volume</Th>
              <Th>State</Th>
              <Th>Size</Th>
              <Th>Attached to</Th>
              <Th>Project</Th>
              <Th>Site</Th>
              <Th className="text-right">Monthly max</Th>
            </tr>
          </thead>
          <tbody>
            {volumes.map((v) => (
              <tr key={v.id} className="transition-colors hover:bg-ink-50">
                <Td className="font-medium text-ink-900">{v.name}</Td>
                <Td>
                  <StatePill state={v.state} />
                </Td>
                <Td className="tabular-nums">{v.sizeGb} GB</Td>
                <Td>
                  {v.attachedTo ? (
                    <span className="text-ink-700">{v.attachedTo}</span>
                  ) : (
                    <Badge tone="amber">Unattached</Badge>
                  )}
                </Td>
                <Td className="text-ink-500">{projectName(v.projectId)}</Td>
                <Td className="text-ink-500">{siteName(v.siteId)}</Td>
                <Td className="text-right tabular-nums font-medium">
                  {money(v.monthlyMax)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
