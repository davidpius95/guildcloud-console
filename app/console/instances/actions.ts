"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserOrg } from "@/lib/supabase/queries";
import { OPERATION_STAGES } from "@/lib/operation-stages";

export type CreateInstanceActionState = { error: string | null };

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
  // Generated once client-side when the wizard renders (not per submit) so
  // a double-click or a retried request reuses the same key - see the
  // unique index on operations.idempotency_key. Falls back to a fresh
  // uuid only if the hidden field is somehow missing, which loses
  // idempotency for that one request but never breaks the flow.
  const idempotencyKey = String(formData.get("idempotencyKey") ?? crypto.randomUUID());

  if (!name) return { error: "Instance name is required." };
  if (!projectId) return { error: "Project is required." };
  if (!catalogImageId || !catalogPlanId || !siteId) {
    return { error: "Image, plan, and site are required." };
  }

  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return { error: "No organization found." };

  const supabase = await createClient();

  // Idempotency check first: if this exact submission already created an
  // operation (double-click, client retry), redirect to it instead of
  // creating a second one.
  const { data: existing } = await supabase
    .from("operations")
    .select("instance_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing?.instance_id) {
    redirect(`/console/instances/${existing.instance_id}`);
  }

  // Server-side re-validation of what the wizard's UI already gates on -
  // never trust the client alone for "is this combination actually
  // provisionable." Matches the wizard's existing "No tested template at
  // {site}" copy rather than letting an unmapped combination reach the
  // worker and fail there instead.
  const { data: template } = await supabase
    .from("catalog_image_site_templates")
    .select("proxmox_vmid")
    .eq("catalog_image_id", catalogImageId)
    .eq("site_id", siteId)
    .maybeSingle();
  if (!template) {
    return { error: "No tested template at this site for this image yet." };
  }

  // Same re-validation discipline as the template check above: without
  // this, an org with zero registered SSH keys and passwordSsh=false
  // could still submit (e.g. a stale page, or a client that skips the
  // wizard's own guard) and get a real instance with no working
  // credential at all - cloud-init has no key to inject, and an
  // unstored, unshown random password is not a real access method.
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

  // Ids generated client-side (same pattern as completeOnboarding in
  // Phase 1) - neither insert below chains .select(), so nothing depends
  // on RETURNING visibility of a same-transaction trigger's writes.
  const instanceId = crypto.randomUUID();
  const operationId = crypto.randomUUID();

  const { error: instanceError } = await supabase.from("instances").insert({
    id: instanceId,
    organization_id: userOrg.organization.id,
    project_id: projectId,
    site_id: siteId,
    name,
    catalog_image_id: catalogImageId,
    catalog_plan_id: catalogPlanId,
    state: "provisioning",
    password_ssh_enabled: passwordSsh,
  });
  if (instanceError) return { error: instanceError.message };

  const { error: operationError } = await supabase.from("operations").insert({
    id: operationId,
    organization_id: userOrg.organization.id,
    project_id: projectId,
    instance_id: instanceId,
    site_id: siteId,
    kind: "instance.create",
    resource_name: name,
    state: "pending",
    idempotency_key: idempotencyKey,
  });
  if (operationError) {
    // 23505 = unique_violation on idempotency_key - a race with another
    // request using the same key. Redirect to whichever one actually won
    // instead of surfacing an error for what is, from the user's
    // perspective, a successful submission.
    if (operationError.code === "23505") {
      const { data: winner } = await supabase
        .from("operations")
        .select("instance_id")
        .eq("idempotency_key", idempotencyKey)
        .single();
      if (winner?.instance_id) redirect(`/console/instances/${winner.instance_id}`);
    }
    // Real bug found live: these are separate inserts, not one transaction.
    // Returning here without cleaning up the instance row already written
    // above left permanently orphaned "provisioning" instances with no
    // operation to ever advance them (found two of these in the wild -
    // see docs/phase-2/threat-model.md finding #11). Compensate by
    // deleting what we just created so a failure here is invisible rather
    // than a silent stuck instance.
    await supabase.from("instances").delete().eq("id", instanceId);
    return { error: operationError.message };
  }

  const { error: stagesError } = await supabase
    .from("operation_stages")
    .insert(OPERATION_STAGES.map((stage) => ({ operation_id: operationId, stage })));
  if (stagesError) {
    await supabase.from("operations").delete().eq("id", operationId);
    await supabase.from("instances").delete().eq("id", instanceId);
    return { error: stagesError.message };
  }

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "instance.create_requested",
    p_project_id: projectId,
    p_target_type: "instance",
    p_target_id: instanceId,
    p_metadata: { name, catalog_image_id: catalogImageId, catalog_plan_id: catalogPlanId, site_id: siteId },
  });

  revalidatePath("/console/instances");
  redirect(`/console/instances/${instanceId}`);
}

