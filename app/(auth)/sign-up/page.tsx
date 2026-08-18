"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card, Button } from "@/components/ui";
import { signUpWithEmail, signInWithOAuth, type AuthActionState } from "../actions";

const initialState: AuthActionState = { error: null };

export default function SignUpPage() {
  const [state, formAction] = useActionState(signUpWithEmail, initialState);

  return (
    <Card className="animate-fade-up p-6">
      <h1 className="text-lg font-semibold text-ink-900">Start building</h1>
      <p className="mt-1 text-sm text-ink-500">
        Sign up with Google, GitHub, or email, then verify your email to continue.
      </p>

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
            required
            className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 outline-none focus:border-lemon-500 focus:ring-1 focus:ring-lemon-500"
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
          Create account
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-ink-500">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-ink-800 underline">
          Sign in
        </Link>
      </p>
    </Card>
  );
}
