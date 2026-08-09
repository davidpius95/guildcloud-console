import "server-only";
import { cache } from "react";
import { createClient } from "./server";
import type { Organization, Membership, AuditLogEntry, Project } from "@/lib/types";
import type { Tables } from "./types";

function toOrganization(row: Tables<"organizations">): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.owner_id,
    walletBalanceCents: row.wallet_balance_cents,
    createdAt: row.created_at,
  };
}

function toMembership(row: Tables<"memberships">): Membership {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role as Membership["role"],
    deviceEnrolled: row.device_enrolled,
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
    invitedEmail: row.invited_email,
    joinedAt: row.joined_at,
    lastActiveAt: row.last_active_at,
    createdAt: row.created_at,
    email: row.email ?? undefined,
  };
}

function toProject(row: Tables<"projects">): Project & { organizationId: string } {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    accent: row.accent as Project["accent"],
    // Not yet backed by real resource tables (Phase 2) - always 0 for now.
    resourceCount: 0,
    monthlySpend: 0,
    organizationId: row.organization_id,
  };
}

function toAuditLogEntry(row: Tables<"audit_log">): AuditLogEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    actorId: row.actor_id,
    projectId: row.project_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
  };
}

/**
 * The current signed-in user's first (only, in Phase 1) organization
 * membership, or null if they haven't completed onboarding yet.
 */
export const getCurrentUserOrg = cache(async function getCurrentUserOrg(): Promise<{
  userId: string;
  userEmail: string | null;
  organization: Organization;
  membership: Membership;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membershipRow } = await supabase
    .from("memberships")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membershipRow) return null;

  const { data: orgRow } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", membershipRow.organization_id)
    .single();
  if (!orgRow) return null;

  return {
    userId: user.id,
    userEmail: user.email ?? null,
    organization: toOrganization(orgRow),
    membership: toMembership(membershipRow),
  };
});

export async function getProjectsForOrg(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toProject);
}

export async function getProjectById(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data ? toProject(data) : null;
}

export async function getMembersForOrg(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("memberships")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => toMembership(row));
}

/**
 * A real (Phase 2) instance and its most recent operation + stage rows,
 * or null if `id` isn't a real instance - the caller falls back to
 * lib/mock-data.ts's Instance[] in that case (see app/console/instances/
 * [id]/page.tsx), since mock instances and real ones share the same
 * route/id shape for now.
 */
export async function getInstanceWithOperation(instanceId: string) {
  const supabase = await createClient();
  const { data: instance } = await supabase
    .from("instances")
    .select("*")
    .eq("id", instanceId)
    .maybeSingle();
  if (!instance) return null;

  const { data: operation } = await supabase
    .from("operations")
    .select("*")
    .eq("instance_id", instanceId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: stages } = operation
    ? await supabase
        .from("operation_stages")
        .select("*")
        .eq("operation_id", operation.id)
    : { data: [] };

  return { instance, operation, stages: stages ?? [] };
}

export async function getSshKeysForOrg(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ssh_keys")
    .select("id, name, public_key, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getAuditLogForOrg(organizationId: string, limit = 100) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(toAuditLogEntry);
}
