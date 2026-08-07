import Link from "next/link";
import { OperationTimeline } from "@/components/operation-timeline";
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
  StatePill,
  cx,
} from "@/components/ui";
import {
  IconArrowRight,
  IconCloud,
  IconPlus,
  IconShield,
  IconSupport,
  IconWallet,
} from "@/components/icons";
import {
  alerts,
  instances,
  money,
  operations,
  organization,
  projects,
  quotas,
  sites,
} from "@/lib/mock-data";

const accents: Record<string, string> = {
  lemon: "from-lemon-200 to-lemon-100",
  sky: "from-sky-200 to-sky-100",
  violet: "from-violet-200 to-violet-100",
  amber: "from-amber-200 to-amber-100",
};

const accentIconTones: Record<string, string> = {
  lemon: "text-lemon-700",
  sky: "text-sky-700",
  violet: "text-violet-700",
  amber: "text-amber-700",
};

export default function DashboardPage() {
  const runningOp = operations.find((o) => o.state === "running");
  const openAlerts = alerts.filter((a) => !a.acknowledged);
  const readyInstances = instances.filter((i) => i.state === "ready").length;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${organization.name}`}
        description="Private-by-default infrastructure across your admitted sites. Everything below reflects mock data."
        action={
          <div className="flex gap-2">
            <Button href="/console/projects" variant="secondary">
              View all projects
            </Button>
            <Button href="/console/instances/new">
              <IconPlus className="h-4 w-4" />
              Create instance
            </Button>
          </div>
        }
      />

      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <Stat
            label="Wallet balance"
            value={money(organization.walletBalance)}
            hint={`Auto-reload at ${money(organization.autoReloadThreshold)}`}
            tone="lemon"
          />
        </Card>
        <Card>
          <Stat
            label="Month to date"
            value={money(organization.monthToDateSpend)}
            hint={`Forecast ${money(organization.monthlyForecast)} of ${money(organization.budget)} budget`}
          />
        </Card>
        <Card>
          <Stat
            label="Instances ready"
            value={`${readyInstances} / ${instances.length}`}
            hint="1 provisioning, 1 degraded, 1 stopped"
          />
        </Card>
        <Card>
          <Stat
            label="Open alerts"
            value={String(openAlerts.length)}
            hint="1 critical, 1 warning"
            tone={openAlerts.length > 0 ? "rose" : undefined}
          />
        </Card>
      </section>

      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-900">Your projects</h2>
          <Link
            href="/console/projects"
            className="text-xs font-medium text-lemon-700 hover:underline"
          >
            View all projects
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link
            href="/console/projects"
            className="grid min-h-28 place-items-center rounded-xl border-2 border-dashed border-ink-200 text-sm font-medium text-ink-400 transition-colors hover:border-lemon-400 hover:bg-lemon-50 hover:text-lemon-800"
          >
            <span className="flex items-center gap-2">
              <IconPlus className="h-4 w-4" />
              Create new project
            </span>
          </Link>
          {projects.map((p) => (
            <Link key={p.id} href="/console/projects">
              <Card className="h-full transition-shadow hover:shadow-md">
                <div className="flex items-start gap-3 p-4">
                  <span
                    className={cx(
                      "grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br",
                      accents[p.accent],
                    )}
                  >
                    <IconCloud className={cx("h-5 w-5", accentIconTones[p.accent])} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {p.name}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      Created {p.createdAt}
                    </p>
                    <p className="mt-2 text-xs text-ink-500">
                      {p.resourceCount} resources ·{" "}
                      <span className="font-medium tabular-nums text-ink-700">
                        {money(p.monthlySpend)}/mo
                      </span>
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader
            title="Cost analysis"
            subtitle="Daily spend across all projects. Hourly price and monthly maximum are shown before every creation."
            action={
              <Button href="/console/billing" variant="secondary" size="sm">
                Billing
              </Button>
            }
          />
          <SpendChart />
        </Card>

        <Card>
          <CardHeader title="Assigned quota" subtitle="Derived from measured site capacity." />
          <div className="space-y-4 px-5 py-4">
            {quotas.map((q) => (
              <Meter
                key={q.label}
                label={q.label}
                caption={`${q.used} / ${q.limit}`}
                value={(q.used / q.limit) * 100}
              />
            ))}
          </div>
        </Card>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Operation in progress"
            subtitle="Slow work is tracked and explained, never hidden."
          />
          <div className="px-5 py-4">
            {runningOp ? (
              <>
                <p className="mb-3 text-sm font-medium text-ink-900">
                  {runningOp.kind} · {runningOp.resourceName}
                </p>
                <OperationTimeline operation={runningOp} />
                <p className="mt-4 text-xs text-ink-400">
                  Started {runningOp.startedAt} · {runningOp.id}
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-400">No operations running.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Site health" subtitle="Each site keeps a 30% capacity reserve." />
          <div className="divide-y divide-ink-100">
            {sites.map((s) => (
              <div key={s.id} className="px-5 py-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink-900">{s.name}</p>
                    <p className="text-xs text-ink-400">{s.location}</p>
                  </div>
                  <Badge tone={s.acceptingNewWork ? "lemon" : "amber"}>
                    {s.acceptingNewWork ? "Accepting work" : "Admission paused"}
                  </Badge>
                </div>
                <Meter
                  label="CPU"
                  caption={`${s.usedCpuPct}%`}
                  value={s.usedCpuPct}
                />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Alerts and incidents"
            subtitle="Customer-safe notices with operator detail behind them."
            action={
              <Button href="/console/monitoring" variant="ghost" size="sm">
                All
              </Button>
            }
          />
          <div className="divide-y divide-ink-100">
            {alerts.slice(0, 4).map((a) => (
              <div key={a.id} className="px-5 py-3">
                <div className="flex items-start gap-2">
                  <span
                    className={cx(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      a.severity === "critical" && "bg-rose-500",
                      a.severity === "warning" && "bg-amber-500",
                      a.severity === "info" && "bg-ink-300",
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-900">{a.title}</p>
                    <p className="mt-0.5 text-xs text-ink-400">
                      {a.resource} · {a.openedAt}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader
            title="Instances"
            subtitle="Private hostnames only — no public SSH route exists for MVP instances."
            action={
              <Button href="/console/instances" variant="secondary" size="sm">
                Manage
              </Button>
            }
          />
          <div className="divide-y divide-ink-100">
            {instances.slice(0, 4).map((i) => (
              <Link
                key={i.id}
                href={`/console/instances/${i.id}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-ink-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">
                    {i.name}
                  </p>
                  <p className="truncate font-mono text-xs text-ink-400">
                    {i.privateHostname}
                  </p>
                </div>
                <span className="hidden shrink-0 text-xs text-ink-500 sm:block">
                  {i.plan}
                </span>
                <span className="shrink-0">
                  <StatePill state={i.state} />
                </span>
                <IconArrowRight className="h-4 w-4 shrink-0 text-ink-300" />
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Protection" subtitle="A backup is not valid until a restore drill proves it." />
          <div className="space-y-3 px-5 py-4">
            <div className="flex items-start gap-3">
              <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-lemon-600" />
              <div>
                <p className="text-sm font-medium text-ink-900">Standard</p>
                <p className="text-xs text-ink-400">
                  Daily encrypted off-site backup, seven-day retention, restore
                  into a healthy site.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-lemon-600" />
              <div>
                <p className="text-sm font-medium text-ink-900">Protected</p>
                <p className="text-xs text-ink-400">
                  More frequent recovery points, longer retention option,
                  priority restore handling.
                </p>
              </div>
            </div>
            <Note>
              Warm Standby is a premium add-on with limited capacity, offered
              only after full-site drills pass.
            </Note>
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-start gap-4 p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-600">
              <IconSupport className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink-900">
                Help &amp; Support
              </p>
              <p className="mt-1 text-xs text-ink-400">
                If you have a question or run into a problem, self-service
                diagnosis comes first — the support team is right behind it.
              </p>
              <Button href="/console/support" variant="secondary" size="sm" className="mt-3">
                Contact support
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-start gap-4 p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-lemon-100 text-lemon-700">
              <IconWallet className="h-5 w-5" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink-900">
                Billing &amp; Payments
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
                {money(organization.walletBalance)}
              </p>
              <p className="text-xs text-ink-400">Total wallet balance</p>
              <Button href="/console/billing" variant="secondary" size="sm" className="mt-3">
                View invoices
              </Button>
            </div>
          </div>
        </Card>
      </section>
    </>
  );
}
