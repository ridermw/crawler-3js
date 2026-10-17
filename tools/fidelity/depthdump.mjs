#!/usr/bin/env node
// Dump the runtime per-pixel camera distance for a frozen screen as raw float32 (w*h, row 0 top).
//   node tools/fidelity/depthdump.mjs --screen crypt --out depth.f32 [--w 768 --h 512]
import { writeFileSync } from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.push([v.slice(2), arr[i + 1]]) : a, a), []));
let pw; try { pw = await import('playwright'); } catch { pw = await import('playwright-core'); }
const b = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.error('pageerror', String(e)));
await p.goto(`${args.base || 'http://localhost:8000'}/?state=${args.screen || 'crypt'}&freeze=1&ui=0&actors=0`);
await p.waitForFunction(() => window.__crawler?.ready);
const b64 = await p.evaluate(([w, h]) => window.__crawlerDepth(w, h), [+(args.w || 768), +(args.h || 512)]);
writeFileSync(args.out || 'depth.f32', Buffer.from(b64, 'base64'));
await b.close();
