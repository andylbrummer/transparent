/**
 * The one Node call cloud.test.ts needs, to read the baked binary file:
 * the app does not otherwise depend on Node's type declarations.
 */
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
