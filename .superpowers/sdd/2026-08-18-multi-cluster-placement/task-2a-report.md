# Task 2A Report: Production Schema and pgTAP Contract

## Scope

Implemented the additive multi-cluster placement migration and its pgTAP
contract only:

- `supabase/migrations/20260818090000_add_multi_cluster_placement.sql`
- `supabase/tests/multi_cluster_placement_schema.sql`

No application or worker code was changed. The existing Task 2B harness,
Supabase config, package script, and fixture worktree changes were preserved
and are not part of this commit. No linked or production Supabase project was
accessed.

## Schema Delivered

- Adds the five RLS-protected infrastructure and placement tables with explicit
  constraint names, safe closed defaults, service-role access, and no customer
  privileges.
- Seeds only Guild-A in paused admission and single-cluster placement mode.
- Adds nullable placement records to operations and instances, and required
  cluster/storage identities to reservations and warm-pool VMs after backfill.
- Makes instance and warm-pool VMIDs cluster-scoped, preserves the readable
  site-template compatibility table, and copies only `lag-1` templates into
  disabled Guild-A cluster capabilities.

## RED Evidence

On an isolated, disposable `supabase/postgres:17.6.1.136` container with
`--network none` and no published ports, the pre-migration fixture reported:

```text
existing_multi_cluster_objects
<none>
```

The pgTAP contract then failed as expected before the migration: assertions
1-5 reported the required tables missing, and the command exited with status
3.

## GREEN Evidence

On a fresh container with the same isolation, the fixture, real production
migration, and real pgTAP file executed in that order. pgTAP completed:

```text
1..140
ROLLBACK
```

This executed checks for table shape, defaults, constraints, foreign keys and
cascades, partial uniqueness, cluster-scoped VMIDs, backfill data, singleton
mode, compatibility reads, RLS, customer denial, and service-role access.
The container was removed by its exit trap.

## Self-Review

- The migration is additive: it creates the new tables and adds columns,
  constraints, and indexes without dropping existing tables, customer RLS
  policies, or compatibility rows.
- The only dropped constraint is the legacy global warm-pool VMID uniqueness
  constraint, replaced by the required cluster-scoped constraint.
- `git diff --no-index --check` found no whitespace errors in the migration or
  pgTAP contract.

## Concern

The repository's committed migration history still cannot be replayed from the
root as a full Supabase reset because it begins after the live Phase 1 schema.
Task 2A validation therefore used the isolated pre-migration fixture supplied
in the worktree; Task 2B owns the durable checked-in replay harness and is not
included in this commit.
