import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Note,
  PageHeader,
  cx,
} from "@/components/ui";
import { projectName, tickets } from "@/lib/mock-data";
import type { TicketPriority, TicketStatus } from "@/lib/types";

const statusTone: Record<TicketStatus, "sky" | "amber" | "lemon" | "neutral"> = {
  open: "sky",
  pending: "amber",
  resolved: "lemon",
  closed: "neutral",
};

const statusLabel: Record<TicketStatus, string> = {
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
};

const priorityTone: Record<TicketPriority, "rose" | "amber" | "sky" | "neutral"> = {
  urgent: "rose",
  high: "amber",
  normal: "sky",
  low: "neutral",
};

export function generateStaticParams() {
  return tickets.map((t) => ({ id: t.id }));
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticket = tickets.find((t) => t.id === id);
  if (!ticket) notFound();

  const targetHours = (ticket.firstResponseTargetMinutes / 60).toFixed(
    ticket.firstResponseTargetMinutes % 60 === 0 ? 0 : 1,
  );
  const isOpenState = ticket.status === "open" || ticket.status === "pending";

  return (
    <>
      <nav className="mb-4 text-xs text-ink-400">
        <Link href="/console/support" className="hover:text-ink-700 hover:underline">
          Support
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-600">{ticket.id}</span>
      </nav>

      <PageHeader
        title={ticket.subject}
        description={`${projectName(ticket.projectId)}${ticket.resource ? ` · ${ticket.resource}` : ""} · opened ${ticket.createdAt}`}
        action={
          isOpenState ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm">
                Mark resolved
              </Button>
              <Button variant="secondary" size="sm">
                Escalate
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone[ticket.status]}>{statusLabel[ticket.status]}</Badge>
        <Badge tone={priorityTone[ticket.priority]}>{ticket.priority} priority</Badge>
        {ticket.protectionTier ? (
          <Badge tone={ticket.protectionTier === "standard" ? "neutral" : "lemon"}>
            {ticket.protectionTier} protection
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Conversation" />
            <div className="divide-y divide-ink-100">
              {ticket.messages.map((m) => (
                <div key={m.id} className="px-5 py-4">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className={cx(
                        "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.65rem] font-semibold",
                        m.role === "support"
                          ? "bg-lemon-100 text-lemon-800"
                          : "bg-ink-100 text-ink-600",
                      )}
                    >
                      {m.author
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </span>
                    <span className="text-sm font-medium text-ink-900">
                      {m.author}
                    </span>
                    {m.role === "support" ? (
                      <Badge tone="lemon">Support</Badge>
                    ) : null}
                    <span className="ml-auto text-xs text-ink-400">{m.at}</span>
                  </div>
                  <p className="text-sm leading-relaxed text-ink-700">{m.body}</p>
                </div>
              ))}
            </div>
            {isOpenState ? (
              <div className="border-t border-ink-100 px-5 py-4">
                <textarea
                  rows={3}
                  placeholder="Add a reply…"
                  className="w-full resize-none rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
                />
                <div className="mt-2 flex justify-end">
                  <Button size="sm">Send reply</Button>
                </div>
              </div>
            ) : (
              <div className="border-t border-ink-100 px-5 py-3">
                <p className="text-xs text-ink-400">
                  This ticket is {ticket.status} — reopen it from the ticket
                  list if the issue recurs.
                </p>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="First response" />
            <div className="space-y-3 px-5 py-4 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-500">Internal target</span>
                <span className="font-medium text-ink-900">{targetHours}h</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-500">Actual</span>
                <span className="font-medium text-ink-900">
                  {ticket.firstResponseAt ?? "Pending"}
                </span>
              </div>
              <Note>
                Internal operating target, not a contractual SLA. Formal
                response guarantees are only published once support
                performance has been measured.
              </Note>
            </div>
          </Card>

          <Card>
            <CardHeader title="Ticket details" />
            <div className="divide-y divide-ink-100 text-sm">
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Ticket ID</span>
                <span className="font-mono text-xs text-ink-800">{ticket.id}</span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Project</span>
                <span className="font-medium text-ink-800">
                  {projectName(ticket.projectId)}
                </span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Resource</span>
                <span className="font-medium text-ink-800">
                  {ticket.resource ?? "—"}
                </span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Last updated</span>
                <span className="font-medium text-ink-800">{ticket.updatedAt}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
