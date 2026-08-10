"use client";

import { useRef, useState, useTransition } from "react";
import { Modal } from "./modal";
import { Button, Note } from "./ui";
import { CopyField } from "./copy-field";
import { revealInstancePassword } from "@/app/console/instances/actions";

export function RevealPasswordButton({ instanceId }: { instanceId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [alreadyRevealed, setAlreadyRevealed] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Real bug found live: the reveal RPC deletes the secret as part of the
  // same call that fetches it - this ref makes a second fire impossible
  // regardless of click-timing races, on top of the modal confirm step.
  const hasFired = useRef(false);

  function reveal() {
    if (hasFired.current) return;
    hasFired.current = true;
    startTransition(async () => {
      const { value, error } = await revealInstancePassword(instanceId);
      // Real bug found live: a real RPC error (vault.delete_secret(uuid)
      // not existing in this Vault version) used to look identical to a
      // genuinely-already-consumed secret - surfaced distinctly now so a
      // future backend error can't hide behind the same misleading text.
      if (error) {
        hasFired.current = false;
        setRevealError(error);
      } else if (value) {
        setPassword(value);
      } else {
        setAlreadyRevealed(true);
      }
    });
  }

  function close() {
    setOpen(false);
    // Deliberately not resetting password/alreadyRevealed/hasFired on
    // close - reopening must keep showing what already happened instead
    // of offering a second live "Reveal" button for an already-consumed
    // secret.
  }

  if (alreadyRevealed && !open) {
    return (
      <Note>
        Already revealed once and deleted. Remove password SSH and re-add
        it to generate a new one.
      </Note>
    );
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Reveal password (one-time)
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Reveal one-time password"
        description={
          password
            ? "This is the only time this password is shown — it has already been deleted from GuildCloud's side."
            : "This can only be shown once. If you close this without copying it, it's gone for good and can't be recovered."
        }
        footer={
          password || alreadyRevealed ? (
            <Button size="sm" onClick={close}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={close} disabled={isPending}>
                Cancel
              </Button>
              <Button size="sm" disabled={isPending} onClick={reveal}>
                {isPending ? "Revealing…" : "Yes, reveal it now"}
              </Button>
            </>
          )
        }
      >
        {password ? (
          <CopyField label="Password" value={password} />
        ) : alreadyRevealed ? (
          <Note>
            Already revealed once and deleted. Remove password SSH and
            re-add it to generate a new one.
          </Note>
        ) : (
          <div className="space-y-3">
            <Note tone="warning">
              You're about to permanently consume this instance's one-time
              password. Make sure you're ready to copy it immediately after.
            </Note>
            {revealError ? (
              <Note tone="warning">
                Something went wrong and nothing was consumed — safe to try
                again: {revealError}
              </Note>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}
