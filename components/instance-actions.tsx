"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { Button, Note, cx } from "./ui";
import { money } from "@/lib/format";
import { plans } from "@/lib/catalog";
import type { Instance } from "@/lib/types";

import {
  resizeInstance,
  createInstanceSnapshot,
  restoreInstance,
  deleteInstance,
} from "@/app/console/instances/actions";

type ModalKind = "resize" | "snapshot" | "restore" | "delete" | null;

export type RealSnapshot = {
  id: string;
  name: string;
  proxmox_snapname: string;
  state: string;
  created_at: string;
};

export type RealPlan = {
  id: string;
  name: string;
  vcpu: number;
  memory_gb: number;
  disk_gb: number;
  monthly_max: number | string;
};

export function InstanceActions({
  instance,
  availablePlans,
  snapshots = [],
  isReal = false,
}: {
  instance: Instance | { id: string; name: string; state: string; catalog_plan_id?: string; diskGb?: number; plan?: string };
  availablePlans?: RealPlan[];
  snapshots?: RealSnapshot[];
  isReal?: boolean;
}) {
  const [modal, setModal] = useState<ModalKind>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const readySnapshots = snapshots.filter((snapshot) => snapshot.state === "ready");

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setModal("resize")}>
          Resize
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setModal("snapshot")}>
          Snapshot
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={readySnapshots.length === 0 || instance.state !== "ready"}
          onClick={() => setModal("restore")}
        >
          Restore
        </Button>
        <Button variant="danger" size="sm" onClick={() => setModal("delete")}>
          Delete
        </Button>
      </div>

      {notice ? (
        <div className="mt-4">
          <Note>{notice}</Note>
        </div>
      ) : null}

      <ResizeModal
        instance={instance as Instance}
        availablePlans={availablePlans}
        open={modal === "resize"}
        isSubmitting={isSubmitting}
        onClose={() => setModal(null)}
        onConfirm={async (planId, planName) => {
          if (isReal) {
            setIsSubmitting(true);
            const res = await resizeInstance(instance.id, planId);
            setIsSubmitting(false);
            setModal(null);
            if (res.error) {
              setNotice(`Failed to resize: ${res.error}`);
            } else {
              setNotice(`Resize operation to ${planName} submitted.`);
            }
          } else {
            setModal(null);
            setNotice(
              `Resize to ${planName} scheduled. This is a mock console — no real operation was created.`,
            );
          }
        }}
      />

      <SnapshotModal
        instance={instance as Instance}
        open={modal === "snapshot"}
        isSubmitting={isSubmitting}
        onClose={() => setModal(null)}
        onConfirm={async (name) => {
          if (isReal) {
            setIsSubmitting(true);
            const res = await createInstanceSnapshot(instance.id, name);
            setIsSubmitting(false);
            setModal(null);
            if (res.error) {
              setNotice(`Failed to create snapshot: ${res.error}`);
            } else {
              setNotice(`Snapshot “${name}” operation submitted.`);
            }
          } else {
            setModal(null);
            setNotice(
              `Snapshot “${name}” queued. This is a mock console — no real snapshot was taken.`,
            );
          }
        }}
      />

      <RestoreModal
        instance={instance as Instance}
        snapshots={readySnapshots}
        open={modal === "restore"}
        isSubmitting={isSubmitting}
        onClose={() => setModal(null)}
        onConfirm={async (snapshotId) => {
          if (isReal) {
            setIsSubmitting(true);
            const res = await restoreInstance(instance.id, snapshotId);
            setIsSubmitting(false);
            setModal(null);
            if (res.error) {
              setNotice(`Failed to restore: ${res.error}`);
            } else {
              setNotice(`Restore operation submitted to replace ${instance.name}.`);
            }
          } else {
            setModal(null);
            setNotice("Restore is unavailable outside the real control plane.");
          }
        }}
      />

      <DeleteModal
        instance={instance as Instance}
        open={modal === "delete"}
        isSubmitting={isSubmitting}
        onClose={() => setModal(null)}
        onConfirm={async () => {
          if (isReal) {
            setIsSubmitting(true);
            const res = await deleteInstance(instance.id);
            setIsSubmitting(false);
            setModal(null);
            if (res.error) {
              setNotice(`Failed to delete: ${res.error}`);
            } else {
              setNotice(`Deletion requested for ${instance.name}. Teardown in progress.`);
            }
          } else {
            setModal(null);
            setNotice(
              `Deletion scheduled for ${instance.name}. Teardown begins immediately and cannot be undone.`,
            );
          }
        }}
      />
    </>
  );
}

