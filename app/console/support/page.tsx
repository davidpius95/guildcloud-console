import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Note,
  PageHeader,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { alerts, projectName, tickets } from "@/lib/mock-data";
import type { TicketPriority, TicketStatus } from "@/lib/types";

const selfService = [
  {
    title: "My instance is unreachable",
    detail:
      "Check device enrollment, project permission, and the instance state before opening a request.",
  },
  {
    title: "A restore failed",
    detail:
      "Read the operation timeline to see which stage failed, then retry or restore to a new target.",
  },
  {
    title: "My wallet is low",
    detail:
      "Top up, or enable auto-reload with a threshold, amount, and maximum frequency.",
  },
  {
    title: "I need higher limits",
    detail:
      "Request a quota increase. Approval follows a capacity and payment review.",
  },
];

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

export default function SupportPage() {
  const openCount = tickets.filter(
    (t) => t.status === "open" || t.status === "pending",
  ).length;

  return (
    <>
      <PageHeader
        title="Support"
        description="Self-service first, then an in-console request that carries safe diagnostics and operation context."
        action={<Button href="/console/support/new">Open a support request</Button>}
      />

      <div className="mb-5">
        <Note>
          GuildCloud does not publish formal response guarantees before support
          performance is measured. The first-response targets below describe
          our internal operating goal, not a contractual SLA — Protected and
          Warm Standby customers receive higher recovery attention.
        </Note>
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Your tickets"
          subtitle={`${openCount} open or pending · ${tickets.length} total`}
        />
        <Table>
          <thead>
            <tr>
              <Th>Ticket</Th>
              <Th>Status</Th>
              <Th>Priority</Th>
              <Th>Project</Th>
              <Th>First response</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => {
              const targetHours = (t.firstResponseTargetMinutes / 60).toFixed(
                t.firstResponseTargetMinutes % 60 === 0 ? 0 : 1,
              );
              return (
                <tr
                  key={t.id}
                  className="cursor-pointer transition-colors hover:bg-ink-50"
                >
                  <Td>
                    <Link
                      href={`/console/support/tickets/${t.id}`}
                      className="font-medium text-ink-900 hover:text-lemon-700 hover:underline"
                    >
                      {t.subject}
                    </Link>
                    <p className="font-mono text-xs text-ink-400">
                      {t.id}
                      {t.resource ? ` · ${t.resource}` : ""}
                    </p>
                  </Td>
                  <Td>
                    <Badge tone={statusTone[t.status]}>
                      {statusLabel[t.status]}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={priorityTone[t.priority]}>{t.priority}</Badge>
                  </Td>
                  <Td className="text-ink-500">{projectName(t.projectId)}</Td>
                  <Td className="text-xs">
                    {t.firstResponseAt ? (
                      <span className="text-ink-600">
                        {t.firstResponseAt}
                        <span className="block text-ink-400">
                          target {targetHours}h
                        </span>
                      </span>
                    ) : (
                      <span className="font-medium text-amber-600">
                        Awaiting response
                        <span className="block font-normal text-ink-400">
                          target {targetHours}h
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">
                    {t.updatedAt}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader title="Help me fix this" subtitle="Guided diagnosis for the most common situations." />
          <div className="divide-y divide-ink-100">
            {selfService.map((s) => (
              <div key={s.title} className="flex items-start justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-ink-900">{s.title}</p>
                  <p className="mt-0.5 text-xs text-ink-400">{s.detail}</p>
                </div>
                <Button variant="secondary" size="sm">
                  Start
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Platform status" subtitle="Reserved for broad service incidents." />
            <div className="px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-lemon-500" />
                <p className="text-sm font-medium text-ink-900">
                  All services operational
                </p>
              </div>
              <p className="mt-1.5 text-xs text-ink-400">
                Planned maintenance is announced in advance, and post-incident
                summaries are published after broad incidents.
              </p>
              <div className="mt-3">
                <Button variant="secondary" size="sm">
                  View status page
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Context attached to requests" />
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
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="Open items relevant to support" subtitle="Alerts that may become a request." />
        <div className="divide-y divide-ink-100">
          {alerts
            .filter((a) => !a.acknowledged)
            .map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-ink-900">{a.title}</p>
                    <Badge tone={a.severity === "critical" ? "rose" : "amber"}>
                      {a.severity}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {a.resource} · {a.openedAt}
                  </p>
                </div>
                <Button variant="secondary" size="sm">
                  Attach to request
                </Button>
              </div>
            ))}
        </div>
      </Card>
    </>
  );
}
