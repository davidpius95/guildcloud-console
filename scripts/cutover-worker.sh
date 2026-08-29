#!/usr/bin/env bash
# One-command worker cutover: mint a cluster-scoped token and switch a site
# worker from the Supabase service-role key onto it (plan Task 7, slice C).
#
# The whole point is that SUPABASE_JWT_SECRET stays on the machine running this
# script. The token is held in a shell variable, piped to the worker over stdin,
# and never written to disk locally, never passed as a command-line argument
# (which would expose it in the remote process list), and never echoed.
#
# Usage:
#   SUPABASE_JWT_SECRET='...' scripts/cutover-worker.sh \
#     --worker-id guild-b-lxc-500 --host podD --vmid 500 [--expires-in 365d] [--dry-run]
#
#   --host   the Proxmox node hosting the worker LXC, reachable over ssh as root
#   --vmid   the worker container id on that node
#
# Guild-B: --worker-id guild-b-lxc-500 --host podD --vmid 500   (narrower canary)
# Guild-A: --worker-id guild-a-lxc-500-r2 --host nodeD --vmid 500
#
# The worker id must already exist in public.worker_identities and must match the
# WORKER_ID in the worker's env, or the worker refuses to start.
#
# Safety: the env file is backed up, the new config is validated with
# --print-config BEFORE the service is restarted, and the backup is restored
# automatically if --health does not come up.

set -euo pipefail

worker_id=""
host=""
vmid=""
expires_in="365d"
dry_run=0

while [ $# -gt 0 ]; do
  case "$1" in
    --worker-id) worker_id="$2"; shift 2 ;;
    --host) host="$2"; shift 2 ;;
    --vmid) vmid="$2"; shift 2 ;;
    --expires-in) expires_in="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$worker_id" ] && [ -n "$host" ] && [ -n "$vmid" ] || {
  echo "Need --worker-id, --host and --vmid. See --help." >&2; exit 2; }
[ -n "${SUPABASE_JWT_SECRET:-}" ] || {
  echo "SUPABASE_JWT_SECRET is not set." >&2; exit 2; }

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote="root@$host"
env_file=/etc/guildcloud/worker.env
stamp=$(date -u +%Y%m%dT%H%M%SZ)

run_in_ct() { ssh -o BatchMode=yes "$remote" "pct exec $vmid -- sh -c \"$1\""; }

echo "==> Checking the worker is reachable and its WORKER_ID matches"
current_worker_id=$(run_in_ct "grep '^WORKER_ID=' $env_file | cut -d= -f2-")
if [ "$current_worker_id" != "$worker_id" ]; then
  echo "WORKER_ID on the box is '$current_worker_id' but you asked to mint for '$worker_id'." >&2
  echo "assertWorkerToken refuses a mismatch, so fix one or the other first." >&2
  exit 1
fi
echo "    WORKER_ID=$worker_id"

if [ "$dry_run" -eq 1 ]; then
  echo "==> Dry run: would mint a token and rewrite $env_file on $host/$vmid"
  echo "    set CONTROL_PLANE_AUTH_MODE=worker_token, add SUPABASE_WORKER_TOKEN,"
  echo "    remove SUPABASE_SERVICE_ROLE_KEY, restart, then verify --health."
  exit 0
fi

echo "==> Minting (secret stays on this machine; token is never written locally)"
token=$(node "$repo_root/scripts/mint-worker-token.mjs" \
          --worker-id "$worker_id" --expires-in "$expires_in" --print 2>/dev/null)
[ -n "$token" ] || { echo "Minting produced no token." >&2; exit 1; }

echo "==> Backing up $env_file to $env_file.bak-$stamp"
run_in_ct "cp -a $env_file $env_file.bak-$stamp"

# Build the new env remotely from the old one, then validate before activating.
# The token arrives on stdin so it never appears in the remote process list.
echo "==> Staging the new configuration"
printf '%s\n' "$token" | ssh -o BatchMode=yes "$remote" "pct exec $vmid -- sh -c '
  set -e
  token=\$(cat)
  tmp=\$(mktemp)
  grep -v -e \"^SUPABASE_SERVICE_ROLE_KEY=\" \
          -e \"^CONTROL_PLANE_AUTH_MODE=\" \
          -e \"^SUPABASE_WORKER_TOKEN=\" $env_file > \"\$tmp\"
  printf \"CONTROL_PLANE_AUTH_MODE=worker_token\n\" >> \"\$tmp\"
  printf \"SUPABASE_WORKER_TOKEN=%s\n\" \"\$token\" >> \"\$tmp\"
  chmod 600 \"\$tmp\"
  chown root:root \"\$tmp\"
  mv \"\$tmp\" $env_file.staged
'"

echo "==> Validating the staged config before touching the running service"
run_in_ct "cd /opt/guildcloud-worker/current && set -a && . $env_file.staged && set +a && node index.js --print-config >/dev/null" || {
  echo "Staged config failed to parse; nothing was activated." >&2
  run_in_ct "rm -f $env_file.staged"
  exit 1
}

echo "==> Activating and restarting"
run_in_ct "mv $env_file.staged $env_file && systemctl restart guildcloud-worker.timer"

echo "==> Health"
if run_in_ct "cd /opt/guildcloud-worker/current && set -a && . $env_file && set +a && node index.js --health"; then
  echo
  echo "Cutover complete for $worker_id."
  echo "The service-role key is gone from $env_file (backup: $env_file.bak-$stamp)."
  echo "Watch two worker cycles before doing the other cluster, then rotate the key."
else
  echo "Health check failed; restoring the previous env and restarting." >&2
  run_in_ct "cp -a $env_file.bak-$stamp $env_file && systemctl restart guildcloud-worker.timer"
  echo "Rolled back. The worker is on the service-role key again." >&2
  exit 1
fi
