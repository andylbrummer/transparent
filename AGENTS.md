# Transparent Earth

## Exposure

| listener | posture | notes |
|---|---|---|
| Vite dev server (`npm run dev`) | `loopback` | `127.0.0.1:5173`; pass `--host` only for a one-off phone session |
| `transparent.sbdev.io` (beagle-ab) | `public` | Cloudflare tunnel `transparent` → nginx in `deploy/compose.yml`; no host port published |

The public site is a static build with no authentication, by decision: it
serves the same files as the GitHub Pages deploy, holds no user data, and
accepts only GET/HEAD (405 otherwise). Caps live in `deploy/nginx.conf`
(1k body, 10s header/body read, 30s send) and `deploy/compose.yml`
(cpu/memory/pids limits, read-only root).

## Deploy

`deploy/deploy.sh` builds `app/dist`, rsyncs it with the compose files to
`beagle-ab:/home/beagle/work/transparent`, runs `docker compose up -d`, and
checks the live URL. The tunnel credential lives only on beagle-ab at
`/home/beagle/.config/cloudflared/transparent.json` (0600) and is never in
this repo.
