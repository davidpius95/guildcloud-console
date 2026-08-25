import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Table,
  Td,
  Th,
  cx,
} from "@/components/ui";
import { IconCloud, IconPlus } from "@/components/icons";
import { formatDate } from "@/lib/format";
import {
  getCurrentUserOrg,
  getInstancesForOrg,
  getProjectsForOrg,
} from "@/lib/supabase/queries";

const accents: Record<string, string> = {
  lemon: "from-lemon-200 to-lemon-100",
  sky: "from-sky-200 to-sky-100",
  violet: "from-violet-200 to-violet-100",
  amber: "from-amber-200 to-amber-100",
};

const accentIconTones: Record<string, string> = {
  lemon: "text-lemon-700",
  sky: "text-sky-700",
  violet: "text-violet-700",
  amber: "text-amber-700",
};

export default async function ProjectsPage() {
  const userOrg = await getCurrentUserOrg();
  const projects = userOrg ? await getProjectsForOrg(userOrg.organization.id) : [];
  const allInstances = userOrg ? await getInstancesForOrg(userOrg.organization.id) : [];
  const instances = allInstances.map((i) => ({ projectId: i.projectId }));

  return (
    <>
      <PageHeader
        title="Projects"
        description="Projects are the isolation boundary. Private networking, access policy, and cost attribution all follow the project."
        action={
          <Button href="/console/projects/new">
            <IconPlus className="h-4 w-4" />
            Create project
          </Button>
        }
      />

      {projects.length === 0 ? (
        <Card className="mb-6 p-8 text-center">
          <p className="text-sm text-ink-500">
            No projects yet.{" "}
            <Link href="/console/projects/new" className="font-medium text-ink-800 underline">
              Create your first project
            </Link>
            .
          </p>
        </Card>
      ) : (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => {
            // Real instance count for this project. Every other resource
            // type (volumes, databases, buckets, clusters, functions) has no
            // backing table yet, so the card used to fill those tiles from
            // lib/mock-data - showing counts of resources the customer does
            // not have. Only what exists is shown.
            const counts = [
              {
                label: "Instances",
                n: instances.filter((r) => r.projectId === p.id).length,
              },
            ];
            return (
              <Link key={p.id} href={`/console/projects/${p.id}`}>
                <Card className="transition-shadow hover:shadow-md">
                  <div className="flex items-start gap-3 p-5">
                    <span
                      className={cx(
                        "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br",
                        accents[p.accent],
                      )}
                    >
                      <IconCloud className={cx("h-5 w-5", accentIconTones[p.accent])} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-ink-900">
                          {p.name}
                        </h3>
                        <Badge tone="lemon">
                          {instances.filter((r) => r.projectId === p.id).length} inst.
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-400">
                        {p.description || "No description"}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-px border-t border-ink-100 bg-ink-100">
                    {counts.map((c) => (
                      <div key={c.label} className="bg-white px-3 py-2.5 text-center">
                        <p className="text-sm font-semibold tabular-nums text-ink-900">
                          {c.n}
                        </p>
                        <p className="text-[0.7rem] text-ink-400">{c.label}</p>
                      </div>
                    ))}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader
          title="All projects"
          subtitle="Cost attribution is per project so bills stay explainable."
        />
        <Table>
          <thead>
            <tr>
              <Th>Project</Th>
              <Th>Created</Th>
              <Th>Instances</Th>
              <Th>Description</Th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium text-ink-900">
                  <Link href={`/console/projects/${p.id}`} className="hover:underline">
                    {p.name}
                  </Link>
                </Td>
                <Td className="text-ink-500">{formatDate(p.createdAt)}</Td>
                <Td className="tabular-nums">
                  {instances.filter((r) => r.projectId === p.id).length}
                </Td>
                <Td className="text-ink-500">{p.description}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
