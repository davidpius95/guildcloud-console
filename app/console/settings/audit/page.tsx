import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th, Mono } from "@/components/ui";
import { getCurrentUserOrg, getAuditLogForOrg } from "@/lib/supabase/queries";
import { formatDateTime } from "@/lib/format";

const actionTones: Record<string, "lemon" | "amber" | "rose" | "sky" | "neutral"> = {
  "org.created": "lemon",
  "project.created": "lemon",
  "member.invited": "sky",
  "member.role_changed": "amber",
  "member.removed": "rose",
};

export default async function AuditLogPage() {
  const userOrg = await getCurrentUserOrg();
  const entries = userOrg ? await getAuditLogForOrg(userOrg.organization.id) : [];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every organization, project, and membership change - append-only, cannot be edited or deleted from the app."
      />

      <Card>
        <CardHeader
          title="Recent activity"
          subtitle={`${entries.length} event${entries.length === 1 ? "" : "s"}`}
        />
        {entries.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Actions like creating a project or inviting a teammate will show up here."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>When</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <Badge tone={actionTones[e.action] ?? "neutral"}>{e.action}</Badge>
                  </Td>
                  <Td className="text-ink-500">
                    {e.targetType ? `${e.targetType}${e.targetId ? ` · ${e.targetId.slice(0, 8)}` : ""}` : "—"}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">
                    {formatDateTime(e.createdAt)}
                  </Td>
                  <Td>
                    <Mono>{JSON.stringify(e.metadata)}</Mono>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
