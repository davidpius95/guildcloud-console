-- CRITICAL: requesting an instance deletion provisioned a new VM instead of
-- deleting the instance.
--
-- Found by the Task 12 end-to-end lifecycle test on a disposable instance:
-- delete was requested at 15:01:34, and 49 seconds later the operation was
-- marked `succeeded` while the instance sat in state `ready` pointing at a
-- brand-new VMID. The stage history of the delete operation shows the whole
-- create sequence having run — proxmox_api_call cloned a new VM, cloud-init was
-- written, networking attached, and the `ready` stage set the instance back to
-- ready.
--
-- Cause: request_instance_deletion (Task 4) ends with
--   perform public.initialize_operation_stages(v_operation_id);
-- which seeds the ten create-shaped stages onto the delete operation. The
-- worker's generic stage machine claims any pending operation for its cluster
-- and walks those stages; its proxmox_api_call branch only special-cases
-- snapshot / resize / restore_replace, so `instance.delete` falls through to the
-- clone-a-new-VM path.
--
-- Deletion is not stage-driven. It is reconciled separately by the worker's
-- processPendingInstanceDeletions sweep, which finds instances in state
-- 'deleting' that have an active delete operation, tears down Proxmox and
-- Tailscale, and then calls finish_instance_operation. That sweep never needed
-- stages, and the other four intents legitimately do — so the fix is to stop
-- seeding stages for this one kind rather than to change
-- initialize_operation_stages.
--
-- With no stages, the stage machine's own guard already handles it: it looks for
-- the first pending/active stage in STAGE_ORDER, finds none, and returns
-- no_pending_stage without touching infrastructure.
--
-- Impact while this was live: every customer-initiated delete would leave the
-- instance running, provision an additional VM, hold its capacity reservation,
-- and report success. Two migrations' worth of blast radius — this shipped with
-- Task 4.

do $$
declare
  v_def text;
  v_target constant text := 'perform public.initialize_operation_stages(v_operation_id);';
  v_oid oid := to_regprocedure('public.request_instance_deletion(uuid, text)');
begin
  if v_oid is null then
    raise notice 'request_instance_deletion(uuid, text) not present; skipping';
    return;
  end if;

  v_def := pg_get_functiondef(v_oid);

  if position(v_target in v_def) = 0 then
    raise notice 'request_instance_deletion already free of stage seeding; skipping';
    return;
  end if;

  v_def := replace(
    v_def,
    v_target,
    '-- Deliberately no stages: deletion is reconciled by the worker''s'
    || chr(10) || '  -- pending-deletion sweep, not by the create-shaped stage machine.'
  );

  execute v_def;
end
$$;

-- Clear stages already seeded onto delete operations that have not finished, so
-- an in-flight delete cannot be picked up by the stage machine after this
-- migration lands. Terminal operations keep their history for the audit trail.
delete from public.operation_stages s
using public.operations o
where s.operation_id = o.id
  and o.kind = 'instance.delete'
  and o.state in ('pending', 'running');

revoke execute on function public.request_instance_deletion(uuid, text) from public, anon;
grant execute on function public.request_instance_deletion(uuid, text) to authenticated;
