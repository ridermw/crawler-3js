// Ruined cathedral crypt: modular stone geometry, sanctum and altar, candles, props, lights and fog.
// All placement is driven by a seeded RNG so the room is identical on every load.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as P from './pixel.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const KEEP = ['position', 'normal', 'uv', 'color'];

// Planar UVs chosen per triangle from its dominant normal axis, in world units.
function worldUV(g, s) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, uv = new Float32Array((p.length / 3) * 2);
  for (let t = 0; t < p.length / 9; t++) {
    let nx = 0, ny = 0, nz = 0;
    for (let v = 0; v < 3; v++) { const i = (t * 3 + v) * 3; nx += n[i]; ny += n[i + 1]; nz += n[i + 2]; }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (let v = 0; v < 3; v++) {
      const k = t * 3 + v, x = p[k * 3], y = p[k * 3 + 1], z = p[k * 3 + 2];
      if (ay >= ax && ay >= az) { uv[k * 2] = x / s; uv[k * 2 + 1] = -z / s; }
      else if (ax >= az) { uv[k * 2] = z / s; uv[k * 2 + 1] = y / s; }
      else { uv[k * 2] = x / s; uv[k * 2 + 1] = y / s; }
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function prep(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], uv = 0, tint = 1 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (!KEEP.includes(k)) g.deleteAttribute(k);
  _e.set(rot[0], rot[1], rot[2], 'YXZ'); _q.setFromEuler(_e);
  g.applyMatrix4(_m.compose(_p.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2])));
  if (uv) worldUV(g, uv);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const t = Array.isArray(tint) ? tint : [tint, tint, tint], col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = t[0]; col[i * 3 + 1] = t[1]; col[i * 3 + 2] = t[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

class Buckets {
  constructor() { this.m = new Map(); }
  // dz shifts everything added while it is set; the sanctum block is authored at z=0 and moved into place.
  add(key, geo) { if (this.dz) geo.translate(0, 0, this.dz); if (!this.m.has(key)) this.m.set(key, []); this.m.get(key).push(geo); }
  build(parent, mats, { cast = true } = {}) {
    for (const [key, list] of this.m) {
      const mesh = new THREE.Mesh(mergeGeometries(list, false), mats[key]);
      mesh.castShadow = cast && !['floor', 'mortar', 'glow'].includes(key); mesh.receiveShadow = true;
      mesh.name = key; parent.add(mesh);
    }
  }
}

// Walkable footprint of the cruciform crypt (axis-aligned rectangles).
const WALK = [
  { x0: -8.6, x1: 8.6, z0: -3.3, z1: 14.5 },   // nave
  { x0: -10.6, x1: 10.6, z0: -1.4, z1: 2.6 },  // side bays between the pedestals
];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.r = P.rng(20251016);
    this.b = new Buckets();
    this.obstacles = [];
    this.candles = [];
    this.lights = [];
    this.anim = [];
    this.grates = [[5.1, 0.2], [-5.4, 5.5], [0.2, 14.6]];
    this.altar = new THREE.Vector3(0, 0.75, -6.55);
    this.SANCTUM_DZ = 1.7;
    this.spawns = [[-6.4, -2.0], [9.8, 0.6], [-9.8, 0.6]];
    this.materials();
    this.floor();
    this.b.dz = this.SANCTUM_DZ; this.sanctum(); this.b.dz = 0;
    this.altar.z += this.SANCTUM_DZ;
    this.architecture();
    this.props();
    this.b.build(this.root, this.mats);
    this.buildCandles();
    this.lighting();
    this.atmosphere();
  }

  materials() {
    const floor = P.stoneSurface(11, { base: [108, 106, 104], contrast: 1.3, normal: 7, warm: 0.2 });
    const wall = P.stoneSurface(23, { base: [92, 94, 98], contrast: 1.2, cracks: 34, warm: 0.15, normal: 7 });
    const relief = P.gothicRelief(5, { base: [104, 104, 106] });
    const reliefAltar = P.gothicRelief(9, { base: [118, 112, 104], emblem: true });
    const iron = P.rustIron(31), bone = P.boneSurface(41), carpet = P.carpetTex(51);
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
    this.mats = {
      floor: std({ ...floor, vertexColors: true, normalScale: new THREE.Vector2(0.8, 0.8) }),
      stone: std({ ...wall, vertexColors: true, normalScale: new THREE.Vector2(1.2, 1.2) }),
      dark: std({ ...wall, color: '#7b8088', vertexColors: true }),
      relief: std({ ...relief }),
      reliefAltar: std({ ...reliefAltar }),
      mortar: std({ color: '#45474b', roughness: 1 }),
      iron: std({ ...iron, metalness: 0.6, vertexColors: true }),
      bone: std({ ...bone, color: '#cfc4a8', roughness: 0.75, vertexColors: true }),
      carpet: std({ ...carpet, vertexColors: true }),
      wax: std({ color: '#d9cfb2', roughness: 0.55, vertexColors: true, emissive: '#3a2a10', emissiveIntensity: 0.25 }),
      brass: std({ color: '#8A6A35', roughness: 0.45, metalness: 0.8, vertexColors: true }),
      glow: new THREE.MeshBasicMaterial({ color: '#ffb35a', vertexColors: true, toneMapped: false }),
    };
    this.tex = { banner0: P.bannerTex(61, 0), banner1: P.bannerTex(62, 1), lancet: P.lancetTex(71), fog: P.fogTex(81), disc: P.softDisc(128) };
  }

  // ------------------------------------------------------------ geometry helpers
  slab(w, h, d, x, y, z, { key = 'stone', ry = 0, rx = 0, rz = 0, tint = 1, bevel = 0.04, uv = 2.2 } = {}) {
    const geo = bevel > 0 ? new RoundedBoxGeometry(w, h, d, 1, Math.min(bevel, w / 2.2, h / 2.2, d / 2.2)) : new THREE.BoxGeometry(w, h, d);
    this.b.add(key, prep(geo, { pos: [x, y, z], rot: [rx, ry, rz], uv, tint }));
  }
  // A wall built from coursed blocks with a broken, uneven top.
  wall(x0, z0, x1, z1, height, { thick = 0.7, course = 0.5, block = [0.7, 1.3], broken = 0.6, tint = 1, gapsAt = [] } = {}) {
    const r = this.r, len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len, ry = Math.atan2(-uz, ux);
    let s = 0; const cols = [];
    while (s < len - 0.05) { const w = Math.min(len - s, P.range(r, block[0], block[1])); cols.push([s, w]); s += w; }
    // broken silhouette: random-walk the column height
    let top = height;
    for (let c = 0; c < cols.length; c++) {
      top = Math.max(height * (1 - broken), Math.min(height, top + (r() - 0.5) * course * 3));
      cols[c].push(top);
    }
    const rows = Math.ceil(height / course);
    for (let row = 0; row < rows; row++) {
      const offset = (row % 2) * 0.35;
      for (let c = 0; c < cols.length; c++) {
        const [cs, cw, ctop] = cols[c];
        const y = row * course;
        if (y + course * 0.5 > ctop) continue;
        const a = Math.max(0, cs - offset * (c > 0 ? 1 : 0)), b = Math.min(len, cs + cw - (c < cols.length - 1 ? offset : 0));
        if (b - a < 0.15) continue;
        const mid = (a + b) / 2;
        if (gapsAt.some(([g0, g1, gy0, gy1]) => mid > g0 && mid < g1 && y + course / 2 > gy0 && y < gy1)) continue;
        const h = Math.min(course, ctop - y) - 0.035;
        const jt = (r() - 0.5) * 0.06;
        this.slab(b - a - 0.04, h, thick + jt, x0 + ux * mid, y + h / 2, z0 + uz * mid, { ry, tint: tint * P.range(r, 0.72, 1.12), rz: (r() - 0.5) * 0.02, bevel: 0.035 });
      }
    }
    // fallen blocks at the foot
    for (let k = 0; k < len * 0.6; k++) {
      const t = r() * len, side = r() < 0.5 ? -1 : 1;
      this.rock(x0 + ux * t - uz * side * (thick * 0.5 + r() * 0.8), z0 + uz * t + ux * side * (thick * 0.5 + r() * 0.8), P.range(r, 0.12, 0.32));
    }
  }
  rock(x, z, size, tint = 1) {
    const r = this.r;
    this.b.add('stone', prep(new THREE.IcosahedronGeometry(size, 0), { pos: [x, size * 0.35, z], rot: [r() * 3, r() * 3, r() * 3], scale: [P.range(r, 0.8, 1.4), P.range(r, 0.5, 0.9), P.range(r, 0.8, 1.3)], uv: 1.5, tint: tint * P.range(r, 0.7, 1.1) }));
  }
  rubble(x, z, radius, count, tint = 1) {
    const r = this.r;
    for (let k = 0; k < count; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
      this.rock(x + Math.cos(a) * d, z + Math.sin(a) * d, P.range(r, 0.05, 0.22) * (1 - d / radius * 0.5), tint);
    }
  }
  bones(x, z, radius, count, skulls = 1) {
    const r = this.r;
    for (let k = 0; k < count; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius, bx = x + Math.cos(a) * d, bz = z + Math.sin(a) * d, len = P.range(r, 0.25, 0.55), ry = r() * Math.PI;
      this.b.add('bone', prep(new THREE.CylinderGeometry(0.025, 0.03, len, 5), { pos: [bx, 0.04 + r() * 0.05, bz], rot: [0, ry, Math.PI / 2 + (r() - 0.5) * 0.3] }));
      for (const s of [-1, 1]) this.b.add('bone', prep(new THREE.SphereGeometry(0.045, 5, 4), { pos: [bx + Math.cos(ry) * s * len / 2, 0.05, bz - Math.sin(ry) * s * len / 2] }));
    }
    for (let k = 0; k < skulls; k++) this.skull(x + (r() - 0.5) * radius, z + (r() - 0.5) * radius, r() * 6);
  }
  skull(x, z, ry, s = 1) {
    this.b.add('bone', prep(new THREE.SphereGeometry(0.13 * s, 8, 6), { pos: [x, 0.12 * s, z], scale: [1, 0.95, 1.15] }));
    this.b.add('bone', prep(new THREE.BoxGeometry(0.16 * s, 0.08 * s, 0.12 * s), { pos: [x + Math.sin(ry) * 0.08 * s, 0.05 * s, z + Math.cos(ry) * 0.08 * s], rot: [0, ry, 0] }));
    for (const e of [-1, 1]) this.b.add('mortar', prep(new THREE.SphereGeometry(0.035 * s, 5, 4), { pos: [x + Math.sin(ry) * 0.11 * s + Math.cos(ry) * e * 0.05 * s, 0.14 * s, z + Math.cos(ry) * 0.11 * s - Math.sin(ry) * e * 0.05 * s] }));
  }
  chain(x0, y0, z0, x1, y1, z1, sag = 0.6) {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0), n = Math.max(4, Math.floor(len / 0.13));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * sag;
      const dy = (y1 - y0) / len, horiz = Math.atan2(x1 - x0, z1 - z0);
      this.b.add('iron', prep(new THREE.TorusGeometry(0.065, 0.018, 4, 8), { pos: [x, y, z], rot: [Math.PI / 2 - dy, horiz, k % 2 ? Math.PI / 2 : 0] }));
    }
  }
  hangingChain(x, z, yTop, yBottom) {
    const n = Math.floor((yTop - yBottom) / 0.12);
    for (let k = 0; k <= n; k++) this.b.add('iron', prep(new THREE.TorusGeometry(0.07, 0.02, 4, 8), { pos: [x, yTop - k * 0.12, z], rot: [0, k % 2 ? Math.PI / 2 : 0, Math.PI / 2] }));
  }
  candle(x, y, z, h, radius = 0.05) { this.candles.push({ x, y, z: z + (this.b.dz || 0), h, r: radius }); }
  candleCluster(x, y, z, n, spread, hmax = 0.4) {
    const r = this.r;
    for (let k = 0; k < n; k++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread; this.candle(x + Math.cos(a) * d, y, z + Math.sin(a) * d, P.range(r, 0.1, hmax), P.range(r, 0.035, 0.06)); }
  }

  // ------------------------------------------------------------ floor
  floor() {
    const r = this.r;
    const inGrate = (x, z, pad) => this.grates.some(([gx, gz]) => Math.abs(x - gx) < 0.85 + pad && Math.abs(z - gz) < 0.85 + pad);
    const inRoom = (x, z) => WALK.some(w => x > w.x0 - 0.6 && x < w.x1 + 0.6 && z > w.z0 - 1.6 && z < w.z1 + 0.6);
    // Irregular flagstones: a jittered lattice whose shared corners make four-sided slabs of uneven
    // shape (no straight seam runs across the room). Each slab is an inset, bevel-free prism that
    // settles slightly; a few slabs crack into two shards.
    const pitch = 1.05, nx = 30, nz = 27, x0 = -15.5, z0 = -9.6;
    const jit = [];
    for (let j = 0; j <= nz; j++) { jit.push([]); for (let i = 0; i <= nx; i++) jit[j].push([x0 + i * pitch + (r() - 0.5) * pitch * 0.55, z0 + j * pitch + (r() - 0.5) * pitch * 0.55]); }
    const prism = (pts, y, tint, settleRot) => {
      const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 1 });
      this.b.add('floor', prep(geo, { pos: [0, y, 0], rot: [-Math.PI / 2 + settleRot[0], 0, settleRot[1]], uv: 2.0, tint }));
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      // merge some cells horizontally into long slabs
      const wide = i < nx - 1 && r() < 0.28;
      const q = [jit[j][i], jit[j][i + (wide ? 2 : 1)], jit[j + 1][i + (wide ? 2 : 1)], jit[j + 1][i]];
      const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
      if (wide) i++;
      if (inGrate(cx, cz, 0.45)) continue;
      const inside = inRoom(cx, cz);
      const tint = (inside ? P.range(r, 0.66, 1.15) : P.range(r, 0.45, 0.8));
      const inset = q.map(([x, z]) => [cx + (x - cx) * 0.94, cz + (z - cz) * 0.94]);
      const y = -0.2 + (inside ? (r() - 0.5) * 0.04 : (r() - 0.5) * 0.12);
      const tilt = [(r() - 0.5) * 0.02, (r() - 0.5) * 0.02];
      if (r() < 0.12) { // cracked: split along a jagged diagonal
        const m1 = [(inset[0][0] + inset[1][0]) / 2 + (r() - 0.5) * 0.3, (inset[0][1] + inset[1][1]) / 2], m2 = [(inset[2][0] + inset[3][0]) / 2 + (r() - 0.5) * 0.3, (inset[2][1] + inset[3][1]) / 2];
        const shrink = poly => { const ax = poly.reduce((a, p) => a + p[0], 0) / poly.length, az = poly.reduce((a, p) => a + p[1], 0) / poly.length; return poly.map(([x, z]) => [ax + (x - ax) * 0.95, az + (z - az) * 0.95]); };
        prism(shrink([inset[0], m1, m2, inset[3]]), y, tint * P.range(r, 0.9, 1.05), tilt);
        prism(shrink([m1, inset[1], inset[2], m2]), y - 0.02, tint * P.range(r, 0.85, 1.0), [tilt[0] * 2, -tilt[1] * 2]);
      } else prism(inset, y, tint, tilt);
    }
    this.b.add('mortar', prep(new THREE.PlaneGeometry(40, 40), { pos: [0, -0.12, 2], rot: [-Math.PI / 2, 0, 0] }));
    // recessed iron grates
    for (const [gx, gz] of this.grates) {
      const s = 1.6, bars = 7;
      // dressed stone surround so the irregular floor meets the grate cleanly
      for (const [fx, fz, fw, fd] of [[0, -1.05, 2.5, 0.5], [0, 1.05, 2.5, 0.5], [-1.05, 0, 0.5, 1.6], [1.05, 0, 0.5, 1.6]])
        this.slab(fw - 0.04, 0.24, fd - 0.04, gx + fx, -0.08, gz + fz, { key: 'floor', tint: P.range(r, 0.8, 0.95), bevel: 0.04, uv: 2.0 });
      this.b.add('mortar', prep(new THREE.BoxGeometry(s, 0.05, s), { pos: [gx, -0.45, gz] }));
      for (const [fx, fz, fw, fd] of [[0, -s / 2, s + 0.16, 0.12], [0, s / 2, s + 0.16, 0.12], [-s / 2, 0, 0.12, s], [s / 2, 0, 0.12, s]])
        this.b.add('iron', prep(new THREE.BoxGeometry(fw, 0.1, fd), { pos: [gx + fx, -0.02, gz + fz], uv: 1 }));
      for (let k = 1; k < bars; k++) {
        const o = -s / 2 + k * s / bars;
        this.b.add('iron', prep(new THREE.BoxGeometry(0.07, 0.08, s), { pos: [gx + o, -0.05, gz], uv: 1 }));
        this.b.add('iron', prep(new THREE.BoxGeometry(s, 0.06, 0.07), { pos: [gx, -0.07, gz + o], uv: 1 }));
      }
    }
  }

  // ------------------------------------------------------------ sanctum, dais, altar, tabernacle
  sanctum() {
    const r = this.r, A = this.altar, dz0 = -8.6, dz1 = -5.3, dw = 3.4;
    // three-step dais
    for (let s = 0; s < 3; s++) {
      const y = s * 0.25, front = dz1 - s * 0.42, half = dw - s * 0.35;
      let x = -half;
      while (x < half - 0.01) {
        const w = Math.min(half - x, P.range(r, 0.8, 1.4));
        this.slab(w - 0.04, 0.25, front - dz0, x + w / 2, y + 0.125, (front + dz0) / 2, { tint: P.range(r, 0.85, 1.1), bevel: 0.04 });
        x += w;
      }
    }
    this.b.add('carpet', prep(new THREE.BoxGeometry(1.3, 0.02, 3.6), { pos: [0, 0.76, -6.4] }));
    for (let s = 0; s < 3; s++) this.b.add('carpet', prep(new THREE.BoxGeometry(1.3, 0.25, 0.02), { pos: [0, s * 0.25 + 0.125, dz1 - s * 0.42 + 0.011] }));
    // altar block with relief panels
    const ay = A.y;
    this.slab(3.3, 0.22, 1.7, A.x, ay + 0.11, A.z - 0.2, { tint: 0.9 });
    this.slab(2.9, 1.0, 1.25, A.x, ay + 0.72, A.z - 0.2, { tint: 1.0 });
    this.slab(3.2, 0.16, 1.5, A.x, ay + 1.3, A.z - 0.2, { tint: 1.08 });
    for (let k = -1; k <= 1; k++) this.b.add('reliefAltar', prep(new THREE.PlaneGeometry(0.82, 0.86), { pos: [A.x + k * 0.92, ay + 0.72, A.z - 0.2 + 0.63] }));
    for (const s of [-1, 1]) this.b.add('reliefAltar', prep(new THREE.PlaneGeometry(0.9, 0.86), { pos: [A.x + s * 1.46, ay + 0.72, A.z - 0.2], rot: [0, s * Math.PI / 2, 0] }));
    // gothic reliquary tabernacle behind the altar
    const tz = A.z - 1.25, ty = ay + 1.38;
    this.slab(2.2, 0.9, 0.7, 0, ty + 0.45, tz, { tint: 0.95 });
    this.b.add('reliefAltar', prep(new THREE.PlaneGeometry(0.8, 0.85), { pos: [0, ty + 0.45, tz + 0.36] }));
    this.slab(1.3, 1.6, 0.55, 0, ty + 1.7, tz, { tint: 1.0 });
    this.b.add('relief', prep(new THREE.PlaneGeometry(1.0, 1.5), { pos: [0, ty + 1.7, tz + 0.28] }));
    this.b.add('glow', prep(new THREE.BoxGeometry(0.06, 0.6, 0.02), { pos: [0, ty + 1.7, tz + 0.3], tint: [1, 0.8, 0.45] }));
    this.b.add('glow', prep(new THREE.BoxGeometry(0.34, 0.06, 0.02), { pos: [0, ty + 1.85, tz + 0.3], tint: [1, 0.8, 0.45] }));
    this.b.add('stone', prep(new THREE.ConeGeometry(0.75, 1.3, 4), { pos: [0, ty + 3.15, tz], rot: [0, Math.PI / 4, 0], uv: 1.5 }));
    for (const s of [-1, 1]) {
      this.slab(0.28, 2.4, 0.28, s * 0.8, ty + 1.2, tz + 0.05, { tint: 0.92 });
      this.b.add('stone', prep(new THREE.ConeGeometry(0.22, 0.8, 4), { pos: [s * 0.8, ty + 2.8, tz + 0.05], rot: [0, Math.PI / 4, 0], uv: 1.5 }));
      this.slab(0.22, 1.5, 0.22, s * 1.25, ty + 0.75, tz + 0.05, { tint: 0.9 });
      this.b.add('stone', prep(new THREE.ConeGeometry(0.17, 0.55, 4), { pos: [s * 1.25, ty + 1.78, tz + 0.05], rot: [0, Math.PI / 4, 0], uv: 1.5 }));
    }
    // corner pinnacle posts on the dais
    for (const [px, pz] of [[-3.0, -5.6], [3.0, -5.6], [-3.0, -8.2], [3.0, -8.2]]) {
      this.slab(0.5, 0.35, 0.5, px, 0.92, pz, { tint: 0.9 });
      this.slab(0.34, 1.9, 0.34, px, 2.05, pz, { tint: 1.0 });
      this.b.add('stone', prep(new THREE.ConeGeometry(0.3, 0.9, 4), { pos: [px, 3.45, pz], rot: [0, Math.PI / 4, 0], uv: 1.5 }));
      this.candleCluster(px, 0.75, pz + 0.45, 3, 0.2, 0.3);
      this.obstacles.push({ x: px, z: pz + (this.b.dz || 0), r: 0.45 });
    }
    // candles: altar top, steps and dais
    for (let k = 0; k < 14; k++) this.candle(A.x - 1.4 + (k % 7) * 0.46 + (r() - 0.5) * 0.1, ay + 1.38, A.z - 0.75 + Math.floor(k / 7) * 0.95 + (r() - 0.5) * 0.12, P.range(r, 0.15, 0.42), 0.05);
    for (let k = 0; k < 8; k++) this.candle(-1.0 + k * 0.28, ty + 0.9, tz + 0.15, P.range(r, 0.1, 0.25), 0.04);
    for (let s = 0; s < 3; s++) for (const side of [-1, 1]) for (let k = 0; k < 3; k++)
      this.candle(side * (1.0 + k * 0.5 + r() * 0.3 + s * 0.2), s * 0.25 + 0.25, dz1 - s * 0.42 - 0.2, P.range(r, 0.12, 0.35), 0.045);
    this.candleCluster(-2.2, 0.75, -6.0, 6, 0.4);
    this.candleCluster(2.2, 0.75, -6.0, 6, 0.4);
    this.candleCluster(-2.4, 0.75, -7.6, 5, 0.35, 0.5);
    this.candleCluster(2.4, 0.75, -7.6, 5, 0.35, 0.5);
    this.bones(-2.0, -4.7, 0.6, 7, 1); this.bones(2.4, -4.8, 0.5, 5, 2);
  }

  // ------------------------------------------------------------ walls, pillars, balustrades, alcoves
  pillar(x, z, height, { banner = -1, broken = false, size = 1.15 } = {}) {
    const r = this.r;
    this.slab(size + 0.5, 0.5, size + 0.5, x, 0.25, z, { tint: 0.85 });
    this.slab(size + 0.3, 0.25, size + 0.3, x, 0.62, z, { tint: 0.95 });
    let y = 0.75;
    const top = broken ? height * P.range(r, 0.55, 0.8) : height;
    while (y < top - 0.05) {
      const h = Math.min(P.range(r, 0.5, 0.8), top - y);
      this.slab(size, h - 0.04, size, x + (r() - 0.5) * 0.03, y + h / 2, z + (r() - 0.5) * 0.03, { tint: P.range(r, 0.78, 1.08), bevel: 0.05 });
      y += h;
    }
    if (broken) {
      for (let k = 0; k < 3; k++) this.slab(size * P.range(r, 0.3, 0.55), P.range(r, 0.2, 0.5), size * P.range(r, 0.3, 0.55), x + (r() - 0.5) * size * 0.5, top + 0.15, z + (r() - 0.5) * size * 0.5, { rx: (r() - 0.5) * 0.4, rz: (r() - 0.5) * 0.4, tint: 0.9 });
      this.rubble(x, z, 1.8, 16);
    } else {
      this.slab(size + 0.3, 0.35, size + 0.3, x, top + 0.17, z, { tint: 1.05 });
      this.slab(size + 0.5, 0.3, size + 0.5, x, top + 0.5, z, { tint: 0.95 });
    }
    // carved relief panels on all four faces
    const ph = Math.min(2.4, top - 1.2);
    for (let f = 0; f < 4; f++) {
      const a = f * Math.PI / 2, nx = Math.sin(a), nz = Math.cos(a);
      this.b.add('relief', prep(new THREE.PlaneGeometry(size * 0.8, ph), { pos: [x + nx * (size / 2 + 0.012), 1.0 + ph / 2, z + nz * (size / 2 + 0.012)], rot: [0, a, 0] }));
    }
    if (banner >= 0) this.banner(x, Math.min(top - 0.2, 6.2), z + size / 2 + 0.06, banner);
    this.obstacles.push({ x, z: z + (this.b.dz || 0), r: size * 0.75 + 0.2 });
  }
  banner(x, yTop, z, variant, w = 1.0, h = 2.6) {
    const mat = new THREE.MeshStandardMaterial({ map: variant ? this.tex.banner1 : this.tex.banner0, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95 });
    const geo = new THREE.PlaneGeometry(w, h, 4, 8); geo.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, yTop, z + (this.b.dz || 0)); m.castShadow = true;
    m.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mat.map, alphaTest: 0.5 });
    this.root.add(m);
    this.slab(w + 0.25, 0.06, 0.06, x, yTop + 0.03, z, { key: 'iron', bevel: 0 });
    this.anim.push(t => { m.rotation.x = Math.sin(t * 0.7 + x) * 0.035; });
  }
  stepped(x, z, w, d, side) {
    const r = this.r;
    const tiers = [[w, 0.55, d], [w * 0.8, 0.5, d * 0.8], [w * 0.55, 0.5, d * 0.6]];
    let y = 0;
    for (const [tw, th, td] of tiers) {
      const n = Math.max(1, Math.round(tw / 0.8));
      for (let k = 0; k < n; k++) this.slab(tw / n - 0.04, th - 0.03, td, x - tw / 2 + (k + 0.5) * tw / n + side * (w - tw) * 0.3, y + th / 2, z + (r() - 0.5) * 0.05, { tint: P.range(r, 0.8, 1.05) });
      y += th;
    }
    this.slab(0.5, 1.1, 0.5, x + side * w * 0.25, y + 0.55, z, { tint: 0.95 });
    this.slab(0.66, 0.16, 0.66, x + side * w * 0.25, y + 1.18, z, { tint: 1.05 });
    this.obstacles.push({ x, z, r: Math.max(w, d) * 0.55 });
  }
  window(x, y, z, w, h, ry = 0) {
    const mat = new THREE.MeshBasicMaterial({ map: this.tex.lancet, transparent: true, toneMapped: true, color: '#6f7d88' });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z + (this.b.dz || 0)); m.rotation.y = ry; this.root.add(m);
    // stone jamb and pointed hood
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const side of [-1, 1]) this.slab(0.18, h * 0.75, 0.3, x + c * side * (w / 2 + 0.06), y - h * 0.12, z - s * side * (w / 2 + 0.06), { ry, tint: 1.05 });
    this.slab(w + 0.4, 0.16, 0.34, x, y - h / 2 - 0.08, z, { ry, tint: 1.05 });
  }
  // Square stepped pedestal carrying a short carved column: the four landmarks framing the nave.
  pedestal(x, z, { size = 2.2, column = 2.0, broken = false } = {}) {
    const r = this.r;
    let y = 0, w = size;
    for (const h of [0.35, 0.3, 0.3]) {
      const n = Math.max(2, Math.round(w / 0.75));
      for (let k = 0; k < n; k++) this.slab(w / n - 0.04, h - 0.03, w - 0.04, x - w / 2 + (k + 0.5) * w / n, y + h / 2, z, { tint: P.range(r, 0.8, 1.05) });
      y += h; w -= 0.42;
    }
    const cw = w - 0.1, top = broken ? column * P.range(r, 0.55, 0.75) : column;
    let cy = y;
    while (cy < y + top - 0.05) { const h = Math.min(P.range(r, 0.5, 0.75), y + top - cy); this.slab(cw, h - 0.04, cw, x, cy + h / 2, z, { tint: P.range(r, 0.82, 1.06), bevel: 0.05 }); cy += h; }
    for (let f = 0; f < 4; f++) {
      const a = f * Math.PI / 2;
      this.b.add('relief', prep(new THREE.PlaneGeometry(cw * 0.78, Math.min(1.6, top - 0.3)), { pos: [x + Math.sin(a) * (cw / 2 + 0.012), y + 0.15 + Math.min(1.6, top - 0.3) / 2, z + Math.cos(a) * (cw / 2 + 0.012)], rot: [0, a, 0] }));
    }
    if (broken) { this.rubble(x, z + size * 0.6, 1.4, 14); for (let k = 0; k < 2; k++) this.slab(cw * 0.5, 0.3, cw * 0.45, x + (r() - 0.5) * cw * 0.4, y + top + 0.1, z + (r() - 0.5) * cw * 0.4, { rx: (r() - 0.5) * 0.5, rz: (r() - 0.5) * 0.5 }); }
    else { this.slab(cw + 0.3, 0.22, cw + 0.3, x, y + top + 0.11, z, { tint: 1.05 }); this.slab(cw + 0.1, 0.2, cw + 0.1, x, y + top + 0.32, z, { tint: 0.95 }); }
    this.candleCluster(x + size * 0.32, 0.95, z + size * 0.32, 2, 0.12, 0.3);
    this.obstacles.push({ x, z, r: size * 0.62 });
  }
  architecture() {
    this.b.dz = this.SANCTUM_DZ;
    // sanctum walls behind the altar with moonlit lancet windows
    this.wall(-4.6, -9.1, 4.6, -9.1, 7.5, { thick: 0.8, broken: 0.25, gapsAt: [[1.6, 3.0, 2.6, 6.4], [6.2, 7.6, 2.6, 6.4], [3.9, 5.3, 3.4, 7.5]] });
    this.window(-2.3, 4.4, -9.08, 1.25, 3.4); this.window(2.3, 4.4, -9.08, 1.25, 3.4); this.window(0, 5.3, -9.08, 1.25, 3.6);
    this.wall(-4.6, -7.6, -4.6, -9.1, 6.5, { thick: 0.7, broken: 0.4 });
    this.wall(4.6, -9.1, 4.6, -7.6, 6.5, { thick: 0.7, broken: 0.4 });
    // rear nave wall, broken along its top, with candle niches
    this.wall(-14, -7.9, -4.6, -7.9, 5.0, { thick: 0.8, broken: 0.45, gapsAt: [[3.0, 4.2, 0.6, 2.2]] });
    this.wall(4.6, -7.9, 14, -7.9, 5.0, { thick: 0.8, broken: 0.45, gapsAt: [[5.2, 6.4, 0.6, 2.2]] });
    this.candleCluster(-7.4, 0.6, -7.9, 5, 0.3); this.candleCluster(7.4, 0.6, -7.9, 5, 0.3);
    for (const s of [-1, 1]) this.slab(1.2, 0.1, 0.8, s * 7.4, 0.55, -7.9, { tint: 0.9 });
    // tall banner pillars flanking the sanctum
    this.pillar(-4.6, -6.3, 8.5, { banner: 0 });
    this.pillar(4.6, -6.3, 8.5, { banner: 1 });
    this.chain(-4.6, 7.6, -5.65, 0, 6.8, -5.9, 1.2); this.chain(4.6, 7.6, -5.65, 0, 6.8, -5.9, 1.2);
    this.b.dz = 0;
    // pedestals: upper pair beside the sanctum mouth, lower pair on the flanks
    this.pedestal(-7.9, -2.4); this.pedestal(7.9, -2.4);
    this.pedestal(-10.3, 5.3, { broken: true }); this.pedestal(10.3, 5.3, { broken: true });
    // stepped walls running between the pedestals, and low ruined walls at the outer edges
    for (const s of [-1, 1]) {
      this.wall(s * 9.2, -0.8, s * 10.0, 3.8, 1.2, { thick: 0.9, broken: 0.5 });
      this.wall(s * 11.2, 7.2, s * 10.0, 17, 1.8, { thick: 0.9, broken: 0.6 });
      this.wall(s * 10.4, -7.6, s * 12.6, -3.6, 3.0, { thick: 0.8, broken: 0.6 });
      this.stepped(s * 9.4, 10.6, 1.8, 1.6, s);
      this.bones(s * 10.9, 0.9, 0.6, 8, 2);
      this.candleCluster(s * 11.6, 0, -1.8, 6, 0.4, 0.45);
    }
    // hanging chains between the tall pillars and from the vault
    for (const [x, z, y0, y1] of [[-6.4, -6.8, 11, 4.6], [6.6, -6.6, 11, 5.4], [-2.6, -7.0, 11, 7.0], [11.2, -2.5, 12, 6.2], [-11.4, -2.0, 12, 5.8]]) this.hangingChain(x, z, y0, y1);
  }

  // ------------------------------------------------------------ props
  props() {
    const r = this.r;
    this.b.dz = this.SANCTUM_DZ;
    // fallen fluted column against the right rear wall
    this.b.add('stone', prep(new THREE.CylinderGeometry(0.42, 0.45, 3.4, 12, 3), { pos: [7.0, 0.45, -6.6], rot: [0, 0.35, Math.PI / 2 - 0.12], uv: 1.6, tint: 0.95 }));
    this.slab(1.1, 0.4, 1.1, 8.6, 0.2, -7.0, { ry: 0.3, tint: 0.9 });
    this.rubble(7.4, -6.2, 1.2, 14);
    // hanging iron brazier cage with embers
    const bx = 6.6, by = 4.2, bz = -5.4;
    this.hangingChain(bx, bz, 11, by + 0.8);
    for (const y of [by - 0.45, by + 0.45]) this.b.add('iron', prep(new THREE.TorusGeometry(0.42, 0.03, 4, 14), { pos: [bx, y, bz], rot: [Math.PI / 2, 0, 0] }));
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; this.b.add('iron', prep(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 4), { pos: [bx + Math.cos(a) * 0.42, by, bz + Math.sin(a) * 0.42] })); }
    this.b.add('iron', prep(new THREE.ConeGeometry(0.44, 0.4, 10, 1, true), { pos: [bx, by + 0.65, bz] }));
    this.b.add('glow', prep(new THREE.IcosahedronGeometry(0.18, 1), { pos: [bx, by - 0.3, bz], tint: [1, 0.55, 0.2] }));
    this.brazier = new THREE.Vector3(bx, by - 0.2, bz + this.SANCTUM_DZ);
    this.b.dz = 0;
    // iron candle stands
    for (const [x, z] of [[-6.6, 6.0], [7.0, 5.0], [-6.2, -5.2], [6.2, -5.2]]) {
      this.b.add('iron', prep(new THREE.CylinderGeometry(0.04, 0.06, 1.1, 6), { pos: [x, 0.55, z] }));
      this.b.add('iron', prep(new THREE.CylinderGeometry(0.22, 0.12, 0.08, 8), { pos: [x, 1.12, z] }));
      this.b.add('iron', prep(new THREE.CylinderGeometry(0.28, 0.32, 0.06, 8), { pos: [x, 0.03, z] }));
      this.candleCluster(x, 1.16, z, 3, 0.1, 0.3);
    }
    // rubble and bone piles: corners, pedestal feet and the foreground flanks
    for (const [x, z, rad, n] of [[-8.0, 9.6, 1.6, 26], [8.0, 9.0, 1.6, 26], [-6.8, -6.0, 1.0, 12], [-12, 10, 2, 30], [12, 10, 2, 30], [-12.4, -5.4, 1.8, 26], [12.4, -5.4, 1.8, 26], [0.2, -5.0, 0.6, 5], [-9.6, -0.2, 1.0, 12], [9.6, -0.4, 1.0, 12], [-4.2, 12.0, 1.0, 10], [4.6, 12.2, 1.0, 10]]) this.rubble(x, z, rad, n);
    for (const [x, z, rad, n, sk] of [[-7.6, 1.2, 0.6, 10, 2], [7.8, 1.0, 0.7, 12, 3], [-7.4, 7.6, 0.6, 9, 1], [7.4, 7.0, 0.5, 7, 2], [-5.4, -4.4, 0.4, 5, 1], [-9.0, 11.0, 0.7, 10, 2], [8.8, -5.6, 0.8, 12, 3]]) this.bones(x, z, rad, n, sk);
    for (let k = 0; k < 30; k++) { const x = P.range(r, -8, 8), z = P.range(r, -5, 12); if (Math.hypot(x, z - 1) > 2.5) this.rock(x, z, P.range(r, 0.04, 0.1)); }
  }

  // ------------------------------------------------------------ candles (instanced)
  buildCandles() {
    const n = this.candles.length;
    const waxGeo = new THREE.CylinderGeometry(1, 1, 1, 7); waxGeo.translate(0, 0.5, 0);
    const wax = new THREE.InstancedMesh(waxGeo, new THREE.MeshStandardMaterial({ color: '#d8ccb0', roughness: 0.5, emissive: '#5a3a14', emissiveIntensity: 0.35 }), n);
    const flameGeo = new THREE.SphereGeometry(1, 6, 5); flameGeo.translate(0, 1, 0);
    const flame = new THREE.InstancedMesh(flameGeo, new THREE.MeshBasicMaterial({ color: '#ffd28a', toneMapped: false }), n);
    const halo = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.tex.disc, color: '#e0903a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), n);
    const puddles = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.candles.forEach((c, k) => {
      m.compose(p.set(c.x, c.y, c.z), q.identity(), s.set(c.r, c.h, c.r)); wax.setMatrixAt(k, m);
      wax.setColorAt(k, new THREE.Color().setHSL(0.11, 0.25, 0.62 + (k * 37 % 17) / 100));
      puddles.push(prep(new THREE.CylinderGeometry(c.r * 1.9, c.r * 2.2, 0.02, 7), { pos: [c.x, c.y + 0.01, c.z] }));
      puddles.push(prep(new THREE.SphereGeometry(c.r * 0.55, 4, 3), { pos: [c.x + c.r * 0.9, c.y + c.h * 0.6, c.z], scale: [0.6, 2.2, 0.6] }));
    });
    const wp = new THREE.Mesh(mergeGeometries(puddles), this.mats.wax); wp.receiveShadow = true; this.root.add(wp);
    wax.castShadow = false; wax.receiveShadow = true;
    this.root.add(wax, flame, halo);
    this.candleMesh = { wax, flame, halo };
  }

  // ------------------------------------------------------------ lights
  lighting() {
    const moon = new THREE.DirectionalLight('#b6bec4', 2.8);
    moon.position.set(-6, 24, 3); moon.target.position.set(0, 0, -1);
    moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 60 });
    moon.shadow.bias = -0.0005; moon.shadow.normalBias = 0.03;
    this.scene.add(moon, moon.target); this.moon = moon;
    this.hemi = new THREE.HemisphereLight('#727c86', '#1e1d1c', 1.5); this.scene.add(this.hemi);
    const warm = (x, y, z, i, d = 8, col = '#D69A45') => { const l = new THREE.PointLight(col, i, d, 1.5); l.position.set(x, y, z); l.userData.base = i; this.scene.add(l); this.lights.push(l); return l; };
    const S = this.SANCTUM_DZ;
    warm(0, 2.6, -5.6 + S, 13, 9); warm(-2.4, 1.5, -6.6 + S, 9, 6); warm(2.4, 1.5, -6.6 + S, 9, 6);
    warm(-7.4, 1.4, -7.2 + S, 6, 5); warm(7.4, 1.4, -7.2 + S, 6, 5);
    warm(-10.4, 1.2, -2.4, 5, 5); warm(10.4, 1.2, -2.4, 5, 5);
    warm(this.brazier.x, this.brazier.y, this.brazier.z, 7, 6, '#e07a30');
    // moonlight pooling on the central floor through the broken roof
    const pool = new THREE.SpotLight('#c9d0d5', 0, 0, 0.42, 1, 0);
    pool.position.set(-1.5, 16, -0.5); pool.target.position.set(0, 0, 1.2);
    this.scene.add(pool, pool.target); this.pool = pool;
  }

  // ------------------------------------------------------------ fog and moon shafts
  atmosphere() {
    this.fogPlanes = [];
    const r = this.r;
    for (let k = 0; k < 7; k++) {
      const tex = this.tex.fog.clone(); tex.needsUpdate = true; tex.repeat.set(1.5, 1.5);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: '#6c757c', transparent: true, opacity: 0.06, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), mat);
      m.rotation.x = -Math.PI / 2; m.position.set(P.range(r, -9, 9), 0.25 + k * 0.12, P.range(r, -3, 11));
      m.userData.v = [P.range(r, -0.01, 0.01), P.range(r, -0.006, 0.006)];
      this.root.add(m); this.fogPlanes.push(m);
    }
    const shaftTex = (() => { const { c, g } = P.makeCanvas(64, 256); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); const g2 = g.createLinearGradient(0, 0, 64, 0); g2.addColorStop(0, 'rgba(0,0,0,1)'); g2.addColorStop(0.5, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = g2; g.fillRect(0, 0, 64, 256); return P.toTexture(c, { repeat: false }); })();
    for (const [x, z, w] of [[-3.5, -7, 2.4], [3.2, -7.5, 1.8], [-7, -2, 2.0]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 12), new THREE.MeshBasicMaterial({ map: shaftTex, color: '#8BA7B8', transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.position.set(x, 5, z); m.rotation.z = 0.38; this.root.add(m);
    }
  }

  setCandleScale(k) { for (const l of this.lights) { l.userData.base0 ??= l.userData.base; l.userData.base = l.userData.base0 * k; l.intensity = l.userData.base; } }
  setMood(moon, hemi, pool = 0) { this.moon.intensity = moon; this.hemi.intensity = hemi; this.pool.intensity = pool; }

  // ------------------------------------------------------------ per-frame
  update(t, camera) {
    const { flame, halo } = this.candleMesh, m = new THREE.Matrix4(), s = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion();
    this.candles.forEach((c, k) => {
      const f = 0.85 + 0.15 * Math.sin(t * 9 + k * 1.7) * Math.sin(t * 5.3 + k * 0.6);
      m.compose(p.set(c.x, c.y + c.h, c.z), q.identity(), s.set(0.022, 0.05 * f, 0.022)); flame.setMatrixAt(k, m);
      if (camera) q.copy(camera.quaternion);
      const hs = 0.42 * (0.9 + 0.1 * f);
      m.compose(p.set(c.x, c.y + c.h + 0.06, c.z), q, s.set(hs, hs, hs)); halo.setMatrixAt(k, m);
      q.identity();
    });
    flame.instanceMatrix.needsUpdate = true; halo.instanceMatrix.needsUpdate = true;
    this.lights.forEach((l, k) => { l.intensity = l.userData.base * (0.9 + 0.1 * Math.sin(t * 7 + k * 2.1) * Math.sin(t * 3.1 + k)); });
    for (const f of this.fogPlanes) { f.material.map.offset.set(t * f.userData.v[0], t * f.userData.v[1]); }
    for (const a of this.anim) a(t);
  }

  // ------------------------------------------------------------ collision
  walkable(x, z) { return WALK.some(w => x > w.x0 && x < w.x1 && z > w.z0 && z < w.z1); }
  resolve(pos, rad, prev) {
    for (const o of this.obstacles) {
      const dx = pos.x - o.x, dz = pos.z - o.z, d = Math.hypot(dx, dz), min = o.r + rad;
      if (d < min && d > 1e-4) { pos.x = o.x + dx / d * min; pos.z = o.z + dz / d * min; }
    }
    if (!this.walkable(pos.x, pos.z)) {
      if (prev && this.walkable(pos.x, prev.z)) pos.z = prev.z;
      else if (prev && this.walkable(prev.x, pos.z)) pos.x = prev.x;
      else if (prev) { pos.x = prev.x; pos.z = prev.z; }
    }
    return pos;
  }
}
