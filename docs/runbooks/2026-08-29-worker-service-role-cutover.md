# Runbook: cut site workers over to cluster-scoped RPCs

**Goal:** remove `SUPABASE_SERVICE_ROLE_KEY` from both production site workers and
rotate it, so a compromised worker can no longer read or write every table for
every cluster.

**Plan reference:** Task 7 slice C of
`docs/2026-08-29-guildcloud-platform-hardening-and-launch.md`.
Slices A (`2c789de`) and B (`e7513ae`) shipped the boundary; this is the
operational half.

**Blast radius:** both Proxmox clusters' provisioning. A wrong step here stops
new instance creation. It does not touch running customer VMs, customer data, or
Tailscale connectivity.

---

## Why this is a runbook and not Terraform

Worth stating, because "put it in Terraform" is the reasonable instinct:

| What is being created | Right tool | Why not Terraform |
| --- | --- | --- |
| Role, table, RPCs | Supabase migrations (already applied) | Terraform's Supabase provider manages projects and settings, not arbitrary Postgres roles or functions. Migrations are already this repo's source of truth for schema. |
| `worker_identities` rows | SQL in this runbook | Two rows of environment identity. A Terraform resource for them adds a state file and a provider without removing a single manual step. |
| The worker JWT | `scripts/mint-worker-token.mjs`, run once by an operator | **This is the important one.** Terraform persists every resource attribute in state. Minting the token through Terraform would write a long-lived credential into the state file, so the state backend becomes a secret store that must then be encrypted, access-controlled, and rotated. Today the token exists in exactly two places: one file on one worker box. That is a strictly better property than any state backend would give. |
| Putting the token on the box | `scp` for two nodes; Ansible if this grows | Terraform is not a configuration-management tool and provisioners are explicitly a last resort in its own docs. |

The genuinely more standard long-term option is **not** Terraform — it is to stop
hand-minting entirely: give each worker a real Supabase Auth user and add a
[Custom Access Token hook](https://supabase.com/docs/guides/auth/auth-hooks)
that stamps `role: guildcloud_site_worker` and `worker_id`. Tokens then become
short-lived and auto-refreshing, and revocation is deleting a user. The reason
that is not this cutover: an access-token hook runs for **every** token the
project issues, including every customer sign-in, so a mistake in it is a
project-wide auth outage. It deserves its own change with its own test plan.
Worth doing once the boundary itself is proven in production.

---

## Preconditions

- [ ] Slice A and B migrations applied to production:
      `20260829120000_add_cluster_worker_rpc_boundary.sql`,
      `20260829130000_add_worker_housekeeping_rpcs.sql`.
      Applying them is safe on its own: they only add a role, a table, and
      functions. Nothing calls the new RPCs until a worker runs in
      `worker_token` mode.
- [ ] `npm run check` green on the deploying commit.
- [ ] Both workers currently healthy — recent `worker_heartbeat_at` on both
      `infrastructure_clusters` rows.
- [ ] No operations in flight:
      `select id, cluster_id, kind, state from public.operations where state in ('pending','running');`
      Wait for it to be empty. A cutover mid-operation leaves a half-executed
      lifecycle.
- [ ] You have the project's **JWT secret** (Supabase dashboard → Settings → API →
      JWT Settings).

      **Checked 2026-08-29 — HS256 minting works, with one caveat.** This project
      *has* an asymmetric signing key: its JWKS publishes a single **ES256** key
      (`kid 6f8020a7-…`), so Supabase Auth issues user tokens signed ES256. That
      does **not** block this runbook, because the legacy HS256 secret is still in
      the verification key set. Verified empirically rather than assumed: posting
      the legacy anon key (an HS256 JWT) as a bearer token to
      `/rest/v1/rpc/worker_heartbeat` returns
      `42501 permission denied for function worker_heartbeat` — the token
      verified, PostgREST switched to `anon`, and the grant refused it. The
      control, the same token with one character of the signature changed,
      returns `PGRST301 "None of the keys was able to decode the JWT"`. The
      legacy anon key also still reports `disabled: false`.

      **The caveat is a live footgun.** Completing the signing-keys migration —
      revoking the legacy HS256 key in the dashboard — instantly invalidates every
      worker token minted by `scripts/mint-worker-token.mjs`, stopping
      provisioning on **both** clusters at once. So while workers run on
      HS256 tokens: do not revoke the legacy key, and treat that dashboard action
      as a change that requires re-minting first.

      This is the strongest argument for the Auth-user alternative described
      below: tokens issued by Supabase Auth itself are signed with the current
      ES256 key, so they survive legacy-key revocation. Custom ES256 minting is
      not an option — the platform holds that private key and does not export it.
- [ ] Root SSH to both worker LXCs (Guild-A: vmid 500 on nodeD, Guild-B: vmid 500
      on podD).

