// Procedural texture and raster generation. Every texture, normal map, icon and UI ornament
// in the game is drawn here at startup from a seeded xorshift32 RNG, so output is deterministic.
import * as THREE from 'three';

export function rng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const range = (r, a, b) => a + (b - a) * r();

export const PAL = {
  night: '#0B0D10', charcoal: '#191D22', slate: '#33424F', moon: '#8BA7B8',
  amber: '#D69A45', brass: '#8A6A35', crimson: '#8E1F24', parchment: '#D8CFB7',
};

export function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, g: c.getContext('2d', { willReadFrequently: true }) };
}

export function toTexture(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}

// ---------------------------------------------------------------- scalar fields
class Field {
  constructor(w, h, fill = 0) { this.w = w; this.h = h; this.d = new Float32Array(w * h).fill(fill); }
  i(x, y) { x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h; return y * this.w + x; }
  get(x, y) { return this.d[this.i(x, y)]; }
  add(x, y, v) { this.d[this.i(x, y)] += v; }
  min(x, y, v) { const k = this.i(x, y); if (v < this.d[k]) this.d[k] = v; }
}

// Tileable value noise: a period x period lattice sampled with smoothstep interpolation.
function lattice(r, period) {
  const v = new Float32Array(period * period);
  for (let k = 0; k < v.length; k++) v[k] = r();
  return (u, w) => {
    const x = u * period, y = w * period;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const m = n => ((n % period) + period) % period;
    const a = v[m(y0) * period + m(x0)], b = v[m(y0) * period + m(x0 + 1)];
    const c = v[m(y0 + 1) * period + m(x0)], d = v[m(y0 + 1) * period + m(x0 + 1)];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(w, h, r, period, octaves, gain = 0.5) {
  const f = new Field(w, h), layers = [];
  for (let o = 0; o < octaves; o++) layers.push(lattice(r, period << o));
  let norm = 0, amp = 1; for (let o = 0; o < octaves; o++) { norm += amp; amp *= gain; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; amp = 1;
    for (let o = 0; o < octaves; o++) { s += layers[o](x / w, y / h) * amp; amp *= gain; }
    f.d[y * w + x] = s / norm;
  }
  return f;
}
// Tileable Voronoi: nearest / second-nearest distances and the owning cell value.
function voronoi(w, h, r, n) {
  const pts = []; for (let k = 0; k < n; k++) pts.push([r() * w, r() * h, r()]);
  const f1 = new Field(w, h), f2 = new Field(w, h), id = new Field(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let d1 = 1e9, d2 = 1e9, best = 0;
    for (let k = 0; k < n; k++) {
      let dx = x + 0.5 - pts[k][0], dy = y + 0.5 - pts[k][1];
      dx -= Math.round(dx / w) * w; dy -= Math.round(dy / h) * h;
      const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
    }
    const i = y * w + x; f1.d[i] = Math.sqrt(d1); f2.d[i] = Math.sqrt(d2); id.d[i] = pts[best][2];
  }
  return { f1, f2, id };
}
function boxBlur(f, rad) {
  const { w, h } = f, tmp = new Float32Array(w * h), out = new Field(w, h), n = rad * 2 + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -rad; k <= rad; k++) s += f.get(x + k, y); tmp[y * w + x] = s / n; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let k = -rad; k <= rad; k++) s += tmp[(((y + k) % h + h) % h) * w + x]; out.d[y * w + x] = s / n; }
  return out;
}
// Branching random-walk cracks carved into a height field.
function carveCracks(f, r, count, len, depth, mask) {
  for (let c = 0; c < count; c++) {
    let x = r() * f.w, y = r() * f.h, a = r() * Math.PI * 2;
    const steps = len * (0.5 + r());
    for (let s = 0; s < steps; s++) {
      a += (r() - 0.5) * 0.9;
      x += Math.cos(a); y += Math.sin(a);
      f.add(x | 0, y | 0, -depth); f.add((x + 1) | 0, y | 0, -depth * 0.4);
      if (mask) mask.add(x | 0, y | 0, 1);
    }
  }
}
// Height field -> tangent-space normal map (OpenGL convention, +Y up in texture space).
export function normalCanvas(f, strength) {
  const { w, h } = f, { c, g } = makeCanvas(w, h), img = g.createImageData(w, h), p = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (f.get(x + 1, y) - f.get(x - 1, y)) * strength;
    const dy = (f.get(x, y + 1) - f.get(x, y - 1)) * strength;
    let nx = -dx, ny = dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    p[i] = (nx * 0.5 + 0.5) * 255; p[i + 1] = (ny * 0.5 + 0.5) * 255; p[i + 2] = (nz * 0.5 + 0.5) * 255; p[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}
function rgbCanvas(w, h, fn) {
  const { c, g } = makeCanvas(w, h), img = g.createImageData(w, h), p = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y, y * w + x), i = (y * w + x) * 4;
    p[i] = v[0]; p[i + 1] = v[1]; p[i + 2] = v[2]; p[i + 3] = v[3] ?? 255;
  }
  g.putImageData(img, 0, 0); return c;
}
function fieldFromCanvas(c) {
  const g = c.getContext('2d', { willReadFrequently: true }), d = g.getImageData(0, 0, c.width, c.height).data, f = new Field(c.width, c.height);
  for (let k = 0; k < f.d.length; k++) f.d[k] = d[k * 4] / 255;
  return f;
}

