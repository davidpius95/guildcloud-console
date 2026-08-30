# Replicating GuildCloud in a new environment

How to stand up a complete, working GuildCloud — control plane, execution
plane, private network, site worker, and console — somewhere other than the
current production estate. Written to be followed start to finish by someone
who has this repository and nothing else.

Read [`PROJECT_STATUS.md`](PROJECT_STATUS.md) first for what the system *is*.
This document is only about rebuilding it.

---

## What this repository can and cannot give you

Being blunt about this up front, because the difference is where replication
attempts fail.

**In the repository — reproducible exactly:**

- the console application (Next.js) and its build
- the entire control-plane database schema, from an empty Postgres
  (`supabase/migrations/`, 50 files — see §1)
- the site worker, its systemd units, and its self-deploy mechanism
  (`deploy/site-worker/`)
- the Tailscale access policy (`infra/tailscale/policy.hujson`)
- CI and the production deploy pipeline (`.github/workflows/`)
- every Edge Function (`supabase/functions/`)

**Not in the repository, by design — you must supply these:**

- **Every secret value.** No credential is committed, and none should ever
  be. §7 lists each one, what it is for, and where to get it.
- **Physical or virtual Proxmox hardware.** §3 tells you what the cluster must
  provide; it cannot conjure nodes.
- **Accounts**: Supabase, Tailscale, Vercel, GitHub, Resend.

**Not in the repository, and a real gap:**

- **The master plan** (`GuildCloud-Master-Plan.docx`) lives outside git, on the
  author's machine. It is the authoritative source for scope, requirements and
  boundaries, and `docs/` links to its sections constantly. A replica gets a
  working system but not the reasoning behind its constraints. If this project
  is ever handed over, that file must travel separately.
- **The VM templates themselves.** §3.4 explains how to build equivalents;
  the actual disk images are not and cannot be in git.

---

## 1. Control plane — Supabase

### 1.1 Create the project

Any Supabase project on Postgres 17 works. Note the project ref, the project
URL, the publishable (anon) key, the `service_role` key, and the JWT secret —
you will need all five.

Regions matter for latency to your Proxmox site, not for correctness. The
current production project is `eu-west-1`.

### 1.2 Apply the schema

**Seed Vault first (§1.4), then push.** `20260829230000` refuses to apply while
any enabled row in `infrastructure_clusters` has no matching Vault secret — a
deliberate "fail loudly now rather than at 3am" guard, since a cluster whose
Proxmox token is missing has a worker that cannot function. `20260818090000`
seeds `guild-a` and `guild-b`, so a fresh project inherits those two rows and
the push stops until either their secrets exist or the rows are removed:

```sql
-- Replacing the production clusters with your own:
delete from public.infrastructure_clusters where id in ('guild-a', 'guild-b');
-- or, keeping them: create proxmox_guild_a_site_worker_token etc. first (§1.4).
```

Then:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

That is the whole step, and it is worth explaining why it now works.

Until 2026-08-29 it did not. Phase 1 built the first control-plane objects
directly against the hosted project, before migrations were tracked, so
migration history began mid-schema. Replaying every migration into an empty
database failed **29 times out of 42** — on the very first file, which alters a
table nothing in the repository creates. The repository could not rebuild its
own database, which meant it could not be replicated at all.

That is fixed. The foundation was recovered from the live control plane and
committed as:

| File | What it restores |
| --- | --- |
| `00000000000000_baseline_phase1_schema.sql` | `organizations`, `memberships`, `projects`, `audit_log`, `access_grants`, `catalog_plans`, `catalog_images`, `operations`; the RLS helpers (`is_org_member`, `has_org_role`, `log_audit_event`); org/invite lifecycle functions and triggers; RLS policies; the catalogue seed rows |
| `20260808200550_baseline_instances_ssh_sync_column.sql` | `instances.ssh_keys_sync_pending`, plus grants that could not run before their tables existed |
| `20260808201050_baseline_site_worker_vault_grant.sql` | the `get_vault_secret` grant, which had to move after that function is created |

Two pre-existing migrations were also made order-independent
(`20260808194048`, `20260808200332`) — their filenames place them before
objects they depend on, which was invisible on the live project because the
objects already existed there.

Four worker RPCs (`worker_get_proxmox_credential`, `worker_get_tailscale_oauth`,
`worker_holds_tailnet_housekeeping`, `worker_set_instance_ssh_password`) were
also untracked when this was first investigated. They have since been committed
independently by the worker-cutover work (`20260829220000`, `20260829230000`),
so nothing here needs to restore them.

