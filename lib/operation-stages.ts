// Fixed stage order matching the master plan's §5 operation flow and the
// operation_stages.stage check constraint. Shared by the createInstance
// Server Action (which inserts one row per stage) and the console's
// operation-progress UI (which orders them for display) - the site
// worker (supabase/functions/site-worker-guild-a) keeps its own copy
// since it runs in a separate Deno runtime that can't import this file.
export const OPERATION_STAGES = [
  "preflight",
  "capacity_reservation",
  "operation_created",
  "site_worker_dispatch",
  "proxmox_api_call",
  "template_cloud_init",
  "network_access_attach",
  "backup_monitoring_attach",
  "automated_verification",
  "ready",
] as const;

export type OperationStage = (typeof OPERATION_STAGES)[number];

export const STAGE_LABELS: Record<OperationStage, string> = {
  preflight: "Preflight capacity check",
  capacity_reservation: "Capacity reservation",
  operation_created: "Operation created",
  site_worker_dispatch: "Site worker dispatch",
  proxmox_api_call: "Proxmox clone",
  template_cloud_init: "Cloud-init and boot",
  network_access_attach: "Network and access attach",
  backup_monitoring_attach: "Backup and monitoring attach",
  automated_verification: "Automated verification",
  ready: "Ready",
};
