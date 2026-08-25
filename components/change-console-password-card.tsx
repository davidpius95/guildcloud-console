"use client";

import { useActionState, useEffect, useState } from "react";
import { changeConsolePassword, type PasswordActionState } from "@/app/console/settings/actions";
import { Button, Card, CardHeader, Note } from "./ui";

const initialState: PasswordActionState = { error: null, success: false };

export function ChangeConsolePasswordCard() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(changeConsolePassword, initialState);

  useEffect(() => {
    if (state.success) setOpen(false);
  }, [state.success]);

  return (
    <Card>
      <CardHeader
        title="Sign-in security"
        subtitle="This controls your GuildCloud account, not a server login."
      />
      <div className="space-y-3 px-5 py-4">
        <p className="text-sm leading-6 text-ink-500">
          Use a unique password for the console. Your server's Linux password,
          if you chose one, is changed from inside that server.
        </p>
        {open ? (
          <form action={formAction} className="space-y-3 rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-600">New console password</span>
              <input name="password" type="password" minLength={12} required autoComplete="new-password" className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-ink-600">Confirm new password</span>
              <input name="confirmation" type="password" minLength={12} required autoComplete="new-password" className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-900 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600" />
            </label>
            {state.error ? <Note tone="warning">{state.error}</Note> : null}
            <div className="flex gap-2"><Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" size="sm" disabled={pending}>{pending ? "Updating…" : "Update password"}</Button></div>
          </form>
        ) : (
          <>
            {state.success ? <Note>Your console password was updated.</Note> : null}
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Change console password</Button>
          </>
        )}
      </div>
    </Card>
  );
}
