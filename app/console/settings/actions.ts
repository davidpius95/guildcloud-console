"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserOrg } from "@/lib/supabase/queries";
import type { MemberRole } from "@/lib/types";

export type SettingsActionState = { error: string | null };

export async function inviteMember(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "Developer") as MemberRole;
  if (!email) return { error: "Email is required." };

  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return { error: "No organization found." };

  const supabase = await createClient();

  // Phase 1 simplification: creates a pending membership keyed by email,
  // auto-linked when that person actually signs up (see the
  // link_pending_invites trigger) - not a full token-based invite-
  // acceptance flow yet. See docs/phase-1/api-contract.md.
  const { error } = await supabase.from("memberships").insert({
    organization_id: userOrg.organization.id,
    invited_email: email,
    email,
    role,
    invited_by: userOrg.userId,
    invited_at: new Date().toISOString(),
  });
  if (error) {
    if (error.code === "23505") return { error: "This email has already been invited." };
    return { error: error.message };
  }

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "member.invited",
    p_target_type: "membership",
    p_metadata: { email, role },
  });

  revalidatePath("/console/settings");
  return { error: null };
}

export async function updateMemberRole(membershipId: string, role: MemberRole) {
  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return;
  const supabase = await createClient();

  const { error } = await supabase
    .from("memberships")
    .update({ role })
    .eq("id", membershipId);
  if (error) return;

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "member.role_changed",
    p_target_type: "membership",
    p_target_id: membershipId,
    p_metadata: { role },
  });

  revalidatePath("/console/settings");
}

export async function removeMember(membershipId: string) {
  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return;
  const supabase = await createClient();

  const { error } = await supabase.from("memberships").delete().eq("id", membershipId);
  if (error) return;

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "member.removed",
    p_target_type: "membership",
    p_target_id: membershipId,
  });

  revalidatePath("/console/settings");
}
