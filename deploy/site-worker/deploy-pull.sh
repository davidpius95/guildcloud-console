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
DEPLOY_LOG=/var/log/guildcloud-worker-deploy.log

# Which remote to pull from, and how to authenticate to it. Guild-A uses a
# read-only SSH deploy key, which is why that is the default. Guild-B has no
# deploy key: the repository is public, so it pulls over anonymous HTTPS and sets
# GUILDCLOUD_REPO_URL in its systemd unit instead. Keeping this configurable is
# what lets both clusters run this identical script rather than drifting into two
# hand-maintained copies -- which is how Guild-B ended up with no deploy
# mechanism at all.
#
# If the repository is ever made private, the HTTPS path stops working and that
# cluster needs a deploy key like Guild-A's.
REPO_URL="${GUILDCLOUD_REPO_URL:-git@github.com:davidpius95/guildcloud-console.git}"

case "$REPO_URL" in
  git@*|ssh://*)
    export GIT_SSH_COMMAND="ssh -i /opt/guildcloud-worker/.ssh/deploy_key -o StrictHostKeyChecking=accept-new"
    ;;
esac

cd "$REPO_DIR"
# Real bug found live on the Guild-A predecessor of this script: something
# rewrote origin to an HTTPS URL at some point, which silently broke every
# deploy for ~3 days (git fetch fails, `set -e` exits the script early,
# nothing else runs) - no alerting caught it, only a manual journalctl check
# did. Self-heal the remote on every run rather than trust it stays SSH.
git remote set-url origin "$REPO_URL"
git fetch --depth 1 origin main >/tmp/deploy-pull.log 2>&1
git reset --hard origin/main >>/tmp/deploy-pull.log 2>&1

checksum=$(find "$TRACKED_DIR" -type f -name '*.js' -print0 | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}')
commit_sha=$(git rev-parse HEAD)
previous_checksum=""
[ -f "$STATE_FILE" ] && previous_checksum=$(cat "$STATE_FILE")

if [ "$checksum" = "$previous_checksum" ]; then
  exit 0
fi

release_dir="$RELEASES_DIR/$(date -u +%Y%m%dT%H%M%SZ)"
previous_release=$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)
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
(cd "$release_dir" && npm test >>/tmp/deploy-pull.log 2>&1) || {
  echo "$(date -u +%FT%TZ) REJECTED commit=$commit_sha checksum=$checksum release=$release_dir reason=tests" >> "$DEPLOY_LOG"
  rm -rf "$release_dir"
  exit 1
}

cat > "$release_dir/release-metadata.json" <<EOF
{"commit":"$commit_sha","checksum":"$checksum","installed_at":"$(date -u +%FT%TZ)","rollback_target":"$previous_release"}
EOF

# Activation window: how long a new release has to come up and report healthy
# before it is treated as a bad deploy. Bounded deliberately - an unbounded wait
# leaves a broken release live while the script hangs.
HEALTH_TIMEOUT_SECONDS=${HEALTH_TIMEOUT_SECONDS:-60}

roll_back() {
  local reason="$1"
  if [ -n "$previous_release" ] && [ -d "$previous_release" ]; then
    ln -sfn "$previous_release" "$CURRENT_LINK.rollback"
    mv -Tf "$CURRENT_LINK.rollback" "$CURRENT_LINK"
    systemctl restart guildcloud-worker.timer || true
    echo "$(date -u +%FT%TZ) ROLLED_BACK reason=$reason commit=$commit_sha checksum=$checksum failed_release=$release_dir rollback_target=$previous_release" >> "$DEPLOY_LOG"
  else
    echo "$(date -u +%FT%TZ) FAILED_NO_ROLLBACK reason=$reason commit=$commit_sha checksum=$checksum release=$release_dir" >> "$DEPLOY_LOG"
  fi
  exit 1
}

ln -sfn "$release_dir" "$CURRENT_LINK.new"
mv -Tf "$CURRENT_LINK.new" "$CURRENT_LINK"
if ! systemctl restart guildcloud-worker.timer || ! systemctl start guildcloud-worker.service; then
  roll_back startup
fi

# A release that starts but cannot identify itself to the control plane is not a
# healthy release: in worker_token mode `--health` fails when the token is
# missing, malformed, expired, or issued for a different worker, all of which
# would otherwise surface as a silently idle cluster.
health_deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
health_ok=0
while [ "$(date +%s)" -lt "$health_deadline" ]; do
  if (cd "$CURRENT_LINK" && node index.js --health >>/tmp/deploy-pull.log 2>&1); then
    health_ok=1
    break
  fi
  sleep 5
done
[ "$health_ok" -eq 1 ] || roll_back health
echo "$checksum" > "$STATE_FILE"
echo "$(date -u +%FT%TZ) DEPLOYED commit=$commit_sha checksum=$checksum release=$release_dir rollback_target=$previous_release" >> "$DEPLOY_LOG"

# Keep the current release plus the four before it; anything older is a
# fully superseded, already-proven-bad-or-obsolete release with no reason
# to keep consuming disk.
ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf
