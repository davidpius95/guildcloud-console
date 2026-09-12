"use client";

import { useEffect, useId, useRef } from "react";
import { cx } from "./ui";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

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
  // useId, not a hardcoded "modal-title": two mounted modals (a page can
  // hold several, each rendering null until opened) produced duplicate DOM
  // ids, and aria-labelledby then resolved to whichever came first.
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog. Without this, focus stays on the trigger
    // behind the backdrop, so the first Tab walks the page underneath
    // instead of the dialog - and a screen reader never announces that a
    // dialog opened at all.
    const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      // Trap Tab inside the dialog: the content behind is inert to the eye
      // but was still reachable by keyboard, which let someone tab onto the
      // page under the backdrop and act on it while the dialog was open.
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreFocusTo.current?.focus?.();
    };
  }, [open, onClose]);

  // Lock the page behind the dialog. Scrolling the wheel over the backdrop
  // used to scroll the page underneath, so closing the dialog dropped the
  // customer somewhere they never chose to navigate to.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    // overflow-y-auto + items-start with an auto margin: a dialog taller than
    // the viewport used to be centred by `items-center`, which overflows in
    // BOTH directions on a fixed parent - the title was clipped off the top
    // and the footer's confirm button sat below the fold with nothing able to
    // scroll to either. At 375x812 that put 84px of a password dialog, the
    // "Yes, reveal it now" button included, permanently out of reach.
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain">
      <div
        // bg-ink-950 is NOT usable here: globals.css repurposes that token as
        // adaptive text colour inside .console-root, so in dark mode the
        // scrim resolved to white and every modal flashed the page white
        // instead of dimming it. Pinned to the literal light-theme ink-950,
        // per the same convention the logo marks and primary-button text use.
        className="fixed inset-0 bg-[rgba(14,18,38,0.55)] backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative flex min-h-full items-center justify-center p-4">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cx(
            "relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-inset ring-ink-100",
            width,
          )}
        >
          <div className="shrink-0 border-b border-ink-100 px-5 py-4">
            <h2 id={titleId} className="text-sm font-semibold text-ink-900">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-xs text-ink-500">
                {description}
              </p>
            ) : null}
          </div>
          {/* The only scrolling region, so the title stays readable and the
              footer's actions stay reachable however long the body gets. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {children}
          </div>
          <div className="shrink-0 flex justify-end gap-2 border-t border-ink-100 bg-ink-50 px-5 py-3">
            {footer}
          </div>
        </div>
      </div>
    </div>
  );
}
