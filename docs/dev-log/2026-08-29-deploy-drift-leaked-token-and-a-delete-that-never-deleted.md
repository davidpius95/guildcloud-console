# 2026-08-29 (later) — deploy drift, a leaked worker token, and a delete that never deleted

Continues `2026-08-29-task-7-boundary-and-two-production-faults.md`. That entry
ends with the boundary merged and the cutover waiting on an operator. Getting
ready for the cutover turned over several rocks, and what was under them explains
most of the day: **nothing was deploying itself, so code and production had
drifted apart in three separate places.**

## The through-line

Three faults today, one cause. There was no CD for the console, no deploy
mechanism at all on the Guild-B worker, and a test that silently blocked every
worker deploy on both clusters. Each looked unrelated while it was being
diagnosed; each was code and production disagreeing because nothing was keeping
them in step.

That is now fixed at every layer, and the fixes are the least interesting part of
this entry. The findings are worth reading.

## Fault 1's trigger, now determined

The earlier entry recorded that instance creation broke because both admission
gates required `monitoring_healthy` while the worker reports it `false`, and said
**the exact trigger was not determined**. It is now.

Guild-A keeps timestamped releases, and they answer it directly:

| Guild-A release | `monitoring_healthy` |
| --- | --- |
| `20260827T193304Z` (last before today) | **`true`** |
| `20260829T065206Z` (06:52 today, right after PR #11 merged at 06:51) | **`false`** |

The box had been running a **hand-patched** release that reported `true`. When
PR #11 auto-deployed this morning it replaced that with the honest `false` from
`main`, and both gates refuse work when monitoring is unhealthy. Creation died at
that moment, which matches the last successful create at 2026-08-28 20:28.

So the fault was not introduced by any single commit. It was a local patch on a
production box being silently overwritten by the code it had diverged from — the
same shape as everything else here.

## The Guild-B worker had no deploy mechanism at all

Guild-A and Guild-B turned out to be in completely different states:

| | Guild-A (nodeD) | Guild-B (podD) |
| --- | --- | --- |
| Deploy timer | active | **inactive, not-found** |
| `current` | symlink into `releases/` | **plain directory** |
| Repo checkout / deploy key | present | **absent** |
| Code | current | **pre-boundary** |

Guild-B had `index.js.bak-*` files from 2026-08-27 sitting beside `current`:
code was reaching that box by hand. This also contradicted `PROJECT_STATUS.md`,
which described both workers as running the staged-release mechanism — true for
Guild-A only.

Installing the standard mechanism there was blocked by authentication:
`deploy-pull.sh` force-reset `origin` to an SSH URL and pointed
`GIT_SSH_COMMAND` at a deploy key only Guild-A has. That self-heal exists for a
real reason its own comment records — something once rewrote `origin` to HTTPS
and broke deploys for three days with no alerting — so it stayed, but the
transport became configurable (`GUILDCLOUD_REPO_URL`, defaulting to the existing
SSH URL so Guild-A is byte-for-byte unchanged). The repository is public, so
Guild-B pulls over anonymous HTTPS with no key to manage.

Both clusters now run one identical script. Two hand-maintained copies is how
Guild-B ended up with nothing in the first place.

## A test of mine was blocking every worker deploy, on both clusters

Guild-B's first deploy was **correctly rejected**: `deploy-pull.sh` runs
`npm test` in a staged release before switching the symlink, and one test failed.

```
not ok 114 - the Guild-A launcher contains no second worker implementation
  error: "ENOENT: ... '/opt/guildcloud-worker/releases/site-worker-guild-a/index.js'"
```

`single-source.test.js` reads `../site-worker-guild-a/index.js`, but
`deploy-pull.sh` copies **only** `deploy/site-worker/` into a release, so that
sibling never exists on a worker box. The test passes in CI, where the full repo
layout exists, and fails on every worker.

Guild-A was then checked and fails identically — so **its next deploy would have
been rejected too**, silently, because a rejected deploy just leaves the previous
release running and writes a line nobody reads. Guild-A happened to be on a
current release, so nothing looked wrong.

The test guards a *repository* invariant, not a runtime one, so it now skips on
`ENOENT` only, rethrowing anything else. Verified in both contexts: three tests
pass from a checkout, and two pass with one skipped from a directory containing
only the files a release actually stages.

The gate itself worked exactly as designed. It caught a bad release rather than
shipping it; the test was simply wrong.

## A worker token leaked into this public repository

While syncing for the console redeploy, `worker-token-guild-a-lxc-500.jwt` was
found committed to `main` — swept up by a `git add -A` in PR #22.

**Revoked first, before anything else.** Setting `revoked_at` on the
`guild-a-lxc-500` identity made the leaked token inert immediately:
`current_worker_cluster()` rejects it with `28000` and it cannot heartbeat,
confirmed by resolving that identity through the boundary. No cluster was using
a token yet, so nothing broke.

This is the property the design was chosen for, tested for real rather than in
principle: **revoking a worker is one `UPDATE`, not a JWT-secret rotation.** A
leak cost a row update instead of an incident.

The root cause is ours: `mint-worker-token.mjs` wrote the credential into the
current working directory, which for anyone running it from a checkout is a git
repository. The script's own comment said "do not commit it" — a warning is not
a control. It now resolves an output path **outside any git working tree**,
falling back to the temp dir, with a test asserting the guard, and `*.jwt` is
gitignored.

History was deliberately **not** rewritten: the token is revoked and useless, and
rewriting a public repository's history is disruptive for no security gain. The
identity row is annotated so the id is never re-minted; Guild-A now uses
`guild-a-lxc-500-r2`.

## The delete button had never worked

The sharpest finding of the day, and it was customer-facing for far longer than
the reprovisioning bug.

Production carried two overloads of `request_instance_deletion`. The
one-argument version's entire body:

```sql
update instances set state = 'deleting' where id = p_instance_id and state <> 'deleting';
```

No operation row, no stages, nothing queued. The worker's teardown sweep only
acts on instances in `deleting` that have an **active** `instance.delete`
operation, so it never sees them: the instance sits in `deleting` forever and its
VM keeps running.

The evidence is stark. The database holds **52 `instance.delete_requested` audit
events going back to 2026-08-10**, and until today **zero** `instance.delete`
operations — the only six in existence were created during today's own testing
and cleanup. Every console-initiated deletion since that function shipped created
no work at all.

Task 4 added the atomic two-argument version but left the old one in place, and
PostgREST resolves overloads by the arguments supplied. `main`'s console sends
both and gets the correct function; the **stale production deployment** sent one
and silently stranded the instance. Dropped, so any caller still sending one
argument now gets a loud 404 instead.

Four instances stranded this way (`TestDev`, `e2e-verify-fix`, `Yrw`, `Try`) were
cleaned up by setting them to `delete_failed` — the honest state — and
re-requesting deletion through the two-argument RPC, so the real path did the
teardown. All four seeded **0 stages**, confirming the reprovisioning fix holds,
and all four are gone from the control plane, Proxmox, and the tailnet.

## CD, finally

The console had no CD: `vercel --prod` was a manual step, and production was
running a **two-day-old** build — the one sending a single argument to the delete
RPC. The Vercel project is now connected to the repository, so `main`
auto-deploys and pull requests get previews. Proven end to end rather than
assumed: a docs PR produced a preview deployment, and merging it produced a
production deployment with no `vercel --prod` run by hand.

One gap remains and is recorded rather than glossed: Vercel builds independently
of GitHub Actions, so a commit whose tests fail but whose `next build` succeeds
still deploys. `.github/workflows/deploy.yml` closes it — gated on `workflow_run`
for a successful CI run, checking out the tested SHA rather than current `main`,
and polling the deployed URL before reporting success. It is inert until a
`VERCEL_TOKEN` secret exists, and the file documents the ordering: add secrets
first, disable Vercel's own production deploys second, or nothing deploys at all.

## Cutover readiness

Both workers now run current code and have identities registered whose
`WORKER_ID` matches:

| | Guild-A | Guild-B |
| --- | --- | --- |
| Identity | `guild-a-lxc-500-r2` | `guild-b-lxc-500` |
| Housekeeping | yes (wider surface) | no (**narrower**) |
| Token minted | operator | operator |

Guild-B is the better canary: it exercises only the cluster-scoped RPCs. Its
`WORKER_ID` needed no change — only Guild-A's was burned by the leak, and
rotating an untainted id would have meant editing a production env file and
restarting a healthy worker to end up exactly where it already was.

## Two corrections

Both were stated confidently and both were wrong, so they are recorded here
rather than quietly dropped.

**The Proxmox MCP was reported unreachable.** It is not. The dedicated wrappers
(`get_vms`, `get_vm_status`) silently target the server's *default* cluster
(guild-a), so asking them about a Guild-B node returns TLS and
`No route to host` errors that read as a network fault. `pve_call` with an
explicit `cluster` argument reaches both clusters.

**The one-argument overload was described as having no repository counterpart.**
It does: `20260810104404_add_request_instance_deletion_rpc.sql`. It was confused
with `begin_instance_operation` / `end_instance_operation`, which genuinely are
production-only.

A third, smaller one: the four stranded instances were first said to have been
stuck since 08-28. The audit log shows deletion was requested at **08-29
14:15–14:16**; 08-28 is their *creation* date. That is precisely the trap the
2026-08-27 entry warns about — `instances` has no `updated_at`, so state age
cannot be read from that table. The warning was there and was walked into anyway,
which is an argument for adding the column rather than for reading more
carefully.
