#!/usr/bin/env node
// End-to-end interactive smoke test of the full loop, driven through real input events:
// Title -> Settings -> adjust/apply -> Enter the Crypt -> move & cast 1,2,3,4,Q -> defeat the
// Bone Warden -> Esc back to Title. Fails on any console error.
//
//   python3 -m http.server 8000 &   then   node tools/fidelity/playtest.mjs [--base URL] [--shots DIR]
import { mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.push([v.slice(2), arr[i + 1]]) : a, a), []));
const base = args.base || 'http://localhost:8000';
const shots = args.shots || 'artifacts/validation/tmp/playtest';
mkdirSync(shots, { recursive: true });
let pw;
try { pw = await import('playwright'); } catch { pw = await import('playwright-core'); }
const browser = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
const T = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__crawler)));
const sleep = ms => page.waitForTimeout(ms);
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
let n = 0; const shot = name => page.screenshot({ path: `${shots}/${String(++n).padStart(2, '0')}-${name}.png` });

await page.goto(`${base}/?seedless=1`, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__crawler?.ready);
let t = await T();
check(t.state === 'title' && t.selectedMenu === 'ENTER THE CRYPT', 'boots to title with ENTER THE CRYPT selected');
await shot('title');

// Settings: navigate with arrows, change values, apply.
await page.keyboard.press('ArrowDown'); t = await T();
check(t.selectedMenu === 'SETTINGS', 'arrow moves menu marker to SETTINGS');
await page.keyboard.press('Enter'); await sleep(300); t = await T();
check(t.state === 'settings' && t.settingsFocus === 0, 'Enter opens settings with focus on master volume');
await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); t = await T();
check(t.draft.master === 70 && t.settings.master === 80, 'slider edits the draft only (draft 70, committed 80)');
await page.keyboard.press('Escape'); await sleep(200); t = await T();
check(t.state === 'title' && t.settings.master === 80, 'Esc discards the draft');
await page.keyboard.press('Enter'); await sleep(300);
await page.keyboard.press('ArrowLeft');
for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter'); t = await T();
check(t.draft.vignette === false, 'Enter toggles VIGNETTE off in the draft');
await page.click('#settings .selector span[data-v=borderless]'); t = await T();
check(t.draft.windowMode === 'borderless', 'click selects BORDERLESS');
await page.click('#settings .selector span[data-v=windowed]');
await shot('settings-draft');
await page.click('#settings .act[data-action=apply]'); await sleep(300); t = await T();
check(t.state === 'title' && t.settings.master === 75 && t.settings.vignette === false, 'APPLY commits master 75 and vignette off');
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ashen-reliquary-settings-v1')));
check(stored?.master === 75, 'settings persisted to localStorage');

// Enter the crypt.
await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter'); await sleep(600); t = await T();
check(t.state === 'crypt' && t.hp === 100 && t.bossHp === 100, 'ENTER THE CRYPT starts a fresh encounter');
check(t.enemies.length === 4, 'warden + 3 thralls spawned');

// Move with WASD.
const p0 = t.player;
await page.keyboard.down('KeyW'); await sleep(450); await page.keyboard.up('KeyW'); t = await T();
check(t.player.z < p0.z - 0.8, `W moves the knight up-screen (${p0.z} -> ${t.player.z})`);
await page.keyboard.down('KeyD'); await sleep(300); await page.keyboard.up('KeyD'); t = await T();
check(t.player.x > p0.x + 0.4, 'D moves the knight right');
// Click-to-move.
const before = (await T()).player;
await page.mouse.click(800, 700); await sleep(700); t = await T();
check(Math.hypot(t.player.x - before.x, t.player.z - before.z) > 0.6, 'left-click floor raycast moves the knight');

// Abilities 1..4 and Q.
for (const key of ['1', '2', '3', '4', 'q']) {
  const es = (await T()).essence;
  await page.keyboard.press(key === 'q' ? 'KeyQ' : `Digit${key}`); await sleep(120); t = await T();
  const k = key.toUpperCase();
  check(t.cooldownSeconds[k] > 0, `ability ${k} goes on cooldown (${t.cooldownSeconds[k]}s, essence ${es}->${t.essence})`);
  await sleep(500);
}
await shot('abilities');

// Fight: chase the warden and cleave until it falls (abilities as they come off cooldown).
const t0 = Date.now(); let lastHp = 100;
while (Date.now() - t0 < 90000) {
  t = await T();
  if (t.outcome) break;
  if (t.hp < 55 && t.cooldownSeconds.Q === 0) await page.keyboard.press('KeyQ');
  const target = t.enemies.find(e => e.kind === 'warden');
  if (!target) break;
  const dx = target.x - t.player.x, dz = target.z - t.player.z, d = Math.hypot(dx, dz);
  // aim by hovering the mouse over the warden's screen position
  const scr = await page.evaluate(([x, z]) => window.__crawlerProject?.(x, z), [target.x, target.z]);
  if (scr) await page.mouse.move(scr.x, scr.y);
  if (d > 1.6) { await page.keyboard.down(dz < 0 ? 'KeyW' : 'KeyS'); if (Math.abs(dx) > 0.5) await page.keyboard.down(dx > 0 ? 'KeyD' : 'KeyA'); await sleep(140); for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) await page.keyboard.up(k); }
  else { for (const k of ['Digit2', 'Digit3', 'Digit4', 'Digit1']) { if ((await T()).cooldownSeconds[k.slice(-1)] === 0) { await page.keyboard.press(k); break; } } await sleep(160); }
  if (t.bossHp < lastHp - 20) { lastHp = t.bossHp; console.log(`     warden ${t.bossHp}%  knight ${t.hp}hp`); }
}
t = await T();
await shot('outcome');
check(t.outcome === 'victory', `Bone Warden defeated (outcome=${t.outcome}, boss ${t.bossHp}%, hp ${t.hp})`);
check(await page.isVisible('#bannerMsg'), 'outcome banner shown');

await page.keyboard.press('Escape'); await sleep(400); t = await T();
check(t.state === 'title', 'Esc returns to title');
await shot('back-to-title');

check(errors.length === 0, `zero console errors${errors.length ? ':\n' + errors.join('\n') : ''}`);
await browser.close();
