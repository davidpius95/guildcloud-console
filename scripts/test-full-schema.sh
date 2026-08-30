#!/usr/bin/env bash
# Proves the repository can rebuild its own control-plane database.
#
# Applies the baseline and every tracked migration, in filename order, to an
# empty PostgreSQL 17, then runs the full-schema pgTAP contract against the
# result. Nothing is seeded that a migration should create -- that is the point.
#
# This is the regression test for the 2026-08-29 finding that the migration
# chain failed 29 times out of 42 against an empty database, because Phase 1
# objects existed only in the hosted project. See
# docs/dev-log/2026-08-29-repo-could-not-rebuild-its-own-database.md.
#
# It does NOT replace the faster fixture suites (test:db, test:intents,
# test:worker-boundary). Those ask whether specific RPCs behave; this asks
# whether the repository produces a correct database at all. Run both.
#
# Same disposable-database shape as the other harnesses: no published ports, no
# network, image pinned by digest.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
prelude="$repo_root/supabase/tests/fixtures/full_schema_prelude.sql"
contract="$repo_root/supabase/tests/full_schema_contract.sql"
postgres_image='supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
container_name="guildcloud-full-schema-${RANDOM}-${BASHPID}"
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
# is owned by supabase_admin while this harness connects as postgres. Hosted
# Supabase provides auth.jwt() for real; the prelude only stubs it, which needs
# CREATE on the schema. The baseline's foreign keys also point at auth.users, so
# the contract has to be able to seed users there. Same approach as
# scripts/test-worker-boundary.sh.
docker exec -i "$container_name" psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U supabase_admin -d postgres \
  -c 'grant usage, create on schema auth to postgres;' \
  -c 'grant select, insert, update, delete on auth.users to postgres;' >/dev/null

echo "Harness: isolated container, network=none, ports=none"
echo "Image: $postgres_image"
echo "  Applying prelude (pgTAP, auth.jwt shim, operator Vault stubs -- no tables)"
"${psql_cmd[@]}" < "$prelude" >/dev/null

# Every migration, in filename order, exactly as `supabase db push` would.
# A failure here IS the test failing: it means the repository cannot build its
# own schema, which is precisely the regression this suite exists to catch.
migration_count=0
echo "  Applying every migration in filename order"
for migration in "$repo_root"/supabase/migrations/*.sql; do
  if ! "${psql_cmd[@]}" < "$migration" >/dev/null 2>"${TMPDIR:-/tmp}/full-schema-migration.err"; then
    echo >&2
    echo "FAIL: $(basename "$migration") could not be applied to a database built only from this repository." >&2
    echo >&2
    sed 's/^/    /' "${TMPDIR:-/tmp}/full-schema-migration.err" >&2
    echo >&2
    echo "This usually means the migration depends on an object that exists in production but" >&2
    echo "is not created by any tracked migration. Add the missing object as a forward" >&2
    echo "migration; do not regenerate the baseline from the current production shape." >&2
    exit 1
  fi
  migration_count=$((migration_count + 1))
done
echo "  Applied $migration_count migrations cleanly"

echo "  Running full-schema pgTAP contract"
test_log="$(mktemp "${TMPDIR:-/tmp}/guildcloud-full-schema.XXXXXX.log")"
if ! "${psql_cmd[@]}" < "$contract" | tee "$test_log"; then
  rm -f "$test_log"
  exit 1
fi

if grep -Eq '(^|[[:space:]])not ok [0-9]+ -' "$test_log"; then
  rm -f "$test_log"
  echo 'Full-schema pgTAP contract failed.' >&2
  exit 1
fi

assertions=$(grep -cE '(^|[[:space:]])ok [0-9]+ -' "$test_log" || true)
rm -f "$test_log"

echo "PASS: $migration_count migrations applied from empty, $assertions full-schema pgTAP assertions passed"
