#!/bin/sh
# Warns while there is still time to act on the backup datastore filling up.
#
# On 2026-09-03 this filesystem hit 100% and took instance creation down with
# it, because the guild-snippets NFS export shared it. Snippets have since been
# moved to their own volume, so a full disk here no longer breaks provisioning
# -- but it still breaks every backup, and PBS garbage collection needs free
# space to work with. Nothing watched this either time it filled.
#
# POSIX sh and curl only, deliberately: guild-pbs is a Proxmox Backup Server
# appliance and this must not add a Node or Python dependency to it.
#
# Reported to the same Uptime Kuma push monitor style as the site probes, so
# this going silent is itself an alert.
set -u

MOUNT="${PROBE_MOUNT:-/}"
# 25G of 296G (~8%). PBS GC needs room to rewrite chunk indexes, so the floor is
# deliberately well above "a few hundred MB left".
MIN_FREE_KB="${PROBE_MIN_FREE_KB:-26214400}"

if [ -z "${KUMA_PUSH_URL:-}" ]; then
  echo "KUMA_PUSH_URL is required" >&2
  exit 2
fi

# -P forces one line per filesystem; long device names otherwise wrap and shift
# the columns, which would silently read the wrong field.
line=$(df -Pk "$MOUNT" | tail -1)
total_kb=$(echo "$line" | awk '{print $2}')
free_kb=$(echo "$line" | awk '{print $4}')
used_pct=$(echo "$line" | awk '{print $5}' | tr -d '%')

if [ -z "$free_kb" ] || [ -z "$total_kb" ] || [ "$total_kb" -le 0 ] 2>/dev/null; then
  status=down
  msg="guild-pbs: cannot read capacity for $MOUNT"
else
  free_gb=$((free_kb / 1048576))
  min_free_gb=$((MIN_FREE_KB / 1048576))
  if [ "$free_kb" -lt "$MIN_FREE_KB" ]; then
    status=down
    msg="guild-pbs: backup datastore has ${free_gb}GB free (${used_pct}% used), below the ${min_free_gb}GB floor. Backups and GC will start failing; snippets are on their own volume so creates are unaffected."
  else
    status=up
    msg="guild-pbs: backup datastore ${free_gb}GB free (${used_pct}% used)."
  fi
fi

echo "$msg"
sep='?'
case "$KUMA_PUSH_URL" in *\?*) sep='&' ;; esac
# --get --data-urlencode so a message containing spaces or % cannot break the URL.
curl -fsS --max-time 10 --get \
  --data-urlencode "status=$status" \
  --data-urlencode "msg=$msg" \
  "${KUMA_PUSH_URL}${sep}" >/dev/null || {
    # Same reasoning as the site probe: if the push cannot land, the monitor
    # going stale is the alert. Do not try to be a second alerting channel.
    echo "push failed" >&2
    exit 1
  }
