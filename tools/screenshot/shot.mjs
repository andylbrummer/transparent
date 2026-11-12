#!/usr/bin/env node
/**
 * Screenshot the running app in headless Chromium, to look at a layer.
 *
 *   npm run dev                       # in another terminal (port 5173)
 *   node tools/screenshot/shot.mjs out.png [options]
 *
 * Options:
 *   --on a,b        switch these layers on (ids as in the layers panel's data-layer)
 *   --off a,b       switch these off
 *   --only a,b      switch exactly these on and everything else off
 *   --yaw DEG       look direction, degrees counter-clockwise from north (west = 90)
 *   --pitch DEG     elevation; -90 (default) is straight down through the Earth
 *   --fov DEG       field of view (0.2..100), default 60
 *   --lat --lon     where the user stands (default Austin, 30.27 -97.74)
 *   --time ISO      pin the app clock (?time=), e.g. 2026-11-09T06:00:00Z
 *   --wait MS       settle time before the shot, default 4000
 *   --w --h --dpr   viewport, default 1280 800 1
 *   --panel         open the layers panel
 *   --clean         hide the debug HUD line, the buttons and the compass bar, for publishing
 *   --no-hud        hide only the debug HUD line
 *   --url URL       default http://127.0.0.1:5173/
 *   --software      render with SwiftShader instead of the machine's GPU
 *
 * Prints the HUD text, visible labels, layer status chips, frames drawn
 * and frame time, then any console errors.
 *
 * Needs playwright-core and a Chromium, neither of which the project
 * depends on:  npm i --no-save playwright-core && npx playwright-core install chromium
 * CHROME_PATH overrides the browser binary. The reported frame time is
 * this machine's GPU through ANGLE - a rough guide, not a phone measurement;
 * with --software it measures nothing useful.
 */
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const out = args[0];
if (!out || out.startsWith('--')) {
  console.error('usage: node tools/screenshot/shot.mjs out.png [options]  (see the header of this file)');
  process.exit(2);
}
const opt = (key, fallback) => {
  const i = args.indexOf(`--${key}`);
  return i < 0 ? fallback : args[i + 1];
};
const has = (key) => args.includes(`--${key}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: has('software')
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : ['--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: Number(opt('w', 1280)), height: Number(opt('h', 800)) },
  deviceScaleFactor: Number(opt('dpr', 1)),
  geolocation: { latitude: Number(opt('lat', 30.27)), longitude: Number(opt('lon', -97.74)) },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));

const time = opt('time', null);
const url = opt('url', 'http://127.0.0.1:5173/') + (time ? `?time=${encodeURIComponent(time)}` : '');
await page.goto(url);
await page.waitForFunction(() => window.__transparentEarth?.getSensorState().position, null, { timeout: 30000 });
await page.waitForTimeout(1000);

await page.evaluate(
  ({ on, off, only, yaw, pitch, fov }) => {
    const boxes = [...document.querySelectorAll('input[data-layer]')];
    const set = (box, value) => {
      if (box.checked === value) return;
      box.checked = value;
      box.dispatchEvent(new Event('change'));
    };
    const find = (id) => {
      const box = boxes.find((b) => b.dataset.layer === id);
      if (!box) console.error(`no layer "${id}"; have: ${boxes.map((b) => b.dataset.layer).join(' ')}`);
      return box;
    };
    if (only !== null) {
      const ids = only.split(',').filter(Boolean);
      for (const box of boxes) set(box, ids.includes(box.dataset.layer));
      ids.forEach(find);
    }
    for (const id of (on ?? '').split(',').filter(Boolean)) {
      const box = find(id);
      if (box) set(box, true);
    }
    for (const id of (off ?? '').split(',').filter(Boolean)) {
      const box = find(id);
      if (box) set(box, false);
    }
    window.__transparentEarth.look.setAim((yaw * Math.PI) / 180, (pitch * Math.PI) / 180, fov);
  },
  {
    on: opt('on', null),
    off: opt('off', null),
    only: opt('only', null),
    yaw: Number(opt('yaw', 0)),
    pitch: Number(opt('pitch', -90)),
    fov: Number(opt('fov', 60)),
  }
);
if (has('panel')) await page.click('#layers-toggle');
// Layer panels (a wave clock, a year slider) carry data and stay; the app's own chrome goes.
const hidden = has('clean') ? '#hud, #layers-toggle, #reset-offset, #cardboard-toggle, #ar-toggle, .compass-bar' : has('no-hud') ? '#hud' : null;
if (hidden) await page.addStyleTag({ content: `${hidden} { visibility: hidden !important; }` });
await page.waitForTimeout(Number(opt('wait', 4000)));

const info = await page.evaluate(async () => {
  const app = window.__transparentEarth;
  const startFrames = app.getFrameCount();
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const frames = app.getFrameCount() - startFrames;
  const gl = app.renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown',
    hud: document.getElementById('hud')?.textContent,
    date: app.getDate().toISOString(),
    labels: app.getVisibleLabels(),
    status: Object.fromEntries(
      [...document.querySelectorAll('.layer-switch__status:not([hidden])')].map((chip) => [
        chip.closest('label').querySelector('input').dataset.layer,
        chip.textContent,
      ])
    ),
    frameMs: frames > 0 ? Math.round(((performance.now() - start) / frames) * 10) / 10 : null,
  };
});
await page.screenshot({ path: out });
console.log(JSON.stringify(info, null, 1));
if (problems.length > 0) console.log(problems.slice(0, 20).join('\n'));
await browser.close();
