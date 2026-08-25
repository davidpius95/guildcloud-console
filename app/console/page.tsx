import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Note,
  PageHeader,
  Stat,
  StatePill,
} from "@/components/ui";
import { IconArrowRight, IconLock, IconPlus, IconServer } from "@/components/icons";
import { RemoteAccessGuide } from "@/components/remote-access-guide";
import { formatDate } from "@/lib/format";
import {
  getCurrentUserOrg,
  getInstancesForOrg,
  getProjectsForOrg,
} from "@/lib/supabase/queries";
import type { ResourceState } from "@/lib/types";

const money = (value: number) => `$${value.toFixed(2)}`;

// Rewritten to show only real data. This was previously the most misleading
// page in the console: it greeted the user as a fabricated organization
// ("Northwind Labs"), and every figure on it - instance counts, spend,
// quotas, alerts, site health - came from lib/mock-data rather than the
// signed-in customer's own infrastructure. It is the first page seen after
// login, so it was also the page most likely to be believed.
export default async function ConsoleDashboard() {
  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return null;

  const [instances, projects] = await Promise.all([
    getInstancesForOrg(userOrg.organization.id),
    getProjectsForOrg(userOrg.organization.id),
  ]);

  const ready = instances.filter((i) => i.state === "ready");
  const inFlight = instances.filter(
    (i) => i.state === "provisioning" || i.state === "deleting",
  );
  const failed = instances.filter((i) => i.state === "failed");
  const committedMonthly = instances
    .filter((i) => i.state !== "failed")
    .reduce((sum, i) => sum + (i.plan?.monthly_max ?? 0), 0);
  const canCreate =
    userOrg.membership.role === "Owner" || userOrg.membership.role === "Admin";
  const recent = [...instances].slice(0, 5);

  return (
    <>
      <PageHeader
        title={userOrg.organization.name}
        description="Private-by-default infrastructure. Every instance is reachable only from your enrolled devices — no public IP, no public SSH."
        action={
          canCreate ? (
            <Button href="/console/instances/new">
              <IconPlus className="h-4 w-4" />
              Create instance
            </Button>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <Stat label="Running instances" value={String(ready.length)} tone="lemon" />
        </Card>
        <Card>
          <Stat
            label="In progress"
            value={String(inFlight.length)}
            hint={inFlight.length ? "Provisioning or tearing down." : "Nothing in flight."}
          />
        </Card>
        <Card>
          <Stat
            label="Wallet balance"
            value={money(userOrg.organization.walletBalanceCents / 100)}
          />
        </Card>
        <Card>
          <Stat
            label="Monthly maximum"
            value={money(committedMonthly)}
            hint="Ceiling if everything runs all month."
          />
        </Card>
      </div>

      {failed.length > 0 ? (
        <div className="mb-5">
          <Note tone="warning">
            {failed.length} instance{failed.length === 1 ? "" : "s"} failed to
            provision and {failed.length === 1 ? "is" : "are"} not billable.
            Open {failed.length === 1 ? "it" : "them"} from Guild Instances to
            review or delete.
          </Note>
        </div>
      ) : null}

      {/* The 3-step onboarding guide is for someone who has not connected a
          device yet. Once enrolled it is pure noise in the most valuable slot
          on the page, every visit, forever - so it stands down and the
          Networking page keeps the "add another device" route. */}
      {userOrg.membership.deviceEnrolled ? null : (
        <RemoteAccessGuide className="mb-5" />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader
            title="Your instances"
            subtitle={
              instances.length
                ? `${instances.length} total in ${userOrg.organization.name}.`
                : undefined
            }
            action={
              instances.length ? (
                <Link
                  href="/console/instances"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-lemon-700 hover:text-lemon-800 hover:underline"
                >
                  View all
                  <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : undefined
            }
          />
          {instances.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-lemon-100 text-lemon-800 ring-8 ring-lemon-50">
                <IconServer className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-ink-900">
                No instances yet
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-ink-500">
                {canCreate
                  ? "Create your first private server. It gets a stable private hostname and no public route."
                  : "Only Owners and Admins can create instances. Ask an Owner or Admin on your team."}
              </p>
              {canCreate ? (
                <div className="mt-5">
                  <Button href="/console/instances/new" size="sm">
                    <IconPlus className="h-4 w-4" />
                    Create instance
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y divide-ink-100">
              {recent.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <Link
                      href={`/console/instances/${i.id}`}
                      className="text-sm font-medium text-ink-900 hover:text-lemon-700 hover:underline"
                    >
                      {i.name}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      {i.projectName} · {i.plan?.name ?? "—"} · created{" "}
                      {formatDate(i.createdAt)}
                    </p>
                  </div>
                  <StatePill state={i.state as ResourceState} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Projects" />
            {projects.length === 0 ? (
              <p className="px-5 py-6 text-sm text-ink-500">No projects yet.</p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {projects.map((p) => (
                  <li key={p.id} className="px-5 py-3">
                    <Link
                      href={`/console/projects/${p.id}`}
                      className="text-sm font-medium text-ink-900 hover:text-lemon-700 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {instances.filter((i) => i.projectName === p.name).length}{" "}
                      instances
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Your access" />
            <div className="space-y-3 px-5 py-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-500">Role</span>
                <Badge tone="sky">{userOrg.membership.role}</Badge>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-ink-500">This device</span>
                <Badge tone={userOrg.membership.deviceEnrolled ? "lemon" : "neutral"}>
                  {userOrg.membership.deviceEnrolled ? "Enrolled" : "Not enrolled"}
                </Badge>
              </div>
              <p className="flex items-start gap-2 pt-1 text-xs text-ink-500">
                <IconLock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Instances are reachable only from enrolled devices. Manage
                  yours from{" "}
                  <Link
                    href="/console/networking"
                    className="font-medium text-lemon-700 hover:underline"
                  >
                    Networking
                  </Link>
                  .
                </span>
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
