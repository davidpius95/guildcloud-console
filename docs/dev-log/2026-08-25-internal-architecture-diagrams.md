# 2026-08-25 — Internal architecture diagrams

## What changed

Added [internal architecture diagrams](../architecture.md) covering the
control plane, per-cluster workers, Proxmox execution, private access,
placement, lifecycle reconciliation, system ownership, and incident triage.

## Why

The internal system has grown beyond a single-console-to-single-worker path.
An operator needs a readable map of the real boundaries, especially the
separation between the Vercel/Supabase control plane and the private workers
that can reach Proxmox.

## Verified

The diagrams were traced against the current generic worker, the placement
RPC migration, the device enrollment route, and current project-status
evidence. No runtime behavior was changed.

## What's still open

The document intentionally preserves the existing limits: no public ingress,
automatic failover, or proved cross-site DR. Live admission/capacity must
still be read from the control plane before an operational decision.
