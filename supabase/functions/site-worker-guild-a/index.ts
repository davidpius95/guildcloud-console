// This Edge Function is dead code, kept only so the deployed function slug
// still resolves to something intentional instead of a 404.
//
// The real, canonical site worker is deploy/site-worker/index.js
// (cluster-neutral) launched per cluster via deploy/site-worker-guild-a/
// index.js and (once onboarded) its Guild-B equivalent. It runs as a
// long-lived Node process on a cluster-resident LXC, not as a Supabase Edge
// Function - the Edge Function runtime cannot reach Proxmox's private LAN
// IP at all (see docs/phase-2/threat-model.md finding #1). Its own
// pg_cron schedule was permanently unscheduled by
// supabase/migrations/20260809011200_unschedule_site_worker_guild_a_edge_function.sql
// after running it alongside the real worker caused a real state-corruption
// bug (two unlocked pollers racing on the same operation).
//
// Do not resurrect this file's old implementation and do not re-schedule
// it. Any worker change belongs in deploy/site-worker/, not here - see
// deploy/site-worker/README.md.
Deno.serve(() => {
  return new Response(
    JSON.stringify({
      ok: false,
      error:
        "this Edge Function is permanently retired - the real site worker runs on-network per cluster, see deploy/site-worker/",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  );
});
