import Link from "next/link";
import { Button, Card, CardHeader, Note, PageHeader } from "@/components/ui";
import { instances, projects } from "@/lib/mock-data";

export default function NewSupportRequestPage() {
  return (
    <>
      <nav className="mb-4 text-xs text-ink-400">
        <Link href="/console/support" className="hover:text-ink-700 hover:underline">
          Support
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-600">New request</span>
      </nav>

      <PageHeader
        title="Open a support request"
        description="Safe diagnostics and operation context are attached automatically — you never need to paste logs or credentials."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader title="Describe the issue" />
          <div className="space-y-4 px-5 py-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-500">
                Subject
              </span>
              <input
                placeholder="e.g. worker-1 memory pressure won't clear"
                className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-500">
                  Project
                </span>
                <select className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600">
                  {projects.map((p) => (
                    <option key={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-500">
                  Affected resource (optional)
                </span>
                <select className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600">
                  <option>None</option>
                  {instances.map((i) => (
                    <option key={i.id}>{i.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-500">
                What's happening
              </span>
              <textarea
                rows={6}
                placeholder="Describe what you expected, what happened instead, and when it started."
                className="w-full resize-none rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
              />
            </label>

            <Button>Submit request</Button>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Attached automatically" />
            <ul className="divide-y divide-ink-100 text-sm">
              {[
                "Affected resource and project",
                "Recent operation timeline and failure stage",
                "Site health at the time of the issue",
                "Access and backup status (no secrets)",
              ].map((c) => (
                <li key={c} className="px-5 py-2.5 text-ink-700">
                  {c}
                </li>
              ))}
            </ul>
          </Card>
          <Note>
            This is a mock console — submitting here won't create a real
            ticket. In the real product this opens a durable ticket record
            with the diagnostics above already attached.
          </Note>
        </div>
      </div>
    </>
  );
}
