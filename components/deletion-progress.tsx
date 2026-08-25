"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconLock } from "./icons";

// Deletion has no operation/stage tracking on the backend (unlike create -
// see OperationProgress) - there's no started-at timestamp or step list to
// poll, just the instance row flipping to "deleting" and eventually
// disappearing once the site worker's teardown finishes. Rather than leave
// the user staring at a static sentence with no sign of life, this shows
// the same reassurance pattern as the create flow (animated spinner + a
// live clock) and polls router.refresh() so the page moves on by itself
// the moment the row is gone (getInstanceWithOperation starts returning
// null, which 404s this page) instead of requiring a manual reload.
export function DeletionProgress() {
  const router = useRouter();
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => setElapsedSec(Math.floor((Date.now() - start) / 1000)), 1000);
    const poll = setInterval(() => router.refresh(), 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [router]);

  const elapsedLabel =
    elapsedSec < 60
      ? `${elapsedSec}s`
      : `${Math.floor(elapsedSec / 60)}m ${String(elapsedSec % 60).padStart(2, "0")}s`;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-900">
      <span
        aria-hidden
        className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-300 border-t-amber-600"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          Deleting this instance — {elapsedLabel} so far
        </p>
        <p className="mt-1 text-amber-700">
          The site worker is tearing down the real Proxmox VM and Tailscale
          device. This usually takes under a minute, longer for larger
          disks. This page updates itself and will move on automatically
          once it's gone — no need to reload.
        </p>
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-amber-200/70">
          <div className="h-full w-1/3 animate-[deletion-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-amber-500" />
        </div>
      </div>
      <IconLock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
    </div>
  );
}
