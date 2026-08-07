"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { discoveredWorkloads, plans, projects, sites } from "@/lib/mock-data";
import type { MigrationSource } from "@/lib/types";
import { Badge, Button, Card, cx } from "./ui";
import { IconArrowRight, IconCloud } from "./icons";

const sources: Array<{ id: MigrationSource; label: string }> = [
  { id: "AWS", label: "AWS" },
  { id: "DigitalOcean", label: "DigitalOcean" },
  { id: "Hetzner", label: "Hetzner" },
  { id: "Other", label: "Other / self-hosted" },
];

function Section({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#171d36] text-xs font-semibold text-lemon-400">
          {step}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-ink-400">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

export function MigrationWizard() {
  const [source, setSource] = useState<MigrationSource>("AWS");
  const [scanned, setScanned] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [projectId, setProjectId] = useState(projects[0].id);
  const [siteId, setSiteId] = useState(sites[0].id);
  const [planByWorkload, setPlanByWorkload] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(discoveredWorkloads.map((w) => [w.id, "std-2"])),
  );
  const [started, setStarted] = useState(false);

  const totalGb = useMemo(
    () => discoveredWorkloads.reduce((s, w) => s + w.sizeGb, 0),
    [],
  );

  function runScan() {
    setScanning(true);
    setTimeout(() => {
      setScanning(false);
      setScanned(true);
    }, 700);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section
          step={1}
          title="Discover"
          description="Choose the source provider. Credentials are used only to read workload metadata for this scan and are never stored."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {sources.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setSource(s.id);
                  setScanned(false);
                }}
                className={cx(
                  "rounded-lg px-4 py-3 text-left text-sm font-medium ring-1 ring-inset transition-all",
                  s.id === source
                    ? "bg-lemon-50 text-[#171d36] ring-2 ring-lemon-500"
                    : "bg-white ring-ink-200 hover:ring-ink-300",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {!scanned ? (
              <Button size="sm" onClick={runScan} disabled={scanning}>
                {scanning ? "Scanning…" : `Scan ${source} for workloads`}
              </Button>
            ) : (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Badge tone="lemon">
                    {discoveredWorkloads.length} workloads found
                  </Badge>
                  <span className="text-xs text-ink-400">
                    {totalGb} GB total
                  </span>
                </div>
                <div className="overflow-hidden rounded-lg ring-1 ring-inset ring-ink-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-ink-50/60 text-left text-xs font-semibold text-ink-500">
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Kind</th>
                        <th className="px-3 py-2">Spec</th>
                        <th className="px-3 py-2 text-right">Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discoveredWorkloads.map((w) => (
                        <tr key={w.id} className="border-t border-ink-100">
                          <td className="px-3 py-2 font-medium text-ink-900">
                            {w.name}
                          </td>
                          <td className="px-3 py-2">
                            <Badge>{w.kind}</Badge>
                          </td>
                          <td className="px-3 py-2 text-ink-500">{w.spec}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {w.sizeGb} GB
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Section>

        {scanned ? (
          <>
            <Section
              step={2}
              title="Plan"
              description="Map each discovered workload to a GuildCloud site and plan. VM instances need a plan; databases and buckets map to their managed equivalent automatically."
            >
              <div className="mb-4 grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink-500">
                    Destination project
                  </span>
                  <select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-ink-500">
                    Destination site
                  </span>
                  <select
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                    className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
                  >
                    {sites
                      .filter((s) => s.acceptingNewWork)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>

              <div className="space-y-2">
                {discoveredWorkloads.map((w) => (
                  <div
                    key={w.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink-50 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink-900">
                        {w.name}
                      </p>
                      <p className="text-xs text-ink-400">{w.spec}</p>
                    </div>
                    {w.kind === "VM" ? (
                      <select
                        value={planByWorkload[w.id]}
                        onChange={(e) =>
                          setPlanByWorkload((prev) => ({
                            ...prev,
                            [w.id]: e.target.value,
                          }))
                        }
                        className="rounded-lg bg-white px-3 py-1.5 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
                      >
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {p.vcpu} vCPU · {p.memoryGb} GB
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge tone="sky">
                        {w.kind === "Database"
                          ? "Managed PostgreSQL"
                          : "Object Storage"}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </Section>

            <Section
              step={3}
              title="Migrate"
              description="Review the plan, then start the migration. GuildCloud snapshots the source, transfers data, verifies integrity, and only then cuts over — nothing is switched live until verification passes."
            >
              {started ? (
                <div className="rounded-lg bg-lemon-50 px-4 py-3 text-sm text-lemon-900 ring-1 ring-inset ring-lemon-200">
                  Migration started. This is a mock console — no real
                  transfer was initiated. In the real product this would open
                  a durable operation and appear on the{" "}
                  <Link href="/console/migration" className="underline">
                    Migration
                  </Link>{" "}
                  page with a live stage timeline.
                </div>
              ) : (
                <Button onClick={() => setStarted(true)}>
                  Start migration
                  <IconArrowRight className="h-4 w-4" />
                </Button>
              )}
            </Section>
          </>
        ) : null}
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card>
          <div className="flex items-center gap-3 border-b border-ink-100 px-5 py-4">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-100 text-sky-700">
              <IconCloud className="h-4.5 w-4.5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900">Summary</p>
              <p className="text-xs text-ink-400">
                Nothing migrates until you confirm.
              </p>
            </div>
          </div>
          <div className="divide-y divide-ink-100 text-sm">
            <div className="flex justify-between px-5 py-2.5">
              <span className="text-ink-500">Source</span>
              <span className="font-medium text-ink-900">{source}</span>
            </div>
            <div className="flex justify-between px-5 py-2.5">
              <span className="text-ink-500">Workloads</span>
              <span className="font-medium text-ink-900">
                {scanned ? discoveredWorkloads.length : "Not scanned yet"}
              </span>
            </div>
            {scanned ? (
              <>
                <div className="flex justify-between px-5 py-2.5">
                  <span className="text-ink-500">Destination project</span>
                  <span className="font-medium text-ink-900">
                    {projects.find((p) => p.id === projectId)?.name}
                  </span>
                </div>
                <div className="flex justify-between px-5 py-2.5">
                  <span className="text-ink-500">Destination site</span>
                  <span className="font-medium text-ink-900">
                    {sites.find((s) => s.id === siteId)?.name}
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