## Rollback position

At every step below, rollback is: set `CONTROL_PLANE_AUTH_MODE=service_role`,
restore `SUPABASE_SERVICE_ROLE_KEY`, restart the worker. **Do not rotate the
service-role key until step 7**, so this remains true throughout.

---

## 1. Register the worker identities

> **Already done in production, 2026-08-29 16:12 UTC.** Both rows exist and
> `guild-a-lxc-500` holds `tailnet_housekeeping`. Re-running the SQL below is
> harmless (`on conflict do nothing`, and the housekeeping `update` is
> idempotent), so this step is kept for a fresh environment and as the record of
> what was applied. **Skip to step 2** unless you are setting up a new project.
>
> Registering identities grants nothing on its own: no token exists yet, and the
> running workers are still on `service_role`, which never reads this table.
>
> The worker ids were taken from what the workers actually report
> (`infrastructure_clusters.worker_id`), not assumed from this document — they
> happened to match. Verified afterwards by resolving each identity through the
> boundary rather than trusting the insert:
>
> | Check | Result |
> | --- | --- |
> | `guild-a-lxc-500` resolves | `guild-a` |
> | `guild-b-lxc-500` resolves | `guild-b` |
> | Guild-A holds tailnet housekeeping | granted |
> | Guild-B requests housekeeping | refused (`42501`) |
> | Guild-B's pending-deletion listing | scoped to its own cluster |
>
> Both clusters stayed `open` and heartbeating throughout, with zero active
> operations.

The token proves *which worker* is calling; this table decides *what that worker
may touch*. A token for an unregistered worker fails closed with `28000`.

```sql
insert into public.worker_identities (worker_id, cluster_id, description)
values
  ('guild-a-lxc-500', 'guild-a', 'Guild-A site worker, LXC 500 on nodeD'),
  ('guild-b-lxc-500', 'guild-b', 'Guild-B site worker, LXC 500 on podD')
on conflict (worker_id) do nothing;

-- Exactly one worker holds tailnet housekeeping. Guild-A holds it today
-- (TAILNET_HOUSEKEEPING_OWNER=true in its env). A unique partial index makes a
-- second holder impossible rather than merely discouraged.
update public.worker_identities
set tailnet_housekeeping = true
where worker_id = 'guild-a-lxc-500';
```

Use each worker's real `WORKER_ID` from its `/etc/guildcloud/worker.env` — the
minted token's `worker_id` must match it exactly or the worker refuses to start.

Verify:

```sql
select worker_id, cluster_id, tailnet_housekeeping, revoked_at
from public.worker_identities order by worker_id;
```

## The short path

Steps 2-5 are automated by `scripts/cutover-worker.sh`. It keeps
`SUPABASE_JWT_SECRET` on your machine: the token is held in a shell variable,
piped to the worker over stdin, and never written to disk locally, never passed
as a command-line argument, and never echoed.

```bash
SUPABASE_JWT_SECRET='<jwt secret>' scripts/cutover-worker.sh \
  --worker-id guild-b-lxc-500 --host podD --vmid 500
```

Add `--dry-run` first to see what it would do. It refuses if the box's
`WORKER_ID` does not match the id you are minting for, backs up the env file,
validates the new config with `--print-config` **before** restarting anything,
and restores the backup automatically if `--health` does not come up.

Guild-A is `--worker-id guild-a-lxc-500-r2 --host nodeD --vmid 500`. Do Guild-B
first: it does not hold tailnet housekeeping, so it exercises the narrower
surface.

Requires ssh as root to the Proxmox node. The long-hand steps below remain
accurate if you would rather do it by hand, or if that ssh path is unavailable.

## 2. Mint the canary token

Pick the canary cluster from current health, not from habit — do **not** default
to Guild-A. This runbook assumes Guild-B as canary because Guild-A holds tailnet
housekeeping, so Guild-B exercises the narrower surface first.

```bash
SUPABASE_JWT_SECRET='<jwt secret>' node scripts/mint-worker-token.mjs --worker-id guild-b-lxc-500 --expires-in 365d
```

Writes `worker-token-guild-b-lxc-500.jwt` (0600) in the working directory and
prints a non-secret summary. The token itself is never printed unless you pass
`--print`.

Record the summary's `jti`, `worker_id`, and `expires_at` in the change record.
Never record the token.

## 3. Pause admission on the canary cluster

```sql
update public.infrastructure_clusters set admission_state = 'paused' where id = 'guild-b';
```

Nothing new can be placed there while the credential changes.

## 4. Cut the canary worker over

On the Guild-B worker LXC:

```bash
cp /etc/guildcloud/worker.env /etc/guildcloud/worker.env.pre-cutover
```

Edit `/etc/guildcloud/worker.env`:

