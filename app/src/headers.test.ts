import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MEDIA_ORIGIN } from './guides/media-origin';

/** public/_headers as rules: each path pattern and its headers, in order, comments dropped. */
function readHeaders(text: string): { path: string; headers: [name: string, value: string][] }[] {
  const rules: { path: string; headers: [string, string][] }[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), headers: [] });
      continue;
    }
    const colon = line.indexOf(':');
    rules[rules.length - 1].headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return rules;
}

const RULES = readHeaders(readFileSync('public/_headers', 'utf8'));
const policies = RULES.flatMap((rule) => rule.headers.filter(([name]) => name === 'content-security-policy').map(([, value]) => ({ path: rule.path, value })));

describe('the headers the site is served with', () => {
  it('lets audio and video come only from the site, its blob: URLs and the media origin', () => {
    // blob: because narration plays from a fetched blob; the media origin is guide video on R2 (spec/guides.md §10.3).
    expect(policies).toEqual([{ path: '/*', value: `media-src 'self' blob: ${MEDIA_ORIGIN}` }]);
  });

  it('restricts nothing else: a directive added by mistake would break the layers fetching from other hosts', () => {
    const directives = policies[0].value.split(';').map((directive) => directive.trim().split(/\s+/)[0]);
    expect(directives).toEqual(['media-src']);
  });

  it('names the media origin as https and with no path, as a policy source and a URL prefix both need', () => {
    expect(new URL(MEDIA_ORIGIN).origin).toBe(MEDIA_ORIGIN);
    expect(MEDIA_ORIGIN.startsWith('https://')).toBe(true);
  });
});
