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
import { IconPlus } from "@/components/icons";
import { currentUser, organization, quotas, team } from "@/lib/mock-data";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Organization, team access, quotas, and API credentials."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader
            title="Team access"
            subtitle="Roles control the console. Private network permission and server login are revoked together on removal."
            action={
              <Button size="sm">
                <IconPlus className="h-3.5 w-3.5" />
                Invite
              </Button>
            }
          />
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Role</Th>
                <Th>Device</Th>
                <Th>Last active</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <span className="font-medium text-ink-900">{m.name}</span>
                    <p className="text-xs text-ink-400">{m.email}</p>
                  </Td>
                  <Td>
                    <Badge tone={m.role === "Owner" ? "lemon" : "neutral"}>
                      {m.role}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={m.deviceEnrolled ? "lemon" : "amber"}>
                      {m.deviceEnrolled ? "Enrolled" : "Not enrolled"}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">
                    {m.lastActive}
                  </Td>
                  <Td className="text-right">
                    {m.role === "Owner" ? null : (
                      <Button variant="ghost" size="sm">
                        Remove
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Organization" />
            <div className="divide-y divide-ink-100 text-sm">
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Name</span>
                <span className="font-medium text-ink-900">{organization.name}</span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Organization ID</span>
                <span className="font-mono text-xs text-ink-700">
                  {organization.id}
                </span>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Your role</span>
                <Badge tone="lemon">{currentUser.role}</Badge>
              </div>
              <div className="flex justify-between px-5 py-3">
                <span className="text-ink-500">Email verified</span>
                <Badge tone="lemon">Yes</Badge>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Quotas" subtitle="Higher limits are approved after capacity and payment review." />
            <Table minWidth="0">
              <thead>
                <tr>
                  <Th>Resource</Th>
                  <Th className="text-right">Used</Th>
                  <Th className="text-right">Limit</Th>
                </tr>
              </thead>
              <tbody>
                {quotas.map((q) => (
                  <tr key={q.label}>
                    <Td className="text-ink-700">{q.label}</Td>
                    <Td className="text-right tabular-nums">{q.used}</Td>
                    <Td className="text-right tabular-nums font-medium">
                      {q.limit}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="px-5 py-3">
              <Button variant="secondary" size="sm">
                Request higher limits
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="SSH keys" subtitle="Keys are enabled by default on every instance." />
          <div className="divide-y divide-ink-100 text-sm">
            {[
              ["saurabh@macbook", "ed25519 · added 2026-03-11"],
              ["amara@thinkpad", "ed25519 · added 2026-04-02"],
            ].map(([name, meta]) => (
              <div key={name} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="font-medium text-ink-900">{name}</p>
                  <p className="text-xs text-ink-400">{meta}</p>
                </div>
                <Button variant="ghost" size="sm">
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <div className="px-5 py-3">
            <Button variant="secondary" size="sm">
              <IconPlus className="h-3.5 w-3.5" />
              Add key
            </Button>
          </div>
        </Card>

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
