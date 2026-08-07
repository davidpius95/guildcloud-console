import Link from "next/link";
import { notFound } from "next/navigation";
import { FunctionEnvVars } from "@/components/function-env-vars";
import { FunctionLogs } from "@/components/function-logs";
import { Badge, Card, CardHeader, PageHeader, StatePill } from "@/components/ui";
import {
  functionEnvVars,
  functionLogs,
  functions,
  money,
  projectName,
  siteName,
} from "@/lib/mock-data";

export function generateStaticParams() {
  return functions.map((f) => ({ id: f.id }));
}

export default async function FunctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fn = functions.find((f) => f.id === id);
  if (!fn) notFound();

  return (
    <>
      <nav className="mb-4 text-xs text-ink-400">
        <Link href="/console/functions" className="hover:text-ink-700 hover:underline">
          Guild Functions
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-600">{fn.name}</span>
      </nav>

      <PageHeader
        title={fn.name}
        description={`${projectName(fn.projectId)} · ${siteName(fn.siteId)}`}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <StatePill state={fn.state} />
        <Badge tone="sky">{fn.runtime}</Badge>
        <Badge>{fn.trigger}</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <FunctionEnvVars initialVars={functionEnvVars[fn.id] ?? []} />
          <FunctionLogs initialLogs={functionLogs[fn.id] ?? []} />
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Invocations (24h)" />
            <div className="divide-y divide-ink-100 text-sm">
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Invocations</span>
                <span className="font-medium tabular-nums text-ink-900">
                  {fn.invocations24h.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Error rate</span>
                <span
                  className={
                    fn.errorRate > 1
                      ? "font-medium tabular-nums text-rose-600"
                      : "font-medium tabular-nums text-ink-900"
                  }
                >
                  {fn.errorRate.toFixed(1)}%
                </span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Avg duration</span>
                <span className="font-medium tabular-nums text-ink-900">
                  {fn.avgDurationMs} ms
                </span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Monthly maximum</span>
                <span className="font-medium tabular-nums text-ink-900">
                  {money(fn.monthlyMax)}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
