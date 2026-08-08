import { notFound } from "next/navigation";
import { Card, CardHeader, PageHeader, Badge, EmptyState } from "@/components/ui";
import { formatDate, money } from "@/lib/mock-data";
import { getProjectById } from "@/lib/supabase/queries";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.description || "No description"}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-ink-400">Created</p>
          <p className="mt-1 text-sm font-medium text-ink-900">
            {formatDate(project.createdAt)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-ink-400">Monthly spend</p>
          <p className="mt-1 text-sm font-medium text-ink-900">{money(project.monthlySpend)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-ink-400">Accent</p>
          <div className="mt-1">
            <Badge tone="lemon">{project.accent}</Badge>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Resources"
          subtitle="Instances, databases, storage, and functions for this project."
        />
        <EmptyState
          title="No resources yet"
          description="Resource provisioning connects to real Guild-A/Guild-B infrastructure in Phase 2 (site integration) - not wired up yet."
        />
      </Card>
    </>
  );
}
