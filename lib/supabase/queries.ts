import "server-only";
import { cache } from "react";
import { createClient } from "./server";
import type { Organization, Membership, AuditLogEntry, Project, AccessResourceType } from "@/lib/types";
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
// Real bug found live: the create-instance wizard's image-availability
// check used lib/mock-data.ts's fictional `availableSites` field, which
// claims Debian/Fedora/Rocky/AlmaLinux/Docker/WordPress are all available
// at Lagos 1 - none of them have a real Proxmox template mapped anywhere.
// Only ubuntu-2404/lag-1 does. This is the real source of truth instead.
export async function getCatalogTemplateAvailability() {
  const supabase = await createClient();
  // See the catalog_image_site_availability() RPC's own comment
  // (supabase/migrations/20260819120000_route_lifecycle_by_instance.sql)
  // for why this is a security-definer RPC rather than a direct read of
  // catalog_image_site_templates.
  const { data, error } = await supabase.rpc("catalog_image_site_availability");
  if (error) throw error;
  return (data ?? []).map((row) => ({ catalogImageId: row.catalog_image_id, siteId: row.site_id }));
}

export async function getInstancesForOrg(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instances")
    .select(
      "id, name, state, site_id, private_ip, private_hostname, created_at, catalog_image_id, project_id, projects(name), catalog_images(name, version), catalog_plans(name, vcpu, memory_gb, disk_gb, hourly_price, monthly_max)",
    )
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  type Row = {
    id: string;
    name: string;
    state: string;
    site_id: string;
    private_ip: unknown;
    private_hostname: string | null;
    created_at: string;
    catalog_image_id: string | null;
    project_id: string;
    projects: { name: string } | null;
    catalog_images: { name: string; version: string } | null;
    catalog_plans: {
      name: string;
      vcpu: number;
      memory_gb: number;
      disk_gb: number;
      hourly_price: number;
      monthly_max: number;
    } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    state: row.state,
    siteId: row.site_id,
    privateIp: row.private_ip ? String(row.private_ip) : null,
    privateHostname: row.private_hostname,
    createdAt: row.created_at,
    projectId: row.project_id,
    projectName: row.projects?.name ?? "—",
    imageId: row.catalog_image_id ?? null,
    imageLabel: row.catalog_images ? `${row.catalog_images.name} ${row.catalog_images.version}` : "—",
    plan: row.catalog_plans,
  }));
}

export async function getCatalogPlans() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catalog_plans")
    .select("*")
    .order("vcpu", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getSnapshotsForInstance(instanceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instance_snapshots")
    .select("*")
    .eq("instance_id", instanceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getInstanceWithOperation(instanceId: string) {
  const supabase = await createClient();
  const { data: instance } = await supabase
    .from("instances")
    .select("*, catalog_plans(*), catalog_images(*), projects(name)")
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

  const snapshots = await getSnapshotsForInstance(instanceId);

  return { instance, operation, stages: stages ?? [], snapshots };
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

export async function getAccessGrantsForOrg(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("access_grants")
    .select("id, project_id, membership_id, resource_type, resource_id, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    projectId: row.project_id,
    membershipId: row.membership_id,
    resourceType: row.resource_type as AccessResourceType | "all",
    resourceId: row.resource_id,
    createdAt: row.created_at,
  }));
}

export async function getInstancesWithPrivateNetworkForOrg(organizationId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instances")
    .select("id, name, private_ip, private_hostname, state, projects(name)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    projectName: (row.projects as unknown as { name: string } | null)?.name ?? "—",
    privateIp: row.private_ip as string | null,
    privateHostname: row.private_hostname,
    state: row.state,
  }));
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
