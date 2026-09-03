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
      {/* overflow-hidden is load-bearing: the container is rounded but its
          children are not, so without it the code block's background and the
          button's corners paint past the rounded edge - visible as the Copy
          button spilling out of the field on a narrow screen. gap-2 is gone
          for the same reason; the button's border-l is the divider, and a gap
          only exposed the container's own edge between the two. */}
      <div className="flex items-stretch overflow-hidden rounded-lg ring-1 ring-inset ring-ink-200">
        <code className="min-w-0 flex-1 break-all bg-ink-50 px-3 py-2 font-mono text-xs text-ink-700">
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
            // self-stretch, not self-start: a short button left the divider
            // stopping mid-field and the code block's background showing
            // beside it on a wrapped, multi-line value.
            "shrink-0 self-stretch border-l border-ink-200 px-3 py-2 text-xs font-medium transition-colors",
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
