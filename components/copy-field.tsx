"use client";

import { useState } from "react";
import { cx } from "./ui";

export function CopyField({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div>
      {label ? (
        <p className="mb-1.5 text-xs font-medium text-ink-500">{label}</p>
      ) : null}
      <div className="flex items-stretch overflow-hidden rounded-lg ring-1 ring-inset ring-ink-200">
        <code className="flex-1 overflow-x-auto whitespace-nowrap bg-ink-50 px-3 py-2 font-mono text-xs text-ink-700">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className={cx(
            "shrink-0 border-l border-ink-200 px-3 text-xs font-medium transition-colors",
            copied
              ? "bg-lemon-100 text-lemon-800"
              : "bg-white text-ink-600 hover:bg-ink-50",
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
