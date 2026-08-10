#!/bin/sh
# Self-deploy poller for the Guild-A site worker (vmid 500, this LXC).
#
# Runs on a systemd timer. Pulls the tracked repo (read-only deploy key,
# sparse-checkout of just this directory), and if
# deploy/site-worker-guild-a/index.js differs from the live
# /opt/guildcloud-worker/index.js, copies it in and restarts the service.
#
# This replaces manually pasting worker code changes over a terminal -
# every change now just needs a normal git commit + push to `main`.
set -e

REPO_DIR=/opt/guildcloud-worker/repo
LIVE_FILE=/opt/guildcloud-worker/index.js
TRACKED_FILE="$REPO_DIR/deploy/site-worker-guild-a/index.js"

export GIT_SSH_COMMAND="ssh -i /opt/guildcloud-worker/.ssh/deploy_key -o StrictHostKeyChecking=accept-new"

cd "$REPO_DIR"
git fetch --depth 1 origin main >/tmp/deploy-pull.log 2>&1
git reset --hard origin/main >>/tmp/deploy-pull.log 2>&1

if ! cmp -s "$TRACKED_FILE" "$LIVE_FILE"; then
  cp "$TRACKED_FILE" "$LIVE_FILE"
  systemctl restart guildcloud-worker.timer
  echo "$(date -u +%FT%TZ) deployed new worker version" >> /var/log/guildcloud-worker-deploy.log
fi
