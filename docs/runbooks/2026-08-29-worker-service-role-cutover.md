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
- [ ] You have generated an **ES256 signing key you control** and rotated to it
      (step 0 below). This replaced an earlier precondition asking for the
      project's legacy JWT secret; that instruction is withdrawn.

      **Superseded 2026-08-29.** The original plan minted HS256 tokens with the
      legacy JWT secret, and the earlier version of this bullet recorded that
      working -- verified empirically at the time: posting the legacy anon key as
      a bearer token to `/rest/v1/rpc/worker_heartbeat` returned
      `42501 permission denied for function worker_heartbeat` (the token
      verified; PostgREST switched to `anon`; the grant refused it), while the
      same token with one signature character changed returned
      `PGRST301 "None of the keys was able to decode the JWT"`.

      Two things killed that approach on the same day. First, the footgun the
      bullet itself flagged: completing the signing-keys migration invalidates
      every HS256-signed worker token at once, stopping provisioning on **both**
      clusters. Second, and decisively, **the legacy JWT secret was exposed** and
      has to be retired. Tokens whose validity depends on a secret you are about
      to revoke are not worth minting.

      That same bullet claimed custom ES256 minting was "not an option -- the
      platform holds that private key and does not export it". **That was wrong.**
      It is true of the key Supabase generates for you; it is not a limit of the
      platform. `supabase gen signing-key --algorithm ES256` produces a key *you*
      hold and import, and `scripts/mint-worker-token.mjs --signing-key-file`
      signs with it. Worker tokens are then independent of the legacy secret and
      survive its revocation, which is what step 8 needs.
- [ ] Root SSH to both worker LXCs (Guild-A: vmid 500 on nodeD, Guild-B: vmid 500
      on podD).

## Rollback position

At every step below, rollback is: set `CONTROL_PLANE_AUTH_MODE=service_role`,
restore `SUPABASE_SERVICE_ROLE_KEY`, restart the worker. **Do not rotate the
service-role key until step 7**, so this remains true throughout.

---

## 0. Generate and install a signing key you control

**Do this first. It is no longer optional.** The legacy HS256 JWT secret was
exposed on 2026-08-29 and is being retired, so tokens signed with it are dead on
arrival once it is revoked. Worker tokens must be signed with a key you control.

```bash
supabase gen signing-key --algorithm ES256 > signing-key.json
chmod 600 signing-key.json
```

Write it somewhere outside any git working tree -- this file is the private half
of the signing key, and a `git add -A` has already leaked one credential from
this repository.

Then in Settings -> JWT Keys: import it as a **standby** key. Choose *import*,
not *generate* -- a generated key leaves the private half with Supabase, which is
the one thing that does not help here.

**Stop at standby. Do not rotate.** An earlier version of this step said to
rotate to the new key, and that was unnecessary. Standby keys are published in
the JWKS *and* accepted for verification, so a worker token signed with one works
immediately. Verified empirically on 2026-08-29: a token minted under a
freshly-imported standby key (`kid 3cf66c3f-...`, never rotated) was posted to
`/rest/v1/rpc/worker_heartbeat` and returned **HTTP 204**. The signature
verified, PostgREST resolved the worker role, and the heartbeat ran.

This matters because rotating changes which key signs every *user* auth token
Supabase issues. That is a live change to session handling, and nothing in this
cutover needs it. Leave the in-use key alone.

Confirm the public half is published before minting -- if it is not there, every
token you mint fails verification with `PGRST301 "No suitable key or wrong key
type"`. Import is not instant; Supabase caches JWKS at several layers, so poll
rather than assuming:

```bash
until curl -s "$SUPABASE_URL/auth/v1/.well-known/jwks.json" | grep -q "<your kid>"; do
  printf '.'; sleep 30
done; echo " published"
```

Then prove the key actually verifies before cutting anything over -- one command,
and it distinguishes "not published yet" from "published but not accepted":

```bash
TOKEN=$(node scripts/mint-worker-token.mjs --worker-id guild-b-lxc-500 \
  --signing-key-file ~/signing-key.json --expires-in 5m --print 2>/dev/null)
curl -s -w '\nHTTP %{http_code}\n' -X POST "$SUPABASE_URL/rest/v1/rpc/worker_heartbeat" \
  -H "apikey: <publishable key>" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{}'
unset TOKEN
```

`HTTP 204` means the key verifies and the identity is live -- proceed. `PGRST301`
means the signature was not accepted; do not proceed, the cutover will fail the
same way. `42501` or `28000` mean the signature verified but a grant or the
identity row refused it -- fix that, not the key.

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

Steps 2-5 are automated by `scripts/cutover-worker.sh`. It keeps the signing key
on your machine: the token is held in a shell variable, piped to the worker over
stdin, and never written to disk locally, never passed as a command-line
argument, and never echoed.

