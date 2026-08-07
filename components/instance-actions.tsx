"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { Button, Note, cx } from "./ui";
import { money, plans } from "@/lib/mock-data";
import type { Instance } from "@/lib/types";

type ModalKind = "resize" | "snapshot" | "restore" | "delete" | "recovery" | null;

export function InstanceActions({ instance }: { instance: Instance }) {
  const [modal, setModal] = useState<ModalKind>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setModal("resize")}>
          Resize
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setModal("snapshot")}>
          Snapshot
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setModal("restore")}>
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
        instance={instance}
        open={modal === "resize"}
        onClose={() => setModal(null)}
        onConfirm={(planName) => {
          setModal(null);
          setNotice(
            `Resize to ${planName} scheduled. This is a mock console — no real operation was created; in the real product this opens a durable operation and streams its stages.`,
          );
        }}
      />

      <SnapshotModal
        instance={instance}
        open={modal === "snapshot"}
        onClose={() => setModal(null)}
        onConfirm={(name) => {
          setModal(null);
          setNotice(
            `Snapshot “${name}” queued. This is a mock console — no real snapshot was taken.`,
          );
        }}
      />

      <RestoreModal
        instance={instance}
        open={modal === "restore"}
        onClose={() => setModal(null)}
        onConfirm={(mode) => {
          setModal(null);
          setNotice(
            mode === "replace"
              ? `Restore scheduled to replace the live instance. This is a mock console — no real restore was started.`
              : `Restore scheduled to a new instance. The current instance is untouched. This is a mock console — no real restore was started.`,
          );
        }}
      />

      <DeleteModal
        instance={instance}
        open={modal === "delete"}
        onClose={() => setModal(null)}
        onConfirm={() => {
          setModal(null);
          setNotice(
            `Deletion scheduled for ${instance.name}. A documented recovery window applies before permanent deletion. This is a mock console — nothing was actually deleted.`,
          );
        }}
      />
    </>
  );
}

export function RecoveryConsoleButton({ instance }: { instance: Instance }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Open recovery console
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Recovery console — ${instance.name}`}
        description="For exceptional recovery, not ordinary use. This session is proxied through the site worker and does not depend on the private overlay being reachable."
        width="max-w-lg"
        footer={
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <div className="rounded-lg bg-[#0e1226] px-4 py-3 font-mono text-xs text-lemon-300">
          <p>Connecting to {instance.privateHostname}…</p>
          <p className="mt-1 text-ink-400">
            This is a mock console — no real serial/VNC session is opened. In
            the real product this pane streams a live terminal.
          </p>
        </div>
      </Modal>
    </>
  );
}

function ResizeModal({
  instance,
  open,
  onClose,
  onConfirm,
}: {
  instance: Instance;
  open: boolean;
  onClose: () => void;
  onConfirm: (planName: string) => void;
}) {
  const currentPlan = plans.find((p) => p.name === instance.plan) ?? plans[0];
  const [planId, setPlanId] = useState(currentPlan.id);
  const target = plans.find((p) => p.id === planId)!;
  const sameSize = target.id === currentPlan.id;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Resize ${instance.name}`}
      description="CPU and memory may resize up or down. Disk expansion is supported; disk shrinking is not offered."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={sameSize}
            onClick={() => onConfirm(target.name)}
          >
            Confirm resize
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {plans.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlanId(p.id)}
              className={cx(
                "rounded-lg px-3 py-2.5 text-left text-sm ring-1 ring-inset transition-all",
                p.id === planId
                  ? "bg-lemon-50 text-[#171d36] ring-2 ring-lemon-500"
                  : "bg-white text-ink-700 ring-ink-200 hover:ring-ink-300",
                p.id === currentPlan.id && p.id !== planId && "opacity-70",
              )}
            >
              <span className="block font-medium">{p.name}</span>
              <span className="block text-xs opacity-70">
                {p.vcpu} vCPU · {p.memoryGb} GB · {p.diskGb} GB
              </span>
              {p.id === currentPlan.id ? (
                <span className="mt-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-lemon-700">
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
          <div className="flex justify-between">
            <span className="text-ink-500">Was</span>
            <span className="tabular-nums text-ink-500">
              {money(currentPlan.monthlyMax)}
            </span>
          </div>
        </div>

        {sameSize ? (
          <p className="text-xs text-ink-400">
            Choose a different plan to resize.
          </p>
        ) : (
          <Note tone="warning">
            Applying this resize restarts {instance.name}. Some plan changes
            require migration to a host with available capacity — you'll see
            that step in the operation timeline if it applies here.
          </Note>
        )}
      </div>
    </Modal>
  );
}

function SnapshotModal({
  instance,
  open,
  onClose,
  onConfirm,
}: {
  instance: Instance;
  open: boolean;
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
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name.trim()} onClick={() => onConfirm(name.trim())}>
            Create snapshot
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
      <p className="mt-3 text-xs text-ink-400">
        Estimated additional cost: ~{money(instance.diskGb * 0.1)}/mo while retained.
      </p>
    </Modal>
  );
}

function RestoreModal({
  instance,
  open,
  onClose,
  onConfirm,
}: {
  instance: Instance;
  open: boolean;
  onClose: () => void;
  onConfirm: (mode: "new" | "replace") => void;
}) {
  const [mode, setMode] = useState<"new" | "replace">("new");
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = mode === "new" || confirmText === instance.name;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Restore ${instance.name}`}
      description="Restores never silently overwrite a live workload."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={mode === "replace" ? "danger" : "primary"}
            disabled={!canConfirm}
            onClick={() => onConfirm(mode)}
          >
            {mode === "replace" ? "Replace live instance" : "Restore to new instance"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setMode("new")}
          className={cx(
            "block w-full rounded-lg px-4 py-3 text-left ring-1 ring-inset transition-all",
            mode === "new"
              ? "bg-lemon-50 ring-2 ring-lemon-500"
              : "bg-white ring-ink-200 hover:ring-ink-300",
          )}
        >
          <span className="block text-sm font-medium text-ink-900">
            Restore to a new instance
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">
            Recommended. {instance.name} keeps running, untouched.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMode("replace")}
          className={cx(
            "block w-full rounded-lg px-4 py-3 text-left ring-1 ring-inset transition-all",
            mode === "replace"
              ? "bg-rose-50 ring-2 ring-rose-400"
              : "bg-white ring-ink-200 hover:ring-ink-300",
          )}
        >
          <span className="block text-sm font-medium text-ink-900">
            Replace this live instance
          </span>
          <span className="mt-0.5 block text-xs text-ink-500">
            Destructive. The current disk state is discarded once the restore verifies.
          </span>
        </button>

        {mode === "replace" ? (
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
        ) : null}
      </div>
    </Modal>
  );
}

function DeleteModal({
  instance,
  open,
  onClose,
  onConfirm,
}: {
  instance: Instance;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const canConfirm = confirmText === instance.name;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delete ${instance.name}`}
      description="A documented recovery window applies before permanent deletion."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" disabled={!canConfirm} onClick={onConfirm}>
            Delete instance
          </Button>
        </>
      }
    >
      <Note tone="warning">
        This stops {instance.name} and starts its recovery window. Attached
        volumes are not deleted automatically.
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
