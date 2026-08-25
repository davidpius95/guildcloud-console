"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Modal } from "./modal";
import { Button, Note } from "./ui";
import { addSshKey, type SettingsActionState } from "@/app/console/settings/actions";

const initialState: SettingsActionState = { error: null };

// Inline version of the same real addSshKey action Settings uses - lets
// the user register a key without leaving the create-instance flow. Stays
// open after each successful add (not a one-shot dialog) so adding more
// than one key in a row doesn't mean reopening it each time.
export function AddSshKeyModal({
  open,
  onClose,
  onKeyAdded,
}: {
  open: boolean;
  onClose: () => void;
  onKeyAdded: (name: string) => void;
}) {
  const [state, formAction, pending] = useActionState(addSshKey, initialState);
  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [addedThisSession, setAddedThisSession] = useState<string[]>([]);
  const wasPending = useRef(false);
  const pendingName = useRef("");

  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setAddedThisSession((prev) => [...prev, pendingName.current]);
      onKeyAdded(pendingName.current);
      setName("");
      setPublicKey("");
    }
    wasPending.current = pending;
  }, [pending, state.error, onKeyAdded]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an SSH key"
      description="Every key you add here is injected into every new instance you create, including this one."
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Done
        </Button>
      }
    >
      <form
        action={(formData) => {
          pendingName.current = name;
          formAction(formData);
        }}
        className="space-y-3"
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">Label</span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. work laptop"
            className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">
            Public key
          </span>
          <textarea
            name="publicKey"
            value={publicKey}
            onChange={(e) => setPublicKey(e.target.value)}
            placeholder="ssh-ed25519 AAAA... (from ~/.ssh/id_ed25519.pub on your computer)"
            rows={3}
            className="w-full rounded-lg bg-white px-3 py-2 font-mono text-xs text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
          />
        </label>
        {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
        <Button type="submit" size="sm" disabled={pending || !name.trim() || !publicKey.trim()}>
          {pending ? "Adding…" : "Add key"}
        </Button>
      </form>

      {addedThisSession.length > 0 ? (
        <div className="mt-4">
          <Note>
            Added this session: {addedThisSession.join(", ")}. Add another
            above, or close when you're done.
          </Note>
        </div>
      ) : null}
    </Modal>
  );
}
