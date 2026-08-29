"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserOrg } from "@/lib/supabase/queries";

export type CreateInstanceActionState = { error: string | null; redirectTo?: string };

function revalidateInstance(instanceId: string) {
  revalidatePath(`/console/instances/${instanceId}`);
  revalidatePath("/console/instances");
}

export async function createInstance(
  _prev: CreateInstanceActionState,
  formData: FormData,
): Promise<CreateInstanceActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "");
  const catalogImageId = String(formData.get("catalogImageId") ?? "");
  const catalogPlanId = String(formData.get("catalogPlanId") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const passwordSsh = formData.get("passwordSsh") === "on";
  const idempotencyKey = String(formData.get("idempotencyKey") ?? crypto.randomUUID());

  if (!name) return { error: "Instance name is required." };
  if (!projectId) return { error: "Project is required." };
  if (!catalogImageId || !catalogPlanId || !siteId) {
    return { error: "Image, plan, and site are required." };
  }

  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return { error: "No organization found." };
  if (userOrg.membership.role !== "Owner" && userOrg.membership.role !== "Admin") {
    return { error: "Only organization Owners and Admins can create instances." };
  }

  const supabase = await createClient();

  const { data: availability } = await supabase
    .rpc("catalog_image_site_availability")
    .eq("catalog_image_id", catalogImageId)
    .eq("site_id", siteId)
    .maybeSingle();
  if (!availability) {
    return { error: "No tested template at this site for this image yet." };
  }

  const { data: provisionability, error: provisionabilityError } = await supabase
    .rpc("can_provision_instance", {
      p_site_id: siteId,
      p_catalog_image_id: catalogImageId,
      p_catalog_plan_id: catalogPlanId,
    })
    .maybeSingle();
  if (provisionabilityError) return { error: provisionabilityError.message };
  if (!provisionability?.eligible) {
    return {
      error:
        provisionability?.message ??
        "No eligible capacity is available for this image and plan right now.",
    };
  }

  if (!passwordSsh) {
    const { count } = await supabase
      .from("ssh_keys")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", userOrg.organization.id);
    if (!count) {
      return {
        error: "You have no SSH keys registered - add one, or enable password SSH, so this instance is reachable.",
      };
    }
  }

  const { data, error } = await supabase.rpc("request_instance_create", {
    p_instance_id: crypto.randomUUID(),
    p_operation_id: crypto.randomUUID(),
    p_project_id: projectId,
    p_site_id: siteId,
    p_name: name,
    p_catalog_image_id: catalogImageId,
    p_catalog_plan_id: catalogPlanId,
    p_password_ssh_enabled: passwordSsh,
    p_idempotency_key: idempotencyKey,
  });
  if (error) return { error: error.message };

  const accepted = data?.[0];
  if (!accepted?.instance_id) {
    return { error: "The control plane did not accept this request." };
  }

  revalidatePath("/console/instances");
  return { error: null, redirectTo: `/console/instances/${accepted.instance_id}` };
}

export async function revealInstancePassword(
  instanceId: string,
): Promise<{ value: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_instance_ssh_password", {
    p_instance_id: instanceId,
  });
  if (error) return { value: null, error: error.message };
  return { value: data, error: null };
}

export async function deleteInstance(instanceId: string): Promise<{ error: string | null }> {
  if (!(await getCurrentUserOrg())) return { error: "No organization found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_instance_deletion", {
    p_instance_id: instanceId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidateInstance(instanceId);
  return { error: null };
}

export async function resizeInstance(
  instanceId: string,
  newPlanId: string,
): Promise<{ error: string | null }> {
  if (!(await getCurrentUserOrg())) return { error: "No organization found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_instance_resize", {
    p_instance_id: instanceId,
    p_target_plan_id: newPlanId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidateInstance(instanceId);
  return { error: null };
}

export async function createInstanceSnapshot(
  instanceId: string,
  snapshotName: string,
): Promise<{ error: string | null }> {
  if (!(await getCurrentUserOrg())) return { error: "No organization found." };
  const name = snapshotName.trim();
  if (!name) return { error: "Snapshot name is required." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_instance_snapshot", {
    p_instance_id: instanceId,
    p_name: name,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidateInstance(instanceId);
  return { error: null };
}

export async function restoreInstance(
  instanceId: string,
  snapshotId: string,
): Promise<{ error: string | null }> {
  if (!(await getCurrentUserOrg())) return { error: "No organization found." };
  if (!snapshotId) return { error: "Choose a ready snapshot to restore." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_instance_restore_replace", {
    p_instance_id: instanceId,
    p_snapshot_id: snapshotId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidateInstance(instanceId);
  return { error: null };
}
