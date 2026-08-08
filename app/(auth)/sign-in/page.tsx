"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card, Button } from "@/components/ui";
import { signInWithEmail, signInWithOAuth, type AuthActionState } from "../actions";

const initialState: AuthActionState = { error: null };

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.85A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.09V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.85Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.06l3.66 2.85C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.94c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.27 5.69.42.36.78 1.07.78 2.16v3.2c0 .3.2.66.79.55A10.51 10.51 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
    </svg>
  );
}

export default function SignInPage() {
  const [state, formAction] = useActionState(signInWithEmail, initialState);

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-ink-900">Sign in</h1>
      <p className="mt-1 text-sm text-ink-500">Welcome back to GuildCloud.</p>

      <div className="mt-5 flex flex-col gap-2">
        <form action={signInWithOAuth.bind(null, "google")}>
          <Button type="submit" variant="secondary" className="w-full justify-center">
            <GoogleIcon />
            Continue with Google
          </Button>
        </form>
        <form action={signInWithOAuth.bind(null, "github")}>
          <Button type="submit" variant="secondary" className="w-full justify-center">
            <GithubIcon />
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
            className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 outline-none focus:border-lemon-500 focus:ring-1 focus:ring-lemon-500"
          />
        </label>
        {state.error ? <p className="text-xs text-rose-600">{state.error}</p> : null}
        <Button type="submit" className="w-full justify-center">
          Sign in
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-ink-500">
        No account?{" "}
        <Link href="/sign-up" className="font-medium text-ink-800 underline">
          Start building
        </Link>
      </p>
    </Card>
  );
}
