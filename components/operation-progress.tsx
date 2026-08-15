"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  OPERATION_STAGES,
  STAGE_DETAIL,
  STAGE_LABELS,
  type OperationStage,
} from "@/lib/operation-stages";
import { Badge, Card, CardHeader, Meter, cx } from "./ui";
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

export function OperationProgress({
  operation,
  stages,
}: {
  operation: Tables<"operations">;
  stages: Tables<"operation_stages">[];
}) {
  const router = useRouter();
  // Ticks once a second purely so the elapsed counter below moves. Without a
  // visible clock a two-to-four minute wait reads as a hung page, which is
  // the single most common reason someone reloads or gives up mid-provision.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (TERMINAL_STATES.has(operation.state)) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [operation.state]);

  // The site worker advances stages continuously within its own loop, not
  // in lockstep with this page - polling by re-fetching the server
  // component is still the simplest way to show genuine progress without
  // a separate realtime channel for a single-operation view.
  useEffect(() => {
    if (TERMINAL_STATES.has(operation.state)) return;
    const interval = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(interval);
  }, [operation.state, router]);

  const byStage = new Map(stages.map((s) => [s.stage, s]));
  const completedCount = OPERATION_STAGES.filter((stage) => {
    const status = byStage.get(stage)?.status;
    return status === "done" || status === "skipped";
  }).length;
  const pct = (completedCount / OPERATION_STAGES.length) * 100;

  const elapsedSec = Math.max(
    0,
    Math.floor((now - new Date(operation.started_at).getTime()) / 1000),
  );
  const elapsedLabel =
    elapsedSec < 60
      ? `${elapsedSec}s elapsed`
      : `${Math.floor(elapsedSec / 60)}m ${String(elapsedSec % 60).padStart(2, "0")}s elapsed`;

  const isRunning = !TERMINAL_STATES.has(operation.state);

  return (
    <Card>
      <CardHeader
        title="Setting up your server"
        subtitle={
          operation.state === "failed"
            ? `Failed: ${operation.failure_reason ?? "unknown error"}`
            : operation.state === "succeeded"
              ? "Completed — your server is ready to use."
              : "This usually takes two to four minutes. You can leave this page; it keeps going."
        }
      />
      <div className="px-5 pt-4">
        <Meter
          value={pct}
          caption={
            isRunning
              ? `${completedCount}/${OPERATION_STAGES.length} steps · ${elapsedLabel}`
              : `${completedCount}/${OPERATION_STAGES.length} steps`
          }
          tone="lemon"
        />
      </div>
      <ol className="divide-y divide-ink-100">
        {OPERATION_STAGES.map((stage: OperationStage) => {
          const row = byStage.get(stage);
          const status = row?.status ?? "pending";
          const isActive = status === "active";
          return (
            <li
              key={stage}
              className={cx(
                "px-5 py-3 transition-colors",
                isActive && "bg-sky-50/60",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5 text-sm text-ink-800">
                  {isActive ? (
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600"
                    />
                  ) : status === "done" ? (
                    <span aria-hidden className="flex h-3 w-3 shrink-0 items-center justify-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-lemon-500" />
                    </span>
                  ) : (
                    <span aria-hidden className="h-3 w-3 shrink-0" />
                  )}
                  {STAGE_LABELS[stage]}
                </span>
                <Badge tone={statusTone[status] ?? "neutral"}>
                  {statusLabel[status] ?? status}
                </Badge>
              </div>
              {/* Only under the running step: explains what the wait is for,
                  so a slow stage reads as expected rather than broken. */}
              {isActive && STAGE_DETAIL[stage] ? (
                <p className="mt-1.5 pl-[22px] text-xs leading-relaxed text-ink-500">
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
