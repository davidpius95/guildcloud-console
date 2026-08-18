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

## Fix Round 1

Accepted reservation compatibility and migration-safety findings were addressed:

- `capacity_reservations.cluster_id` and `storage_id` now retain the required
  NOT NULL guarantees while defaulting legacy inserts to `guild-a` and
  `ceph-vm`.
- The global operation uniqueness constraint is replaced with the partial
  `capacity_reservations_active_operation_key` index for `held` and
  `committed` reservations only.
- Before that index is created, active duplicate legacy reservations are ranked
  per operation: committed first, then unexpired held, then newest
  `created_at` and `id`. All non-winning active rows are retained and released.
- The pgTAP fixture now contains committed, unexpired-held, and expired-held
  duplicates for one legacy operation. Assertions cover the selected committed
  row, preserved history, legacy insert defaults, partial-index conflicts, and
  allowed released history.
- pgTAP also now asserts the exact one-row Guild-A seed before behavioral test
  setup and verifies that legacy operation/instance placement values were not
  invented or changed.

### Fix Round 1 RED

Before the migration change, the expanded pgTAP contract reported eight
failures, including missing reservation defaults and the old
`capacity_reservations_operation_key`. After adding the authorized duplicate
fixture rows, the unchanged migration failed during DDL with:

```text
ERROR: could not create unique index "capacity_reservations_operation_key"
```

### Fix Round 1 GREEN

The isolated runner then applied the real fixture, real migration, and real
pgTAP contract successfully with no network or published ports:

```text
1..151
Harness cleanup: removing disposable container
```
