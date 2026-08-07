import { SpendChart } from "@/components/spend-chart";
import { BillingWorkspace } from "@/components/billing-workspace";
import { WebhooksCard } from "@/components/webhooks-card";
import { Card, CardHeader, Note, PageHeader, Table, Td, Th } from "@/components/ui";
import {
  buckets,
  clusters,
  databases,
  functions,
  instances,
  invoices,
  ledger,
  money,
  organization,
  paymentMethods,
  projects,
  volumes,
  webhookDeliveries,
  webhookEndpoints,
} from "@/lib/mock-data";

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

  return (
    <>
      <PageHeader
        title="Billing"
        description="One wallet per organization. Metered events become explainable ledger entries — you can always see what you are paying for."
      />

      <BillingWorkspace
        initialWalletBalance={organization.walletBalance}
        monthToDateSpend={organization.monthToDateSpend}
        monthlyForecast={organization.monthlyForecast}
        budget={organization.budget}
        initialLedger={ledger}
        initialPaymentMethods={paymentMethods}
        invoices={invoices}
        initialAutoReload={{
          enabled: organization.autoReloadEnabled,
          amount: organization.autoReloadAmount,
          threshold: organization.autoReloadThreshold,
          maxPerMonth: 4,
        }}
      />

      <Card className="my-4">
        <CardHeader title="Spend over time" subtitle="Daily metered usage across all projects." />
        <SpendChart />
      </Card>

      <WebhooksCard initialEndpoints={webhookEndpoints} deliveries={webhookDeliveries} />

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

      <Note>
        If a payment fails, GuildCloud retries and notifies you, then applies a
        documented grace period. Customer data is never silently deleted for a
        billing failure.
      </Note>
    </>
  );
}
