#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$repo_root/supabase/tests/fixtures/instance_intents_base.sql"
test_sql="$repo_root/supabase/tests/instance_intents.sql"
postgres_image='supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
container_name="guildcloud-intents-${RANDOM}-${BASHPID}"
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
"${psql_cmd[@]}" < "$fixture" >/dev/null

for migration in \
  "$repo_root/supabase/migrations/20260829100000_repair_rls_helper_grants.sql" \
  "$repo_root/supabase/migrations/20260829110000_add_atomic_instance_intents.sql"
do
  [[ -f "$migration" ]] && "${psql_cmd[@]}" < "$migration" >/dev/null
done

test_log="$(mktemp "${TMPDIR:-/tmp}/guildcloud-intents.XXXXXX.log")"
if ! "${psql_cmd[@]}" < "$test_sql" | tee "$test_log"; then
  rm -f "$test_log"
  exit 1
fi
if grep -Eq '(^|[[:space:]])not ok [0-9]+ -' "$test_log"; then
  rm -f "$test_log"
  echo 'Instance-intent pgTAP contract failed.' >&2
  exit 1
fi
rm -f "$test_log"

first_log="$(mktemp "${TMPDIR:-/tmp}/guildcloud-intent-first.XXXXXX.log")"
second_log="$(mktemp "${TMPDIR:-/tmp}/guildcloud-intent-second.XXXXXX.log")"

(
  "${psql_cmd[@]}" >"$first_log" 2>&1 <<'SQL'
begin;
set local role authenticated;
set local "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';
select public.request_instance_snapshot(
  '40000000-0000-4000-8000-000000000001', 'concurrency-snapshot', 'concurrency-snapshot-key'
);
select pg_sleep(1);
commit;
SQL
) &
first_pid=$!

sleep 0.1
set +e
"${psql_cmd[@]}" >"$second_log" 2>&1 <<'SQL'
set role authenticated;
set "request.jwt.claim.sub" = '20000000-0000-4000-8000-000000000001';
select public.request_instance_resize(
  '40000000-0000-4000-8000-000000000001', 'std-2', 'concurrency-resize-key'
);
SQL
second_exit=$?
set -e
wait "$first_pid"

if [[ "$second_exit" -eq 0 ]] || ! grep -q 'instance is busy' "$second_log"; then
  echo 'Concurrent lifecycle request was not rejected as busy.' >&2
  cat "$first_log" "$second_log" >&2
  rm -f "$first_log" "$second_log"
  exit 1
fi

active_count="$("${psql_cmd[@]}" -Atqc \
  "select count(*) from public.operations where instance_id = '40000000-0000-4000-8000-000000000001' and state in ('pending','running')")"
rm -f "$first_log" "$second_log"
if [[ "$active_count" != "1" ]]; then
  echo "Expected one active operation after concurrent requests, found $active_count." >&2
  exit 1
fi

echo 'PASS: 43 instance-intent pgTAP assertions passed'
echo 'PASS: concurrent lifecycle requests serialize to one active operation'
