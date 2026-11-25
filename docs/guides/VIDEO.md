# Guide video: the owner's steps

Video clips are code-complete: the schema, the validator, the player, the
`media-src` policy in `app/public/_headers`, and the `guides:put-video` and
`guides:check-media` scripts. Nothing is hosted yet. The bucket, its domain,
its CORS and the token's permission are left for the owner, by decision
(spec/guides.md §10, Q10). Until they exist, no guide can ship a video: a
declared `src` would point at a host that does not answer.

## 1. The bucket

In the Cloudflare dashboard, R2 → Create bucket:

- Name: `transparent-media`
- Location: automatic. Default storage class.

## 2. The domain

Bucket → Settings → Custom Domains → Connect domain:
`media.transparent.sbdev.io`. Cloudflare adds the DNS record in the
`sbdev.io` zone. Leave the `r2.dev` public URL off; the guides only use the
custom domain, and `MEDIA_ORIGIN` (`app/src/guides/media-origin.ts`) names it.
If the domain changes, change `MEDIA_ORIGIN` and `_headers` together; a test
holds them equal.

## 3. CORS

Bucket → Settings → CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://transparent.sbdev.io", "https://andylbrummer.github.io"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 86400
  }
]
```

This is not optional. The player sets `crossOrigin = 'anonymous'` on its
video, so the same element can be drawn as a texture in Cardboard. A
cross-origin video with that attribute and no `Access-Control-Allow-Origin`
does not load at all, on the phone or the desktop. For a local check, add
`http://127.0.0.1:5173` for the session and take it out again.

## 4. The token

The `cloudflare` devkey token has Workers Scripts edit. Add
**Account → Workers R2 Storage → Edit** (object write) to the same token,
or `wrangler r2 object put` will answer 403.

## 5. AGENTS.md

Add the listener to the exposure table in the same commit as the first video
(spec/guides.md §10.2):

| listener | posture | notes |
|---|---|---|
| `media.transparent.sbdev.io` (R2 bucket `transparent-media`) | `public` | static objects, GET/HEAD only, no auth by decision: it holds only published guide video |

## Uploading a video

The file must be H.264 video with AAC sound in an .mp4, at most 1080p either
way up and 200 MiB. Put its captions (`.vtt`) and a poster image in the
guide's folder, as for any clip.

```sh
# Prints the clip's src and video block; uploads nothing; needs no configuration.
npm run guides:put-video -- --dry-run <guide id> path/to/film.mp4

# Uploads, then prints the same block.
TRANSPARENT_MEDIA_BUCKET=transparent-media npm run guides:put-video -- <guide id> path/to/film.mp4
```

Use `media` in place of a guide id for a film in the media layer
(`app/public/media/hotspots.json`). The script refuses to upload unless
`TRANSPARENT_MEDIA_BUCKET` is set; it runs
`devkey run cloudflare -- npx wrangler r2 object put` with a year's immutable
cache, since a changed film gets a new name. Paste the printed block into the
clip and add `kind`, `captions`, `poster` and `credit`.

A contributor without the token uses `--dry-run` and opens the pull request
with the block; a maintainer uploads the same file before merging. The name
carries the hash, so a different file cannot land under it.

## Checking

```sh
npm run guides:check-media
```

For every declared video it sends a HEAD from each site's origin and checks
the status, length, `video/mp4` and the CORS answer, then fetches the file and
checks its sha256. It needs the network, so it is not part of `npm test`. Run
it after an upload and before a release that adds or changes a video.
