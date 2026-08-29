#!/usr/bin/env bash
# One-command worker cutover: mint a cluster-scoped token and switch a site
# worker from the Supabase service-role key onto it (plan Task 7, slice C).
#
# The whole point is that the signing material stays on the machine running this
# script. The token is held in a shell variable, piped to the worker over stdin,
# and never written to disk locally, never passed as a command-line argument
# (which would expose it in the remote process list), and never echoed.
#
# Usage (preferred -- ES256 with a key you control):
#   scripts/cutover-worker.sh --signing-key-file ./signing-key.json \
#     --worker-id guild-b-lxc-500 --host podD --vmid 500 [--expires-in 365d] [--dry-run]
#
# Usage (legacy HS256 -- tokens die when the legacy JWT secret is revoked):
#   SUPABASE_JWT_SECRET='...' scripts/cutover-worker.sh \
#     --worker-id guild-b-lxc-500 --host podD --vmid 500
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
# --print-config before the service is restarted, and the backup is restored
# automatically if either validation or --health fails. Writing the env file does
# not affect the running worker -- systemd only reads it on the next start.

set -euo pipefail

worker_id=""
host=""
vmid=""
expires_in="365d"
signing_key_file=""
dry_run=0
# The `apikey` header must carry a real API key. A minted JWT is rejected there
# with "Invalid API key" before JWT verification even runs, so the token alone is
# not enough. Publishable keys are public by design, so defaulting to one here is
# safe; override with --api-key if the project's changes.
api_key="sb_publishable_t_WWRLE-RXN8Lu7Pc8-0Cw_HgHE2OGY"

while [ $# -gt 0 ]; do
  case "$1" in
    --worker-id) worker_id="$2"; shift 2 ;;
    --host) host="$2"; shift 2 ;;
    --vmid) vmid="$2"; shift 2 ;;
    --expires-in) expires_in="$2"; shift 2 ;;
    --signing-key-file) signing_key_file="$2"; shift 2 ;;
    --api-key) api_key="$2"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$worker_id" ] && [ -n "$host" ] && [ -n "$vmid" ] || {
  echo "Need --worker-id, --host and --vmid. See --help." >&2; exit 2; }
if [ -n "$signing_key_file" ]; then
  [ -r "$signing_key_file" ] || {
    echo "Cannot read signing key file: $signing_key_file" >&2; exit 2; }
  mint_args=(--signing-key-file "$signing_key_file")
elif [ -n "${SUPABASE_JWT_SECRET:-}" ]; then
  # HS256. These tokens stop working the moment the legacy JWT secret is
  # revoked, which is the direction this project is moving in.
  echo "WARNING: minting HS256 against the legacy JWT secret. Prefer --signing-key-file." >&2
  mint_args=()
else
  echo "Need --signing-key-file (preferred) or SUPABASE_JWT_SECRET." >&2; exit 2
fi

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

echo "==> Minting (signing key stays on this machine; token is never written locally)"
token=$(node "$repo_root/scripts/mint-worker-token.mjs" \
          --worker-id "$worker_id" --expires-in "$expires_in" \
          ${mint_args[@]+"${mint_args[@]}"} --print 2>/dev/null)
[ -n "$token" ] || { echo "Minting produced no token." >&2; exit 1; }

echo "==> Backing up $env_file to $env_file.bak-$stamp"
run_in_ct "cp -a $env_file $env_file.bak-$stamp"

# Build the new env remotely from the old one. The token arrives on stdin so it
# never appears in the remote process list.
echo "==> Staging the new configuration"
printf '%s\n' "$token" | ssh -o BatchMode=yes "$remote" "pct exec $vmid -- sh -c '
  set -e
  token=\$(cat)
  tmp=\$(mktemp)
  grep -v -e \"^SUPABASE_SERVICE_ROLE_KEY=\" \
          -e \"^CONTROL_PLANE_AUTH_MODE=\" \
          -e \"^SUPABASE_PUBLISHABLE_KEY=\" \
          -e \"^SUPABASE_WORKER_TOKEN=\" $env_file > \"\$tmp\"
  printf \"CONTROL_PLANE_AUTH_MODE=worker_token\n\" >> \"\$tmp\"
  printf \"SUPABASE_PUBLISHABLE_KEY=%s\n\" \"$api_key\" >> \"\$tmp\"
  printf \"SUPABASE_WORKER_TOKEN=%s\n\" \"\$token\" >> \"\$tmp\"
  chmod 600 \"\$tmp\"
  chown root:root \"\$tmp\"
  mv \"\$tmp\" $env_file.staged
'"

# The config must be validated with the new file IN PLACE, not sourced alongside
# the old one. index.js re-reads $env_file itself and fills in anything the
# sourced environment left unset -- so with the old file still present it picks
# SUPABASE_SERVICE_ROLE_KEY back up and trips the guard that refuses to run with
# both credentials. Validating a staged copy could therefore never pass.
#
# Writing the file is safe on its own: systemd only reads it when the service
# next starts, so the running worker is unaffected until the restart below.
echo "==> Activating the new configuration"
run_in_ct "mv $env_file.staged $env_file"

echo "==> Validating it parses"
run_in_ct "cd /opt/guildcloud-worker/current && node index.js --print-config >/dev/null" || {
  echo "New config failed to parse; restoring the previous env." >&2
  run_in_ct "cp -a $env_file.bak-$stamp $env_file"
  exit 1
}

echo "==> Restarting"
run_in_ct "systemctl restart guildcloud-worker.timer"

echo "==> Health"
if run_in_ct "cd /opt/guildcloud-worker/current && set -a && . $env_file && set +a && node index.js --health"; then
  echo
  echo "Cutover complete for $worker_id."
  echo "The service-role key is gone from $env_file (backup: $env_file.bak-$stamp)."
  echo "Watch two worker cycles before doing the other cluster."
  echo "Do NOT rotate signing keys -- the standby key already verifies (runbook step 0)."
  echo "Retiring service_role is runbook step 7; it is a deactivation, not a rotation."
else
  echo "Health check failed; restoring the previous env and restarting." >&2
  run_in_ct "cp -a $env_file.bak-$stamp $env_file && systemctl restart guildcloud-worker.timer"
  echo "Rolled back. The worker is on the service-role key again." >&2
  exit 1
fi
