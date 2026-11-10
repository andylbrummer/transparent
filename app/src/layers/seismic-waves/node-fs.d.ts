/**
 * The one Node call the tests here make: reading the baked rays from
 * app/public/geo, so that what is tested is the file the app ships. The
 * project carries no @types/node.
 */
declare module 'node:fs' {
  export function readFileSync(path: URL): Uint8Array;
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}
