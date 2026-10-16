#!/usr/bin/env node
// Capture deterministic 1920x1080 frames of the three reference screens.
//
//   python3 -m http.server 8000 &          # from the repository root
//   npm i --no-save playwright-core         # or playwright
//   node tools/fidelity/capture.mjs [--base http://localhost:8000] [--frame ref|full] [--out artifacts/validation]
//
// --frame full (default) anchors the HUD to the real 16:9 screen edges, exactly as in play; the v2
// gate maps edge-anchored UI boxes onto 16:9 (--ui-frame auto). --frame ref lays the UI out inside
// the centred 3:2 reference frame instead.
//
// Uses the locally installed Google Chrome (channel "chrome") with GPU rasterisation.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.push([v.slice(2), arr[i + 1]]) : a, a), []));
const base = args.base || 'http://localhost:8000';
const out = resolve(args.out || 'artifacts/validation');
const screens = (args.screens || 'title,settings,crypt').split(',');
const frame = args.frame === 'ref' ? '&frame=ref' : '';
const NAME = { title: 'ashen-reliquary-title', settings: 'ashen-reliquary-settings', crypt: 'ashen-reliquary-crypt' };

let pw;
try { pw = await import('playwright'); } catch { pw = await import('playwright-core'); }
mkdirSync(out, { recursive: true });
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
for (const s of screens) {
  await page.goto(`${base}/?state=${s}&freeze=1${frame}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__crawler && window.__crawler.ready, null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const file = `${out}/${NAME[s]}-runtime.png`;
  await page.screenshot({ path: file });
  console.log(`captured ${file}`);
}
await browser.close();
if (errors.length) { console.error('console errors:\n' + errors.join('\n')); process.exitCode = 1; }
