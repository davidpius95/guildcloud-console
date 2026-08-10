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

// The public key this org's real instances actually get injected with -
// see the "template_cloud_init" stage in supabase/functions/
// site-worker-guild-a. Before this table existed, every clone silently
// inherited the Guild-A template's one shared, fixed key - see
// docs/phase-2/threat-model.md finding #7.
export async function addSshKey(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const publicKey = String(formData.get("publicKey") ?? "").trim();
  if (!name) return { error: "A label for this key is required." };
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+) /.test(publicKey)) {
    return { error: "Doesn't look like a public key (must start with ssh-ed25519, ssh-rsa, or ecdsa-sha2-...)." };
  }

  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return { error: "No organization found." };

  const supabase = await createClient();
  const { error } = await supabase.from("ssh_keys").insert({
    organization_id: userOrg.organization.id,
    name,
    public_key: publicKey,
  });
  if (error) return { error: error.message };

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "ssh_key.added",
    p_target_type: "ssh_key",
    p_metadata: { name },
  });

  // Real bug fixed: a newly-added key previously only reached instances
  // created AFTER this point - cloud-init only injects ssh_keys once, at
  // creation. Flag existing ready instances for the worker's real
  // authorized_keys re-sync (processPendingSshKeySyncs).
  await supabase.rpc("mark_org_instances_ssh_dirty", {
    p_organization_id: userOrg.organization.id,
  });

  revalidatePath("/console/settings");
  return { error: null };
}

export async function removeSshKey(id: string) {
  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return;
  const supabase = await createClient();

  const { error } = await supabase.from("ssh_keys").delete().eq("id", id);
  if (error) return;

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "ssh_key.removed",
    p_target_type: "ssh_key",
    p_target_id: id,
  });

  // Same real-sync fix as addSshKey - a removed key must actually stop
  // working on already-running instances, not just disappear from this
  // table (that's the security-relevant half of this fix).
  await supabase.rpc("mark_org_instances_ssh_dirty", {
    p_organization_id: userOrg.organization.id,
  });

  revalidatePath("/console/settings");
}
