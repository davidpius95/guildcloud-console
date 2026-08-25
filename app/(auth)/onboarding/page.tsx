"use client";

import { useActionState } from "react";
import { Card, Button } from "@/components/ui";
import { completeOnboarding } from "./actions";
import type { AuthActionState } from "../actions";

const initialState: AuthActionState = { error: null };

export default function OnboardingPage() {
  const [state, formAction] = useActionState(completeOnboarding, initialState);

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-ink-900">Set up your organization</h1>
      <p className="mt-1 text-sm text-ink-500">
        Organizations are the billing and team boundary. Projects hold your resources.
      </p>

      <form action={formAction} className="mt-5 flex flex-col gap-3">
        <label className="text-xs font-medium text-ink-600">
          Organization name
          <input
            name="orgName"
            required
            placeholder="Northwind Labs"
            className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 outline-none focus:border-lemon-500 focus:ring-1 focus:ring-lemon-500"
          />
        </label>
        <label className="text-xs font-medium text-ink-600">
          First project name
          <input
            name="projectName"
            required
            placeholder="Production"
            className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 outline-none focus:border-lemon-500 focus:ring-1 focus:ring-lemon-500"
          />
        </label>
        {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
        <Button type="submit" className="w-full justify-center">
          Create organization
        </Button>
      </form>
    </Card>
  );
}
