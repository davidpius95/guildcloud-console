"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

type CopyState = "idle" | "copied" | "failed";

export function CopyField({
  value,
  label,
  copyLabel,
}: {
  value: string;
  label?: string;
  // Distinguishes this button from every other "Copy" on the page. A screen
  // reader reading the enrollment page otherwise met three identical "Copy"
  // buttons with nothing to tell them apart.
  copyLabel?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clearing the timer on unmount: closing the reveal modal inside the 1.6s
  // window left a timeout writing state into an unmounted component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function flash(next: CopyState) {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  }

  async function copy() {
    try {
      // writeText rejects on an insecure origin or a denied permission, and
      // the old call ignored the promise entirely - so the button claimed
      // "Copied" for a clipboard that had never received the password.
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      flash("copied");
    } catch {
      // Select the text instead, so the keyboard shortcut still works and
      // the customer is not left believing a one-time secret is safely on
      // their clipboard when it is not.
      const node = codeRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      flash("failed");
    }
  }

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
        <code
          ref={codeRef}
          className="min-w-0 flex-1 break-all bg-ink-50 px-3 py-2 font-mono text-xs text-ink-700"
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          aria-label={copyLabel}
          className={cx(
            // self-stretch, not self-start: a short button left the divider
            // stopping mid-field and the code block's background showing
            // beside it on a wrapped, multi-line value.
            "shrink-0 self-stretch border-l border-ink-200 px-3 py-2 text-xs font-medium transition-colors",
            state === "copied" && "bg-lemon-100 text-lemon-800",
            state === "failed" && "bg-amber-50 text-amber-800",
            state === "idle" && "bg-white text-ink-600 hover:bg-ink-50",
          )}
        >
          {state === "copied" ? "Copied" : state === "failed" ? "Select + copy" : "Copy"}
        </button>
      </div>
      {/* Announced, not just coloured - the button's own label change is easy
          to miss, and on a one-time secret "did that copy?" matters. */}
      <p aria-live="polite" className="sr-only">
        {state === "copied"
          ? "Copied to clipboard"
          : state === "failed"
            ? "Could not copy automatically. The text is selected — press Ctrl or Cmd + C."
            : ""}
      </p>
    </div>
  );
}
