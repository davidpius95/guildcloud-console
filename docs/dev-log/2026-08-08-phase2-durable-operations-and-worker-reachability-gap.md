# Dev log — 2026-08-08: Phase 2 durable operation model, and a real worker-reachability gap found live

## What was asked

Build Phase 2: the durable/retry-safe operation model from master plan §5,
plus a first real end-to-end provisioning slice proving it — a real
instance created on Guild-A via a real pipeline, verified, then torn down.

## What got built

- Schema: `operations` altered (idempotency key, `instance_id`, `site_id`,
  `current_stage`, `failure_reason`, widened state enum), new
  `operation_stages` (replaces the unused `stages jsonb` blob with real
  rows, fixed stage enum matching §5), new `capacity_reservations` (holds
  with `expires_at`, not commits), new `catalog_image_site_templates`
  (resolves the real catalog/real-template mismatch), new `instances`.
  All checked into `supabase/migrations/` — Phase 1's schema never was.
- A real gap found and fixed mid-build: `operations` had no INSERT policy
  at all in Phase 1 — schema-only, never actually usable by a client.
- A real `site_id` mismatch found and fixed before it caused a silent
  failure: every migration/worker draft used `guild-a`, but
  `lib/mock-data.ts` (what the wizard actually reads/submits) uses `lag-1`
  — never mapped before this phase. Fixed via migration + a global
  find-replace in the worker source, before the console side was wired up.
- Dedicated least-privilege Proxmox credential: role
  `GuildCloudSiteWorker`, user `siteworker-guild-a@pve`, pool
  `guildcloud-guild-a`, token with `privsep=0`. Verified both positively
  (reaches nodeD) and negatively (403s on `nodeA`, on an unrelated existing
  guest) via direct `curl`, not just configured and assumed.
- `createInstance` Server Action + wizard real-submission wiring (narrowly
  scoped to the one real combination: Guild-A/`lag-1` + `ubuntu-2404`) +
  a real `/console/instances/[id]` progress view polling `operation_stages`.
- `npx tsc --noEmit` and `npm run build` both clean throughout.

## The real end-to-end test — and what it actually found

Ran the real test: inserted a genuine `instances`/`operations`/
`operation_stages` row set (the exact shape `createInstance` produces),
watched the `pg_cron`-scheduled Edge Function worker pick it up.

**It failed at the very first stage, `preflight`**, with a TCP connection
timeout trying to reach `192.168.8.195:8006` (Guild-A's Proxmox API) —
after 7 retries over ~2 minutes, never once connecting. Root cause:
Supabase Edge Functions run on Deno Deploy's infrastructure, which has no
route into Guild-A's private LAN. The earlier "smoke test" only proved the
function *executes*, not that it can reach Proxmox — that gap was real and
had gone unverified since the function was first deployed.

**No infrastructure side-effect happened** — the failure was before any
clone or capacity commitment. Test rows were deleted after confirming this.

This is exactly the kind of thing this project's "verify live, don't assume
from design intent" discipline exists to catch, and it caught it — a
confirmed-with-the-user MVP simplification (worker as an Edge Function)
turned out to not merely have caveats but to not work *at all* for its one
actual job, once tested against a real operation instead of a health-check
ping.

## Mid-course decisions, made with the user, not assumed

1. **Worker placement:** asked whether to (a) expose the Proxmox API via a
   public tunnel, (b) move the worker onto the Guild-A network itself, or
   (c) pause. User chose (b) — more correct architecturally (matches the
   plan's own "per-site worker" framing), more work, no new public
   exposure.
2. **Credential for the moved worker:** rather than handing the on-network
   process the full Supabase service-role key (bypasses all RLS
   everywhere), created a dedicated Postgres role scoped via RLS to
   `site_id='lag-1'` rows only — consistent with the least-privilege
   discipline already applied to the Proxmox token. **This hit a real,
   separate blocker**: Supabase's pooler doesn't recognize ad-hoc
   SQL-created roles, and the direct-connection path needs IPv6 this
   session's tooling can't test. Left as an explicitly open item in
   `docs/phase-2/threat-model.md`, not silently resolved.
3. **A live tooling gap, surfaced rather than routed around:** the Guild-A
   LXC (`vmid 500`) was created successfully, but no available tool can
   execute commands inside it — SSH is disabled in the Proxmox MCP
   server's own config, and the console fallback (`termproxy` backend)
   times out even on a trivial `echo`. Asked the user how to proceed
   (manual setup script vs. enabling SSH in that server's config) rather
   than attempting a workaround.

## A design question answered honestly, not glossed over

Asked whether cloud-init drives on-the-fly provisioning, and whether it can
happen in milliseconds. Checked the real template config live
(`pve_call GET nodes/nodeD/qemu/9000/config`) before answering: yes,
cloud-init is real and configured, but found two things worth fixing before
this is customer-facing:

- **The template's `sshkeys` is one fixed, shared key** — every clone
  currently inherits it verbatim. There's no per-customer SSH key feature
  anywhere in the console yet to override it with. Documented as
  threat-model finding #7 — must be fixed before real customer
  provisioning, not carried as accepted debt.
- **A `cicustom` vendor snippet appears to auto-enroll every clone into
  Tailscale** at boot; its auth-key scope wasn't reviewed this pass.
- **Speed:** a full VM clone + real boot + cloud-init first-run is tens of
  seconds to low minutes, not milliseconds — told plainly rather than
  implying the current architecture achieves something it structurally
  can't. A pre-warmed pool would be the fix if sub-second handoff is a hard
  requirement, and that's a different design, not a tuning problem.

## Status at end of session

Schema, credential, Server Action, and console UI are built, typechecked,
and build-clean. The real end-to-end proof is **not yet complete** — blocked
on getting the worker actually running from inside Guild-A's network, which
is itself blocked on a tooling gap (no working exec path into the new LXC)
that only the user can resolve (enable SSH in the MCP server's config, or
run a handoff script manually). `docs/phase-2/{data-model,api-contract,
threat-model,operator-runbook}.md` are written to reflect this honestly —
including two items explicitly marked open/unresolved rather than claimed
done.
