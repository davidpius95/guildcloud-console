"use client";

import { useActionState, useTransition } from "react";
import { Button, Card, CardHeader } from "./ui";
import { IconPlus } from "./icons";
import { formatDate } from "@/lib/format";
import {
  addSshKey,
  removeSshKey,
  type SettingsActionState,
} from "@/app/console/settings/actions";

const initialState: SettingsActionState = { error: null };

type SshKeyRow = { id: string; name: string; public_key: string; created_at: string };

function fingerprint(publicKey: string) {
  const parts = publicKey.trim().split(/\s+/);
  return parts[0] ?? "unknown";
}

export function SshKeysCard({ keys }: { keys: SshKeyRow[] }) {
  const [state, formAction] = useActionState(addSshKey, initialState);
  const [isPending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader
        title="SSH keys"
        subtitle="Every one of these is injected into every new instance you create."
      />
      <div className="divide-y divide-ink-100 text-sm">
        {keys.length === 0 ? (
          <p className="px-5 py-4 text-xs text-ink-400">
            No keys yet — instances can&rsquo;t be reached until you add one.
          </p>
        ) : (
          keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-ink-900">{k.name}</p>
                <p className="text-xs text-ink-400">
                  {fingerprint(k.public_key)} · added {formatDate(k.created_at)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => startTransition(() => removeSshKey(k.id))}
              >
                Remove
              </Button>
            </div>
          ))
        )}
      </div>
      <form action={formAction} className="space-y-2 border-t border-ink-100 px-5 py-4">
        <input
          name="name"
          placeholder="Label, e.g. laptop"
          className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
        />
        <textarea
          name="publicKey"
          placeholder="ssh-ed25519 AAAA..."
          rows={2}
          className="w-full rounded-lg bg-white px-3 py-2 font-mono text-xs text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
        />
        {state.error ? <p className="text-xs text-rose-600">{state.error}</p> : null}
        <Button type="submit" variant="secondary" size="sm">
          <IconPlus className="h-3.5 w-3.5" />
          Add key
        </Button>
      </form>
    </Card>
  );
}
