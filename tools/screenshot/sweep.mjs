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
 *   --uncapped       run the browser without vsync, so frameMs shows the
 *                    headroom under the 16.7 ms a capped run reports
 *   --no-shots       measure only
 *   --defaults JSON  settings applied to every case, e.g. '{"w":412,"h":892,"dpr":2}'
 *
 * Writes outDir/<name>.png and outDir/results.json (frame time, status
 * chips, labels, console problems per case) and prints one line per case.
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

  const info = await page.evaluate(async () => {
    const app = window.__transparentEarth;
    const startFrames = app.getFrameCount();
    const start = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const frames = app.getFrameCount() - startFrames;
    const memory = app.renderer.info.memory;
    return {
      frameMs: frames > 0 ? Math.round(((performance.now() - start) / frames) * 100) / 100 : null,
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
  });
  if (!has('no-shots')) await page.screenshot({ path: join(outDir, `${c.name}.png`) });
  const result = { name: c.name, ...info, problems: [...problems] };
  results.push(result);
  console.log(
    `${c.name}\t${info.frameMs} ms\ttex ${info.textures}\t${info.labels.length} labels\t${JSON.stringify(info.status)}` +
      (problems.length > 0 ? `\n  ${problems.slice(0, 6).join('\n  ')}` : '')
  );
}
writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 1));
await browser.close();
