#!/usr/bin/env node
// Long-lived capture driver for tools/fidelity/search.py. Reads one JSON command per line on stdin:
//   {"pose": {...}, "grade": {...}, "lights": {...}, "out": "path.png"}
// applies it through window.__crawlerDebug without reloading, captures 1920x1080, then prints
// {"ok": true, "out": ...}. The first line of stdin must be {"screen": "title|settings|crypt"}.
import readline from 'node:readline';

let pw;
try { pw = await import('playwright'); } catch { pw = await import('playwright-core'); }
const base = process.env.CRAWLER_BASE || 'http://localhost:8000';
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', e => process.stderr.write(`pageerror: ${e}\n`));
const rl = readline.createInterface({ input: process.stdin });
let ready = false;
for await (const line of rl) {
  if (!line.trim()) continue;
  const cmd = JSON.parse(line);
  try {
    if (cmd.screen) {
      await page.goto(`${base}/?state=${cmd.screen}&freeze=1${cmd.query ? '&' + cmd.query : ''}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__crawler && window.__crawler.ready, null, { timeout: 60000 });
      ready = true;
      process.stdout.write(JSON.stringify({ ok: true, state: await page.evaluate(() => window.__crawlerDebug.state()) }) + '\n');
      continue;
    }
    if (!ready) throw new Error('send {"screen": ...} first');
    await page.evaluate(c => { const d = window.__crawlerDebug; if (c.pose) d.pose(c.pose); if (c.grade) d.grade(c.grade); if (c.lights) d.lights(c.lights); }, cmd);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: cmd.out });
    process.stdout.write(JSON.stringify({ ok: true, out: cmd.out }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(e) }) + '\n');
  }
}
await browser.close();
