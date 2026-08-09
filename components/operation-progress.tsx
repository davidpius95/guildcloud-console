"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OPERATION_STAGES, STAGE_LABELS, type OperationStage } from "@/lib/operation-stages";
import { Badge, Card, CardHeader } from "./ui";
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

  // The site worker advances one stage per pg_cron tick (~every 20s), so
  // this polls by re-fetching the server component rather than opening a
  // realtime subscription - simplest thing that shows genuine progress
  // without a separate streaming channel for a single-operation view.
  useEffect(() => {
    if (TERMINAL_STATES.has(operation.state)) return;
    const interval = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(interval);
  }, [operation.state, router]);

  const byStage = new Map(stages.map((s) => [s.stage, s]));

  return (
    <Card>
      <CardHeader
        title="Provisioning progress"
        subtitle={
          operation.state === "failed"
            ? `Failed: ${operation.failure_reason ?? "unknown error"}`
            : operation.state === "succeeded"
              ? "Completed"
              : "Updates automatically as the site worker advances each stage."
        }
      />
      <ol className="divide-y divide-ink-100">
        {OPERATION_STAGES.map((stage: OperationStage) => {
          const row = byStage.get(stage);
          const status = row?.status ?? "pending";
          return (
            <li key={stage} className="flex items-center justify-between gap-3 px-5 py-3">
              <span className="text-sm text-ink-800">{STAGE_LABELS[stage]}</span>
              <Badge tone={statusTone[status] ?? "neutral"}>{statusLabel[status] ?? status}</Badge>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
