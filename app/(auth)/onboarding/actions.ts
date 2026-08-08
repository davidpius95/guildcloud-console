"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AuthActionState } from "../actions";

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  // Append a short random suffix so two orgs named the same thing don't
  // collide on the unique slug constraint.
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base || "org"}-${suffix}`;
}

export async function completeOnboarding(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const orgName = String(formData.get("orgName") ?? "").trim();
  const projectName = String(formData.get("projectName") ?? "").trim();
  if (!orgName) return { error: "Organization name is required." };
  if (!projectName) return { error: "First project name is required." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  // handle_new_organization() trigger creates the Owner membership + the
  // org.created audit entry atomically - see supabase/migrations.
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name: orgName, slug: slugify(orgName), owner_id: user.id })
    .select("id")
    .single();
  if (orgError || !org) return { error: orgError?.message ?? "Could not create organization." };

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({ organization_id: org.id, name: projectName })
    .select("id")
    .single();
  if (projectError) return { error: projectError.message };

  if (project) {
    await supabase.rpc("log_audit_event", {
      p_organization_id: org.id,
      p_action: "project.created",
      p_project_id: project.id,
      p_target_type: "project",
      p_target_id: project.id,
      p_metadata: { name: projectName },
    });
  }

  redirect("/console");
}
