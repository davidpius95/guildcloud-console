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

// Customer-facing names. The stage *keys* stay infrastructure-accurate for
// the worker and the DB check constraint, but nothing a customer reads
// should require knowing what Proxmox, cloud-init, or a site worker is -
// §6's binding constraint, and the same promise the landing page makes in
// as many words ("without needing to understand Proxmox, tunnels, or
// VLANs"). These previously read "Proxmox clone" / "Cloud-init and boot" /
// "Site worker dispatch", which broke that promise on the one screen every
// customer watches end to end.
//
// Read top to bottom they tell one story: we check there is room, hold it,
// build the server, connect it privately, protect it, prove it works.
export const STAGE_LABELS: Record<OperationStage, string> = {
  preflight: "Checking there's room at your site",
  capacity_reservation: "Holding that capacity for you",
  operation_created: "Queueing the work",
  site_worker_dispatch: "Sending it to your site",
  proxmox_api_call: "Building your server",
  template_cloud_init: "Starting it up",
  network_access_attach: "Connecting it to your private network",
  backup_monitoring_attach: "Turning on backups and monitoring",
  automated_verification: "Testing that it actually works",
  ready: "Ready to use",
};

// Shown under the stage that is currently running, so the wait explains
// itself instead of looking stalled. network_access_attach genuinely
// dominates the wall clock (measured 89-184s of a ~150-220s provision, as
// the server boots and joins the private network), so it says so rather
// than letting the customer guess whether it has hung.
export const STAGE_DETAIL: Partial<Record<OperationStage, string>> = {
  preflight: "Confirming the site has enough CPU, memory, and disk left.",
  capacity_reservation: "Reserving it so nothing else can take it while we build.",
  site_worker_dispatch: "Handing the work to the machines in Lagos.",
  proxmox_api_call: "Copying your chosen image onto real hardware.",
  template_cloud_init: "First boot: applying your name, SSH keys, and settings.",
  network_access_attach:
    "This is the longest step — usually a minute or two. Your server is booting and joining your private network. Nothing is wrong.",
  backup_monitoring_attach: "Enrolling it in daily backups and health checks.",
  automated_verification:
    "We check it's genuinely reachable before calling it ready — not just assumed.",
};