function pbrSet(albedo, normal, rough, repeat = true) {
  return {
    map: toTexture(albedo, { repeat }),
    normalMap: toTexture(normal, { repeat, srgb: false }),
    roughnessMap: rough ? toTexture(rough, { repeat, srgb: false }) : null,
  };
}

// ---------------------------------------------------------------- surface materials
// Weathered stone surface detail: pitting, chips, hairline cracks and dust. The slab and
// block outlines come from geometry; this texture supplies the fine surface detail.
export function stoneSurface(seed, { size = 512, base = [92, 96, 102], contrast = 1, cracks = 26, warm = 0.1, normal = 6 } = {}) {
  const r = rng(seed);
  const n1 = fbm(size, size, r, 6, 5, 0.55), n2 = fbm(size, size, r, 48, 2, 0.5);
  const vor = voronoi(size, size, r, 90);
  const hgt = new Field(size, size), crackMask = new Field(size, size);
  for (let k = 0; k < hgt.d.length; k++) {
    const pit = smooth(5.5, 0, vor.f1.d[k]) * (vor.id.d[k] > 0.62 ? 0.35 : 0);
    const seam = smooth(2.2, 0, vor.f2.d[k] - vor.f1.d[k]) * 0.12;
    hgt.d[k] = n1.d[k] * 0.7 + n2.d[k] * 0.35 - pit - seam;
  }
  carveCracks(hgt, r, cracks, 70, 0.45, crackMask);
  const speck = rng(seed + 7);
  const alb = rgbCanvas(size, size, (x, y, k) => {
    const h = hgt.d[k], cell = vor.id.d[k];
    let l = (0.62 + (h - 0.5) * 1.1 * contrast) * (0.85 + cell * 0.3);
    if (crackMask.d[k] > 0) l *= 0.45;
    const sp = speck();
    if (sp > 0.985) l *= 1.35; else if (sp < 0.012) l *= 0.6;
    const wv = warm * (n2.d[k] - 0.4);
    return [base[0] * l * (1 + wv), base[1] * l, base[2] * l * (1 - wv * 0.8)];
  });
  const rough = rgbCanvas(size, size, (x, y, k) => { const v = 200 + (n1.d[k] - 0.5) * 80 + (crackMask.d[k] > 0 ? 30 : 0); return [v, v, v]; });
  return pbrSet(alb, normalCanvas(hgt, normal), rough);
}

// Carved gothic relief: recessed panel, pointed lancet niche, quatrefoil and a cross emblem.
export function gothicRelief(seed, { w = 256, h = 512, base = [96, 98, 102], emblem = true } = {}) {
  const r = rng(seed);
  const { c, g } = makeCanvas(w, h);
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h);
  const m = w * 0.08;
  g.fillStyle = '#5a5a5a'; g.fillRect(m, m, w - 2 * m, h - 2 * m);
  g.fillStyle = '#8a8a8a'; g.fillRect(m + 6, m + 6, w - 2 * m - 12, h - 2 * m - 12);
  // lancet niche
  const nx0 = w * 0.22, nx1 = w * 0.78, ny0 = h * 0.18, ny1 = h * 0.86, mid = (nx0 + nx1) / 2, rad = nx1 - nx0;
  const arch = (inset, fill) => {
    g.fillStyle = fill; g.beginPath();
    g.moveTo(nx0 + inset, ny1 - inset); g.lineTo(nx0 + inset, ny0 + rad * 0.55);
    g.arc(nx1, ny0 + rad * 0.55, rad - inset, Math.PI, Math.PI * 1.32, false);
    g.arc(nx0, ny0 + rad * 0.55, rad - inset, Math.PI * 1.68, 0, false);
    g.lineTo(nx1 - inset, ny1 - inset); g.closePath(); g.fill();
  };
  arch(0, '#4a4a4a'); arch(8, '#7a7a7a'); arch(14, '#3a3a3a');
  // tracery bar
  g.fillStyle = '#8a8a8a'; g.fillRect(mid - 3, ny0 + rad * 0.9, 6, ny1 - ny0 - rad * 0.9 - 14);
  // quatrefoil medallion
  const qy = ny0 + rad * 0.62, qr = rad * 0.16;
  g.fillStyle = '#9a9a9a';
  for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(mid + Math.cos(k * Math.PI / 2) * qr, qy + Math.sin(k * Math.PI / 2) * qr, qr, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#3a3a3a'; g.beginPath(); g.arc(mid, qy, qr * 0.7, 0, Math.PI * 2); g.fill();
  if (emblem) {
    g.fillStyle = '#b0b0b0';
    const ey = ny0 + (ny1 - ny0) * 0.62, es = rad * 0.22;
    g.fillRect(mid - 4, ey - es * 1.5, 8, es * 3); g.fillRect(mid - es, ey - es * 0.7, es * 2, 8);
    g.beginPath(); g.arc(mid, ey - es * 0.3, es * 0.9, 0, Math.PI * 2); g.lineWidth = 4; g.strokeStyle = '#b0b0b0'; g.stroke();
  }
  // base moulding
  g.fillStyle = '#6a6a6a'; g.fillRect(m, h - m - 18, w - 2 * m, 6); g.fillRect(m, m + 12, w - 2 * m, 6);
  let hgt = boxBlur(fieldFromCanvas(c), 1);
  const n = fbm(w, h, r, 8, 4);
  for (let k = 0; k < hgt.d.length; k++) hgt.d[k] += (n.d[k] - 0.5) * 0.18;
  carveCracks(hgt, r, 6, 50, 0.3);
  const alb = rgbCanvas(w, h, (x, y, k) => {
    const v = hgt.d[k], l = 0.35 + v * 0.85 + (n.d[k] - 0.5) * 0.3;
    return [base[0] * l, base[1] * l, base[2] * l];
  });
  return pbrSet(alb, normalCanvas(hgt, 9), null, false);
}

