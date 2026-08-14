"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { signUpWithEmail, signInWithOAuth, type AuthActionState } from "@/app/(auth)/actions";

const initialState: AuthActionState = { error: null };

// Same form as sign-up, just with the invited email locked in - the
// person clicking a real emailed link doesn't get to change which
// address they're accepting the invite as.
export function AcceptInviteForm({ email }: { email: string }) {
  const [state, formAction] = useActionState(signUpWithEmail, initialState);

  return (
    <>
      <div className="mt-5 flex flex-col gap-2">
        <form action={signInWithOAuth.bind(null, "google")}>
          <Button type="submit" variant="secondary" className="w-full justify-center">
            Continue with Google
          </Button>
        </form>
        <form action={signInWithOAuth.bind(null, "github")}>
          <Button type="submit" variant="secondary" className="w-full justify-center">
            Continue with GitHub
          </Button>
        </form>
      </div>

      <div className="my-5 flex items-center gap-3 text-xs text-ink-400">
        <div className="h-px flex-1 bg-ink-100" />
        or
        <div className="h-px flex-1 bg-ink-100" />
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <label className="text-xs font-medium text-ink-600">
          Email
          <input
            name="email"
            type="email"
            value={email}
            readOnly
            className="mt-1 w-full rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-600 outline-none"
          />
        </label>
        <label className="text-xs font-medium text-ink-600">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 outline-none focus:border-lemon-500 focus:ring-1 focus:ring-lemon-500"
          />
        </label>
        {state.error ? <p className="text-xs text-rose-600">{state.error}</p> : null}
        <Button type="submit" className="w-full justify-center">
          Accept invite &amp; create account
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-ink-500">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-ink-800 underline">
          Sign in
        </Link>
        , then this invite will link automatically.
      </p>
    </>
  );
}
