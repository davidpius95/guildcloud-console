"use client";

import { useActionState } from "react";
import { Card, PageHeader, Button } from "@/components/ui";
import { createProject, type ProjectActionState } from "../actions";

const initialState: ProjectActionState = { error: null };

export default function NewProjectPage() {
  const [state, formAction] = useActionState(createProject, initialState);

  return (
    <>
      <PageHeader
        title="Create project"
        description="Projects are the isolation boundary for private networking, access policy, and cost."
      />
      <Card className="max-w-lg p-6">
        <form action={formAction} className="flex flex-col gap-3">
          <label className="text-xs font-medium text-ink-600">
            Project name
            <input
              name="name"
              required
              placeholder="Production"
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 outline-none focus:border-lemon-500 focus:ring-1 focus:ring-lemon-500"
            />
          </label>
          <label className="text-xs font-medium text-ink-600">
            Description (optional)
            <textarea
              name="description"
              rows={3}
              placeholder="What is this project for?"
              className="mt-1 w-full rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-900 outline-none focus:border-lemon-500 focus:ring-1 focus:ring-lemon-500"
            />
          </label>
          {state.error ? <p className="text-xs text-rose-600 dark:text-rose-400">{state.error}</p> : null}
          <div className="flex gap-2">
            <Button type="submit">Create project</Button>
            <Button href="/console/projects" variant="secondary">
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
