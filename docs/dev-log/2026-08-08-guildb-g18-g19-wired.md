# Dev log — 2026-08-08: Guild-B firewall and backups wired (G-19, G-18)

## What was asked

User asked to apply the same hardening Guild-A got to Guild-B — firewall
(G-19) and backups (G-18) — without touching any running services, and
without disrupting the Headlamp RBAC fix already in place from earlier
today.

## G-19: Firewall — done

Exact same design as G-05: explicit `ACCEPT` cluster-wide policy (no
lockout risk), plus a targeted `DROP` rule blocking guest workload IPs
from reaching Proxmox management ports (8006, 22). Built IPSet
`guildb-workloads` (k8s-cp-1, k8s-w-2, kuma, guildcloud-dev, the
GuildCloud-instance-tagged `test` VM — `gean-devnet` excluded, DHCP IP,
already out of scope). Enabled node-by-node, lowest-risk first (podB →
podD → podC → podA), verifying reachability and guest-agent responsiveness
after each step. Verified Kuma itself stayed reachable after enabling its
own host's firewall. Final check against Kuma's `/metrics` confirmed no
new monitors went down — only pre-existing issues (expired domain, offline
podE) were present both before and after.

`podE` is offline — its rules are configured but the node firewall
couldn't be enabled (`No route to host`). Follow-up needed when it's back.

## G-18: Backups — mechanism proven working

Reused the existing `guild-pbs` server rather than provisioning new
infrastructure. Hit a real bug immediately: `backup owner check failed`.
Guild-A and Guild-B assign VMIDs independently and they collide heavily
(101, 102, 200, 300, 9000+ all exist on both) — a shared flat datastore
was the wrong design, since PBS ties backup-group ownership to whichever
system's token wrote to a given VMID first.

Fixed properly with PBS namespaces rather than a workaround: created a
`guild-b` namespace on the same datastore. This PBS version's CLI doesn't
expose namespace creation — had to call the API directly, which required
a temporary `root@pam` token (even root's own tokens need explicit ACL
grants under PBS's privilege-separation model). Created it, used it once,
deleted it immediately after — no standing elevated credential left
behind.

Registered Guild-B's storage with the new namespace, created the daily job
(`guild-b-standard-daily`, matching Guild-A's shape exactly), then ran a
real proof backup rather than trusting the job's mere existence. Result:
`TASK OK`, 20 GiB transferred, and independently confirmed via PBS's own
snapshot API that a real, correctly-owned snapshot exists.

## What's flagged but not solved

- PBS host has ~75GB free. Guild-B's guests are collectively much larger
  than Guild-A's (`gean-devnet` alone: 1TB disk allocated). The daily
  all-guest job will likely hit disk exhaustion once it reaches the larger
  guests. This is a real capacity decision (expand storage, exclude large
  guests, or both) that needs to happen before the job can be trusted to
  fully complete — flagged in the gap register, not solved today.
- `podE`'s firewall rules need to be applied once it's back online.

## What changed

- Live: Guild-B firewall enabled on 4/5 nodes with the rules described.
- Live: new PBS token, ACL grants, namespace, storage registration, and
  backup job on Guild-B. One real backup completed successfully.
- `docs/decisions/2026-08-08-g18-g19-guildb-wiring.md` — full decision
  record.
- `docs/phase-0/gap-register.md` — G-18 High→Medium (mechanism proven,
  capacity risk open), G-19 High→resolved (podA-D; podE pending).