function ResizeModal({
  instance,
  availablePlans,
  open,
  isSubmitting,
  onClose,
  onConfirm,
}: {
  instance: Instance | { id: string; name: string; catalog_plan_id?: string; plan?: string };
  availablePlans?: RealPlan[];
  open: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (planId: string, planName: string) => void;
}) {
  const planList =
    availablePlans && availablePlans.length > 0
      ? availablePlans.map((p) => ({
          id: p.id,
          name: p.name,
          vcpu: p.vcpu,
          memoryGb: p.memory_gb,
          diskGb: p.disk_gb,
          monthlyMax: Number(p.monthly_max),
        }))
      : plans;

  const currentPlanId =
    (instance as { catalog_plan_id?: string }).catalog_plan_id ??
    plans.find((p) => p.name === (instance as Instance).plan)?.id ??
    planList[0].id;

  const [selectedPlanId, setSelectedPlanId] = useState(currentPlanId);
  const target = planList.find((p) => p.id === selectedPlanId) ?? planList[0];
  const sameSize = target.id === currentPlanId;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Resize ${instance.name}`}
      description="CPU and memory may resize up or down. Disk expansion is supported; disk shrinking is not offered."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={sameSize}
            loading={isSubmitting}
            onClick={() => onConfirm(target.id, target.name)}
          >
            {isSubmitting ? "Submitting..." : "Confirm resize"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {planList.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedPlanId(p.id)}
              className={cx(
                "rounded-lg px-3 py-2.5 text-left text-sm ring-1 ring-inset transition-all",
                p.id === selectedPlanId
                  ? "bg-lemon-50 text-[#171d36] ring-2 ring-lemon-500"
                  : "bg-white text-ink-700 ring-ink-200 hover:ring-ink-300",
                p.id === currentPlanId && p.id !== selectedPlanId && "opacity-70",
              )}
            >
              <span className="block font-medium">{p.name}</span>
              <span className="block text-xs opacity-70">
                {p.vcpu} vCPU · {p.memoryGb} GB · {p.diskGb} GB
              </span>
              {p.id === currentPlanId ? (
                <span className="mt-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-lemon-700 dark:text-lemon-400">
                  Current
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <div className="rounded-lg bg-ink-50 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-ink-500">New monthly maximum</span>
            <span className="font-semibold tabular-nums text-ink-900">
              {money(target.monthlyMax)}
            </span>
          </div>
        </div>

        {sameSize ? (
          <p className="text-xs text-ink-500">
            Choose a different plan to resize.
          </p>
        ) : (
          <Note tone="warning">
            Applying this resize restarts {instance.name}. Some plan changes
            require host capacity verification before applying.
          </Note>
        )}
      </div>
    </Modal>
  );
}

function SnapshotModal({
  instance,
  open,
  isSubmitting,
  onClose,
  onConfirm,
}: {
  instance: Instance | { id: string; name: string; diskGb?: number };
  open: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(`${instance.name}-snapshot`);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Snapshot ${instance.name}`}
      description="A point-in-time copy of this instance's disk. Snapshots count toward your storage usage."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!name.trim()}
            loading={isSubmitting}
            onClick={() => onConfirm(name.trim())}
          >
            {isSubmitting ? "Creating..." : "Create snapshot"}
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-ink-500">
          Snapshot name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg bg-white px-3 py-2 font-mono text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
        />
      </label>
      <p className="mt-3 text-xs text-ink-500">
        Estimated additional cost: ~{money(((instance as Instance).diskGb ?? 40) * 0.1)}/mo while retained.
      </p>
    </Modal>
  );
}

function RestoreModal({
  instance,
  snapshots = [],
  open,
  isSubmitting,
  onClose,
  onConfirm,
}: {
  instance: Instance | { id: string; name: string };
  snapshots?: RealSnapshot[];
  open: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: (snapshotId: string) => void;
}) {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>(
    snapshots[0]?.id ?? "",
  );
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = selectedSnapshotId.length > 0 && confirmText === instance.name;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Restore ${instance.name}`}
      description="Replace this instance's disk with a verified ready snapshot."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={!canConfirm}
            loading={isSubmitting}
            onClick={() => onConfirm(selectedSnapshotId)}
          >
            {isSubmitting ? "Restoring..." : "Replace live instance"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {snapshots.length > 0 ? (
          <div className="mb-3">
            <label className="mb-1.5 block text-xs font-medium text-ink-500">
              Select Snapshot / Recovery Point
            </label>
            <select
              value={selectedSnapshotId}
              onChange={(e) => setSelectedSnapshotId(e.target.value)}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-lemon-600"
            >
              {snapshots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.proxmox_snapname}) — {new Date(s.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <Note tone="warning">
          Destructive: the current disk state is discarded after the snapshot rollback succeeds.
        </Note>
        <label className="block pt-1">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">
            Type <span className="font-mono text-ink-700">{instance.name}</span> to confirm
          </span>
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={instance.name}
            className="w-full rounded-lg bg-white px-3 py-2 font-mono text-sm text-ink-800 ring-1 ring-inset ring-rose-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-rose-500"
          />
        </label>
      </div>
    </Modal>
  );
}

function DeleteModal({
  instance,
  open,
  isSubmitting,
  onClose,
  onConfirm,
}: {
  instance: Instance | { id: string; name: string };
  open: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = confirmText === instance.name;

  // There is no recovery window. This dialog used to say "A documented
  // recovery window applies before permanent deletion", which invited a
  // confident destructive click by implying an undo that does not exist:
  // request_instance_deletion marks the row and the site worker tears the real
  // VM down within about a minute. Nothing restores it afterwards.
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delete ${instance.name}`}
      description="This permanently destroys the server. It cannot be undone."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!canConfirm || isSubmitting}
            onClick={onConfirm}
          >
            {isSubmitting ? "Deleting..." : "Delete instance"}
          </Button>
        </>
      }
    >
      <Note tone="warning">
        Teardown of {instance.name} begins immediately and cannot be
        cancelled or reversed. The disk and its data are destroyed with it —
        restore from a snapshot afterwards is not possible.
      </Note>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-medium text-ink-500">
          Type <span className="font-mono text-ink-700">{instance.name}</span> to confirm
        </span>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={instance.name}
          className="w-full rounded-lg bg-white px-3 py-2 font-mono text-sm text-ink-800 ring-1 ring-inset ring-rose-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-rose-500"
        />
      </label>
    </Modal>
  );
}