**Verified**: all 50 migrations apply cleanly to an empty Postgres 17, and the
result matches production exactly — 23/23 tables, 63/63 functions, and an
`operations` table with the same 19 columns in the same order.

Everything added is guarded (`if not exists`, `create or replace`, or a DO
block), so it is a no-op against the existing production project. To adopt it
there without re-running anything:

```bash
supabase migration repair --status applied 00000000000000
```

### 1.3 Enable extensions

`20260808200000` enables `pg_cron` and `pg_net`; the baseline asserts
`pgcrypto`. `supabase_vault` and `uuid-ossp` ship enabled on a hosted project.
Confirm all six are present before continuing:

```sql
select extname from pg_extension order by 1;
```

### 1.4 Load Vault secrets

The control plane resolves credentials from Supabase Vault by **name**, never
from the worker's environment. That indirection is deliberate: a worker box
never holds a Proxmox token, and rotating one is a Vault update rather than a
fleet-wide config push.

Create each secret with the exact name below — the names are wired into
`infrastructure_clusters.proxmox_token_secret_name` and into the functions in
`20260829190000`:

```sql
select vault.create_secret('<value>', '<name>');
```

| Secret name | What it holds |
| --- | --- |
| `proxmox_<cluster>_site_worker_token` | Proxmox API token for that cluster's worker identity (§3.5). One per cluster; the name is stored per-cluster in `infrastructure_clusters`. |
| `tailscale_guildcloud_worker_oauth_client_id` | Tailscale OAuth client id (§4.2) |
| `tailscale_guildcloud_worker_oauth_client_secret` | Tailscale OAuth client secret (§4.2) |
| `resend_api_key` | Resend API key, read by the `send-invite-email` Edge Function |

`pbs_guild_a_readonly_import_token` also exists in production — it is only
needed if you replicate the cross-cluster PBS template import described in
`docs/dev-log/2026-08-19-guild-b-onboarding-day-1.md`, not for a single-site
build.

Everything else in `vault.secrets` (`instance_ssh_password_*`,
`enrollment_key_*`, `instance_enrollment_key_*`) is created at runtime. Do not
seed those.

The Proxmox secret name is derived, not free-form:
`proxmox_<cluster-id-with-underscores>_site_worker_token`. `20260829230000`
fills `infrastructure_clusters.proxmox_token_secret_name` with exactly that
pattern for any cluster where it is null, then asserts the secret exists.

### 1.5 Configure Auth

- Enable email/password sign-in.
- Set Site URL and redirect URLs to your console origin — the same value you
  put in `NEXT_PUBLIC_SITE_URL`. Invite and verification links are built from
  it, so a wrong value produces mail pointing at the wrong host.

### 1.6 Deploy the Edge Functions

```bash
supabase functions deploy send-invite-email
supabase functions deploy enroll-device
```

`site-worker-guild-a` is the superseded, pre-LXC worker. It is kept for history
and should **not** be deployed in a new environment — the real worker is the
one in §5.

### 1.7 Register the cluster

Before any worker can claim work, its cluster must exist in the control plane.
Insert rows into `infrastructure_clusters`, `infrastructure_nodes` and
`infrastructure_storage_targets` describing your hardware, and set
`proxmox_token_secret_name` to the Vault name from §1.4. See
`20260818090000_add_multi_cluster_placement.sql` for the columns, and
`docs/phase-0/site-inventory.md` for a filled-in example.

Then register the worker identity (§5.4).

---

## 2. What the execution plane must provide

The control plane assumes a Proxmox VE cluster that can do these things. Any
cluster that can is a valid target; the specific hardware is not load-bearing.

| Requirement | Why | Production example |
| --- | --- | --- |
| Proxmox VE 9.x, quorate | the worker drives the cluster API | Guild-A: 5 nodes, PVE 9.2.2 |
| A resource pool for GuildCloud VMs | scopes the worker's ACL to its own VMs | `guildcloud-guild-a` |
| VM storage | instance disks | `ceph-vm` (Guild-A), `local-lvm` (Guild-B) |
| Snippets storage | cloud-init `cicustom` files | `guild-snippets`, mounted at `/mnt/guild-snippets` |
| A backup target + job | §8 of the plan requires real backups | PBS `guild-pbs` |
| Cloud-init-ready VM templates | cloned per instance | VMIDs 9001–9020 |
| An LXC for the worker | runs the site worker | Guild-A: vmid 500 on nodeD |

