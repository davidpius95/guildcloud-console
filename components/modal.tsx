"use client";

import { useEffect } from "react";
import { cx } from "./ui";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ink-950/50 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cx(
          "relative w-full overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-inset ring-ink-100",
          width,
        )}
      >
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 id="modal-title" className="text-sm font-semibold text-ink-900">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-xs text-ink-500">{description}</p>
          ) : null}
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-ink-100 bg-ink-50 px-5 py-3">
          {footer}
        </div>
      </div>
    </div>
  );
}
