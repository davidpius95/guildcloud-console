"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserOrg } from "@/lib/supabase/queries";

export type ProjectActionState = { error: string | null };

const accentCycle = ["lemon", "sky", "violet", "amber"] as const;

export async function createProject(
  _prev: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) return { error: "Project name is required." };

  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return { error: "No organization found." };

  const supabase = await createClient();
  const accent = accentCycle[Math.floor(Math.random() * accentCycle.length)];

  // id (and the slug derived from it) generated client-side so the real
  // Tailscale tag name (tag:guildcloud-tenant-<slug>) is fixed at creation
  // and never recomputed from the renamable `name` column - see
  // docs/phase-3/data-model.md. tailscale_acl_state defaults to 'pending';
  // the site worker picks it up and applies the real per-project ACL
  // grant asynchronously, the same durable pattern createInstance already
  // uses for provisioning.
  const projectId = crypto.randomUUID();
  const slug = `project-${projectId.slice(0, 8)}`;

  const { error } = await supabase.from("projects").insert({
    id: projectId,
    organization_id: userOrg.organization.id,
    name,
    description,
    accent,
    slug,
  });

  if (error) return { error: error.message };

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "project.created",
    p_project_id: projectId,
    p_target_type: "project",
    p_target_id: projectId,
    p_metadata: { name, slug },
  });

  revalidatePath("/console/projects");
  redirect("/console/projects");
}
