#!/usr/bin/env node
/**
 * Screenshot many views in one go, to look over every layer.
 *
 *   node tools/screenshot/sweep.mjs cases.json outDir [options]
 *
 * cases.json is an array of cases. Each has a `name` (the PNG's file name)
 * and any of shot.mjs's settings as keys: only / on / off (comma-separated
 * layer ids), yaw, pitch, fov, lat, lon, time, w, h, dpr, wait, plus
 *   stereo: true     enter the Cardboard view before the shot
 *   panel: true      open the layers panel
 *   scroll: 0..1     with panel: how far down the panel to scroll
 *
 * Cases that share a viewport, place and time share one page, switching
 * layers without a reload - which is also how a person uses the app.
 *
 * Options:
 *   --url URL        default http://127.0.0.1:5173/
 *   --uncapped       run the browser without vsync
 *   --no-shots       measure only
 *   --windows N      time N one-second windows per case (default 1) and
 *                    report the fastest and the median: use 3 or more when
 *                    something else is using the GPU
 *   --defaults JSON  settings applied to every case, e.g. '{"w":412,"h":892,"dpr":2}'
 *
 * Writes outDir/<name>.png and outDir/results.json and prints one line per
 * case: frameMs, the interval between frames (16.7 at best on a 60 Hz
 * display); renderMs, the time a frame's draw calls take through to the
 * GPU finishing them - the figure that shows headroom and what a layer
 * costs, though it includes the fixed cost of waiting for the GPU (run a
 * case in a tiny viewport to see it); texture count, labels, status chips,
 * console problems.
 * Needs playwright-core and a Chromium; see shot.mjs.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const [casesPath, outDir] = args;
if (!casesPath || !outDir || casesPath.startsWith('--') || outDir.startsWith('--')) {
  console.error('usage: node tools/screenshot/sweep.mjs cases.json outDir [options]  (see the header of this file)');
  process.exit(2);
}
const opt = (key, fallback) => {
  const i = args.indexOf(`--${key}`);
  return i < 0 ? fallback : args[i + 1];
};
const has = (key) => args.includes(`--${key}`);
const baseUrl = opt('url', 'http://127.0.0.1:5173/');
const defaults = { w: 1280, h: 800, dpr: 1, lat: 30.27, lon: -97.74, time: null, ...JSON.parse(opt('defaults', '{}')) };
const cases = JSON.parse(readFileSync(casesPath, 'utf8')).map((c) => ({ ...defaults, ...c }));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: [
    '--use-angle=gl-egl',
    '--ignore-gpu-blocklist',
    ...(has('uncapped') ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
  ],
});

const pageKey = (c) => [c.w, c.h, c.dpr, c.lat, c.lon, c.time].join('|');
const results = [];
let open = null;

async function pageFor(c) {
  const key = pageKey(c);
  if (open?.key === key) return open;
  await open?.context.close();
  const context = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: c.dpr,
    geolocation: { latitude: c.lat, longitude: c.lon },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
  await page.goto(baseUrl + (c.time ? `?time=${encodeURIComponent(c.time)}` : ''));
  await page.waitForFunction(() => window.__transparentEarth?.getSensorState().position, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  open = { key, context, page, problems, stereo: false, panel: false };
  return open;
}

for (const c of cases) {
  const session = await pageFor(c);
  const { page, problems } = session;
  problems.length = 0;
  // Leave the stereo view and the panel as the last case left them only if this one wants the same.
  if (session.stereo && !c.stereo) {
    await page.mouse.click(c.w / 2, c.h / 2);
    session.stereo = false;
  }
  if (session.panel !== Boolean(c.panel)) {
    await page.evaluate(() => document.getElementById('layers-toggle').click());
    session.panel = Boolean(c.panel);
  }
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
        if (!box) console.error(`no layer "${id}"`);
        return box;
      };
      const list = (text) => (text ?? '').split(',').filter(Boolean);
      if (only !== undefined && only !== null) {
        const ids = list(only);
        for (const box of boxes) set(box, ids.includes(box.dataset.layer));
        ids.forEach(find);
      }
      for (const id of list(on)) {
        const box = find(id);
        if (box) set(box, true);
      }
      for (const id of list(off)) {
        const box = find(id);
        if (box) set(box, false);
      }
      window.__transparentEarth.look.setAim((yaw * Math.PI) / 180, (pitch * Math.PI) / 180, fov);
    },
    { on: c.on, off: c.off, only: c.only, yaw: c.yaw ?? 0, pitch: c.pitch ?? -90, fov: c.fov ?? 60 }
  );
  if (c.stereo && !session.stereo) {
    await page.evaluate(() => document.getElementById('cardboard-toggle').click());
    session.stereo = true;
  }
  if (c.panel) {
    await page.evaluate((fraction) => {
      const panel = document.getElementById('layers-panel');
      panel.scrollTop = (panel.scrollHeight - panel.clientHeight) * fraction;
    }, c.scroll ?? 0);
  }
  // Settle: a fixed pause, then until no switch still says it is loading.
  await page.waitForTimeout(c.wait ?? 1500);
  await page
    .waitForFunction(
      () => ![...document.querySelectorAll('.layer-switch__status:not([hidden])')].some((chip) => chip.textContent === 'loading…'),
      null,
      { timeout: 20000 }
    )
    .catch(() => problems.push('still loading after 20 s'));
  await page.waitForTimeout(500);

  const info = await page.evaluate(async (windows) => {
    const app = window.__transparentEarth;
    // Time each frame's rendering through to the GPU finishing it: the
    // frame interval stops at the display's 16.7 ms however little of it a
    // frame uses. From the frame's first render call to a pixel read back
    // after its last (the app's frame callback runs before this one, having
    // been registered first): reading a pixel waits for the GPU, which
    // gl.finish() in a browser does not. Once per frame, so that a stereo
    // frame's two renders pay for one wait like any other frame.
    if (!window.__renderTimer) {
      const timer = (window.__renderTimer = { ms: 0, started: 0 });
      const gl = app.renderer.getContext();
      const render = app.renderer.render.bind(app.renderer);
      const pixel = new Uint8Array(4);
      app.renderer.render = (scene, camera) => {
        if (timer.started === 0) timer.started = performance.now();
        render(scene, camera);
      };
      const afterFrame = () => {
        requestAnimationFrame(afterFrame);
        if (timer.started === 0) return;
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        timer.ms += performance.now() - timer.started;
        timer.started = 0;
      };
      requestAnimationFrame(afterFrame);
    }
    // Other work on the machine's GPU shows up as slow windows: take several and keep the best and the middle one.
    const times = [];
    const renders = [];
    for (let i = 0; i < windows; i++) {
      const startFrames = app.getFrameCount();
      const startRender = window.__renderTimer.ms;
      const start = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const frames = app.getFrameCount() - startFrames;
      if (frames === 0) continue;
      times.push(Math.round(((performance.now() - start) / frames) * 100) / 100);
      renders.push(Math.round(((window.__renderTimer.ms - startRender) / frames) * 100) / 100);
    }
    times.sort((a, b) => a - b);
    renders.sort((a, b) => a - b);
    const memory = app.renderer.info.memory;
    return {
      frameMs: times[0] ?? null,
      frameMsMedian: times[Math.floor(times.length / 2)] ?? null,
      renderMs: renders[0] ?? null,
      renderMsMedian: renders[Math.floor(renders.length / 2)] ?? null,
      labels: app.getVisibleLabels(),
      hud: document.getElementById('hud')?.textContent,
      textures: memory.textures,
      geometries: memory.geometries,
      heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e5) / 10 : null,
      status: Object.fromEntries(
        [...document.querySelectorAll('.layer-switch__status:not([hidden])')]
          .filter((chip) => chip.closest('label').querySelector('input').checked)
          .map((chip) => [chip.closest('label').querySelector('input').dataset.layer, chip.textContent])
      ),
    };
  }, Number(opt('windows', 1)));
  if (!has('no-shots')) await page.screenshot({ path: join(outDir, `${c.name}.png`) });
  const result = { name: c.name, ...info, problems: [...problems] };
  results.push(result);
  console.log(
    `${c.name}\t${info.frameMs} ms (median ${info.frameMsMedian})\trender ${info.renderMs} (${info.renderMsMedian})\ttex ${info.textures}\t${info.labels.length} labels\t${JSON.stringify(info.status)}` +
      (problems.length > 0 ? `\n  ${problems.slice(0, 6).join('\n  ')}` : '')
  );
}
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1));
await browser.close();
