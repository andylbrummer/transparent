/**
 * Renders app/public/icons/icon.svg to the PNGs the web app manifest and iOS ask for.
 *
 *   CHROME_PATH=<chromium> node tools/icons/render.mjs
 *
 * depends on: npm i --no-save playwright-core (as tools/screenshot/shot.mjs does)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const dir = fileURLToPath(new URL('../../app/public/icons/', import.meta.url));
const svg = await readFile(`${dir}icon.svg`, 'utf8');
const sizes = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage();
for (const [name, size] of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `${dir}${name}`, clip: { x: 0, y: 0, width: size, height: size } });
  console.log(`wrote ${name}`);
}
await browser.close();
