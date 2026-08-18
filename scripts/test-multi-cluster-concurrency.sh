#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <postgres-container-name>\n' "$0" >&2
  exit 2
fi

container_name=$1
test_now='2026-08-18 12:00:00+00'
assertions=0

psql_container() {
  docker exec -i "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -qAt \
      -h 127.0.0.1 -U postgres -d postgres "$@"
}

fail() {
  printf 'CONCURRENCY NOT OK: %s\n' "$*" >&2
  exit 1
}

assert_sql() {
  local description=$1
  local query=$2
  local expected=$3
  local actual

  actual=$(psql_container -c "$query")
  if [[ "$actual" != "$expected" ]]; then
    fail "$description (expected $expected, got ${actual:-<empty>})"
  fi
  assertions=$((assertions + 1))
  printf 'concurrency ok %d - %s\n' "$assertions" "$description"
}

reset_and_seed() {
  local request_count=$1

  psql_container <<SQL
truncate table
  public.operation_stages,
  public.capacity_reservations,
  public.warm_pool_vms,
  public.operations,
  public.instances,
  public.catalog_image_cluster_templates,
  public.infrastructure_storage_targets,
  public.infrastructure_nodes,
  public.infrastructure_clusters,
  public.placement_settings
restart identity cascade;

insert into public.placement_settings (id, mode) values (true, 'single');
insert into public.infrastructure_clusters
  (id, site_id, name, enabled, admission_state, worker_heartbeat_at,
   capacity_observed_at, private_networking_healthy, backup_healthy,
   monitoring_healthy)
values
  ('guild-a', 'lag-1', 'Guild-A', true, 'open', '$test_now', '$test_now',
   true, true, true);
insert into public.infrastructure_nodes
  (cluster_id, node, enabled, admission_state, online, total_vcpu,
   committed_vcpu, total_memory_bytes, used_memory_bytes,
   committed_memory_bytes, observed_at)
values
  ('guild-a', 'node-a', true, 'open', true, 10, 2,
   10737418240, 2147483648, 2147483648, '$test_now');
insert into public.infrastructure_storage_targets
  (cluster_id, storage_id, node, enabled, healthy, shared, total_bytes,
   used_bytes, observed_at)
values
  ('guild-a', 'shared-a', null, true, true, true,
   107374182400, 21474836480, '$test_now');
insert into public.catalog_image_cluster_templates
  (catalog_image_id, cluster_id, source_node, proxmox_vmid, storage_id,
   target_nodes, enabled, tested_at, template_version)
values
  ('ubuntu-2404', 'guild-a', 'node-a', 9000, 'shared-a', array['node-a'],
   true, '$test_now', 'concurrency');

insert into public.instances
  (id, site_id, catalog_image_id, catalog_plan_id)
select
  ('52000000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
  'lag-1', 'ubuntu-2404', 'std-5'
from generate_series(1, $request_count) series;

insert into public.operations
  (id, site_id, instance_id, kind, state, started_at)
select
  ('42000000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
  'lag-1',
  ('52000000-0000-0000-0000-' || lpad(series::text, 12, '0'))::uuid,
  'instance.create', 'pending',
  '$test_now'::timestamptz + make_interval(secs => series)
from generate_series(1, $request_count) series;

insert into public.operation_stages (operation_id, stage)
select operation.id, stage.name
from public.operations operation
cross join (values ('preflight'), ('capacity_reservation'), ('operation_created')) stage(name);
SQL
}

run_concurrent_pair() {
  local first_output second_output first_pid lock_seen=0
  first_output=$(mktemp "${TMPDIR:-/tmp}/guildcloud-concurrency-first.XXXXXX")
  second_output=$(mktemp "${TMPDIR:-/tmp}/guildcloud-concurrency-second.XXXXXX")

  psql_container >"$first_output" 2>&1 <<SQL &
begin;
select public.place_next_pending_operation('guild-a', '$test_now', null);
select pg_sleep(2);
commit;
SQL
  first_pid=$!

  for _attempt in {1..100}; do
    if [[ $(psql_container -c "select count(*) from pg_locks where locktype = 'advisory' and granted") -gt 0 ]]; then
      lock_seen=1
      break
    fi
    if ! kill -0 "$first_pid" 2>/dev/null; then
      break
    fi
    sleep 0.02
  done

  if [[ "$lock_seen" -ne 1 ]]; then
    wait "$first_pid" || true
    tail -n 20 "$first_output" >&2 || true
    rm -f "$first_output" "$second_output"
    fail 'first session never held the transaction advisory lock'
  fi

  if ! psql_container >"$second_output" 2>&1 <<SQL
select public.place_next_pending_operation('guild-a', '$test_now', null);
SQL
  then
    wait "$first_pid" || true
    tail -n 20 "$second_output" >&2 || true
    rm -f "$first_output" "$second_output"
    fail 'second placement session failed'
  fi

  if ! wait "$first_pid"; then
    tail -n 20 "$first_output" >&2 || true
    rm -f "$first_output" "$second_output"
    fail 'first placement session failed'
  fi

  rm -f "$first_output" "$second_output"
}

reset_and_seed 1
run_concurrent_pair
assert_sql 'one operation is assigned once' \
  "select count(*) from public.operations where cluster_id is not null" 1
assert_sql 'one operation owns one active reservation' \
  "select count(*) from public.capacity_reservations where state in ('held', 'committed')" 1

reset_and_seed 2
run_concurrent_pair
assert_sql 'only one of two operations consumes the last safe capacity' \
  "select count(*) from public.operations where cluster_id is not null" 1
assert_sql 'the last safe capacity creates only one reservation' \
  "select count(*) from public.capacity_reservations where state in ('held', 'committed')" 1
assert_sql 'the second operation stays pending with a safe wait reason' \
  "select count(*) from public.operations where cluster_id is null and state = 'pending' and failure_reason = 'Waiting for eligible capacity or capability.'" 1

reset_and_seed 1
psql_container <<SQL
insert into public.infrastructure_nodes
  (cluster_id, node, enabled, admission_state, online, total_vcpu,
   committed_vcpu, total_memory_bytes, used_memory_bytes,
   committed_memory_bytes, observed_at)
values
  ('guild-a', 'node-z', true, 'open', true, 10, 2,
   10737418240, 2147483648, 2147483648, '$test_now');
update public.catalog_image_cluster_templates
set target_nodes = array['node-a', 'node-z'];
SQL

blocker_output=$(mktemp "${TMPDIR:-/tmp}/guildcloud-concurrency-blocker.XXXXXX")
psql_container >"$blocker_output" 2>&1 <<SQL &
begin;
select 1 from public.infrastructure_nodes
where cluster_id = 'guild-a' and node = 'node-a'
for update;
select pg_advisory_lock(32123, 1);
select pg_sleep(2);
update public.infrastructure_nodes
set enabled = false
where cluster_id = 'guild-a' and node = 'node-a';
commit;
SQL
blocker_pid=$!

blocker_ready=0
for _attempt in {1..100}; do
  if [[ $(psql_container -c \
      "select count(*) from pg_locks where locktype = 'advisory' and classid = 32123 and objid = 1 and granted") -eq 1 ]]; then
    blocker_ready=1
    break
  fi
  if ! kill -0 "$blocker_pid" 2>/dev/null; then
    break
  fi
  sleep 0.02
done
if [[ "$blocker_ready" -ne 1 ]]; then
  wait "$blocker_pid" || true
  tail -n 20 "$blocker_output" >&2 || true
  rm -f "$blocker_output"
  fail 'node-lock blocker session did not reach its synchronization point'
fi

placement_result=$(psql_container -c \
  "select public.place_next_pending_operation('guild-a', '$test_now', null)")
if ! wait "$blocker_pid"; then
  tail -n 20 "$blocker_output" >&2 || true
  rm -f "$blocker_output"
  fail 'node-lock blocker session failed'
fi
rm -f "$blocker_output"

if [[ -z "$placement_result" ]]; then
  fail 'placement did not retry another node after locked capacity changed'
fi
assert_sql 'locked revalidation retries another node on the same shared storage' \
  "select assigned_node from public.operations where id = '42000000-0000-0000-0000-000000000001'" node-z

printf 'PASS: %d two-session concurrency assertions passed\n' "$assertions"
