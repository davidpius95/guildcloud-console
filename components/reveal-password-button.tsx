"use client";

import { useState, useTransition } from "react";
import { Button, Note } from "./ui";
import { CopyField } from "./copy-field";
import { revealInstancePassword } from "@/app/console/instances/actions";

export function RevealPasswordButton({ instanceId }: { instanceId: string }) {
  const [password, setPassword] = useState<string | null>(null);
  const [alreadyRevealed, setAlreadyRevealed] = useState(false);
  const [isPending, startTransition] = useTransition();

  function reveal() {
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

  return (
    <Button variant="secondary" size="sm" disabled={isPending} onClick={reveal}>
      {isPending ? "Revealing…" : "Reveal password (one-time)"}
    </Button>
  );
}
