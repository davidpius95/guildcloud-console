import { OperationTimeline } from "@/components/operation-timeline";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Meter,
  Note,
  PageHeader,
  Table,
  Td,
  Th,
  cx,
} from "@/components/ui";
import {
  alerts,
  databases,
  instances,
  operations,
  sites,
} from "@/lib/mock-data";

const defaultAlerts = [
  "Instance unavailable",
  "Private-access failure",
  "CPU, memory, or disk pressure",
  "Backup failure",
  "Wallet low",
  "Payment failure",
  "Auto-reload failure",
  "Platform incident",
];

export default function MonitoringPage() {
  return (
    <>
      <PageHeader
        title="Monitoring"
        description="Service health, performance, protection, and alerts. Customer-safe notices here; operator detail sits behind them."
        action={
          <Button variant="secondary">Configure alerts</Button>
        }
      />

      <div className="mb-5">
        <Note>
          MVP automation safely retries jobs and reconnects. Real incidents are
          handled by operators — automatic failover is deliberately future work.
        </Note>
      </div>

      <section className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader title="Service health" subtitle="Per-site utilisation against the 30% capacity reserve." />
          <div className="divide-y divide-ink-100">
            {sites.map((s) => (
              <div key={s.id} className="px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink-900">{s.name}</p>
                    <p className="text-xs text-ink-400">{s.location}</p>
                  </div>
                  <Badge tone={s.acceptingNewWork ? "lemon" : "amber"}>
                    {s.acceptingNewWork ? "Healthy" : "Admission paused"}
                  </Badge>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Meter label="CPU" caption={`${s.usedCpuPct}%`} value={s.usedCpuPct} />
                  <Meter label="Memory" caption={`${s.usedMemoryPct}%`} value={s.usedMemoryPct} />
                  <Meter label="Storage" caption={`${s.usedStoragePct}%`} value={s.usedStoragePct} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Protection status" subtitle="Last verified off-site copy per resource." />
          <Table minWidth="0">
            <thead>
              <tr>
                <Th>Resource</Th>
                <Th>Last backup</Th>
              </tr>
            </thead>
            <tbody>
              {[...instances, ...databases].map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium text-ink-900">{r.name}</Td>
                  <Td
                    className={
                      r.lastBackupAt
                        ? "whitespace-nowrap text-xs text-ink-500"
                        : "text-xs text-amber-600"
                    }
                  >
                    {r.lastBackupAt ?? "Not yet taken"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </section>

      <section className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader
            title="Alerts and incidents"
            subtitle={`${alerts.filter((a) => !a.acknowledged).length} unacknowledged`}
          />
          <div className="divide-y divide-ink-100">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-start gap-3 px-5 py-4">
                <span
                  className={cx(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    a.severity === "critical" && "bg-rose-500",
                    a.severity === "warning" && "bg-amber-500",
                    a.severity === "info" && "bg-ink-300",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink-900">{a.title}</p>
                    {a.acknowledged ? (
                      <Badge>Acknowledged</Badge>
                    ) : (
                      <Badge tone={a.severity === "critical" ? "rose" : "amber"}>
                        Open
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-500">{a.detail}</p>
                  <p className="mt-1.5 text-xs text-ink-400">
                    {a.resource} · opened {a.openedAt}
                  </p>
                </div>
                {!a.acknowledged ? (
                  <Button variant="secondary" size="sm">
                    Help me fix this
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Default alerts" subtitle="Enabled for every organization." />
          <ul className="divide-y divide-ink-100 text-sm">
            {defaultAlerts.map((a) => (
              <li key={a} className="flex items-center justify-between px-5 py-2.5">
                <span className="text-ink-700">{a}</span>
                <Badge tone="lemon">On</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <Card>
        <CardHeader
          title="Recent operations"
          subtitle="Durable, retry-safe records. Failures explain the stage that failed."
        />
        <div className="grid gap-px bg-ink-100 sm:grid-cols-3">
          {operations.map((o) => (
            <div key={o.id} className="bg-white px-5 py-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink-900">{o.kind}</p>
                  <p className="text-xs text-ink-400">{o.resourceName}</p>
                </div>
                <Badge
                  tone={
                    o.state === "succeeded"
                      ? "lemon"
                      : o.state === "failed"
                        ? "rose"
                        : "sky"
                  }
                >
                  {o.state}
                </Badge>
              </div>
              <OperationTimeline operation={o} />
              <p className="mt-3 text-xs text-ink-400">
                {o.startedAt} · {o.id}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
