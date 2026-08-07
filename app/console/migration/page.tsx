import { OperationTimeline } from "@/components/operation-timeline";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Note,
  PageHeader,
} from "@/components/ui";
import { migrationJobs, projectName } from "@/lib/mock-data";

const statusTone = {
  discovering: "sky",
  planning: "sky",
  migrating: "amber",
  completed: "lemon",
  failed: "rose",
} as const;

export default function MigrationPage() {
  return (
    <>
      <PageHeader
        title="Migration"
        description="Bring workloads in from AWS, DigitalOcean, Hetzner, or any other provider. Discover what you have, map it to a GuildCloud plan, then migrate with guided automation."
        action={<Button href="/console/migration/new">Start a migration</Button>}
      />

      <div className="mb-6">
        <Note>
          Source credentials are used only to discover and read workload
          metadata during this flow — they are never stored by GuildCloud.
          This capability is manual and guided today; fully automated
          near-zero-downtime cutover is future work.
        </Note>
      </div>

      {migrationJobs.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {migrationJobs.map((job) => (
            <Card key={job.id}>
              <CardHeader
                title={job.name}
                subtitle={`${job.source} · ${projectName(job.projectId)} · ${job.workloadCount} workloads`}
                action={<Badge tone={statusTone[job.status]}>{job.status}</Badge>}
              />
              <div className="px-5 py-4">
                <OperationTimeline
                  operation={{
                    id: job.id,
                    kind: "Migration",
                    resourceName: job.name,
                    projectId: job.projectId,
                    startedAt: job.startedAt,
                    state:
                      job.status === "completed"
                        ? "succeeded"
                        : job.status === "failed"
                          ? "failed"
                          : "running",
                    stages: job.stages,
                  }}
                />
                <p className="mt-4 text-xs text-ink-400">
                  Started {job.startedAt}
                  {job.completedAt ? ` · Completed ${job.completedAt}` : ""}
                </p>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-semibold text-ink-800">
              No migrations yet
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-400">
              Start one to bring existing workloads onto GuildCloud.
            </p>
          </div>
        </Card>
      )}
    </>
  );
}