// Worn iron with rust blooms (grates, chains, brazier cage).
export function rustIron(seed) {
  const s = 128, r = rng(seed), n = fbm(s, s, r, 4, 4), m = fbm(s, s, r, 16, 2);
  const alb = rgbCanvas(s, s, (x, y, k) => {
    const rust = smooth(0.5, 0.75, n.d[k]);
    const l = 0.7 + m.d[k] * 0.5;
    return [(46 + rust * 70) * l, (44 + rust * 30) * l, (44 + rust * 10) * l];
  });
  const rough = rgbCanvas(s, s, (x, y, k) => { const v = 120 + smooth(0.5, 0.75, n.d[k]) * 120; return [v, v, v]; });
  const hgt = new Field(s, s); for (let k = 0; k < hgt.d.length; k++) hgt.d[k] = n.d[k] * 0.6 + m.d[k] * 0.4;
  return pbrSet(alb, normalCanvas(hgt, 4), rough);
}

// Bone / ivory with fine pores.
export function boneSurface(seed) {
  const s = 128, r = rng(seed), n = fbm(s, s, r, 8, 4);
  const alb = rgbCanvas(s, s, (x, y, k) => { const l = 0.75 + n.d[k] * 0.4; return [196 * l, 184 * l, 156 * l]; });
  return { map: toTexture(alb), normalMap: toTexture(normalCanvas(n, 3), { srgb: false }) };
}

// Brushed dark steel for armour.
export function steelSurface(seed) {
  const s = 128, r = rng(seed), n = fbm(s, s, r, 4, 4), scratch = new Field(s, s);
  carveCracks(scratch, r, 40, 14, 1);
  const alb = rgbCanvas(s, s, (x, y, k) => { const l = 0.8 + n.d[k] * 0.35 + (scratch.d[k] < 0 ? 0.25 : 0); return [92 * l, 96 * l, 102 * l]; });
  const rough = rgbCanvas(s, s, (x, y, k) => { const v = 90 + n.d[k] * 90; return [v, v, v]; });
  return { map: toTexture(alb), roughnessMap: toTexture(rough, { srgb: false }) };
}

// Dark woven cloth (robes, cape).
export function clothSurface(seed, tint = [26, 26, 30]) {
  const s = 128, r = rng(seed), n = fbm(s, s, r, 8, 3);
  const alb = rgbCanvas(s, s, (x, y, k) => { const weave = ((x + y) % 4 < 2 ? 1 : 0.86) * ((x - y + 256) % 6 < 3 ? 1 : 0.9); const l = (0.8 + n.d[k] * 0.5) * weave; return [tint[0] * l, tint[1] * l, tint[2] * l]; });
  return { map: toTexture(alb) };
}

// Worn crimson carpet runner with brass border.
export function carpetTex(seed) {
  const w = 128, h = 512, r = rng(seed), n = fbm(w, h, r, 4, 4), holes = fbm(w, h, r, 8, 3);
  return { map: toTexture(rgbCanvas(w, h, (x, y, k) => {
    const border = x < 10 || x > w - 11; const stripe = x > 14 && x < 18 || x > w - 19 && x < w - 15;
    let c = border ? [70, 48, 26] : stripe ? [110, 82, 40] : [92, 22, 24];
    const wear = smooth(0.62, 0.72, holes.d[k]);
    const l = 0.6 + n.d[k] * 0.6;
    c = c.map((v, i) => (v * (1 - wear) + [52, 52, 54][i] * wear) * l);
    return c;
  }), { repeat: false }) };
}

// ---------------------------------------------------------------- alpha / emissive sprites
function alphaCanvas(w, h, fn) {
  return rgbCanvas(w, h, (x, y, k) => fn(x, y, k));
}

