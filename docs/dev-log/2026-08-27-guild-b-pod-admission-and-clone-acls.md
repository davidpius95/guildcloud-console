# 2026-08-27 — Guild-B podB–podF made admittable; two real blockers found and fixed

Follow-on from `2026-08-27-custom-domain-and-ingress-route-fix.md`. That entry
ends with the new `cloud.guild-technologies.com` domain verified for sign-in but
the create-instance flow untestable — the wizard reported "No eligible capacity"
for every image and every plan. This entry is what that turned out to be.

## What changed

**1. Recorded the capacity finding as G-24** in `docs/phase-0/gap-register.md`
(see that row for the full per-node arithmetic). Short version: at the time of
the finding, *every* node on *both* clusters failed the wizard's admission
check for even a Standard 1 (1 vCPU / 2 GB), so the product's primary flow was
unavailable to any customer.

**2. Found that the two placement RPCs disagreed — this was the real bug.**

| Gate | `can_provision_instance()` (wizard) | `place_next_pending_operation()` (real placement) |
|---|---|---|
| vCPU ceiling | `floor(total_vcpu * 0.7)` | `total_vcpu * 2` |
| Memory floor | 30% of total must remain | flat 1 GiB must remain |

The wizard was therefore refusing creates that real placement would have
accepted — the strictness was not protecting anything, because the thing that
actually allocates VMs never applied it.

Fixed by adding nullable per-node overrides rather than loosening the global
defaults (migration `per_node_capacity_ceiling_overrides`):
`infrastructure_nodes.vcpu_overcommit_ratio` and `.memory_reserve_ratio`, both
`null` by default, `coalesce`d to the original `0.7` / `0.3` in the function.
Set to `1.0` / `0.15` on **podB, podC, podD, podE, podF only**.
**podA and all five Guild-A nodes were deliberately left null** (user
instruction: add the other pods, not podA) and still correctly refuse work.

**3. Found a latent permission gap that would have broken all five pods.**

With the gate open, the first real create reached Proxmox and failed:

```
403 Permission check failed (/vms/9162, VM.Clone)
```

`siteworker-guild-b@pve` holds `GuildCloudSiteWorker` on all six *nodes*, but
Proxmox evaluates `VM.Clone` against the **source VM path** `/vms/<vmid>`, and
only templates 9000 and 9100 had such an entry.

**Pool membership does not confer it** — this was the non-obvious part, and an
assumption worth not repeating: templates 9163/9165/9166 *are* members of the
`guildcloud-guild-b` pool (which the worker has a role on), yet
`GET access/permissions` returned `VM.Clone: 0` for all three. Only an explicit
`/vms/<vmid>` ACL worked. Checked each template individually rather than
inferring from the pool, which is how 9163/9165/9166 were caught — they would
each have failed exactly as podB did, one node at a time, on first use.

Added explicit `GuildCloudSiteWorker` ACLs on `/vms/9162`, `/vms/9163`,
`/vms/9164`, `/vms/9165`, `/vms/9166`. podA's `/vms/9100` grant was left
exactly as found.

## Why

The user asked to verify end-to-end that the new `cloud.guild-technologies.com`
domain is the one actually in use (not `guildcloud-console.vercel.app`), then —
once capacity turned out to block that — to document the finding, leave physical
capacity alone, and enable the other pods excluding podA.

## Verified

- **Sign-in on the new domain**: full Google OAuth round-trip stays on
  `cloud.guild-technologies.com` and lands in `/console`. This needed a Supabase
  Redirect-URLs fix first — before it, the callback silently fell back to the
  Site URL and dumped the browser on `guildcloud-console.vercel.app/?code=...`,
  the same failure class as the 2026-08-25 stale-`localhost` incident.
- **Gate math re-derived per node in SQL** after the migration: podB–podF pass
  both vCPU and memory checks; podA and all Guild-A nodes still fail. Confirms
  the override is scoped as intended.
- **`VM.Clone: 1` re-read from `access/permissions`** for all five templates
  after the ACL change (it was `0` for 9163/9165/9166 beforehand).
- **Two real end-to-end creates through the production UI, on two different
  nodes** — not one create generalised to five:
  - `e2e-podb-verify` → **podB**, VM 111, `state: ready`, op `succeeded`,
    Tailscale IP `100.122.168.93`.
  - `e2e-second-node` → **podD**, VM 112, `state: ready`, op `succeeded`,
    Tailscale IP `100.116.77.110`. Notably this one cleared
    `template_cloud_init`, the stage that produced the ENOSPC failures in the
    2026-08-21 podF attempts.
  - Both confirmed `status: running` directly on Proxmox (guest agent up,
    real network counters), not just by trusting the DB row.

## What's still open

- **podC, podE, podF are verified at both gates but have not had a real create
  land on them.** Placement chose podB then podD on its own (highest headroom
  first); the remaining three are proven only to the level of "capacity check
  passes and `VM.Clone` is granted". Worth one create each before treating them
  as production-ready, given the podF ENOSPC history.
- **Guild-A (all 5 nodes) and Guild-B podA still cannot admit any work** — left
  that way on purpose. That is G-14's legacy-workload problem and nothing here
  addresses it.
- **`1.0` / `0.15` are judgement calls, not derived limits.** 0.15 leaves ~2.3 GB
  free on a 15.5 GB node — still more than `place_next_pending_operation()`'s own
  1 GiB floor, but thin. Worth revisiting alongside the wider question of which
  of the two RPCs' ceilings is the intended policy; right now they still disagree
  and only the wizard side was moved.
- **Three test instances exist and are consuming real capacity**: `e2e-podb-verify`
  (podB/111) and `e2e-second-node` (podD/112) are live VMs; `cloud-domain-e2e` is
  a `failed` row from the pre-ACL-fix attempt with no VM behind it (`proxmox_vmid`
  null). None have been cleaned up yet — deletion was not requested.
