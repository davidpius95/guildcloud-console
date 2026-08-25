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
import { TeamAccessCard } from "@/components/team-access-card";
import { SshKeysCard } from "@/components/ssh-keys-card";
import {
  getCurrentUserOrg,
  getMembersForOrg,
  getSshKeysForOrg,
} from "@/lib/supabase/queries";

export default async function SettingsPage() {
  const userOrg = await getCurrentUserOrg();
  const members = userOrg ? await getMembersForOrg(userOrg.organization.id) : [];
  const sshKeys = userOrg ? await getSshKeysForOrg(userOrg.organization.id) : [];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organization, team access, quotas, and API credentials."
        action={
          <Button href="/console/settings/audit" variant="secondary">
            View audit log
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <TeamAccessCard members={members} />

        <div className="space-y-4">
          <Card>
            <CardHeader title="Organization" />
            <div className="divide-y divide-ink-100 text-sm">
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Name</span>
                <span className="font-medium text-ink-900">
                  {userOrg?.organization.name ?? "—"}
                </span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Organization ID</span>
                <span className="font-mono text-xs text-ink-700">
                  {userOrg?.organization.id ?? "—"}
                </span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Your role</span>
                <Badge tone="lemon">{userOrg?.membership.role ?? "—"}</Badge>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Email verified</span>
                <Badge tone="lemon">Yes</Badge>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Quotas"
              subtitle="Higher limits are approved after capacity and payment review."
            />
            {/* Quota accounting is not implemented - there is no per-org limit
                table and nothing meters usage against one. This card used to
                render fabricated used/limit pairs from lib/mock-data, which
                read as a real allowance the customer was consuming. */}
            <p className="px-5 py-6 text-sm leading-relaxed text-ink-500">
              No quotas are enforced on this organization yet. Capacity is
              governed per site by its own reserve, shown on the Networking
              page.
            </p>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SshKeysCard keys={sshKeys} />

        <Card>
          <CardHeader title="Support access" subtitle="There is no standing support access to your servers." />
          <div className="space-y-3 px-5 py-4">
            <Note>
              Any exceptional access is customer-approved, time-limited, audited,
              and revocable. No support engineer can reach your instances without
              you granting it.
            </Note>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-500">Standing access grants</span>
              <Badge>None</Badge>
            </div>
            <Button variant="secondary" size="sm">
              View access audit history
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
