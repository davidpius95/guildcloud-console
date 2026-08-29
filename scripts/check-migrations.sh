#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

duplicate_timestamps=$(find supabase/migrations -maxdepth 1 -type f -name '*.sql' -exec basename {} \; |
  sed -E 's/^([0-9]+).*/\1/' | sort | uniq -d)
if [[ -n "$duplicate_timestamps" ]]; then
  echo "Duplicate migration timestamps: $duplicate_timestamps" >&2
  exit 1
fi

if rg -n -i 'create\s+(unique\s+)?index\s+concurrently|drop\s+index\s+concurrently' supabase/migrations; then
  echo "CONCURRENTLY is not permitted in transactional Supabase migrations." >&2
  exit 1
fi

changed_migrations=()
if [[ $# -eq 2 ]]; then
  while IFS= read -r migration_file; do changed_migrations+=("$migration_file"); done < <(
    git diff --name-only "$1" "$2" -- 'supabase/migrations/*.sql'
  )
else
  while IFS= read -r migration_file; do changed_migrations+=("$migration_file"); done < <(
    git diff --name-only --diff-filter=ACMR HEAD -- 'supabase/migrations/*.sql'
    git ls-files --others --exclude-standard 'supabase/migrations/*.sql'
  )
fi

for migration_file in "${changed_migrations[@]}"; do
  [[ -f "$migration_file" ]] || continue
  if rg -qi 'security\s+definer' "$migration_file"; then
    rg -qi 'set\s+search_path' "$migration_file" || { echo "$migration_file: SECURITY DEFINER missing search_path" >&2; exit 1; }
    rg -qi 'revoke\s+execute' "$migration_file" || { echo "$migration_file: SECURITY DEFINER missing REVOKE EXECUTE" >&2; exit 1; }
    rg -qi 'grant\s+execute' "$migration_file" || { echo "$migration_file: SECURITY DEFINER missing GRANT EXECUTE" >&2; exit 1; }
  fi
done

echo "Migration safety checks passed."