Note the snippets constraint: cloud-init snippet storage must be reachable from
**every node you place onto**, or a clone onto node X cannot read a snippet
written on node Y. Production hit exactly this and it is why Guild-A is
currently pinned to a single node — see the Guild-B onboarding dev-log.

---

## 3. Execution plane — building it

### 3.1 Cluster and pool

Build the PVE cluster, then create the pool the worker will own:

```bash
pvesh create /pools --poolid guildcloud-<cluster>
```

### 3.2 Storage

Attach VM storage and a snippets storage. The snippets storage must have
content type `snippets` and its directory must match `SNIPPETS_DIR` in the
worker env.

### 3.3 Backups

Add a PBS (or equivalent) storage and create a backup job covering the pool.
Its id goes in `BACKUP_JOB_ID`, the storage in `BACKUP_STORAGE`, and — if the
datastore uses namespaces — the namespace in `BACKUP_NAMESPACE`. Leave the
namespace unset for a datastore without one.

If your PBS certificate ever rotates, update each cluster's storage
fingerprint. Production had backups silently failing on **both** clusters for
this exact reason, found only during the Guild-B onboarding.

### 3.4 Templates

Build one cloud-init-enabled template per catalogue image, and record the
mapping in `catalog_image_cluster_node_templates` (per node) and
`catalog_image_cluster_templates` (per cluster). Every node listed in a
cluster template's `target_nodes` must have a matching enabled per-node row, or
the worker cannot clone onto it — there is a pgTAP invariant asserting this.

Production reserves VMID blocks per cluster (Guild-A 9000–9099, Guild-B
9100–9199). Worth keeping.

### 3.5 The worker's Proxmox identity

Create a dedicated least-privilege identity — never reuse an admin account.
This is the exact role production uses:

```bash
pveum role add GuildCloudSiteWorker --privs \
"Datastore.Allocate,Datastore.AllocateSpace,Datastore.AllocateTemplate,Datastore.Audit,\
SDN.Use,Sys.Audit,VM.Allocate,VM.Audit,VM.Clone,VM.Config.CPU,VM.Config.Cloudinit,\
VM.Config.Disk,VM.Config.HWType,VM.Config.Memory,VM.Config.Network,VM.Config.Options,\
VM.GuestAgent.Audit,VM.GuestAgent.Unrestricted,VM.PowerMgmt,VM.Snapshot,VM.Snapshot.Rollback"

pveum user add siteworker-<cluster>@pve
pveum user token add siteworker-<cluster>@pve site-worker --privsep 0
```

Then scope it — **nothing at `/`** except read-only audit:

```bash
pveum acl modify / --user siteworker-<cluster>@pve --role PVEAuditor
pveum acl modify /pool/guildcloud-<cluster> --user siteworker-<cluster>@pve --role GuildCloudSiteWorker
pveum acl modify /nodes/<each-node>       --user siteworker-<cluster>@pve --role GuildCloudSiteWorker
pveum acl modify /storage/<each-storage>  --user siteworker-<cluster>@pve --role GuildCloudSiteWorker
pveum acl modify /sdn/zones/<zone>        --user siteworker-<cluster>@pve --role GuildCloudSiteWorker
pveum acl modify /vms/<each-template-vmid> --user siteworker-<cluster>@pve --role GuildCloudSiteWorker
```

Template VMIDs need their own grants because templates live outside the pool.

Store the resulting token in Vault under the name from §1.4. Note `--privsep 0`:
a privilege-separated token gets none of its user's ACLs, which is a common way
to end up with a token that can authenticate but do nothing.

---

## 4. Private network — Tailscale

### 4.1 Tailnet and tags

Create a tailnet. The policy in `infra/tailscale/policy.hujson` defines the tag
structure; read
`docs/decisions/2026-08-07-tailscale-tenancy-model.md` for why it is shaped
that way before changing it.

Replace the tailnet name in the policy and in
`.github/workflows/tailscale-acl.yml` — production hardcodes
`tail345216.ts.net`.

### 4.2 OAuth clients

Two separate clients, deliberately:

| Client | Scopes | Used by |
| --- | --- | --- |
| Worker | Devices Core + Auth Keys | the site worker, via Vault (§1.4) |
| ACL GitOps | Policy File read+write | the GitHub Action (§6.2) |

The worker client is intentionally **not** tag-restricted; see
`docs/phase-3/threat-model.md` finding #2.

### 4.3 Policy as code

