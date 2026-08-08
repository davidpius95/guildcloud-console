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
  // org.created audit entry atomically - see supabase/migrations. The id
  // is generated here (not read back via .select()) because INSERT...
  // RETURNING's implicit SELECT-policy check (is_org_member) evaluates
  // before this same statement's AFTER INSERT trigger has made the new
  // membership row visible to it, which fails RLS even though the insert
  // itself is fully permitted - a same-command RLS/trigger ordering quirk,
  // not a policy bug. A separate statement afterward sees the trigger's
  // writes fine, which is what the project insert below relies on.
  const orgId = crypto.randomUUID();
  const { error: orgError } = await supabase
    .from("organizations")
    .insert({ id: orgId, name: orgName, slug: slugify(orgName), owner_id: user.id });
  if (orgError) return { error: orgError.message };

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({ organization_id: orgId, name: projectName })
    .select("id")
    .single();
  if (projectError) return { error: projectError.message };

  if (project) {
    await supabase.rpc("log_audit_event", {
      p_organization_id: orgId,
      p_action: "project.created",
      p_project_id: project.id,
      p_target_type: "project",
      p_target_id: project.id,
      p_metadata: { name: projectName },
    });
  }

  redirect("/console");
}
