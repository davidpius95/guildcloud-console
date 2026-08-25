"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserOrg } from "@/lib/supabase/queries";
import { getSiteUrl } from "@/lib/site-url";
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

  const [{ data: project }, { data: membership }] = await Promise.all([
    supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("organization_id", userOrg.organization.id)
      .maybeSingle(),
    supabase
      .from("memberships")
      .select("id")
      .eq("id", membershipId)
      .eq("organization_id", userOrg.organization.id)
      .maybeSingle(),
  ]);
  if (!project) return { error: "That project was not found in this organization." };
  if (!membership) return { error: "That member was not found in this organization." };

  // Never trust the client alone for "does this resource actually exist
  // and belong to this org" - same discipline as createInstance's
  // server-side template re-check. Only 'instance' is a real resource
  // kind today; database/cluster/bucket/function stay mock everywhere
  // else in this app, so there's nothing real to validate them against.
  if (resourceId && resourceType === "instance") {
    const { data: instance } = await supabase
      .from("instances")
      .select("id, project_id")
      .eq("id", resourceId)
      .eq("organization_id", userOrg.organization.id)
      .maybeSingle();
    if (!instance) return { error: "That instance was not found in this organization." };
    if (instance.project_id !== projectId) return { error: "That instance does not belong to the selected project." };
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

  // The tailnet policy is reconciled by the designated site worker. Marking
  // this project pending gives the customer a truthful state while that
  // worker turns this database grant into a narrow member->instance route.
  await supabase
    .from("projects")
    .update({ tailscale_acl_state: "pending" })
    .eq("id", projectId)
    .eq("organization_id", userOrg.organization.id);

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

  const { data: target } = await supabase
    .from("access_grants")
    .select("project_id, organization_id")
    .eq("id", id)
    .maybeSingle();

  if (!target || target.organization_id !== userOrg.organization.id) return;

  const { error } = await supabase.from("access_grants").delete().eq("id", id);
  if (error) return;

  // Reconcile the affected project after revocation as well. Read it through
  // the org-scoped RLS policy rather than trusting a project id from the UI.
  if (target?.project_id) {
    await supabase
      .from("projects")
      .update({ tailscale_acl_state: "pending" })
      .eq("id", target.project_id)
      .eq("organization_id", userOrg.organization.id);
  }

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
export async function requestDeviceEnrollment(
  regenerate = false,
): Promise<{ command: string | null; error: string | null; reused?: boolean }> {
  const supabase = await createClient();

  // Fast path, entirely inside this app. Minting a key needs the Tailscale
  // credentials only the Edge Function holds, but *reusing* an already-valid
  // link needs nothing except the token sitting on the caller's own
  // membership row - which they can read under RLS because it is their row.
  // Going out to the Edge Function for that was three network hops (Vercel ->
  // Supabase Auth -> Postgres) to answer a question one query answers, and
  // measured ~1.4s warm. Scoped to the signed-in user's own membership by
  // user_id, so this can never surface another member's link.
  if (!regenerate) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: own } = await supabase
        .from("memberships")
        .select("enrollment_token, enrollment_token_expires_at")
        .eq("user_id", user.id)
        .maybeSingle();
      const expiry = own?.enrollment_token_expires_at;
      if (own?.enrollment_token && expiry && new Date(expiry).getTime() > Date.now()) {
        return {
          command: `curl -fsSL ${await getSiteUrl()}/api/enroll/${own.enrollment_token} | sh`,
          error: null,
          reused: true,
        };
      }
    }
  }

  // Pass this app's own known-good origin instead of relying on the
  // Edge Function's CONSOLE_URL secret - that secret never actually took
  // effect across several dashboard + CLI attempts (see PROJECT_STATUS.md,
  // 2026-08-25), silently falling back to a hardcoded localhost URL that
  // broke the generated command on every device but the one dev box.
  // getSiteUrl() is already proven correct here (same fix as OAuth/invite
  // redirects), so there's no reason to route this through a second,
  // separately-configured source of truth.
  const { data, error } = await supabase.functions.invoke("enroll-device", {
    method: "POST",
    body: { consoleUrl: await getSiteUrl(), regenerate },
  });
  if (error) return { command: null, error: error.message };
  if (data?.error) return { command: null, error: data.error };
  return { command: data?.command ?? null, error: null, reused: data?.reused === true };
}
