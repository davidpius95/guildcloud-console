"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  OPERATION_STAGES,
  STAGE_DETAIL,
  STAGE_LABELS,
  type OperationStage,
} from "@/lib/operation-stages";
import { Badge, Card, CardHeader, Meter, cx } from "./ui";
import { IconNetwork, IconPulse, IconServer, IconShield } from "./icons";
import type { Tables } from "@/lib/supabase/types";

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

const statusTone: Record<string, "lemon" | "sky" | "neutral" | "amber" | "rose"> = {
  done: "lemon",
  active: "sky",
  pending: "neutral",
  skipped: "neutral",
  failed: "rose",
};

const statusLabel: Record<string, string> = {
  done: "Done",
  active: "In progress",
  pending: "Pending",
  skipped: "Skipped",
  failed: "Failed",
};

const stageGroups = [
  {
    label: "Plan",
    stages: ["preflight", "capacity_reservation", "operation_created"] as OperationStage[],
    icon: IconPulse,
  },
  {
    label: "Build",
    stages: ["site_worker_dispatch", "proxmox_api_call", "template_cloud_init"] as OperationStage[],
    icon: IconServer,
  },
  {
    label: "Connect",
    stages: ["network_access_attach"] as OperationStage[],
    icon: IconNetwork,
  },
  {
    label: "Protect",
    stages: ["backup_monitoring_attach", "automated_verification", "ready"] as OperationStage[],
    icon: IconShield,
  },
];

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  if (safeSeconds < 60) return `${safeSeconds}s`;
  return `${Math.floor(safeSeconds / 60)}m ${String(safeSeconds % 60).padStart(2, "0")}s`;
}

function getStageDuration(stage: Tables<"operation_stages"> | undefined, now: number) {
  const startedAt = stage?.started_at ? new Date(stage.started_at).getTime() : null;
  if (!startedAt) return null;
  const endedAt = stage?.finished_at ? new Date(stage.finished_at).getTime() : now;
  return formatDuration(Math.floor((endedAt - startedAt) / 1000));
}

function isOperationStage(stage: string | null): stage is OperationStage {
  return OPERATION_STAGES.includes(stage as OperationStage);
}

