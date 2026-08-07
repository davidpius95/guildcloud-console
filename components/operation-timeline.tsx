import type { Operation } from "@/lib/types";
import { cx } from "./ui";

export function OperationTimeline({ operation }: { operation: Operation }) {
  return (
    <ol className="space-y-2.5">
      {operation.stages.map((stage) => (
        <li key={stage.label} className="flex items-center gap-3 text-sm">
          <span
            className={cx(
              "grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.6rem] font-bold",
              stage.status === "done" && "bg-lemon-400 text-ink-900",
              stage.status === "active" &&
                "animate-pulse bg-sky-500 text-white",
              stage.status === "failed" && "bg-rose-500 text-white",
              stage.status === "pending" && "bg-ink-100 text-ink-300",
            )}
          >
            {stage.status === "done" ? "✓" : stage.status === "failed" ? "!" : ""}
          </span>
          <span
            className={cx(
              stage.status === "pending" ? "text-ink-300" : "text-ink-700",
              stage.status === "active" && "font-medium text-ink-900",
            )}
          >
            {stage.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