`infra/tailscale/policy.hujson` is the single source of truth. A PR touching it
validates against the live API; a merge to `main` applies it. Never edit the
policy in the Tailscale admin console — the next apply silently overwrites it.

---

## 5. The site worker

Full detail lives in [`deploy/site-worker/README.md`](../deploy/site-worker/README.md);
this is the ordering.

### 5.1 Create the LXC

A small Debian LXC on one node of the cluster, with Node.js 22 and network
reachability to both the PVE API and the internet.

### 5.2 Get the code onto it

Sparse-checkout `deploy/site-worker/` into `/opt/guildcloud-worker/repo`. The
transport is configurable via `GUILDCLOUD_REPO_URL` in the systemd unit:

- **Public repository** → anonymous HTTPS, no key to manage. This is what
  Guild-B uses.
- **Private repository** → generate an ed25519 keypair at
  `/opt/guildcloud-worker/.ssh/deploy_key`, add the public half as a read-only
  deploy key, and leave the default SSH URL. One key per cluster, so revoking
  one never affects another.

```bash
mkdir -p /opt/guildcloud-worker/releases
```

### 5.3 Configure it

Copy `deploy/site-worker/env.example` to `/etc/guildcloud/worker.env`, fill in
this cluster's real values, then:

```bash
chown root:root /etc/guildcloud/worker.env && chmod 600 /etc/guildcloud/worker.env
```

The worker calls `fs.statSync` on startup and **refuses to run** if this file is
group- or world-readable. No field that identifies a cluster has a default, so a
copy-pasted env file with one blank line fails to start rather than quietly
claiming another cluster's work.

### 5.4 Give it an identity and a token

Register the worker in the control plane first:

```sql
insert into public.worker_identities (worker_id, cluster_id) values ('<worker-id>', '<cluster-id>');
```

Then mint its token **on an operator machine**, not on the worker:

```bash
SUPABASE_JWT_SECRET=... node scripts/mint-worker-token.mjs --worker-id <worker-id>
```

The script writes the credential to a path outside any git working tree,
falling back to the temp directory. That guard exists because a minted token was
once swept into this public repository by a `git add -A`; `*.jwt` is also
gitignored. Move the value into `/etc/guildcloud/worker.env` as
`SUPABASE_WORKER_TOKEN`, set `CONTROL_PLANE_AUTH_MODE=worker_token`, and delete
the file.

The cluster is **not** in the token — every RPC resolves it from
`worker_identities`. Revoking a worker is therefore one UPDATE, not a JWT-secret
rotation:

```sql
update public.worker_identities set revoked_at = now() where worker_id = '<worker-id>';
```

Exactly one worker per tailnet may hold `tailnet_housekeeping` (a unique partial
index enforces it):

```sql
update public.worker_identities set tailnet_housekeeping = true where worker_id = '<worker-id>';
```

### 5.5 Start it

Install the four systemd units from `deploy/site-worker/` into
`/etc/systemd/system/` and enable both timers:

```bash
systemctl enable --now guildcloud-worker.timer guildcloud-worker-deploy.timer
```

Verify:

```bash
node /opt/guildcloud-worker/current/index.js --print-config   # identity; secret NAMES only
node /opt/guildcloud-worker/current/index.js --health         # exits non-zero if it can't reach the control plane
```

From here the worker self-deploys: a push to `main` reaches every cluster within
~2 minutes, gated on `node --check` and the full worker test suite passing in a
staged release before the symlink moves.

---

## 6. Console and pipelines

### 6.1 Run it

```bash
cp .env.example .env.local   # fill in from §1.1
npm ci
npm run dev                  # http://localhost:3100
```

### 6.2 GitHub secrets

| Secret | Used by |
| --- | --- |
| `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_CLIENT_SECRET` | `tailscale-acl.yml` (Policy File scope) |
| `VERCEL_TOKEN` | `deploy.yml` |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | `deploy.yml` — from `.vercel/project.json` after linking |

`deploy.yml` skips cleanly while `VERCEL_TOKEN` is unset, so it will not fill
the Actions tab with red before you get there.

### 6.2.1 Protect the default branch — do this before anything reaches production

Production is deployed from `main`. Nothing stops a red commit reaching `main`
unless you say so, and CI passing on a pull request means nothing if the branch
will accept a push that skipped it.

A branch ruleset requiring a pull request and green checks closes that without
any deploy credential, which is why it is the first thing to set up rather than
the last:

```bash
gh api -X POST repos/<owner>/<repo>/rulesets --input ruleset.json
```

