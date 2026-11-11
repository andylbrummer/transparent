#!/usr/bin/env bash
# Install (or update) the automatic deploy of transparent.sbdev.io on
# beagle-ab: copies auto-deploy.sh and the systemd user units, and starts the
# timer. Run from any machine with ssh to beagle-ab; run again after changing
# either file. Watch it with:
#   ssh beagle-ab 'journalctl --user -u transparent-deploy -f'
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
host="beagle-ab"
remote_dir="/home/beagle/work/transparent"

ssh "$host" "mkdir -p $remote_dir ~/.config/systemd/user"
rsync -a "$repo/deploy/auto-deploy.sh" "$host:$remote_dir/"
rsync -a "$repo/deploy/systemd/transparent-deploy.service" "$repo/deploy/systemd/transparent-deploy.timer" \
  "$host:.config/systemd/user/"
ssh "$host" 'systemctl --user daemon-reload && systemctl --user enable --now transparent-deploy.timer && systemctl --user list-timers transparent-deploy.timer --no-pager'
