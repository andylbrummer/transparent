# Transparent Earth

## Exposure

| listener | posture | notes |
|---|---|---|
| Vite dev server (`npm run dev`) | `loopback` | `127.0.0.1:5173`; pass `--host` only for a one-off phone session |
| `transparent.sbdev.io` (Cloudflare Worker `transparent`) | `public` | static assets only (`wrangler.jsonc`), no Worker code |

The public site is a static build with no authentication, by decision: it
serves the same files as the GitHub Pages deploy and holds no user data.
Cloudflare answers only GET/HEAD for an assets-only Worker (POST is 405,
checked on 2026-11-11). Headers live in `app/public/_headers`.

## Deploy

A push to `main` deploys both sites. GitHub Pages builds in Actions
(`.github/workflows/deploy.yml`). transparent.sbdev.io is a Cloudflare Worker
serving `app/dist` as static assets, deployed by Cloudflare Workers Builds
from this repository with the build command
`npm ci && npm run lint && npm run typecheck && npm test && npm run build`
and the deploy command `npx wrangler deploy`. No Cloudflare token is stored
in GitHub.

Manual deploy, from a workstation holding the `cloudflare` devkey grant:
`npm run build && devkey run cloudflare -- npx wrangler deploy`. The token
needs Workers Scripts edit. The custom domain is attached to the Worker
once, outside `wrangler.jsonc` (`PUT /accounts/{account}/workers/domains`):
the devkey token lacks Workers Routes, which a `routes` entry would need on
every deploy.

The site moved off beagle-ab on 2026-11-11: its auto-deploy timer is
disabled and its containers are down.
