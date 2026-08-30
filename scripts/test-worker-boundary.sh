#!/usr/bin/env bash
# Contract harness for the cluster-scoped worker RPC boundary (plan Task 7).
# Same disposable-database shape as test-instance-intents.sh: no published
# ports, no network, image pinned by digest.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
base_fixture="$repo_root/supabase/tests/fixtures/instance_intents_base.sql"
worker_fixture="$repo_root/supabase/tests/fixtures/cluster_worker_base.sql"
test_sql="$repo_root/supabase/tests/cluster_worker_boundary.sql"
postgres_image='supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
container_name="guildcloud-worker-boundary-${RANDOM}-${BASHPID}"
container_started=0

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ "$container_started" -eq 1 ]]; then
    docker rm -f "$container_name" >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

docker info >/dev/null 2>&1 || { echo 'Docker is required.' >&2; exit 1; }
docker image inspect "$postgres_image" >/dev/null 2>&1 || docker pull "$postgres_image" >/dev/null
docker run --detach --rm --pull=never --network none --name "$container_name" \
  -e POSTGRES_PASSWORD=postgres "$postgres_image" >/dev/null
container_started=1

for attempt in {1..60}; do
  docker exec "$container_name" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1 && break
  [[ "$attempt" -lt 60 ]] || { echo 'PostgreSQL did not become ready.' >&2; exit 1; }
  sleep 1
done

psql_cmd=(docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres)

# The image ships auth.uid()/auth.role() but not auth.jwt(), and the auth schema
# is owned by supabase_admin. Hosted Supabase provides auth.jwt() for real; the
# fixture only stubs it, which needs CREATE on the schema.
docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d postgres \
  -c 'grant usage, create on schema auth to postgres;' >/dev/null

# Order matters: the base fixture supplies the lifecycle tables, the worker
# fixture adds infrastructure_clusters and the primitives the boundary wraps,
# then the real migrations are applied on top exactly as production would.
"${psql_cmd[@]}" < "$base_fixture" >/dev/null
"${psql_cmd[@]}" < "$worker_fixture" >/dev/null

for migration in \
  "$repo_root/supabase/migrations/20260829100000_repair_rls_helper_grants.sql" \
  "$repo_root/supabase/migrations/20260829110000_add_atomic_instance_intents.sql" \
  "$repo_root/supabase/migrations/20260829120000_add_cluster_worker_rpc_boundary.sql" \
  "$repo_root/supabase/migrations/20260829130000_add_worker_housekeeping_rpcs.sql" \
  "$repo_root/supabase/migrations/20260829150000_revoke_anon_definer_functions.sql" \
  "$repo_root/supabase/migrations/20260829190000_add_instances_updated_at.sql" \
  "$repo_root/supabase/migrations/20260830090000_add_worker_list_cluster_operations.sql" \
  "$repo_root/supabase/migrations/20260830100000_fix_worker_get_operation_stage_alias.sql"
do
  [[ -f "$migration" ]] && "${psql_cmd[@]}" < "$migration" >/dev/null
done

test_log="$(mktemp "${TMPDIR:-/tmp}/guildcloud-worker-boundary.XXXXXX.log")"
if ! "${psql_cmd[@]}" < "$test_sql" | tee "$test_log"; then
  rm -f "$test_log"
  exit 1
fi
if grep -Eq '(^|[[:space:]])not ok [0-9]+ -' "$test_log"; then
  rm -f "$test_log"
  echo 'Cluster worker boundary pgTAP contract failed.' >&2
  exit 1
fi
# A plan mismatch means assertions were added or skipped without the count being
# updated. Without this the suite reports PASS while silently running a
# different set of tests than it claims to.
if grep -q 'Looks like you planned' "$test_log"; then
  grep 'Looks like you planned' "$test_log" >&2
  rm -f "$test_log"
  echo 'Cluster worker boundary pgTAP plan count is wrong.' >&2
  exit 1
fi
rm -f "$test_log"

echo 'PASS: cluster worker boundary pgTAP contract passed'
