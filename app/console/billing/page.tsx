import Link from "next/link";
import { Card, CardHeader, Note, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { IconArrowRight } from "@/components/icons";
import { getCurrentUserOrg, getInstancesForOrg } from "@/lib/supabase/queries";

const money = (value: number) => `$${value.toFixed(2)}`;

// Rewritten to show only real data. This page previously rendered a full
// fabricated billing suite from lib/mock-data - invoices, a ledger, payment
// methods, webhook deliveries, a spend chart, and per-project spend across
// resource types that do not exist yet - none of it the customer's. The
// wallet balance and the committed monthly maximum of real instances are the
// two things that are genuinely known today, so they are the two things shown.
export default async function BillingPage() {
  const userOrg = await getCurrentUserOrg();
  const instances = userOrg ? await getInstancesForOrg(userOrg.organization.id) : [];

  const walletBalance = (userOrg?.organization.walletBalanceCents ?? 0) / 100;
  const billable = instances.filter((i) => i.state !== "failed");
  const committedMonthly = billable.reduce((sum, i) => sum + (i.plan?.monthly_max ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Billing"
        description="What you hold, and what your running instances can cost at most this month."
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <Card>
          <Stat
            label="Wallet balance"
            value={money(walletBalance)}
            hint="Prepaid credit held against this organization."
            tone="lemon"
          />
        </Card>
        <Card>
          <Stat
            label="Committed monthly maximum"
            value={money(committedMonthly)}
            hint={`Ceiling if all ${billable.length} instance${billable.length === 1 ? "" : "s"} run the full month.`}
          />
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader
          title="Running instances"
          subtitle="Billed hourly for actual use. The monthly maximum is a ceiling, not a forecast."
        />
        {billable.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-ink-400">
            No billable instances yet.
          </p>
        ) : (
          <Table minWidth="34rem">
            <thead>
              <tr>
                <Th>Instance</Th>
                <Th>Project</Th>
                <Th>Plan</Th>
                <Th className="text-right">Monthly max</Th>
              </tr>
            </thead>
            <tbody>
              {billable.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <Link
                      href={`/console/instances/${i.id}`}
                      className="font-medium text-ink-900 hover:text-lemon-700 hover:underline"
                    >
                      {i.name}
                    </Link>
                  </Td>
                  <Td className="text-ink-500">{i.projectName}</Td>
                  <Td className="whitespace-nowrap text-ink-500">{i.plan?.name ?? "—"}</Td>
                  <Td className="text-right font-medium tabular-nums">
                    {i.plan ? money(i.plan.monthly_max) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Invoices and payment methods" />
        <div className="px-5 py-8 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Not available yet
          </span>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-500">
            Invoice history, saved payment methods, auto-reload, and spend
            analytics aren&rsquo;t wired up yet. Top-ups are arranged directly
            with the team until they are.
          </p>
          <div className="mt-5">
            <Link
              href="/console/support"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-lemon-700 hover:text-lemon-800 hover:underline"
            >
              How to reach support
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </Card>

      <div className="mt-4">
        <Note>
          Stopped instances still bill for retained storage. Deleting an
          instance releases its storage after the documented recovery window.
        </Note>
      </div>
    </>
  );
}
