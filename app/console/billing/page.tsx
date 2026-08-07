import { SpendChart } from "@/components/spend-chart";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Meter,
  Note,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
  cx,
} from "@/components/ui";
import { IconWallet } from "@/components/icons";
import {
  buckets,
  clusters,
  databases,
  functions,
  instances,
  ledger,
  money,
  organization,
  projects,
  volumes,
} from "@/lib/mock-data";

const kindTone = {
  "top-up": "lemon",
  usage: "neutral",
  adjustment: "sky",
  refund: "sky",
} as const;

export default function BillingPage() {
  const perProject = projects.map((p) => {
    const compute = instances
      .filter((r) => r.projectId === p.id)
      .reduce((s, r) => s + r.monthlyMax, 0);
    const storage =
      volumes.filter((r) => r.projectId === p.id).reduce((s, r) => s + r.monthlyMax, 0) +
      buckets.filter((r) => r.projectId === p.id).reduce((s, r) => s + r.monthlyMax, 0);
    const managed =
      databases.filter((r) => r.projectId === p.id).reduce((s, r) => s + r.monthlyMax, 0) +
      clusters.filter((r) => r.projectId === p.id).reduce((s, r) => s + r.monthlyMax, 0) +
      functions.filter((r) => r.projectId === p.id).reduce((s, r) => s + r.monthlyMax, 0);
    return { p, compute, storage, managed, total: compute + storage + managed };
  });

  const budgetUsed = (organization.monthToDateSpend / organization.budget) * 100;

  return (
    <>
      <PageHeader
        title="Billing"
        description="One wallet per organization. Metered events become explainable ledger entries — you can always see what you are paying for."
        action={
          <Button>
            <IconWallet className="h-4 w-4" />
            Add funds
          </Button>
        }
      />

      <section className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <Stat
            label="Wallet balance"
            value={money(organization.walletBalance)}
            hint={
              organization.autoReloadEnabled
                ? `Auto-reload ${money(organization.autoReloadAmount)} at ${money(organization.autoReloadThreshold)}`
                : "Auto-reload off"
            }
            tone="lemon"
          />
        </Card>
        <Card>
          <Stat
            label="Month to date"
            value={money(organization.monthToDateSpend)}
            hint="Metered hourly across all projects"
          />
        </Card>
        <Card>
          <Stat
            label="Monthly forecast"
            value={money(organization.monthlyForecast)}
            hint="Based on current running resources"
          />
        </Card>
        <Card>
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-ink-400">Budget</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
              {money(organization.budget)}
            </p>
            <div className="mt-2">
              <Meter value={budgetUsed} caption={`${budgetUsed.toFixed(0)}% used`} label="This month" />
            </div>
          </div>
        </Card>
      </section>

      <section className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader title="Spend over time" subtitle="Daily metered usage across all projects." />
          <SpendChart />
        </Card>

        <Card>
          <CardHeader title="Payment" subtitle="Credit is applied only after a verified provider result." />
          <div className="divide-y divide-ink-100 text-sm">
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-ink-500">Provider</span>
              <Badge tone="lemon">{organization.paymentProvider}</Badge>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-ink-500">Email verified</span>
              <Badge tone="lemon">Yes</Badge>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-ink-500">Payment verified</span>
              <Badge tone="lemon">Yes</Badge>
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <span className="text-ink-500">Auto-reload</span>
              <span className="font-medium text-ink-900">
                {money(organization.autoReloadAmount)} at{" "}
                {money(organization.autoReloadThreshold)}
              </span>
            </div>
            <div className="px-5 py-3">
              <p className="text-xs text-ink-400">
                Paystack and Flutterwave are both supported. Available methods
                depend on your country and currency.
              </p>
            </div>
          </div>
        </Card>
      </section>

      <Card className="mb-4">
        <CardHeader title="Cost by project" subtitle="Monthly maximum if every resource runs the full month." />
        <Table>
          <thead>
            <tr>
              <Th>Project</Th>
              <Th className="text-right">Compute</Th>
              <Th className="text-right">Storage</Th>
              <Th className="text-right">Managed services</Th>
              <Th className="text-right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {perProject.map((r) => (
              <tr key={r.p.id}>
                <Td className="font-medium text-ink-900">{r.p.name}</Td>
                <Td className="text-right tabular-nums">{money(r.compute)}</Td>
                <Td className="text-right tabular-nums">{money(r.storage)}</Td>
                <Td className="text-right tabular-nums">{money(r.managed)}</Td>
                <Td className="text-right tabular-nums font-semibold text-ink-900">
                  {money(r.total)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="Ledger"
          subtitle="Append-only. Every entry carries a unique provider or operation reference."
        />
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Description</Th>
              <Th>Kind</Th>
              <Th>Reference</Th>
              <Th className="text-right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-ink-500">{e.date}</Td>
                <Td className="text-ink-900">{e.description}</Td>
                <Td>
                  <Badge tone={kindTone[e.kind]}>{e.kind}</Badge>
                </Td>
                <Td className="font-mono text-xs text-ink-400">{e.reference}</Td>
                <Td
                  className={cx(
                    "text-right tabular-nums font-medium",
                    e.amount > 0 ? "text-lemon-700" : "text-ink-800",
                  )}
                >
                  {e.amount > 0 ? "+" : ""}
                  {money(Math.abs(e.amount))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <div className="mt-5">
        <Note>
          If a payment fails, GuildCloud retries and notifies you, then applies a
          documented grace period. Customer data is never silently deleted for a
          billing failure.
        </Note>
      </div>
    </>
  );
}
