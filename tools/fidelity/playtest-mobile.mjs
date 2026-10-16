#!/usr/bin/env node
// Touch smoke test on emulated phones (portrait and landscape): tap through the title, use the
// virtual stick, tap ability slots, open MENU, and check settings sliders respond to drags.
//   node tools/fidelity/playtest-mobile.mjs [--base URL] [--shots DIR]
import { mkdirSync } from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.push([v.slice(2), arr[i + 1]]) : a, a), []));
const base = args.base || 'http://localhost:8000';
const shots = args.shots || 'artifacts/validation/tmp/mobile';
mkdirSync(shots, { recursive: true });
let pw;
try { pw = await import('playwright'); } catch { pw = await import('playwright-core'); }
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
for (const [name, vp] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]]) {
  console.log(`-- ${name}`);
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const T = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__crawler)));
  const sleep = ms => page.waitForTimeout(ms);
  const center = async sel => { const b = await page.locator(sel).boundingBox(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  const inView = b => b && b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1;
  // Touch drag through CDP so pointer events carry pointerType "touch".
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.waitForFunction(() => window.__crawler?.ready);
  await page.screenshot({ path: `${shots}/${name}-title.png` });
  for (const sel of ['#titleLockup', '#titleMenu .menu-item[data-action=enter]', '#titleMenu .menu-item[data-action=quit]']) check(inView((await center(sel))?.b), `${sel} on screen`);
  check(await page.isVisible('.hint-small .touch-only'), 'touch hint shown');
  await page.tap('#titleMenu .menu-item[data-action=settings]'); await sleep(300);
  check((await T()).state === 'settings', 'tap SETTINGS opens settings');
  check(inView((await center('#settings .panel')).b), 'settings panel fits the screen');
  const tr = await center('#settings .row[data-key=master] .track');
  await touch('touchStart', [[tr.b.x + tr.b.width * 0.3, tr.y]]); await touch('touchEnd', []); await sleep(100);
  check((await T()).draft.master === 30, `slider tap sets master volume (${(await T()).draft.master})`);
  await page.tap('#settings .act[data-action=back]'); await sleep(300);
  await page.tap('#titleMenu .menu-item[data-action=enter]'); await sleep(600);
  let t = await T();
  check(t.state === 'crypt', 'tap ENTER THE CRYPT starts the game');
  for (const sel of ['#actionbar', '.orb.hp', '.orb.es', '.minimap', '#menuBtn']) check(inView((await center(sel))?.b), `${sel} on screen`);
  await page.screenshot({ path: `${shots}/${name}-crypt.png` });
  // virtual stick: hold and drag upward
  const p0 = t.player, sx = vp.width * 0.18, sy = vp.height * 0.6;
  await touch('touchStart', [[sx, sy]]); await touch('touchMove', [[sx, sy - 40]]); await touch('touchMove', [[sx, sy - 60]]);
  await sleep(150); check(await page.isVisible('#stick'), 'stick appears under the thumb');
  await sleep(500); await touch('touchEnd', []); t = await T();
  check(t.player.z < p0.z - 0.8, `stick moves the knight (${p0.z} -> ${t.player.z})`);
  check(!(await page.isVisible('#stick')), 'stick hides on release');
  // tap-to-move on the right side of the floor
  const p1 = t.player;
  await touch('touchStart', [[vp.width * 0.7, vp.height * 0.5]]); await touch('touchEnd', []); await sleep(700); t = await T();
  check(Math.hypot(t.player.x - p1.x, t.player.z - p1.z) > 0.5, 'tap on the floor walks there');
  for (const k of ['1', '2', '3', '4', 'Q']) {
    const c = await center(`.slot[data-key="${k}"]`);
    await touch('touchStart', [[c.x, c.y]]); await touch('touchEnd', []); await sleep(150);
    t = await T(); check(t.cooldownSeconds[k] > 0, `tap slot ${k} casts (cd ${t.cooldownSeconds[k]})`);
    await sleep(350);
  }
  await page.tap('#menuBtn'); await sleep(300);
  check((await T()).state === 'title', 'MENU returns to title');
  check(errors.length === 0, `zero console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
