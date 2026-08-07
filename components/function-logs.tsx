"use client";

import { useState } from "react";
import { Button, Card, CardHeader, cx } from "./ui";
import type { FunctionLogLine } from "@/lib/types";

const sampleMessages: Array<Omit<FunctionLogLine, "timestamp">> = [
  { level: "info", message: "Invocation started" },
  { level: "info", message: "Invocation completed in 91ms" },
  { level: "warn", message: "Cold start — container initialized in 340ms" },
];

const levelStyle: Record<FunctionLogLine["level"], string> = {
  info: "text-ink-300",
  warn: "text-amber-300",
  error: "text-rose-300",
};

function formatNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function FunctionLogs({ initialLogs }: { initialLogs: FunctionLogLine[] }) {
  const [logs, setLogs] = useState(initialLogs);
  const [tick, setTick] = useState(0);

  function refresh() {
    const sample = sampleMessages[tick % sampleMessages.length];
    setLogs((l) => [{ timestamp: formatNow(), ...sample }, ...l]);
    setTick((t) => t + 1);
  }

  return (
    <Card>
      <CardHeader
        title="Logs"
        subtitle="Most recent first. This is a mock console — real logs stream live."
        action={
          <Button variant="secondary" size="sm" onClick={refresh}>
            Refresh
          </Button>
        }
      />
      <div className="max-h-80 overflow-y-auto bg-[#0e1226] px-4 py-3 font-mono text-xs leading-relaxed">
        {logs.map((line, i) => (
          <div key={i} className="flex gap-3">
            <span className="shrink-0 text-ink-500">{line.timestamp}</span>
            <span className={cx("shrink-0 uppercase", levelStyle[line.level])}>
              {line.level}
            </span>
            <span className="text-ink-200">{line.message}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
