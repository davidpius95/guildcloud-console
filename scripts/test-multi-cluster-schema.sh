#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_path="$repo_root/supabase/tests/fixtures/multi_cluster_base.sql"
migration_path="$repo_root/supabase/migrations/20260818090000_add_multi_cluster_placement.sql"
test_path="$repo_root/supabase/tests/multi_cluster_placement_schema.sql"
postgres_image='supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
container_name="guildcloud-task2b-${RANDOM}-${BASHPID}"
log_file="$(mktemp "${TMPDIR:-/tmp}/guildcloud-task2b.XXXXXX.log")"
container_started=0
phase='startup'

cleanup() {
  local exit_code=$?

  trap - EXIT INT TERM
  if [[ "$container_started" -eq 1 ]]; then
    docker rm -f "$container_name" >/dev/null 2>&1 || true
  fi

  if [[ "$exit_code" -ne 0 ]]; then
    printf 'Harness failed during %s. Last output:\n' "$phase" >&2
    tail -n 80 "$log_file" >&2 || true
  fi

  rm -f "$log_file"
  exit "$exit_code"
}
trap cleanup EXIT INT TERM
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

for required_file in "$fixture_path" "$migration_path" "$test_path"; do
  if [[ ! -f "$required_file" ]]; then
    fail "Missing required schema test file: $required_file"
  fi
done

if ! docker info >/dev/null 2>&1; then
  fail "Docker daemon is required for the isolated PostgreSQL 17 schema test."
fi

if ! docker image inspect "$postgres_image" >/dev/null 2>&1; then
  phase='pulling pinned database image'
  printf 'Preparing pinned database image...\n'
  if ! docker pull "$postgres_image" >>"$log_file" 2>&1; then
    fail "Could not pull pinned database image $postgres_image"
  fi
fi

image_id="$(docker image inspect --format '{{.Id}}' "$postgres_image")"
printf 'Harness: isolated container, network=none, ports=none\n'
printf 'Image: %s (%s)\n' "$postgres_image" "$image_id"

phase='starting isolated database'
if ! docker run --detach --rm --pull=never \
  --network none \
  --name "$container_name" \
  -e POSTGRES_PASSWORD=postgres \
  "$postgres_image" >>"$log_file" 2>&1; then
  fail "Could not start the isolated database container"
fi
container_started=1

phase='waiting for isolated database'
for attempt in {1..60}; do
  if docker exec "$container_name" \
      pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 60 ]]; then
    docker logs "$container_name" >>"$log_file" 2>&1 || true
    fail "Disposable PostgreSQL did not become ready after 60 seconds"
  fi
  sleep 1
done

psql_in_container() {
  docker exec -i "$container_name" \
    psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres "$@"
}

phase='verifying PostgreSQL version'
server_version="$(psql_in_container -Atqc 'show server_version_num' 2>>"$log_file")" || \
  fail 'Could not query the isolated database version'
if [[ "$server_version" != 17* ]]; then
  fail "Pinned database image is not PostgreSQL 17 (reported $server_version)"
fi

run_sql_file() {
  local label=$1
  local path=$2

  phase="$label"
  printf '  %s\n' "$label"
  if ! psql_in_container < "$path" >>"$log_file" 2>&1; then
    fail "$label failed"
  fi
}

run_sql_file 'Applying isolated fixture' "$fixture_path"
run_sql_file 'Applying real production migration' "$migration_path"
run_sql_file 'Running real pgTAP contract' "$test_path"

assertion_count="$(awk '$1 == "ok" && $2 ~ /^[0-9]+$/ {count++} END {print count + 0}' "$log_file")"
failure_count="$(awk '$1 == "not" && $2 == "ok" {count++} END {print count + 0}' "$log_file")"
if [[ "$assertion_count" -ne 151 || "$failure_count" -ne 0 ]]; then
  fail "Expected 151 passing pgTAP assertions, got $assertion_count passing and $failure_count failing"
fi

printf 'PASS: 151 pgTAP assertions passed in the isolated database\n'