with rules `pull_request` and `required_status_checks` for the CI job names
(`application`, `database`, `public-accessibility`), targeting
`~DEFAULT_BRANCH`. Add `deletion` and `non_fast_forward` too — a force-push over
`main` rewrites the history everything else here depends on.

Leave `bypass_actors` empty unless you have a reason not to: with it empty the
rule applies to the repository owner as well, which is the point. Verify by
trying a direct push and confirming it is refused:

```
remote: - Changes must be made through a pull request.
remote: - 3 of 3 required status checks are expected.
```

With this in place, Vercel's own Git integration deploying `main` is safe: only
CI-passing commits can be there. The gated `deploy.yml` pipeline then becomes an
enhancement — it deploys the exact tested SHA and health-checks the result —
rather than the only thing standing between a failing test and production.

### 6.3 Vercel

Link the project, set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
and `NEXT_PUBLIC_SITE_URL` as production environment variables, then follow the
two-step note at the top of `.github/workflows/deploy.yml`: get one successful
workflow run first, and only then disable Vercel's own Git production deploys.
Doing it in the other order leaves nothing deploying production at all.

Production deploys are gated on CI passing for the same commit, and the workflow
checks out `head_sha` rather than `main`, so a push during a CI run cannot ship
untested code.

---

## 7. Secret inventory

Every credential the platform needs. **None of these is in the repository, and
none should ever be committed.**

| Secret | Lives in | Obtained from |
| --- | --- | --- |
| Supabase anon key | `.env.local`, Vercel env | Supabase → Settings → API |
| Supabase `service_role` key | Supabase Edge Function secrets only | Supabase → Settings → API |
| Supabase JWT secret | operator machine, transiently | Supabase → Settings → API |
| Worker token | `/etc/guildcloud/worker.env` | minted by `scripts/mint-worker-token.mjs` |
| Proxmox API token (per cluster) | Supabase Vault | `pveum user token add` (§3.5) |
| Tailscale worker OAuth id/secret | Supabase Vault | Tailscale → Settings → OAuth clients |
| Tailscale ACL OAuth id/secret | GitHub repo secrets | Tailscale → Settings → OAuth clients |
| Resend API key | Supabase Vault (`resend_api_key`) | Resend dashboard |
| Vercel token | GitHub repo secrets | Vercel → Account Settings → Tokens |

Rotation notes live in `docs/phase-3/operator-runbook.md`.

---

## 8. Verifying the replica

In order, because each step depends on the last:

1. **Schema** — `supabase db push` completes; `select count(*) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';`
   returns 63.
2. **Console** — `npm run check` passes (migrations, lint, typecheck, unit,
   pgTAP, build). The pgTAP suites need Docker and are hermetic; they need no
   live project.
3. **Auth** — sign up, land on onboarding, create an org. The
   `on_organization_created` trigger should make you its Owner; if the org is
   invisible after creation, that trigger did not fire.
4. **Worker** — `--health` exits zero and a heartbeat appears in
   `worker_identities`.
5. **Placement** — create an instance. Watch `operations` and
   `operation_stages` advance; the worker should clone a template into the pool.
6. **Private access** — enroll a device from
   `/console/networking?connect=1`, then reach the instance over the tailnet.
   There is no public route by design.
7. **Backups** — confirm the backup job produces a snapshot on the PBS target.

---

## 9. Known gaps

Honest list of what still does not replicate cleanly.

- **The master plan is outside git.** Described in "What this repository can and
  cannot give you". This is the largest remaining gap.
- **Tailnet name is hardcoded** in `infra/tailscale/policy.hujson` and
  `.github/workflows/tailscale-acl.yml`. Replicating requires editing both.
- **Vercel org and project ids are hardcoded** in `deploy.yml`'s setup comment.
  Harmless (they are not secret) but they are one environment's values.
- **`lag-1` is a hardcoded site id** in several migrations, and the
  `site_worker_guild_a` role's RLS policies are pinned to it. A replica using a
  different site id must account for that; the role itself is documented as
  never having been used.
- **No template build automation.** §3.4 says what the templates must be, not
  how to produce them. Building them is manual.
- **`guild-a` and `guild-b` are seeded into `infrastructure_clusters`** by
  `20260818090000`. A replica inherits two production cluster rows it does not
  have hardware for, and `20260829230000` will block the push until they are
  removed or given Vault secrets (§1.2).
- **The catalogue seed carries placeholder pricing** (`is_placeholder = true`).
  Per master plan §16, nothing may be published until a real capacity model
  produces a catalogue proposal.