// Reveal-once: the plaintext lives in Supabase Vault only until the first
// successful call, which deletes it as part of the same RPC (see the
// reveal_instance_ssh_password migration) - a second call for the same
// instance always returns null, never the same password twice. The RPC
// has its own internal Owner/Admin authorization check, so this action
// doesn't need to re-check membership itself.
export async function revealInstancePassword(
  instanceId: string,
): Promise<{ value: string | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_instance_ssh_password", {
    p_instance_id: instanceId,
  });
  // Real bug found live: this used to collapse every RPC error into the
  // same "already revealed" response as a genuinely empty result -
  // vault.delete_secret(uuid) didn't exist in this project's Vault
  // version, so every real reveal attempt silently failed this way and
  // no one ever actually saw a password. Surface real errors distinctly
  // now instead of guessing they mean "already consumed."
  if (error) return { value: null, error: error.message };
  return { value: data, error: null };
}

// Marks the instance for teardown and returns immediately - the real work
// (stopping/destroying the Proxmox VM, deleting the Tailscale device) needs
// the site worker's own LAN access to Proxmox, which this server action
// doesn't have, so it can't happen synchronously here. Same deferred-work
// pattern createInstance already established: this action only ever writes
// state, processPendingInstanceDeletions() in the site worker does the real
// teardown and removes the row once it's actually gone.
export async function deleteInstance(instanceId: string): Promise<{ error: string | null }> {
  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return { error: "No organization found." };

  const supabase = await createClient();

  const { data: instance } = await supabase
    .from("instances")
    .select("id, name, project_id, state")
    .eq("id", instanceId)
    .eq("organization_id", userOrg.organization.id)
    .maybeSingle();
  if (!instance) return { error: "Instance not found." };
  if (instance.state === "deleting") return { error: null };

  // Real bug found live: instances has no UPDATE RLS policy for regular
  // authenticated users (only SELECT and the site worker's own service-role
  // policy) - a plain .update() here matched zero rows under RLS and
  // returned no error, so this button appeared to work while doing
  // nothing. Fixed via a SECURITY DEFINER RPC that does its own internal
  // Owner/Admin check instead - see the request_instance_deletion migration.
  const { error } = await supabase.rpc("request_instance_deletion", {
    p_instance_id: instanceId,
  });
  if (error) return { error: error.message };

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "instance.delete_requested",
    p_project_id: instance.project_id,
    p_target_type: "instance",
    p_target_id: instanceId,
    p_metadata: { name: instance.name },
  });

  revalidatePath(`/console/instances/${instanceId}`);
  revalidatePath("/console/instances");
  return { error: null };
}

export async function resizeInstance(
  instanceId: string,
  newPlanId: string,
): Promise<{ error: string | null }> {
  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return { error: "No organization found." };

  const supabase = await createClient();

  const { data: instance } = await supabase
    .from("instances")
    .select("id, name, project_id, site_id, state, catalog_plan_id")
    .eq("id", instanceId)
    .eq("organization_id", userOrg.organization.id)
    .maybeSingle();

  if (!instance) return { error: "Instance not found." };
  if (instance.state !== "ready") {
    return { error: "Instance must be in Ready state to resize." };
  }
  if (instance.catalog_plan_id === newPlanId) {
    return { error: "Target plan is the same as current plan." };
  }

  const { data: plan } = await supabase
    .from("catalog_plans")
    .select("id, name")
    .eq("id", newPlanId)
    .maybeSingle();
  if (!plan) return { error: "Invalid target plan selected." };

  const operationId = crypto.randomUUID();

  await supabase
    .from("instances")
    .update({ state: "resizing" })
    .eq("id", instanceId);

  const { error: opError } = await supabase.from("operations").insert({
    id: operationId,
    organization_id: userOrg.organization.id,
    project_id: instance.project_id,
    instance_id: instanceId,
    site_id: instance.site_id,
    kind: "instance.resize",
    resource_name: instance.name,
    state: "pending",
    idempotency_key: crypto.randomUUID(),
    stages: { target_plan_id: newPlanId },
  });
  if (opError) {
    await supabase
      .from("instances")
      .update({ state: "ready" })
      .eq("id", instanceId);
    return { error: opError.message };
  }

  const { error: stagesError } = await supabase
    .from("operation_stages")
    .insert(
      OPERATION_STAGES.map((stage) => ({
        operation_id: operationId,
        stage,
      })),
    );
  if (stagesError) {
    await supabase.from("operations").delete().eq("id", operationId);
    await supabase
      .from("instances")
      .update({ state: "ready" })
      .eq("id", instanceId);
    return { error: stagesError.message };
  }

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "instance.resize_requested",
    p_project_id: instance.project_id,
    p_target_type: "instance",
    p_target_id: instanceId,
    p_metadata: {
      name: instance.name,
      old_plan: instance.catalog_plan_id,
      new_plan: newPlanId,
    },
  });

  revalidatePath(`/console/instances/${instanceId}`);
  revalidatePath("/console/instances");
  return { error: null };
}

