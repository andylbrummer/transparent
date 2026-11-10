#!/usr/bin/env node
/**
 * What each thing in the view costs the GPU: time per frame by object
 * name, from WebGL timer queries round every draw call.
 *
 *   node tools/screenshot/gpu-time.mjs [options]
 *
 * Options (as shot.mjs unless noted):
 *   --only a,b      exactly these layers on (default: the app's defaults)
 *   --on a,b        these on as well
 *   --stereo        measure the Cardboard view
 *   --yaw --pitch --fov --lat --lon --time --w --h --dpr --url
 *   --seconds N     how long to measure, default 6
 *
 * Prints one line per object name: the median over frames of the GPU time
 * its draws took in a frame, and the draws per frame. The frame interval
 * says nothing below the display's 16.7 ms, and a busy machine inflates
 * it; this shows where the time goes, and stays steady while other work
 * shares the GPU. Objects are named by the layer that made them (a layer's
 * numbered parts are added together); an unnamed mesh is the globe.
 *
 * Needs playwright-core, a Chromium (see shot.mjs) and a GPU whose driver
 * offers EXT_disjoint_timer_query_webgl2.
 */
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (key, fallback) => {
  const i = args.indexOf(`--${key}`);
  return i < 0 ? fallback : args[i + 1];
};
const has = (key) => args.includes(`--${key}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-webgl-draft-extensions'],
});
const context = await browser.newContext({
  viewport: { width: Number(opt('w', 412)), height: Number(opt('h', 892)) },
  deviceScaleFactor: Number(opt('dpr', 2)),
  geolocation: { latitude: Number(opt('lat', 30.27)), longitude: Number(opt('lon', -97.74)) },
  permissions: ['geolocation'],
});
const page = await context.newPage();
page.on('pageerror', (error) => console.log(`pageerror: ${error.message}`));
const time = opt('time', null);
await page.goto(opt('url', 'http://127.0.0.1:5173/') + (time ? `?time=${encodeURIComponent(time)}` : ''));
await page.waitForFunction(() => window.__transparentEarth?.getSensorState().position, null, { timeout: 30000 });
await page.waitForTimeout(1000);

const supported = await page.evaluate(
  ({ only, on, yaw, pitch, fov }) => {
    const boxes = [...document.querySelectorAll('input[data-layer]')];
    const set = (box, value) => {
      if (box.checked === value) return;
      box.checked = value;
      box.dispatchEvent(new Event('change'));
    };
    const list = (text) => (text ?? '').split(',').filter(Boolean);
    if (only !== null) for (const box of boxes) set(box, list(only).includes(box.dataset.layer));
    for (const box of boxes) if (list(on).includes(box.dataset.layer)) set(box, true);
    window.__transparentEarth.look.setAim((yaw * Math.PI) / 180, (pitch * Math.PI) / 180, fov);
    return Boolean(window.__transparentEarth.renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2'));
  },
  { only: opt('only', null), on: opt('on', null), yaw: Number(opt('yaw', 0)), pitch: Number(opt('pitch', -90)), fov: Number(opt('fov', 60)) }
);
if (!supported) {
  console.error('this GPU driver offers no EXT_disjoint_timer_query_webgl2');
  await browser.close();
  process.exit(1);
}
// Live layers fetch their data; lazy ones compile their shaders.
await page.waitForTimeout(7000);
if (has('stereo')) {
  await page.evaluate(() => document.getElementById('cardboard-toggle').click());
  await page.waitForTimeout(1500);
}

const result = await page.evaluate(async (seconds) => {
  const app = window.__transparentEarth;
  const gl = app.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  /** name -> frame -> ms */
  const byName = new Map();
  const pending = [];
  let active = null;
  app.scene.traverse((object) => {
    if (!object.isMesh && !object.isPoints && !object.isLine) return;
    const name = (object.name || object.parent?.name || 'globe').replace(/-\d+$/, '');
    const before = object.onBeforeRender;
    const after = object.onAfterRender;
    object.onBeforeRender = function (...rest) {
      before.apply(this, rest);
      if (active) return;
      active = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    };
    object.onAfterRender = function (...rest) {
      after.apply(this, rest);
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push([name, app.getFrameCount(), active]);
      active = null;
    };
  });
  const collect = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const [name, frame, query] = pending[i];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        const frames = byName.get(name) ?? new Map();
        const entry = frames.get(frame) ?? { ms: 0, draws: 0 };
        entry.ms += gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        entry.draws++;
        frames.set(frame, entry);
        byName.set(name, frames);
      }
      gl.deleteQuery(query);
      pending.splice(i, 1);
    }
  };
  const firstFrame = app.getFrameCount();
  const start = performance.now();
  while (performance.now() - start < seconds * 1000) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    collect();
  }
  const frames = app.getFrameCount() - firstFrame;
  const rows = [];
  for (const [name, perFrame] of byName) {
    const ms = [...perFrame.values()].map((entry) => entry.ms).sort((a, b) => a - b);
    const draws = [...perFrame.values()].reduce((n, entry) => n + entry.draws, 0) / perFrame.size;
    rows.push({ name, ms: ms[Math.floor(ms.length / 2)], draws });
  }
  rows.sort((a, b) => b.ms - a.ms);
  return { frameMs: (performance.now() - start) / frames, rows };
}, Number(opt('seconds', 6)));

console.log(`frame interval ${result.frameMs.toFixed(2)} ms`);
let total = 0;
for (const row of result.rows) {
  total += row.ms;
  console.log(`  ${row.name.padEnd(30)} ${row.ms.toFixed(3).padStart(8)} ms   ${row.draws.toFixed(1).padStart(6)} draws/frame`);
}
console.log(`  ${'all draws'.padEnd(30)} ${total.toFixed(3).padStart(8)} ms`);
await browser.close();