```bash
scripts/cutover-worker.sh --signing-key-file ./signing-key.json \
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
node scripts/mint-worker-token.mjs --worker-id guild-b-lxc-500 \
  --signing-key-file ./signing-key.json --expires-in 365d
```

Writes `worker-token-guild-b-lxc-500.jwt` (0600) **outside any git working tree**
-- the script prints the path -- and prints a non-secret summary including the
`kid` and `algorithm` it used. The token itself is never printed unless you pass
`--print`.

Record the summary's `jti`, `worker_id`, `kid`, and `expires_at` in the change
record.
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

## 7. Retire the service-role key

> **Corrected 2026-08-29. "Rotate the service_role key" is not a thing you can
> do on this project, and the earlier version of this step was wrong.**
>
> This project has migrated to JWT Signing Keys. Supabase's own guidance is
> explicit: *"it is no longer possible to rotate the legacy anon, service and JWT
> secrets."* The legacy `anon` and `service_role` keys are **not just API keys —
> they are JWTs signed by the legacy JWT secret**, so the only way to invalidate
> them is to revoke that secret, and revoking it invalidates *every* JWT signed
> with it.
>
> **This used to include the worker tokens this runbook mints.** While they were
> HS256 signed with the same legacy secret, revoking that secret to kill
> `service_role` would have killed both workers at the same instant. Minting
> under an imported ES256 key (step 0) is what breaks that coupling, so the two
> can now be done independently.

Only after **both** workers are healthy on `worker_token` for a full day.

1. Confirm no worker env file still contains `SUPABASE_SERVICE_ROLE_KEY`:
   `grep -l SUPABASE_SERVICE_ROLE_KEY /etc/guildcloud/worker.env*` on both boxes
   (the `.pre-cutover` backups will match — delete them first).

2. **Create a secret API key** (`sb_secret_...`) in Settings → API Keys. These
   are not JWTs, are independent of the JWT secret, and can be rotated one at a
   time without downtime — which is precisely what `service_role` cannot do.

3. Replace `service_role` with that secret key wherever it is still used. Checked
   2026-08-29: the Vercel production project holds only `NEXT_PUBLIC_SITE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_URL`, so the console
   is not a holder. `NEXT_PUBLIC_SUPABASE_ANON_KEY` has since been moved to the
   publishable key and redeployed, so the console no longer ships a legacy JWT
   at all. Edge Functions receive `SUPABASE_SECRET_KEYS` alongside the
   legacy variable and can switch by reading the new one. Re-check with
   `vercel env ls production` rather than trusting this note.

4. **Deactivate** the legacy `service_role` key in Settings → API Keys once
   nothing uses it. Reversible — you can re-activate if you find a caller you
   missed. This is the step that actually retires it.

5. Do **not** revoke the legacy JWT secret while any worker still runs an HS256
   token. Once both are on ES256 tokens from step 0, the next section retires it.

## 8. Retire the legacy JWT secret

Once both workers run ES256 tokens, nothing this project owns depends on the
legacy HS256 secret, and it can go. Order matters -- doing these out of order
breaks something at every step:

1. **Console off the legacy anon key.** Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to
   the publishable key (`sb_publishable_...`) and redeploy. Verify the legacy JWT
   is no longer in the served bundle:

   ```bash
   curl -s https://<your-domain>/ | grep -c 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' # expect 0
   ```

   `NEXT_PUBLIC_` values are inlined at build time, so the env change alone
   changes nothing until a redeploy.

2. **Workers off `service_role`** -- that is steps 2-6 of this runbook.

3. **Revoke the legacy JWT secret** in Settings -> JWT Keys, and disable the
   legacy `anon` / `service_role` API keys.

   Rotating signing keys is *not* a prerequisite -- see step 0. Nothing this
   project owns still depends on the legacy secret once steps 1 and 2 are done,
   so it can be revoked from whatever state it is in.

Do step 3 last and only after watching steps 1-2 hold for a full worker cycle.
Revoking the legacy key invalidates every token still signed by it, with no
warning and no partial failure -- anything you missed stops working at once.

## 9. Close out

- [ ] Delete `worker.env.pre-cutover` from both boxes.
- [ ] Confirm no `.jwt` file remains on any workstation.
- [ ] Update `docs/PROJECT_STATUS.md` and tick Task 7's remaining boxes.
- [ ] Confirm no `signing-key.json` remains on any workstation once both workers
      are minted and healthy -- the key can be regenerated and re-imported, and a
      key nobody holds cannot leak.
- [ ] Record in the change log: date, canary cluster, both `jti` values, the
      signing `kid`, rotation time, and the disposable instance's full lifecycle
      evidence.

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

Mint a new one (same `--signing-key-file`), swap the env value, restart, confirm
`--health`. The old token
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