// Tattered black banner with brass border and a gothic insignia; frayed alpha edges.
export function bannerTex(seed, variant = 0) {
  const w = 256, h = 640, r = rng(seed), n = fbm(w, h, r, 6, 4), fray = fbm(w, 64, r, 16, 2);
  const { c, g } = makeCanvas(w, h);
  const img = g.createImageData(w, h), p = img.data;
  const cut = x => { const t = Math.abs(x - w / 2) / (w / 2); return h - 30 - (1 - t) * 90 - fray.get(x, 3) * 50; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x, i = k * 4;
    const weave = ((x + y) & 3) < 2 ? 1 : 0.88;
    let l = (0.7 + n.d[k] * 0.6) * weave;
    let col = [20 * l, 20 * l, 24 * l];
    const bx = Math.min(x, w - 1 - x), by = y;
    if ((bx > 10 && bx < 16) || (by > 18 && by < 24)) col = [128 * l, 98 * l, 50 * l];
    let a = 255;
    if (y > cut(x)) a = 0;
    if (n.d[k] > 0.78 && y > h * 0.35) a = 0; // moth holes / tears
    if (bx < 2 + fray.get(y & 63, 7) * 6) a = 0;
    p[i] = col[0]; p[i + 1] = col[1]; p[i + 2] = col[2]; p[i + 3] = a;
  }
  g.putImageData(img, 0, 0);
  // insignia
  const cx = w / 2, cy = h * 0.36;
  g.strokeStyle = '#9c7a3e'; g.fillStyle = '#9c7a3e'; g.lineWidth = 6;
  if (variant === 0) {
    g.beginPath(); g.arc(cx, cy, 52, 0, Math.PI * 2); g.stroke();
    g.fillRect(cx - 5, cy - 90, 10, 180); g.fillRect(cx - 60, cy - 5, 120, 10);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a - 0.12) * 40, cy + Math.sin(a - 0.12) * 40); g.lineTo(cx + Math.cos(a) * 64, cy + Math.sin(a) * 64); g.lineTo(cx + Math.cos(a + 0.12) * 40, cy + Math.sin(a + 0.12) * 40); g.fill(); }
  } else {
    g.beginPath(); g.moveTo(cx, cy - 80); g.lineTo(cx + 24, cy - 20); g.lineTo(cx + 70, cy); g.lineTo(cx + 24, cy + 20); g.lineTo(cx, cy + 80); g.lineTo(cx - 24, cy + 20); g.lineTo(cx - 70, cy); g.lineTo(cx - 24, cy - 20); g.closePath(); g.fill();
    g.fillStyle = '#141418'; g.beginPath(); g.arc(cx, cy, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9c7a3e'; g.fillRect(cx - 3, cy + 90, 6, 60); g.fillRect(cx - 22, cy + 105, 44, 6);
  }
  return toTexture(c, { repeat: false });
}

// Gothic lancet window: stone mullions and leaded panes backed by cold moonlight.
export function lancetTex(seed) {
  const w = 160, h = 400, r = rng(seed);
  const { c, g } = makeCanvas(w, h);
  const archY = w * 0.52;
  g.save();
  g.beginPath(); g.moveTo(6, h); g.lineTo(6, archY);
  g.arc(w - 6, archY, w - 12, Math.PI, Math.PI * 1.333); g.arc(6, archY, w - 12, Math.PI * 1.667, 0); g.lineTo(w - 6, h); g.closePath();
  g.clip();
  for (let y = 0; y < h; y += 2) { const t = y / h; g.fillStyle = `rgb(${110 - t * 40 | 0},${140 - t * 40 | 0},${165 - t * 35 | 0})`; g.fillRect(0, y, w, 2); }
  for (let k = 0; k < 220; k++) { g.fillStyle = `rgba(20,26,34,${0.2 + r() * 0.5})`; g.fillRect(r() * w, r() * h, 2 + r() * 10, 2 + r() * 10); }
  g.strokeStyle = 'rgba(16,20,26,0.95)'; g.lineWidth = 2;
  for (let d = -h; d < h + w; d += 18) { g.beginPath(); g.moveTo(d, 0); g.lineTo(d + h, h); g.stroke(); g.beginPath(); g.moveTo(d + h, 0); g.lineTo(d, h); g.stroke(); }
  g.fillStyle = '#1a1d22'; g.fillRect(w / 2 - 5, archY * 0.9, 10, h);
  g.fillRect(0, h * 0.55, w, 8);
  g.lineWidth = 9; g.strokeStyle = '#1a1d22'; g.beginPath(); g.arc(w / 2, archY * 0.72, w * 0.18, 0, Math.PI * 2); g.stroke();
  g.restore();
  g.lineWidth = 8; g.strokeStyle = '#1e2126';
  g.beginPath(); g.moveTo(6, h); g.lineTo(6, archY); g.arc(w - 6, archY, w - 12, Math.PI, Math.PI * 1.333); g.arc(6, archY, w - 12, Math.PI * 1.667, 0); g.lineTo(w - 6, h); g.stroke();
  return toTexture(c, { repeat: false });
}

export function softDisc(size = 128, inner = 0) {
  const { c, g } = makeCanvas(size, size), gr = g.createRadialGradient(size / 2, size / 2, size * inner / 2, size / 2, size / 2, size / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size); return toTexture(c, { repeat: false });
}

export function fogTex(seed) {
  const s = 256, r = rng(seed), n = fbm(s, s, r, 4, 5, 0.55);
  return toTexture(alphaCanvas(s, s, (x, y, k) => [255, 255, 255, 255 * smooth(0.35, 0.85, n.d[k])]));
}

