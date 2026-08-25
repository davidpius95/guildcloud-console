"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { Button, Note } from "./ui";
import { deleteInstance } from "@/app/console/instances/actions";

// Real teardown for real (Phase 2/3) instances - separate from the mock
// InstanceActions/DeleteModal in components/instance-actions.tsx, which
// stays mock per the project's mock-data boundary. This one actually
// marks the instance for deletion; the site worker does the real
// Proxmox/Tailscale teardown asynchronously (see
// processPendingInstanceDeletions in supabase/functions/site-worker-guild-a).
export function DeleteInstanceButton({
  instanceId,
  instanceName,
}: {
  instanceId: string;
  instanceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const canConfirm = confirmText === instanceName;

  function onConfirm() {
    startTransition(async () => {
      const result = await deleteInstance(instanceId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push("/console/instances");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setError(null);
          setConfirmText("");
        }}
        title={`Delete ${instanceName}`}
        description="This stops and permanently destroys the underlying server and its private network enrollment. Attached volumes are not deleted automatically."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!canConfirm}
              loading={isPending}
              onClick={onConfirm}
            >
              {isPending ? "Deleting…" : "Delete instance"}
            </Button>
          </>
        }
      >
        <Note tone="warning">
          This cannot be undone. The instance disappears from this list once
          the site worker has actually torn it down — usually within a
          minute or two, not instantly.
        </Note>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">
            Type <span className="font-mono text-ink-700">{instanceName}</span> to confirm
          </span>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={instanceName}
            className="w-full rounded-lg bg-white px-3 py-2 font-mono text-sm text-ink-800 ring-1 ring-inset ring-rose-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-rose-500"
          />
        </label>
        {error ? (
          <div className="mt-3">
            <Note tone="warning">{error}</Note>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
