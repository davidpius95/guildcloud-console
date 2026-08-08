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

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      organization_id: userOrg.organization.id,
      name,
      description,
      accent,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (project) {
    await supabase.rpc("log_audit_event", {
      p_organization_id: userOrg.organization.id,
      p_action: "project.created",
      p_project_id: project.id,
      p_target_type: "project",
      p_target_id: project.id,
      p_metadata: { name },
    });
  }

  revalidatePath("/console/projects");
  redirect("/console/projects");
}