// Red runic summoning ring under the Bone Warden.
export function runeRingTex(seed) {
  const s = 512, r = rng(seed), { c, g } = makeCanvas(s, s), cx = s / 2;
  g.strokeStyle = '#ff3a2e'; g.fillStyle = '#ff3a2e'; g.shadowColor = '#ff2010'; g.shadowBlur = 8;
  const ring = (rad, lw) => { g.lineWidth = lw; g.beginPath(); g.arc(cx, cx, rad, 0, Math.PI * 2); g.stroke(); };
  ring(240, 6); ring(222, 2); ring(170, 3); ring(150, 1.5);
  for (let k = 0; k < 28; k++) {
    const a = k / 28 * Math.PI * 2;
    g.save(); g.translate(cx + Math.cos(a) * 196, cx + Math.sin(a) * 196); g.rotate(a + Math.PI / 2);
    g.lineWidth = 3; g.beginPath();
    const strokes = 2 + (r() * 3 | 0);
    for (let q = 0; q < strokes; q++) { g.moveTo((r() - 0.5) * 18, (r() - 0.5) * 22); g.lineTo((r() - 0.5) * 18, (r() - 0.5) * 22); }
    g.stroke(); g.restore();
  }
  g.lineWidth = 2;
  for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 - Math.PI / 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 150, cx + Math.sin(a) * 150); g.lineTo(cx + Math.cos(a + Math.PI * 2 / 3) * 150, cx + Math.sin(a + Math.PI * 2 / 3) * 150); g.stroke(); }
  return toTexture(c, { repeat: false });
}

// Ground destination marker: thin gold ring with ticks.
export function markerTex() {
  const s = 256, { c, g } = makeCanvas(s, s), cx = s / 2;
  g.strokeStyle = '#ffd890'; g.shadowColor = '#e0a040'; g.shadowBlur = 14;
  g.lineWidth = 9; g.beginPath(); g.arc(cx, cx, 96, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(cx, cx, 70, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 104, cx + Math.sin(a) * 104); g.lineTo(cx + Math.cos(a) * 122, cx + Math.sin(a) * 122); g.stroke(); }
  return toTexture(c, { repeat: false });
}

// Slash trail: bright leading edge fading toward the tail, soft radial falloff.
// Slash trail: a thin white-hot leading edge with fine streaks trailing into a soft amber falloff.
export function arcTex() {
  const w = 512, h = 64, r = rng(404);
  const streak = Array.from({ length: h }, () => 0.6 + r() * 0.4);
  return toTexture(alphaCanvas(w, h, (x, y) => {
    const u = x / (w - 1), v = y / (h - 1);
    const along = Math.pow(u, 2.2) * smooth(1, 0.93, u);
    const edge = Math.exp(-Math.pow((1 - v) / 0.09, 2));            // bright outer rim
    const body = Math.pow(v, 3) * 0.35 * streak[y];                // faint streaks toward the rim
    const a = clamp01(along * (edge + body) * 1.5);
    const hot = clamp01(edge * 1.4);
    return [255, 214 + 41 * hot, 140 + 115 * hot, 255 * a];
  }), { repeat: false });
}

export function sparkTex() {
  const s = 128, cx = s / 2;
  return toTexture(alphaCanvas(s, s, (x, y) => {
    const dx = Math.abs(x - cx) / cx, dy = Math.abs(y - cx) / cx;
    const star = Math.max(clamp01(1 - dx * 8) * clamp01(1 - dy), clamp01(1 - dy * 8) * clamp01(1 - dx));
    const core = clamp01(1 - Math.hypot(dx, dy) * 3);
    const a = clamp01(star * 0.9 + core);
    return [255, 230, 180, 255 * a];
  }), { repeat: false });
}

// ---------------------------------------------------------------- UI rasters
const SERIF = '"Cinzel", "Trajan Pro", Georgia, serif';
const SANS = '"Inter", "Segoe UI", system-ui, sans-serif';

function fitFont(g, text, family, weight, targetW, startPx) {
  let px = startPx; g.font = `${weight} ${px}px ${family}`;
  const w = g.measureText(text).width; px = startPx * targetW / w;
  g.font = `${weight} ${px}px ${family}`; return px;
}
function carvedText(g, text, x, y, r) {
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillText(text, x + 2, y + 3);
  g.fillStyle = '#4a4232'; g.fillText(text, x + 1, y + 1);
  g.fillStyle = '#efe6cf'; g.fillText(text, x - 1, y - 1);
  const gr = g.createLinearGradient(0, y - 80, 0, y);
  gr.addColorStop(0, '#e4dac0'); gr.addColorStop(1, '#b6a988');
  g.fillStyle = gr; g.fillText(text, x, y);
}

