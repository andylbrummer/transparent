import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

interface Image {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
  start_url: string;
  scope: string;
  display: string;
  icons: Image[];
  shortcuts: { url: string; icons?: Image[] }[];
  screenshots: (Image & { form_factor: string })[];
};
const html = readFileSync('index.html', 'utf8');

/** Width and height of a PNG (its IHDR) or a baseline JPEG (its SOF0). */
function pixelSize(path: string): string {
  const bytes = readFileSync(path);
  if (bytes.readUInt32BE(0) === 0x89504e47) return `${String(bytes.readUInt32BE(16))}x${String(bytes.readUInt32BE(20))}`;
  for (let i = 2; i < bytes.length; ) {
    const marker = bytes.readUInt16BE(i);
    if (marker === 0xffc0 || marker === 0xffc2) return `${String(bytes.readUInt16BE(i + 7))}x${String(bytes.readUInt16BE(i + 5))}`;
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  throw new Error(`${path}: no size found`);
}

describe('the web app manifest', () => {
  it('is linked from the page, with the icons iOS reads instead', () => {
    expect(html).toContain('<link rel="manifest" href="manifest.webmanifest" />');
    expect(html).toContain('viewport-fit=cover');
    const apple = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(html)?.[1];
    expect(apple && pixelSize(`public/${apple}`)).toBe('180x180');
  });

  it('opens the app full screen, from where the site is served, under either deploy', () => {
    // Relative, so the GitHub Pages project path and the domain root both work.
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('fullscreen');
  });

  it('has the 192 and 512 icons an install asks for, and a maskable one, each the size it says', () => {
    for (const icon of manifest.icons.filter((i) => i.type === 'image/png')) {
      expect(pixelSize(`public/${icon.src}`), icon.src).toBe(icon.sizes);
    }
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('shows a narrow and a wide screenshot, each the size it says', () => {
    expect(manifest.screenshots.map((s) => s.form_factor).sort()).toEqual(['narrow', 'wide']);
    for (const shot of manifest.screenshots) expect(pixelSize(`public/${shot.src}`), shot.src).toBe(shot.sizes);
  });

  it('has a shortcut only to a guide that exists', () => {
    const guides = JSON.parse(readFileSync('public/guides/index.json', 'utf8')) as string[];
    expect(manifest.shortcuts.length).toBeGreaterThan(0);
    for (const shortcut of manifest.shortcuts) {
      const id = new URLSearchParams(shortcut.url.split('?')[1]).get('guide');
      expect(guides, shortcut.url).toContain(id);
      for (const icon of shortcut.icons ?? []) expect(existsSync(`public/${icon.src}`)).toBe(true);
    }
  });

  it('has a service worker beside it to make the app open offline', () => {
    expect(existsSync('public/sw.js')).toBe(true);
  });
});
