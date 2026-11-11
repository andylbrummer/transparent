#!/usr/bin/env bash
# Keeps transparent.sbdev.io on the latest main. Runs on beagle-ab from the
# systemd user timer in deploy/systemd/ (installed by install-auto-deploy.sh).
#
# GitHub cannot reach beagle-ab (it is only reachable outward, through the
# Cloudflare tunnel), and a self-hosted runner on a public repository would
# let fork pull requests run code here. So the box pulls instead: when main
# moves and the CI workflow has passed for that commit, it builds the commit
# in a throwaway Node container and swaps the result into the directory
# nginx serves. The repository is public, so no credential is needed.
set -euo pipefail

repo_url="https://github.com/andylbrummer/transparent.git"
api="https://api.github.com/repos/andylbrummer/transparent"
site="https://transparent.sbdev.io/"
root="/home/beagle/work/transparent"
src="$root/src"
deployed="$root/deployed-sha"
skipped="$root/skipped-sha"
# Node of the CI and GitHub Pages builds.
node_image="node:20-bookworm-slim"

exec 9>"$root/.deploy.lock"
flock -n 9 || exit 0

sha="$(git ls-remote "$repo_url" refs/heads/main | cut -f1)"
[ -n "$sha" ] || { echo "could not read main from $repo_url" >&2; exit 1; }
[ "$sha" = "$(cat "$deployed" 2>/dev/null)" ] && exit 0
[ "$sha" = "$(cat "$skipped" 2>/dev/null)" ] && exit 0

# Deploy only what CI passed, as GitHub Pages does.
ci="$(curl -fsS -H 'Accept: application/vnd.github+json' "$api/actions/runs?head_sha=$sha&event=push" \
  | jq -r '[.workflow_runs[] | select(.name == "CI")][0] | "\(.status) \(.conclusion)"')"
case "$ci" in
  "completed success") ;;
  "completed "*)
    echo "CI did not pass for $sha ($ci); not deploying it"
    echo "$sha" > "$skipped"
    exit 0 ;;
  *)
    echo "waiting for CI on $sha ($ci)"
    exit 0 ;;
esac

echo "deploying $sha"
if [ ! -d "$src/.git" ]; then
  git clone -q --filter=blob:none --no-checkout "$repo_url" "$src"
fi
git -C "$src" fetch -q origin "$sha"
git -C "$src" -c advice.detachedHead=false checkout -q --force "$sha"
git -C "$src" clean -qfdx

# Capped: beagle-ab also runs the agents. npm's cache persists between runs.
mkdir -p "$root/.npm-cache"
docker run --rm --user "$(id -u):$(id -g)" --cpus 2 --memory 3g \
  -e HOME=/tmp -e npm_config_cache=/npm-cache \
  -v "$src:/src" -v "$root/.npm-cache:/npm-cache" -w /src \
  "$node_image" sh -c 'npm ci --no-audit --no-fund && npm run build'

# The compose files travel with the commit; restart only when they changed.
restart=0
for f in compose.yml nginx.conf cloudflared-config.yml; do
  if ! cmp -s "$src/deploy/$f" "$root/$f"; then
    cp "$src/deploy/$f" "$root/$f"
    restart=1
  fi
done

# Files land together at the end, and old ones go after, so a reader mid-swap
# never meets a page whose scripts are missing.
rsync -a --delete-delay --delay-updates "$src/app/dist/" "$root/dist/"
if [ "$restart" = 1 ]; then
  docker compose -f "$root/compose.yml" up -d --remove-orphans
fi

curl -fsS -o /dev/null --retry 10 --retry-delay 2 --retry-all-errors -w "$site -> %{http_code}\n" "$site"
echo "$sha" > "$deployed"
echo "deployed $sha"
