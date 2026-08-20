import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ssbleuvjxlgttlkoancu.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzYmxldXZqeGxndHRsa29hbmN1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjE4NDc2OSwiZXhwIjoyMTAxNzYwNzY5fQ.PbRUCMR2yisRNo9YStGhMxpw2fywXVUNqRjsrIyCcXw";

const STAGES = [
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
];

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

async function createAndMonitor(name, forceCluster) {
  console.log(`\n==============================================`);
  console.log(`Creating instance: ${name} (Forced cluster: ${forceCluster || 'auto'})`);
  console.log(`==============================================`);

  const instanceId = crypto.randomUUID();
  const operationId = crypto.randomUUID();

  // 1. Insert instance
  const { error: instErr } = await supabase.from("instances").insert({
    id: instanceId,
    organization_id: "9a428339-5fbe-4b33-8482-74fc6ce08ff4",
    project_id: "b44c4107-4c7b-4ec0-bcad-b84f2d1fc034",
    site_id: "lag-1",
    name,
    catalog_image_id: "ubuntu-2404",
    catalog_plan_id: "std-1",
    state: "provisioning",
    password_ssh_enabled: true,
  });
  if (instErr) throw instErr;

  // 2. Insert operation
  const { error: opErr } = await supabase.from("operations").insert({
    id: operationId,
    organization_id: "9a428339-5fbe-4b33-8482-74fc6ce08ff4",
    project_id: "b44c4107-4c7b-4ec0-bcad-b84f2d1fc034",
    instance_id: instanceId,
    site_id: "lag-1",
    kind: "instance.create",
    resource_name: name,
    state: "pending",
    idempotency_key: crypto.randomUUID(),
  });
  if (opErr) throw opErr;

  // 3. Insert stages
  const { error: stgErr } = await supabase.from("operation_stages").insert(
    STAGES.map((stage) => ({ operation_id: operationId, stage }))
  );
  if (stgErr) throw stgErr;

  console.log(`Operation ${operationId} queued.`);

  // 4. Trigger placement RPC
  const { data: placedId, error: placeErr } = await supabase.rpc(
    "place_next_pending_operation",
    {
      p_worker_cluster_id: forceCluster || "guild-a",
      p_now: new Date().toISOString(),
      p_force_cluster_id: forceCluster || null,
    }
  );
  if (placeErr) console.warn("Placement RPC warning:", placeErr.message);
  console.log("Placed operation ID:", placedId);

  // 5. Poll stages
  let done = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data: stages } = await supabase
      .from("operation_stages")
      .select("stage, status, detail, error")
      .eq("operation_id", operationId)
      .order("id");

    const activeStage = stages?.find((s) => s.status === "active");
    const doneStages = stages?.filter((s) => s.status === "done").map((s) => s.stage);
    const failedStage = stages?.find((s) => s.status === "failed");

    console.log(
      `[${i * 4}s] Done: [${doneStages?.join(", ")}] | Active: ${activeStage?.stage || "none"} | Failed: ${failedStage?.stage || "none"}`
    );

    if (failedStage) {
      console.error(`FAILED at stage ${failedStage.stage}:`, failedStage.error);
      break;
    }

    if (doneStages?.length === STAGES.length) {
      console.log(`\n🎉 INSTANCE ${name} PROVISIONED SUCCESSFULLY TO READY!`);
      done = true;
      break;
    }
  }

  const { data: finalInst } = await supabase.from("instances").select("*").eq("id", instanceId).single();
  console.log("Final Instance Record:", JSON.stringify(finalInst, null, 2));

  return { instanceId, operationId, done, finalInst };
}

async function main() {
  const resB = await createAndMonitor("ui-test-guild-b-vm", "guild-b");
  const resA = await createAndMonitor("ui-test-guild-a-vm", "guild-a");

  console.log("\n================ SUMMARY ================");
  console.log("Guild-B Instance Result:", resB.done ? "SUCCESS (Ready)" : "FAILED");
  console.log("Guild-A Instance Result:", resA.done ? "SUCCESS (Ready)" : "FAILED");
}

main().catch(console.error);