- set `CONTROL_PLANE_AUTH_MODE=worker_token`
- add `SUPABASE_WORKER_TOKEN=<contents of the .jwt file>`
- **remove** the `SUPABASE_SERVICE_ROLE_KEY` line

The worker refuses to start with both credentials present — that guard exists so
a half-finished migration cannot look complete while the broad key sits on the
box unrotated.

Keep the file `root:root 0600`; the worker refuses to start otherwise.

```bash
systemctl restart guildcloud-worker.timer
node /opt/guildcloud-worker/current/index.js --health
```

`--health` must print `"controlPlaneAuthMode": "worker_token"`, the right
`workerId` and `clusterId`, and a sane `workerTokenSecondsRemaining`. Then
delete the local `.jwt` file.

## 5. Observe the canary

```bash
journalctl -u guildcloud-worker.service -n 200 --no-pager
```

Watch **at least two full cycles** (~6 minutes at the 3-minute timer). Expect:

- no `28000` (identity not recognised — the identity row is missing or the
  `worker_id` does not match)
- no `42501` (permission denied — a migration did not apply)
- no `permission denied for table ...` (an unguarded table access; the role holds
  no table privileges by design)
- a fresh `worker_heartbeat_at` on the `guild-b` cluster row

```sql
select id, worker_id, worker_heartbeat_at, capacity_observed_at
from public.infrastructure_clusters order by id;
```

Guild-B should show a heartbeat seconds old and a fresh capacity snapshot. If
either is stale, roll back (see "Rollback position") and stop.

Confirm cluster isolation actually holds — the point of the whole change:

```sql
-- Should be empty. Guild-B's worker must not have touched Guild-A rows.
select id, cluster_id, state, updated_at from public.operations
where cluster_id = 'guild-a' and updated_at > now() - interval '15 minutes';
```

## 6. Reopen admission and prove one real lifecycle

```sql
update public.infrastructure_clusters set admission_state = 'open' where id = 'guild-b';
```

**Requires explicit user approval before creating any real VM.** With approval,
create one disposable Standard 1 instance with a unique verification prefix,
then delete it. Record instance and operation ids, Proxmox UPIDs, stage timings,
and confirm afterwards that no orphan remains in Proxmox, Tailscale, or the
control plane.

Then repeat steps 2–6 for Guild-A (`--worker-id guild-a-lxc-500`). Guild-A
additionally exercises tailnet housekeeping, so also confirm
`reconcile_tailnet_access` runs without `42501`.

## 7. Rotate the service-role key

Only after **both** workers are healthy on `worker_token` for a full day.

1. Confirm no worker env file still contains `SUPABASE_SERVICE_ROLE_KEY`:
   `grep -l SUPABASE_SERVICE_ROLE_KEY /etc/guildcloud/worker.env*` on both boxes
   (the `.pre-cutover` backups will match — delete them first).
2. Supabase dashboard → Settings → API → rotate the `service_role` key.
3. Update every remaining legitimate holder. **Checked 2026-08-29**: the Vercel
   production project holds only `NEXT_PUBLIC_SITE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_URL` -- it does
   **not** hold the service-role key, so rotating cannot take the console down.
   Supabase injects `SUPABASE_SERVICE_ROLE_KEY` into Edge Functions itself, so
   those pick up the new value without changes. That leaves the two worker env
   files as the only manual holders, and after the cutover neither should have
   it. Re-check with `vercel env ls production` before rotating rather than
   trusting this note.
4. Redeploy whatever consumed it and verify sign-in plus instance listing.

## 8. Close out

- [ ] Delete `worker.env.pre-cutover` from both boxes.
- [ ] Confirm no `.jwt` file remains on any workstation.
- [ ] Update `docs/PROJECT_STATUS.md` and tick Task 7's remaining boxes.
- [ ] Record in the change log: date, canary cluster, both `jti` values, rotation
      time, and the disposable instance's full lifecycle evidence.

---

## Revoking a worker

Revocation is a database update, not a JWT-secret rotation — this is the main
operational gain over the service-role key:

```sql
update public.worker_identities set revoked_at = now() where worker_id = '<worker-id>';
```

Effective on that worker's next call. Its token still parses; the database
simply stops recognising it. To re-enable, set `revoked_at = null`.

## Rotating a worker token

Mint a new one, swap the env value, restart, confirm `--health`. The old token
stops being used but remains *valid* until it expires — so if it may have leaked,
revoke the `worker_id` first, deploy the new token, then clear `revoked_at`.
Accept the gap: it is a brief provisioning pause on one cluster, not an outage
for running instances.

## Moving tailnet housekeeping

```sql
update public.worker_identities set tailnet_housekeeping = false where worker_id = '<old>';
update public.worker_identities set tailnet_housekeeping = true  where worker_id = '<new>';
```

Both statements in one transaction — the unique partial index rejects a second
live holder, so doing them separately in the wrong order fails.
