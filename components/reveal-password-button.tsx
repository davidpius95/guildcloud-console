"use client";

import { useRef, useState, useTransition } from "react";
import { Button, Note } from "./ui";
import { CopyField } from "./copy-field";
import { revealInstancePassword } from "@/app/console/instances/actions";

export function RevealPasswordButton({ instanceId }: { instanceId: string }) {
  const [password, setPassword] = useState<string | null>(null);
  const [alreadyRevealed, setAlreadyRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Real bug found live: the reveal RPC deletes the secret as part of the
  // same call that fetches it, with no confirmation step first - a single
  // stray click (or, in principle, two clicks landing before React's
  // isPending flips) permanently consumes the one-time password with
  // nothing ever shown. This ref makes a second fire impossible regardless
  // of render timing, on top of the confirm step below.
  const hasFired = useRef(false);

  function reveal() {
    if (hasFired.current) return;
    hasFired.current = true;
    startTransition(async () => {
      const value = await revealInstancePassword(instanceId);
      if (value) setPassword(value);
      else setAlreadyRevealed(true);
    });
  }

  if (password) {
    return (
      <div className="space-y-2">
        <Note tone="warning">
          This is the only time this password is shown — it has already been
          deleted from GuildCloud's side.
        </Note>
        <CopyField label="Password" value={password} />
      </div>
    );
  }

  if (alreadyRevealed) {
    return (
      <Note>
        Already revealed once and deleted. Remove password SSH and re-add it
        to generate a new one.
      </Note>
    );
  }

  if (confirming) {
    return (
      <div className="space-y-2">
        <Note tone="warning">
          Only shown once — if you navigate away or close this before
          copying it, it's gone for good and can't be recovered.
        </Note>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button size="sm" disabled={isPending} onClick={reveal}>
            {isPending ? "Revealing…" : "Yes, reveal it now"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
      Reveal password (one-time)
    </Button>
  );
}
