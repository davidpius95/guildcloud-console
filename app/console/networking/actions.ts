"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserOrg } from "@/lib/supabase/queries";
import type { AccessResourceType } from "@/lib/types";

export type NetworkingActionState = { error: string | null };

// Real per-instance/per-project access grants - the "Access policy" card
// used to be pure client-local React state (components/access-policy-card.tsx),
// no persistence at all. Same shape as addSshKey/removeSshKey
// (app/console/settings/actions.ts).
export async function addAccessGrant(
  _prev: NetworkingActionState,
  formData: FormData,
): Promise<NetworkingActionState> {
  const projectId = String(formData.get("projectId") ?? "");
  const membershipId = String(formData.get("membershipId") ?? "");
  const resourceType = String(formData.get("resourceType") ?? "all") as AccessResourceType | "all";
  const resourceIdRaw = String(formData.get("resourceId") ?? "").trim();
  const resourceId = resourceIdRaw || null;

  if (!projectId) return { error: "Project is required." };
  if (!membershipId) return { error: "Member is required." };

  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return { error: "No organization found." };

  const supabase = await createClient();

  // Never trust the client alone for "does this resource actually exist
  // and belong to this org" - same discipline as createInstance's
  // server-side template re-check. Only 'instance' is a real resource
  // kind today; database/cluster/bucket/function stay mock everywhere
  // else in this app, so there's nothing real to validate them against.
  if (resourceId && resourceType === "instance") {
    const { data: instance } = await supabase
      .from("instances")
      .select("id")
      .eq("id", resourceId)
      .eq("organization_id", userOrg.organization.id)
      .maybeSingle();
    if (!instance) return { error: "That instance was not found in this organization." };
  }

  const { error } = await supabase.from("access_grants").insert({
    organization_id: userOrg.organization.id,
    project_id: projectId,
    membership_id: membershipId,
    resource_type: resourceType,
    resource_id: resourceId,
    created_by: userOrg.userId,
  });
  if (error) {
    if (error.code === "23505") return { error: "This member already has this exact grant." };
    return { error: error.message };
  }

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "access_grant.added",
    p_project_id: projectId,
    p_target_type: "access_grant",
    p_metadata: { membershipId, resourceType, resourceId },
  });

  revalidatePath("/console/networking");
  return { error: null };
}

export async function removeAccessGrant(id: string) {
  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return;
  const supabase = await createClient();

  const { error } = await supabase.from("access_grants").delete().eq("id", id);
  if (error) return;

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "access_grant.removed",
    p_target_type: "access_grant",
    p_target_id: id,
  });

  revalidatePath("/console/networking");
}

// Real device self-enrollment. Calls the enroll-device Edge Function
// (which holds the Tailscale credentials this app deliberately never
// does) and returns a one-shot install command for the caller's own
// device - never a raw Tailscale key, and the word "Tailscale" never
// appears in this response, only inside the script itself once fetched.
export async function requestDeviceEnrollment(): Promise<{ command: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke("enroll-device", { method: "POST" });
  if (error) return { command: null, error: error.message };
  if (data?.error) return { command: null, error: data.error };
  return { command: data?.command ?? null, error: null };
}