export function OperationProgress({
  operation: initialOperation,
  stages: initialStages,
}: {
  operation: Tables<"operations">;
  stages: Tables<"operation_stages">[];
}) {
  const router = useRouter();

  // Live-updated operation and stages — seeded from the server component's
  // initial render, then kept fresh by lightweight targeted polling below.
  const [operation, setOperation] = useState(initialOperation);
  const [stages, setStages] = useState(initialStages);

  // Keep in sync if the parent re-renders with new server data (e.g. after
  // a one-time router.refresh() when a terminal state is reached).
  useEffect(() => setOperation(initialOperation), [initialOperation]);
  useEffect(() => setStages(initialStages), [initialStages]);

  // Ticks once a second purely so the elapsed counter below moves. Without a
  // visible clock a two-to-four minute wait reads as a hung page, which is
  // the single most common reason someone reloads or gives up mid-provision.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (TERMINAL_STATES.has(operation.state)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [operation.state]);

  // Targeted polling: instead of router.refresh() (which re-renders the
  // entire page tree — layout, auth, org queries, everything), fetch only
  // the operation + stages from a lightweight API route. Only this component
  // re-renders during polling. When the operation finishes, one final
  // router.refresh() updates the rest of the page (Connect card, badges).
  const didFinalRefresh = useRef(false);
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/operations/${operation.id}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setOperation(data.operation);
      setStages(data.stages);
      if (TERMINAL_STATES.has(data.operation.state) && !didFinalRefresh.current) {
        didFinalRefresh.current = true;
        router.refresh();
      }
    } catch {
      // Silently ignore network blips — the next poll will retry.
    }
  }, [operation.id, router]);

  useEffect(() => {
    if (TERMINAL_STATES.has(operation.state)) return;
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [operation.state, poll]);

  const byStage = new Map(stages.map((s) => [s.stage, s]));
  const currentStage = isOperationStage(operation.current_stage) ? operation.current_stage : null;
  const currentStageIndex = currentStage ? OPERATION_STAGES.indexOf(currentStage) : -1;
  const displayStatusFor = (stage: OperationStage) => {
    const rawStatus = byStage.get(stage)?.status;
    if (rawStatus === "failed") return rawStatus;
    if (operation.state === "succeeded") return rawStatus === "skipped" ? "skipped" : "done";
    if (
      operation.kind === "instance.create" &&
      operation.state === "running" &&
      currentStageIndex >= 0
    ) {
      const stageIndex = OPERATION_STAGES.indexOf(stage);
      if (stageIndex < currentStageIndex && rawStatus !== "skipped") return "done";
      if (stageIndex === currentStageIndex && (rawStatus === "pending" || !rawStatus)) {
        return "active";
      }
    }
    return rawStatus ?? "pending";
  };
  const completedCount = OPERATION_STAGES.filter((stage) => {
    const status = displayStatusFor(stage);
    return status === "done" || status === "skipped";
  }).length;
  const pct = (completedCount / OPERATION_STAGES.length) * 100;
  const activeStage =
    OPERATION_STAGES.find((stage) => displayStatusFor(stage) === "active") ??
    OPERATION_STAGES.find((stage) => displayStatusFor(stage) === "failed") ??
    OPERATION_STAGES[Math.min(completedCount, OPERATION_STAGES.length - 1)];
  const activeRow = byStage.get(activeStage);

  const elapsedSec = Math.max(
    0,
    Math.floor((now - new Date(operation.started_at).getTime()) / 1000),
  );
  const elapsedLabel = `${formatDuration(elapsedSec)} elapsed`;
  const activeStageDuration = getStageDuration(activeRow, now);
  const startedAtLabel = new Date(operation.started_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const isRunning = !TERMINAL_STATES.has(operation.state);
  const isFailed = operation.state === "failed";
  const isSucceeded = operation.state === "succeeded";

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={isSucceeded ? "Server ready" : isFailed ? "Provisioning stopped" : "Provisioning in progress"}
        subtitle={
          isFailed
            ? `Failed: ${operation.failure_reason ?? "unknown error"}`
            : isSucceeded
              ? "Completed. Your server passed verification and is ready to use."
              : "Live build flow. This page refreshes automatically while the worker advances each real step."
        }
      />

      <div className="relative border-b border-ink-100 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-lemon-50)_72%,transparent),color-mix(in_srgb,var(--color-ink-50)_70%,transparent))] px-5 py-5">
        {isRunning ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--color-lemon-400),transparent)] animate-operation-scan"
          />
        ) : null}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-ink-500">
              Current step
            </p>
            <h3 className="mt-1 max-w-xl text-base font-semibold leading-tight text-ink-900">
              {STAGE_LABELS[activeStage]}
            </h3>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-500">
              {isFailed
                ? operation.failure_reason ?? "The worker recorded a failure on this step."
                : STAGE_DETAIL[activeStage] ??
                  "The site worker is advancing this step and will update the timeline automatically."}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-left md:min-w-[21rem]">
            <div className="rounded-lg bg-white/70 px-3 py-2 ring-1 ring-inset ring-ink-100">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Time
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
                {formatDuration(elapsedSec)}
              </p>
            </div>
            <div className="rounded-lg bg-white/70 px-3 py-2 ring-1 ring-inset ring-ink-100">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Step
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
                {completedCount}/{OPERATION_STAGES.length}
              </p>
            </div>
            <div className="rounded-lg bg-white/70 px-3 py-2 ring-1 ring-inset ring-ink-100">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Since
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
                {startedAtLabel}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5">
          <Meter
            value={pct}
            label={isRunning ? "Overall provisioning progress" : "Provisioning result"}
            caption={
              isRunning
                ? `${completedCount}/${OPERATION_STAGES.length} steps · ${elapsedLabel}`
                : `${completedCount}/${OPERATION_STAGES.length} steps`
            }
            tone={isFailed ? "ink" : "lemon"}
          />
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-4" aria-label="Provisioning process flow">
          {stageGroups.map((group) => {
            const Icon = group.icon;
            const done = group.stages.every((stage) => {
              const status = displayStatusFor(stage);
              return status === "done" || status === "skipped";
            });
            const active = group.stages.some((stage) => displayStatusFor(stage) === "active");
            const failed = group.stages.some((stage) => displayStatusFor(stage) === "failed");
            return (
              <div
                key={group.label}
                className={cx(
                  "relative overflow-hidden rounded-lg px-3 py-3 ring-1 ring-inset transition-all duration-300",
                  done && "bg-lemon-50 text-lemon-900 ring-lemon-200",
                  active && "bg-sky-50 text-sky-900 ring-sky-200 shadow-[0_10px_28px_rgba(14,165,233,0.12)]",
                  failed && "bg-rose-50 text-rose-900 ring-rose-200",
                  !done && !active && !failed && "bg-white/70 text-ink-500 ring-ink-100",
                )}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-[linear-gradient(90deg,transparent,#0ea5e9,transparent)] animate-operation-flow"
                  />
                ) : null}
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      "grid h-7 w-7 place-items-center rounded-lg ring-1 ring-inset",
                      done && "bg-lemon-100 ring-lemon-200",
                      active && "bg-white text-sky-700 ring-sky-200 animate-operation-breathe",
                      failed && "bg-white text-rose-700 ring-rose-200",
                      !done && !active && !failed && "bg-ink-50 ring-ink-100",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{group.label}</p>
                    <p className="text-[0.68rem] uppercase tracking-[0.14em] opacity-70">
                      {failed ? "Needs attention" : active ? "Working" : done ? "Complete" : "Queued"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ol className="divide-y divide-ink-100" aria-label="Detailed provisioning steps">
        {OPERATION_STAGES.map((stage: OperationStage) => {
          const row = byStage.get(stage);
          const status = displayStatusFor(stage);
          const isActive = status === "active";
          const isDone = status === "done" || status === "skipped";
          const isStageFailed = status === "failed";
          const duration = getStageDuration(row, now);
          return (
            <li
              key={stage}
              className={cx(
                "px-5 py-3.5 transition-colors",
                isActive && "bg-sky-50/70",
                isStageFailed && "bg-rose-50/60",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-3 text-sm text-ink-800">
                  {isActive ? (
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-100 text-sky-700 ring-1 ring-sky-200"
                    >
                      <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-sky-200 border-t-sky-700" />
                    </span>
                  ) : isDone ? (
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-lemon-100 text-xs font-bold text-lemon-800 ring-1 ring-lemon-200"
                    >
                      ✓
                    </span>
                  ) : isStageFailed ? (
                    <span
                      aria-hidden
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose-100 text-xs font-bold text-rose-700 ring-1 ring-rose-200"
                    >
                      !
                    </span>
                  ) : (
                    <span
                      aria-hidden
                      className="h-6 w-6 shrink-0 rounded-full bg-ink-50 ring-1 ring-inset ring-ink-100"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{STAGE_LABELS[stage]}</span>
                    {duration ? (
                      <span className="mt-0.5 block text-xs tabular-nums text-ink-400">
                        {isActive ? `${duration} on this step` : `Finished in ${duration}`}
                      </span>
                    ) : null}
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  {isActive && activeStageDuration ? (
                    <span className="hidden text-xs tabular-nums text-ink-500 sm:inline">
                      {activeStageDuration}
                    </span>
                  ) : null}
                  <Badge tone={statusTone[status] ?? "neutral"}>
                    {statusLabel[status] ?? status}
                  </Badge>
                </div>
              </div>
              {(isActive || isStageFailed) && (STAGE_DETAIL[stage] || row?.error) ? (
                <p className="mt-2 pl-9 text-xs leading-relaxed text-ink-500">
                  {isStageFailed && row?.error ? row.error : null}
                  {isStageFailed && row?.error && STAGE_DETAIL[stage] ? " " : null}
                  {STAGE_DETAIL[stage]}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
