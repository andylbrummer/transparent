#!/usr/bin/env bash
# Build the app and ship it to beagle-ab, where deploy/compose.yml serves it
# at transparent.sbdev.io through a Cloudflare tunnel.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
host="beagle-ab"
remote_dir="/home/beagle/work/transparent"

tman run -- npm --prefix "$repo" run build

ssh "$host" "mkdir -p $remote_dir/dist"
rsync -a --delete "$repo/app/dist/" "$host:$remote_dir/dist/"
rsync -a "$repo/deploy/compose.yml" "$repo/deploy/nginx.conf" \
  "$repo/deploy/cloudflared-config.yml" "$host:$remote_dir/"
ssh "$host" "docker compose -f $remote_dir/compose.yml up -d --remove-orphans"

# A freshly started tunnel answers 530 for a few seconds until its edge
# connections register, so retry briefly before calling the deploy failed.
curl -fsS -o /dev/null --retry 10 --retry-delay 2 --retry-all-errors \
  -w 'https://transparent.sbdev.io/ -> %{http_code}\n' https://transparent.sbdev.io/
