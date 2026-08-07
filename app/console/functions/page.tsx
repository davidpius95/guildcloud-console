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
import { functions, money, projectName, siteName } from "@/lib/mock-data";

export default function FunctionsPage() {
  return (
    <>
      <PageHeader
        title="Guild Functions"
        description="Node.js and Python functions for HTTP, schedules, storage events, and PostgreSQL events."
        action={
          <Button>
            <IconPlus className="h-4 w-4" />
            Create function
          </Button>
        }
      />

      <div className="mb-5">
        <Note>
          A container runtime for functions is advanced/future work. Function
          code, configuration, and event history are covered by the project
          protection tier.
        </Note>
      </div>

      <Card>
        <CardHeader title={`${functions.length} functions`} subtitle="Last 24 hours of invocation data." />
        <Table>
          <thead>
            <tr>
              <Th>Function</Th>
              <Th>State</Th>
              <Th>Runtime</Th>
              <Th>Trigger</Th>
              <Th>Site</Th>
              <Th className="text-right">Invocations</Th>
              <Th className="text-right">Error rate</Th>
              <Th className="text-right">Avg duration</Th>
              <Th className="text-right">Monthly max</Th>
            </tr>
          </thead>
          <tbody>
            {functions.map((f) => (
              <tr key={f.id} className="transition-colors hover:bg-ink-50">
                <Td>
                  <span className="font-medium text-ink-900">{f.name}</span>
                  <p className="text-xs text-ink-400">{projectName(f.projectId)}</p>
                </Td>
                <Td>
                  <StatePill state={f.state} />
                </Td>
                <Td>
                  <Badge tone="sky">{f.runtime}</Badge>
                </Td>
                <Td>
                  <Badge>{f.trigger}</Badge>
                </Td>
                <Td className="text-ink-500">{siteName(f.siteId)}</Td>
                <Td className="text-right tabular-nums">
                  {f.invocations24h.toLocaleString()}
                </Td>
                <Td
                  className={
                    f.errorRate > 1
                      ? "text-right tabular-nums font-medium text-rose-600"
                      : "text-right tabular-nums"
                  }
                >
                  {f.errorRate.toFixed(1)}%
                </Td>
                <Td className="text-right tabular-nums">{f.avgDurationMs} ms</Td>
                <Td className="text-right tabular-nums font-medium">
                  {money(f.monthlyMax)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {["HTTP", "Schedule", "Storage event", "PostgreSQL event"].map((t) => (
          <Card key={t}>
            <div className="px-5 py-4">
              <p className="text-sm font-semibold text-ink-900">{t}</p>
              <p className="mt-1 text-xs text-ink-400">
                {functions.filter((f) => f.trigger === t).length} function
                {functions.filter((f) => f.trigger === t).length === 1 ? "" : "s"}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
