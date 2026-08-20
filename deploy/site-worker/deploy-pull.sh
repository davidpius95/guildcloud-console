#!/bin/sh
# Self-deploy poller, generic across clusters - one copy of this script runs
# on every Guild-* worker LXC. Runs on a systemd timer
# (guildcloud-worker-deploy.timer, every 2 minutes). Pulls the tracked repo
# (read-only deploy key, sparse-checkout of deploy/site-worker/), and if the
# tracked directory differs from the currently live release, stages,
# validates, and atomically swaps to it.
#
# This replaces manually pasting worker code changes over a terminal - every
# change now just needs a normal git commit + push to `main`.
#
# Unlike the single-file predecessor this replaces (deploy/site-worker-guild-a
# /deploy-pull.sh), the tracked unit is now a whole directory
# (config.js/routing.js/health-snapshot.js/index.js), so a plain `cmp -s` on
# one file no longer proves anything changed or didn't - this stages every
# release into its own timestamped directory, checks each .js file parses
# with `node --check` before going anywhere near the live symlink, and keeps
# the previous release on disk so a bad deploy has a same-script rollback.
set -e

REPO_DIR=/opt/guildcloud-worker/repo
TRACKED_DIR="$REPO_DIR/deploy/site-worker"
RELEASES_DIR=/opt/guildcloud-worker/releases
CURRENT_LINK=/opt/guildcloud-worker/current
STATE_FILE=/opt/guildcloud-worker/.deployed-checksum

export GIT_SSH_COMMAND="ssh -i /opt/guildcloud-worker/.ssh/deploy_key -o StrictHostKeyChecking=accept-new"

cd "$REPO_DIR"
# Real bug found live on the Guild-A predecessor of this script: something
# rewrote origin to an HTTPS URL at some point, which silently broke every
# deploy for ~3 days (git fetch fails, `set -e` exits the script early,
# nothing else runs) - no alerting caught it, only a manual journalctl check
# did. Self-heal the remote on every run rather than trust it stays SSH.
git remote set-url origin git@github.com:davidpius95/guildcloud-console.git
git fetch --depth 1 origin main >/tmp/deploy-pull.log 2>&1
git reset --hard origin/main >>/tmp/deploy-pull.log 2>&1

checksum=$(find "$TRACKED_DIR" -type f -name '*.js' -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')
previous_checksum=""
[ -f "$STATE_FILE" ] && previous_checksum=$(cat "$STATE_FILE")

if [ "$checksum" = "$previous_checksum" ]; then
  exit 0
fi

release_dir="$RELEASES_DIR/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$release_dir"
cp -a "$TRACKED_DIR"/. "$release_dir"/

for js_file in "$release_dir"/*.js; do
  if ! node --check "$js_file" >>/tmp/deploy-pull.log 2>&1; then
    echo "$(date -u +%FT%TZ) REJECTED release $release_dir: $js_file failed node --check" >> /var/log/guildcloud-worker-deploy.log
    rm -rf "$release_dir"
    exit 1
  fi
done

(cd "$release_dir" && npm install --omit=dev --no-audit --no-fund >>/tmp/deploy-pull.log 2>&1)

ln -sfn "$release_dir" "$CURRENT_LINK.new"
mv -Tf "$CURRENT_LINK.new" "$CURRENT_LINK"
echo "$checksum" > "$STATE_FILE"
systemctl restart guildcloud-worker.timer
echo "$(date -u +%FT%TZ) deployed $release_dir" >> /var/log/guildcloud-worker-deploy.log

# Keep the current release plus the four before it; anything older is a
# fully superseded, already-proven-bad-or-obsolete release with no reason
# to keep consuming disk.
ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
