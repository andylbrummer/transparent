/**
 * Where guide video is served from (spec/guides.md §10): the R2 bucket transparent-media on its own domain. Video is
 * too large for the repository and for Cloudflare's 25 MiB static-asset cap, so it is the one media the app fetches
 * from outside its own origin. app/public/_headers names the same origin in its media-src policy; a test holds the two
 * together.
 */
export const MEDIA_ORIGIN = 'https://media.transparent.sbdev.io';