// "THE ASHEN / RELIQUARY" chiselled lockup sized to the reference composition.
export function titleLockup(scale = 1) {
  const W = Math.round(520 * scale), H = Math.round(150 * scale);
  const { c, g } = makeCanvas(W, H); const r = rng(1701);
  g.textAlign = 'center';
  fitFont(g, 'THE ASHEN', SERIF, 600, 340 * scale, 60 * scale);
  carvedText(g, 'THE ASHEN', W / 2, 52 * scale, r);
  fitFont(g, 'RELIQUARY', SERIF, 600, 488 * scale, 90 * scale);
  carvedText(g, 'RELIQUARY', W / 2, 138 * scale, r);
  // worn edges: knock small flecks out of the glyphs
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 900 * scale; k++) { g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.6})`; const s = (0.6 + r() * 1.6) * scale; g.fillRect(r() * W, r() * H, s, s); }
  g.globalCompositeOperation = 'source-over';
  return c;
}

// Tarnished-brass rule with bead ornaments and a centred double diamond with filigree.
export function dividerCanvas(w, h = 18, { diamond = true, ends = true } = {}) {
  const { c, g } = makeCanvas(w, h), cy = h / 2, cx = w / 2, d = h * 0.42;
  const line = g.createLinearGradient(0, 0, w, 0);
  line.addColorStop(0, 'rgba(176,136,70,0)'); line.addColorStop(0.15, 'rgba(176,136,70,0.9)'); line.addColorStop(0.85, 'rgba(176,136,70,0.9)'); line.addColorStop(1, 'rgba(176,136,70,0)');
  g.fillStyle = line; g.fillRect(0, cy - Math.max(1, h * 0.04), w, Math.max(1.5, h * 0.08));
  if (ends) for (const x of [w * 0.3, w * 0.7]) { g.fillStyle = '#c9a463'; g.beginPath(); g.ellipse(x, cy, h * 0.11, h * 0.07, 0, 0, Math.PI * 2); g.fill(); }
  if (diamond) {
    const glow = g.createRadialGradient(cx, cy, 0, cx, cy, d * 2.6); glow.addColorStop(0, 'rgba(214,154,69,0.35)'); glow.addColorStop(1, 'rgba(214,154,69,0)');
    g.fillStyle = glow; g.fillRect(cx - d * 3, 0, d * 6, h);
    const dia = (k, fill, stroke, lw) => { g.beginPath(); g.moveTo(cx, cy - d * k); g.lineTo(cx + d * k * 1.15, cy); g.lineTo(cx, cy + d * k); g.lineTo(cx - d * k * 1.15, cy); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); } };
    // filigree wings
    g.strokeStyle = '#c9a463'; g.lineWidth = Math.max(1, h * 0.06);
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(cx + s * d * 1.1, cy); g.quadraticCurveTo(cx + s * d * 1.7, cy - d * 0.75, cx + s * d * 2.3, cy - d * 0.15); g.stroke();
      g.beginPath(); g.moveTo(cx + s * d * 1.1, cy); g.quadraticCurveTo(cx + s * d * 1.7, cy + d * 0.75, cx + s * d * 2.3, cy + d * 0.15); g.stroke();
      g.fillStyle = '#d8b673'; g.beginPath(); g.moveTo(cx + s * d * 2.3, cy - d * 0.25); g.lineTo(cx + s * d * 2.75, cy); g.lineTo(cx + s * d * 2.3, cy + d * 0.25); g.closePath(); g.fill();
    }
    dia(1.0, '#0B0D10', '#d8b673', Math.max(1.2, h * 0.07));
    dia(0.62, null, '#a88544', Math.max(1, h * 0.04));
    dia(0.3, '#e0bd78', null, 0);
  }
  return c;
}

// Square ability icons: dark iron plate, bevelled, with a pale-steel or coloured glyph.
export function abilityIcon(id, size = 128) {
  const { c, g } = makeCanvas(size, size), s = size, r = rng(id.charCodeAt(0) * 31);
  g.fillStyle = '#121418'; g.fillRect(0, 0, s, s);
  for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.06})`; g.fillRect(r() * s, r() * s, 2, 2); }
  const gr = g.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.7);
  gr.addColorStop(0, 'rgba(70,74,80,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#2d3036'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, s - 3, s - 3);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const steel = (a = 1) => { const lg = g.createLinearGradient(0, 0, s, s); lg.addColorStop(0, `rgba(235,232,222,${a})`); lg.addColorStop(1, `rgba(140,142,146,${a})`); return lg; };
  g.save(); g.translate(s / 2, s / 2); g.scale(s / 128, s / 128);
  if (id === '1') { // greatsword cleave
    g.rotate(-Math.PI / 4);
    g.fillStyle = steel(); g.beginPath(); g.moveTo(-6, 30); g.lineTo(-6, -38); g.lineTo(0, -50); g.lineTo(6, -38); g.lineTo(6, 30); g.closePath(); g.fill();
    g.fillStyle = '#8A6A35'; g.fillRect(-20, 28, 40, 7); g.fillRect(-4, 35, 8, 18); g.beginPath(); g.arc(0, 56, 6, 0, Math.PI * 2); g.fill();
    g.rotate(Math.PI / 4);
    g.strokeStyle = 'rgba(240,220,170,0.85)';
    for (let k = 0; k < 3; k++) { g.lineWidth = 4 - k; g.beginPath(); g.arc(-8, 8, 30 + k * 10, -Math.PI * 0.95, -Math.PI * 0.45); g.stroke(); }
  } else if (id === '2') { // shield break
    g.fillStyle = steel(); g.beginPath(); g.moveTo(-34, -40); g.lineTo(34, -40); g.lineTo(34, 0); g.quadraticCurveTo(30, 34, 0, 48); g.quadraticCurveTo(-30, 34, -34, 0); g.closePath(); g.fill();
    g.fillStyle = '#2a2d33'; g.beginPath(); g.moveTo(-24, -30); g.lineTo(24, -30); g.lineTo(24, 0); g.quadraticCurveTo(22, 24, 0, 36); g.quadraticCurveTo(-22, 24, -24, 0); g.closePath(); g.fill();
    g.fillStyle = steel(0.9); g.fillRect(-4, -30, 8, 64); g.fillRect(-24, -6, 48, 8);
    g.strokeStyle = '#0d0f12'; g.lineWidth = 5; g.beginPath(); g.moveTo(6, -42); g.lineTo(-4, -16); g.lineTo(10, 2); g.lineTo(-2, 24); g.lineTo(6, 46); g.stroke();
  } else if (id === '3') { // shadow lunge / forward dash
    g.fillStyle = steel();
    for (let k = 0; k < 3; k++) { const x = -34 + k * 24; g.globalAlpha = 0.45 + k * 0.27; g.beginPath(); g.moveTo(x, -30); g.lineTo(x + 26, 0); g.lineTo(x, 30); g.lineTo(x + 10, 30); g.lineTo(x + 36, 0); g.lineTo(x + 10, -30); g.closePath(); g.fill(); }
    g.globalAlpha = 1; g.strokeStyle = 'rgba(200,200,205,0.5)'; g.lineWidth = 2;
    for (const y of [-40, 40]) { g.beginPath(); g.moveTo(-50, y); g.lineTo(10, y * 0.6); g.stroke(); }
  } else if (id === '4') { // consecration ward
    g.strokeStyle = '#D69A45'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; g.beginPath(); g.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); g.lineTo(Math.cos(a) * 40, Math.sin(a) * 40); g.stroke(); }
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, 26); rg.addColorStop(0, 'rgba(255,220,150,0.9)'); rg.addColorStop(1, 'rgba(214,154,69,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2dcae'; g.fillRect(-3, -20, 6, 40); g.fillRect(-14, -8, 28, 6);
  } else if (id === 'Q') { // crimson vial
    g.fillStyle = 'rgba(200,210,215,0.35)'; g.beginPath(); g.arc(0, 14, 32, 0, Math.PI * 2); g.fill(); g.fillRect(-10, -36, 20, 30);
    g.fillStyle = '#8E1F24'; g.beginPath(); g.arc(0, 14, 28, Math.PI * 0.08, Math.PI * 0.92); g.fill();
    g.beginPath(); g.ellipse(0, 14 + 28 * Math.sin(Math.PI * 0.08) - 2, 27, 5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c23a3a'; g.beginPath(); g.arc(-8, 22, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6b4a2a'; g.fillRect(-11, -46, 22, 12);
    g.strokeStyle = 'rgba(240,240,240,0.7)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 14, 32, Math.PI * 1.05, Math.PI * 1.35); g.stroke();
    g.strokeStyle = '#8A6A35'; g.lineWidth = 3; g.strokeRect(-11, -36, 22, 4);
  }
  g.restore();
  return c;
}