export async function createInstanceSnapshot(
  instanceId: string,
  snapshotName: string,
): Promise<{ error: string | null }> {
  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return { error: "No organization found." };

  const name = snapshotName.trim();
  if (!name) return { error: "Snapshot name is required." };

  const supabase = await createClient();

  const { data: instance } = await supabase
    .from("instances")
    .select("id, name, project_id, site_id, state")
    .eq("id", instanceId)
    .eq("organization_id", userOrg.organization.id)
    .maybeSingle();

  if (!instance) return { error: "Instance not found." };
  if (instance.state !== "ready") {
    return { error: "Instance must be in Ready state to snapshot." };
  }

  const snapname = `snap-${Date.now().toString(36)}`;
  const snapshotId = crypto.randomUUID();
  const operationId = crypto.randomUUID();

  const { error: snapError } = await supabase.from("instance_snapshots").insert({
    id: snapshotId,
    organization_id: userOrg.organization.id,
    project_id: instance.project_id,
    instance_id: instanceId,
    name,
    proxmox_snapname: snapname,
    state: "creating",
  });
  if (snapError) return { error: snapError.message };

  const { error: opError } = await supabase.from("operations").insert({
    id: operationId,
    organization_id: userOrg.organization.id,
    project_id: instance.project_id,
    instance_id: instanceId,
    site_id: instance.site_id,
    kind: "instance.snapshot",
    resource_name: `${instance.name}/${name}`,
    state: "pending",
    idempotency_key: crypto.randomUUID(),
    stages: { snapshot_id: snapshotId, proxmox_snapname: snapname },
  });
  if (opError) {
    await supabase.from("instance_snapshots").delete().eq("id", snapshotId);
    return { error: opError.message };
  }

  await supabase.from("operation_stages").insert(
    OPERATION_STAGES.map((stage) => ({
      operation_id: operationId,
      stage,
    })),
  );

  await supabase.rpc("log_audit_event", {
    p_organization_id: userOrg.organization.id,
    p_action: "instance.snapshot_requested",
    p_project_id: instance.project_id,
    p_target_type: "instance",
    p_target_id: instanceId,
    p_metadata: { name: instance.name, snapshot_name: name },
  });

  revalidatePath(`/console/instances/${instanceId}`);
  return { error: null };
}

export async function restoreInstance(
  instanceId: string,
  mode: "new" | "replace",
  snapshotId?: string,
): Promise<{ error: string | null }> {
  const userOrg = await getCurrentUserOrg();
  if (!userOrg) return { error: "No organization found." };

  const supabase = await createClient();

  const { data: instance } = await supabase
    .from("instances")
    .select("id, name, project_id, site_id, state")
    .eq("id", instanceId)
    .eq("organization_id", userOrg.organization.id)
    .maybeSingle();

  if (!instance) return { error: "Instance not found." };

  const operationId = crypto.randomUUID();

  if (mode === "replace") {
    let snapname = "";
    if (snapshotId) {
      const { data: snap } = await supabase
        .from("instance_snapshots")
        .select("proxmox_snapname")
        .eq("id", snapshotId)
        .maybeSingle();
      if (snap) snapname = snap.proxmox_snapname;
    }

    await supabase
      .from("instances")
      .update({ state: "restoring" })
      .eq("id", instanceId);

    const { error: opError } = await supabase.from("operations").insert({
      id: operationId,
      organization_id: userOrg.organization.id,
      project_id: instance.project_id,
      instance_id: instanceId,
      site_id: instance.site_id,
      kind: "instance.restore_replace",
      resource_name: instance.name,
      state: "pending",
      idempotency_key: crypto.randomUUID(),
      stages: { snapshot_id: snapshotId, proxmox_snapname: snapname },
    });
    if (opError) {
      await supabase
        .from("instances")
        .update({ state: "ready" })
        .eq("id", instanceId);
      return { error: opError.message };
    }

    await supabase.from("operation_stages").insert(
      OPERATION_STAGES.map((stage) => ({
        operation_id: operationId,
        stage,
      })),
    );

    await supabase.rpc("log_audit_event", {
      p_organization_id: userOrg.organization.id,
      p_action: "instance.restore_requested",
      p_project_id: instance.project_id,
      p_target_type: "instance",
      p_target_id: instanceId,
      p_metadata: { name: instance.name, mode: "replace" },
    });
  } else {
    const newInstanceId = crypto.randomUUID();
    const newName = `${instance.name}-restored`;

    const { error: instErr } = await supabase.from("instances").insert({
      id: newInstanceId,
      organization_id: userOrg.organization.id,
      project_id: instance.project_id,
      site_id: instance.site_id,
      name: newName,
      catalog_image_id: "ubuntu-2404",
      catalog_plan_id: "std-1",
      state: "provisioning",
      password_ssh_enabled: true,
    });
    if (instErr) return { error: instErr.message };

    const { error: opError } = await supabase.from("operations").insert({
      id: operationId,
      organization_id: userOrg.organization.id,
      project_id: instance.project_id,
      instance_id: newInstanceId,
      site_id: instance.site_id,
      kind: "instance.create",
      resource_name: newName,
      state: "pending",
      idempotency_key: crypto.randomUUID(),
    });
    if (opError) return { error: opError.message };

    await supabase.from("operation_stages").insert(
      OPERATION_STAGES.map((stage) => ({
        operation_id: operationId,
        stage,
      })),
    );
  }

  revalidatePath(`/console/instances/${instanceId}`);
  revalidatePath("/console/instances");
  return { error: null };
}
