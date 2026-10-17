#!/usr/bin/env node
// Project the runtime world grid (and the room's current landmarks) into the 1536x1024 reference
// frame for one screen pose, and write JSON for tools/fidelity/gridref.py to draw over a reference
// pass (clay, depth or clean plate). This is how reference objects get world coordinates.
//   node tools/fidelity/gridproject.mjs --screen crypt --out grid.json [--y 0]
import { writeFileSync } from 'node:fs';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.push([v.slice(2), arr[i + 1]]) : a, a), []));
let pw;
try { pw = await import('playwright'); } catch { pw = await import('playwright-core'); }
const b = await pw.chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto(`${args.base || 'http://localhost:8000'}/?state=${args.screen || 'crypt'}&freeze=1&ui=0&actors=0`);
await p.waitForFunction(() => window.__crawler?.ready);
const data = await p.evaluate(y => {
  const fw = Math.min(innerWidth, innerHeight * 1.5), left = (innerWidth - fw) / 2, s = 1536 / fw;
  const pr = (x, yy, z) => { const q = window.__crawlerProjectXYZ(x, yy, z); return [(q.x - left) * s, q.y * s]; };
  const lines = [];
  for (let x = -16; x <= 16; x++) { const pts = []; for (let z = -12; z <= 20; z += 0.5) pts.push(pr(x, y, z)); lines.push({ axis: 'x', v: x, pts }); }
  for (let z = -12; z <= 20; z++) { const pts = []; for (let x = -16; x <= 16; x += 0.5) pts.push(pr(x, y, z)); lines.push({ axis: 'z', v: z, pts }); }
  return { lines, landmarks: window.__crawlerLandmarks().map(l => ({ ...l, p: pr(l.x, l.y ?? 0, l.z) })) };
}, +(args.y || 0));
writeFileSync(args.out || 'grid.json', JSON.stringify(data));
await b.close();
