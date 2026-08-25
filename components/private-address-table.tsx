import { Badge, Card, CardHeader, Table, Td, Th } from "./ui";

type Row = {
  id: string;
  name: string;
  projectName: string;
  privateIp: string | null;
  privateHostname: string | null;
  state: string;
};

export function PrivateAddressTable({ instances }: { instances: Row[] }) {
  return (
    <Card className="mt-4">
      <CardHeader title="Private address allocation" subtitle="One stable project IP and private DNS name per instance." />
      {instances.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-500">
          No instances yet — private addresses appear here once an instance
          finishes provisioning.
        </p>
      ) : (
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
                <Td className="text-ink-500">{i.projectName}</Td>
                <Td className="font-mono text-xs">
                  {i.privateIp ?? (
                    <span className="text-ink-500">
                      {i.state === "provisioning" ? "Assigning…" : "—"}
                    </span>
                  )}
                </Td>
                <Td className="font-mono text-xs">{i.privateHostname ?? "—"}</Td>
                <Td>
                  <Badge>None</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