export function keyIcon(size = 64) {
  const { c, g } = makeCanvas(size, size);
  g.translate(size / 2, size / 2); g.scale(size / 64, size / 64); g.rotate(-Math.PI / 4);
  g.strokeStyle = '#a07a44'; g.fillStyle = '#a07a44'; g.lineWidth = 4;
  g.beginPath(); g.arc(0, -16, 9, 0, Math.PI * 2); g.stroke();
  g.fillRect(-2, -7, 4, 32); g.fillRect(2, 16, 8, 4); g.fillRect(2, 22, 6, 4);
  g.fillStyle = 'rgba(120,60,30,0.6)'; g.fillRect(-2, 4, 4, 6);
  return c;
}

// Brass-rimmed glass orb holding a liquid at the given fill fraction: a pitted tarnished ring with
// rivets and four cardinal notches around a dark glass well, mottled liquid and a smoky meniscus.
export function orbCanvas(kind, frac, size = 200) {
  const { c, g } = makeCanvas(size, size), cx = size / 2, R = size * 0.47, r = R * 0.8;
  const liquid = kind === 'hp' ? ['#b8282c', '#7a1418', '#2a0507'] : ['#4f73a0', '#253f63', '#0b1626'];
  const rnd = rng(kind === 'hp' ? 77 : 78);
  // outer ring: dark bevel, brass band, inner lip
  g.fillStyle = '#120d07'; g.beginPath(); g.arc(cx, cx, R, 0, Math.PI * 2); g.fill();
  const band = g.createLinearGradient(0, 0, size, size);
  band.addColorStop(0, '#b8955a'); band.addColorStop(0.45, '#6e5229'); band.addColorStop(1, '#3a2a14');
  g.strokeStyle = band; g.lineWidth = R * 0.13; g.beginPath(); g.arc(cx, cx, R * 0.9, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#2a1e0e'; g.lineWidth = 1.5;
  for (const k of [0.97, 0.83]) { g.beginPath(); g.arc(cx, cx, R * k, 0, Math.PI * 2); g.stroke(); }
  // engraved tick ring and pitting
  for (let k = 0; k < 48; k++) { const a = k / 48 * Math.PI * 2; g.strokeStyle = 'rgba(30,20,8,0.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.86, cx + Math.sin(a) * R * 0.86); g.lineTo(cx + Math.cos(a) * R * 0.94, cx + Math.sin(a) * R * 0.94); g.stroke(); }
  for (let k = 0; k < 160; k++) { const a = rnd() * Math.PI * 2, d = R * (0.84 + rnd() * 0.12); g.fillStyle = `rgba(${rnd() < 0.5 ? '20,14,6' : '200,170,110'},${0.2 + rnd() * 0.3})`; g.fillRect(cx + Math.cos(a) * d, cx + Math.sin(a) * d, 1.2, 1.2); }
  // cardinal notches
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 - Math.PI / 2; g.save(); g.translate(cx + Math.cos(a) * R * 0.92, cx + Math.sin(a) * R * 0.92); g.rotate(a + Math.PI / 2);
    g.fillStyle = '#c7a465'; g.beginPath(); g.moveTo(0, -R * 0.09); g.lineTo(R * 0.05, 0); g.lineTo(0, R * 0.09); g.lineTo(-R * 0.05, 0); g.closePath(); g.fill();
    g.strokeStyle = '#2a1e0e'; g.lineWidth = 1; g.stroke(); g.restore();
  }
  // glass well
  g.save(); g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.clip();
  const glass = g.createLinearGradient(0, cx - r, 0, cx + r); glass.addColorStop(0, '#2c2e30'); glass.addColorStop(1, '#0a0b0c');
  g.fillStyle = glass; g.fillRect(0, 0, size, size);
  const top = cx + r - 2 * r * Math.max(0, Math.min(1, frac));
  const lg = g.createRadialGradient(cx - r * 0.3, top + r * 0.3, r * 0.05, cx, cx + r * 0.2, r * 1.2);
  lg.addColorStop(0, liquid[0]); lg.addColorStop(0.5, liquid[1]); lg.addColorStop(1, liquid[2]);
  g.fillStyle = lg; g.fillRect(0, top, size, size);
  for (let k = 0; k < 900; k++) { const x = rnd() * size, y = top + rnd() * (size - top); g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${rnd() * 0.08})`; g.fillRect(x, y, 2, 2); }
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, top - 1, size, 1.5);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, top + 1, size, 3);
  const vig = g.createRadialGradient(cx, cx, r * 0.55, cx, cx, r); vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = vig; g.fillRect(0, 0, size, size);
  const hl = g.createRadialGradient(cx - r * 0.25, cx - r * 0.55, 0, cx - r * 0.25, cx - r * 0.55, r * 0.55);
  hl.addColorStop(0, 'rgba(255,255,255,0.22)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl; g.fillRect(0, 0, size, size);
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.9)'; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke();
  return c;
}

// Cruciform minimap with the altar, player chevron and enemy dots.
export function drawMinimap(c, data) {
  const g = c.getContext('2d'), W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(8,9,11,0.88)'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#6e5a36'; g.lineWidth = 1; g.strokeRect(5.5, 5.5, W - 11, H - 11);
  g.fillStyle = '#a8864a';
  for (const [x, y] of [[5, 5], [W - 5, 5], [5, H - 5], [W - 5, H - 5]]) { g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 4, y); g.lineTo(x, y + 4); g.lineTo(x - 4, y); g.closePath(); g.fill(); }
  const sx = W / 26, ox = W / 2, oz = H * 0.42;
  const P = (x, z) => [ox + x * sx, oz + z * sx * 0.92];
  const room = [[-3.2, -9], [3.2, -9], [3.2, -5.4], [5.6, -5.4], [5.6, -3.4], [8.6, -3.4], [8.6, -1.4], [11, -1.4], [11, 2.6], [8.6, 2.6], [8.6, 5], [4, 5], [4, 13.5], [-4, 13.5], [-4, 5], [-8.6, 5], [-8.6, 2.6], [-11, 2.6], [-11, -1.4], [-8.6, -1.4], [-8.6, -3.4], [-5.6, -3.4], [-5.6, -5.4], [-3.2, -5.4]];
  g.beginPath(); room.forEach(([x, z], k) => { const [px, py] = P(x, z); k ? g.lineTo(px, py) : g.moveTo(px, py); }); g.closePath();
  g.fillStyle = '#262a2f'; g.fill(); g.strokeStyle = '#9a9ea2'; g.lineWidth = 1.6; g.stroke();
  g.strokeStyle = 'rgba(154,158,162,0.25)'; g.lineWidth = 1;
  for (const [x0, z0, x1, z1] of [[-8.6, -1.4, 8.6, -1.4], [-8.6, 2.6, 8.6, 2.6], [-4, 5, 4, 5]]) { const [a, b] = P(x0, z0), [c2, d] = P(x1, z1); g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); }
  g.fillStyle = '#3a4048'; for (const [x, z] of [[-7.9, -2.4], [7.9, -2.4], [-10.3, 5.3], [10.3, 5.3]]) { const [px, py] = P(x, z); g.fillRect(px - 3, py - 3, 6, 6); }
  const [axp, azp] = P(0, -6.9);
  g.fillStyle = '#D69A45'; g.beginPath(); g.moveTo(axp, azp - 6); g.lineTo(axp + 6, azp); g.lineTo(axp, azp + 6); g.lineTo(axp - 6, azp); g.closePath(); g.fill();
  g.fillStyle = '#d0302c';
  for (const e of data.enemies) { const [px, py] = P(e.x, e.z); g.beginPath(); g.arc(px, py, e.elite ? 4.5 : 3.5, 0, Math.PI * 2); g.fill(); }
  const [ppx, ppz] = P(data.player.x, data.player.z);
  g.save(); g.translate(ppx, ppz); g.rotate(Math.PI - data.player.facing);
  g.fillStyle = '#f2efe6'; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 2); g.lineTo(-6, 6); g.closePath(); g.fill();
  g.restore();
}
