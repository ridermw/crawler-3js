// Characters, abilities, enemy AI and combat VFX.
// The Grave Warden knight fights the Bone Warden and its Skeletal Thralls.
import * as THREE from 'three';
import * as P from './pixel.js';

export const ABILITIES = [
  { key: '1', id: 'cleave', name: 'Greatsword Cleave', cd: 0.7, cost: 0 },
  { key: '2', id: 'bash', name: 'Shield Bash', cd: 6, cost: 12 },
  { key: '3', id: 'lunge', name: 'Shadow Lunge', cd: 8, cost: 18 },
  { key: '4', id: 'ward', name: 'Consecration Ward', cd: 16, cost: 30 },
  { key: 'Q', id: 'vial', name: 'Crimson Vial', cd: 20, cost: 0 },
];
const MAX_HP = 100, MAX_ES = 75, WARDEN_HP = 400, THRALL_HP = 60;
// Characters are authored at human scale; the crypt reads at a slightly heroic scale.
const ACTOR_SCALE = 1.3;

// ---------------------------------------------------------------- materials
let M = null;
function mats() {
  if (M) return M;
  const steel = P.steelSurface(101), bone = P.boneSurface(102), robe = P.clothSurface(103, [30, 24, 26]), cape = P.clothSurface(104, [22, 22, 26]);
  const std = o => new THREE.MeshStandardMaterial({ roughness: 0.8, ...o });
  M = {
    armor: std({ ...steel, color: '#a4a9b0', metalness: 0.35, roughness: 0.45 }),
    armorDark: std({ ...steel, color: '#6a6f76', metalness: 0.3, roughness: 0.55 }),
    leather: std({ color: '#3b2b20', roughness: 0.85 }),
    cloth: std({ ...cape, color: '#a0a0a8', side: THREE.DoubleSide }),
    brass: std({ color: '#a8823e', metalness: 0.45, roughness: 0.4 }),
    blade: std({ color: '#dfe3e8', metalness: 0.5, roughness: 0.25, emissive: '#2a2a2a' }),
    bone: std({ ...bone, color: '#d6cbb0', roughness: 0.7 }),
    boneDark: std({ ...bone, color: '#8c8270', roughness: 0.8 }),
    robe: std({ ...robe, color: '#b0a0a4', side: THREE.DoubleSide }),
    crimson: std({ color: '#7a1a1e', roughness: 0.7 }),
    rust: std({ color: '#5a4030', metalness: 0.5, roughness: 0.7 }),
    eye: new THREE.MeshBasicMaterial({ color: '#ff4a30', toneMapped: false }),
    gem: new THREE.MeshBasicMaterial({ color: '#ff3a2a', toneMapped: false }),
    outline: new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, transparent: true, opacity: 0.22, depthWrite: false }),
  };
  return M;
}
function part(geo, mat, x = 0, y = 0, z = 0, parent, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
const joint = (parent, x, y, z) => { const j = new THREE.Group(); j.position.set(x, y, z); parent.add(j); return j; };
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 6) => new THREE.CylinderGeometry(rt, rb, h, n);
const sph = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// ---------------------------------------------------------------- character builders
function buildKnight() {
  const m = mats(), root = new THREE.Group(), J = {};
  J.hips = joint(root, 0, 0.98, 0);
  part(box(0.42, 0.2, 0.26), m.armorDark, 0, 0, 0, J.hips);
  part(box(0.46, 0.34, 0.06), m.cloth, 0, -0.2, 0.13, J.hips, { rx: 0.08 });
  for (const s of [-1, 1]) {
    const hip = J[s < 0 ? 'hipR' : 'hipL'] = joint(J.hips, s * 0.13, -0.06, 0);
    part(box(0.17, 0.44, 0.19), m.armorDark, 0, -0.22, 0, hip);
    const knee = J[s < 0 ? 'kneeR' : 'kneeL'] = joint(hip, 0, -0.46, 0);
    part(sph(0.09, 6, 4), m.armor, 0, 0, 0.04, knee);
    part(box(0.15, 0.4, 0.17), m.armor, 0, -0.22, 0, knee);
    part(box(0.17, 0.1, 0.27), m.leather, 0, -0.44, 0.05, knee);
  }
  J.torso = joint(J.hips, 0, 0.08, 0);
  part(cyl(0.3, 0.22, 0.6, 7), m.armor, 0, 0.3, 0, J.torso, { sz: 0.72 });
  part(box(0.46, 0.08, 0.3), m.leather, 0, 0.02, 0, J.torso);
  part(box(0.06, 0.4, 0.04), m.brass, 0, 0.32, 0.2, J.torso);
  const cape = part(new THREE.PlaneGeometry(0.62, 1.15, 1, 3), m.cloth, 0, 0.0, -0.24, J.torso, { rx: 0.12 });
  cape.geometry.translate(0, 0.0, 0);
  J.head = joint(J.torso, 0, 0.68, 0);
  part(cyl(0.15, 0.16, 0.32, 8), m.armor, 0, 0.1, 0, J.head);
  part(sph(0.155, 8, 4), m.armor, 0, 0.26, 0, J.head, { sy: 0.6 });
  part(box(0.24, 0.035, 0.02), new THREE.MeshBasicMaterial({ color: '#050505' }), 0, 0.14, 0.15, J.head);
  part(box(0.03, 0.12, 0.3), m.brass, 0, 0.32, 0, J.head);
  for (const s of [-1, 1]) {
    const sh = J[s < 0 ? 'shR' : 'shL'] = joint(J.torso, s * 0.33, 0.52, 0);
    part(sph(0.15, 7, 5), m.armor, s * 0.03, 0.04, 0, sh, { sy: 0.75 });
    part(box(0.13, 0.32, 0.14), m.armorDark, 0, -0.18, 0, sh);
    const el = J[s < 0 ? 'elR' : 'elL'] = joint(sh, 0, -0.34, 0);
    part(box(0.12, 0.3, 0.13), m.armor, 0, -0.15, 0, el);
    part(box(0.13, 0.11, 0.14), m.leather, 0, -0.33, 0, el);
    J[s < 0 ? 'handR' : 'handL'] = joint(el, 0, -0.36, 0);
  }
  // greatsword in the right hand, blade along -Y of the hand
  const sw = J.sword = joint(J.handR, 0, 0, 0.02);
  part(cyl(0.025, 0.025, 0.26, 6), m.leather, 0, 0.04, 0, sw);
  part(sph(0.045, 6, 4), m.brass, 0, 0.19, 0, sw);
  part(box(0.36, 0.05, 0.06), m.brass, 0, -0.1, 0, sw);
  const blade = part(box(0.085, 1.3, 0.022), m.blade, 0, -0.77, 0, sw);
  part(new THREE.ConeGeometry(0.06, 0.16, 4), m.blade, 0, -1.5, 0, sw, { rx: Math.PI, sz: 0.3 });
  J.bladeTip = joint(sw, 0, -1.45, 0);
  // kite shield on the left forearm
  const shield = joint(J.elL, -0.09, -0.16, 0.0);
  part(box(0.05, 0.62, 0.42), m.armorDark, 0, 0, 0, shield);
  part(box(0.06, 0.54, 0.06), m.brass, 0, 0, 0, shield);
  part(box(0.06, 0.06, 0.34), m.brass, 0, 0.08, 0, shield);
  J.root = root; root.userData.blade = blade;
  return J;
}

function buildThrall(seed = 1) {
  const m = mats(), root = new THREE.Group(), J = {}, r = P.rng(seed);
  J.hips = joint(root, 0, 0.9, 0);
  part(box(0.3, 0.1, 0.16), m.bone, 0, 0, 0, J.hips);
  part(new THREE.PlaneGeometry(0.4, 0.4, 1, 2), m.robe, 0, -0.18, 0.08, J.hips, { rx: 0.1 });
  for (const s of [-1, 1]) {
    const hip = J[s < 0 ? 'hipR' : 'hipL'] = joint(J.hips, s * 0.1, -0.04, 0);
    part(cyl(0.035, 0.03, 0.42, 5), m.bone, 0, -0.21, 0, hip);
    const knee = J[s < 0 ? 'kneeR' : 'kneeL'] = joint(hip, 0, -0.43, 0);
    part(sph(0.045, 5, 4), m.bone, 0, 0, 0, knee);
    part(cyl(0.03, 0.025, 0.4, 5), m.bone, 0, -0.2, 0, knee);
    part(box(0.08, 0.04, 0.16), m.bone, 0, -0.42, 0.04, knee);
  }
  J.torso = joint(J.hips, 0, 0.05, 0);
  part(cyl(0.03, 0.03, 0.5, 5), m.boneDark, 0, 0.25, -0.04, J.torso);
  for (let k = 0; k < 4; k++) part(new THREE.TorusGeometry(0.15 - k * 0.012, 0.016, 4, 10, Math.PI * 1.5), m.bone, 0, 0.22 + k * 0.08, 0.0, J.torso, { rx: Math.PI / 2, rz: Math.PI * 0.25 + Math.PI, sy: 0.8 });
  part(box(0.36, 0.05, 0.08), m.bone, 0, 0.52, -0.02, J.torso);
  J.head = joint(J.torso, 0, 0.64, 0);
  part(sph(0.13, 8, 6), m.bone, 0, 0.06, 0, J.head, { sz: 1.1 });
  part(box(0.15, 0.07, 0.12), m.bone, 0, -0.06, 0.05, J.head);
  for (const s of [-1, 1]) part(sph(0.028, 5, 4), m.eye, s * 0.045, 0.07, 0.115, J.head);
  if (r() < 0.6) part(cyl(0.12, 0.15, 0.1, 7), m.rust, 0, 0.15, 0, J.head);
  for (const s of [-1, 1]) {
    const sh = J[s < 0 ? 'shR' : 'shL'] = joint(J.torso, s * 0.2, 0.5, 0);
    part(sph(0.05, 5, 4), m.bone, 0, 0, 0, sh);
    part(cyl(0.03, 0.025, 0.32, 5), m.bone, 0, -0.16, 0, sh);
    const el = J[s < 0 ? 'elR' : 'elL'] = joint(sh, 0, -0.33, 0);
    part(cyl(0.025, 0.02, 0.3, 5), m.bone, 0, -0.15, 0, el);
    J[s < 0 ? 'handR' : 'handL'] = joint(el, 0, -0.32, 0);
  }
  const blade = joint(J.handR, 0, 0, 0);
  part(box(0.04, 0.16, 0.04), m.leather, 0, 0.02, 0, blade);
  part(box(0.16, 0.03, 0.04), m.rust, 0, -0.06, 0, blade);
  part(box(0.07, 0.7, 0.015), m.rust, 0, -0.42, 0, blade);
  J.root = root;
  return J;
}

function buildWarden() {
  const m = mats(), root = new THREE.Group(), J = {};
  J.hips = joint(root, 0, 0.0, 0);
  const robe = new THREE.CylinderGeometry(0.32, 0.72, 1.55, 10, 4, true);
  { // tattered hem: jitter the lowest ring of vertices
    const p = robe.attributes.position, r = P.rng(77);
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.7) p.setY(i, p.getY(i) + r() * 0.22);
  }
  part(robe, m.robe, 0, 0.78, 0, J.hips);
  part(cyl(0.34, 0.36, 0.1, 10), m.crimson, 0, 1.5, 0, J.hips);
  J.torso = joint(J.hips, 0, 1.5, 0);
  part(cyl(0.36, 0.32, 0.6, 8), m.robe, 0, 0.28, 0, J.torso, { sz: 0.75 });
  part(box(0.16, 0.7, 0.02), m.crimson, 0, 0.2, 0.25, J.torso);
  for (const s of [-1, 1]) {
    part(sph(0.2, 7, 5), m.boneDark, s * 0.38, 0.6, 0, J.torso, { sy: 0.6 });
    for (let k = 0; k < 3; k++) part(new THREE.ConeGeometry(0.04, 0.26, 5), m.bone, s * (0.36 + k * 0.06), 0.78, -0.04 + k * 0.05, J.torso, { rz: -s * 0.5 });
  }
  J.head = joint(J.torso, 0, 0.78, 0);
  part(sph(0.17, 8, 6), m.bone, 0, 0.08, 0.02, J.head, { sz: 1.1 });
  part(box(0.18, 0.08, 0.12), m.bone, 0, -0.07, 0.08, J.head);
  for (const s of [-1, 1]) part(sph(0.035, 5, 4), m.eye, s * 0.06, 0.1, 0.16, J.head);
  part(cyl(0.2, 0.19, 0.08, 8), m.brass, 0, 0.21, 0, J.head);
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; part(new THREE.ConeGeometry(0.03, 0.18, 4), m.brass, Math.sin(a) * 0.18, 0.32, Math.cos(a) * 0.18, J.head); }
  for (const s of [-1, 1]) {
    const horn = joint(J.head, s * 0.16, 0.2, -0.02);
    part(new THREE.ConeGeometry(0.06, 0.42, 6), m.boneDark, s * 0.1, 0.16, 0, horn, { rz: -s * 0.75 });
    part(new THREE.ConeGeometry(0.035, 0.24, 5), m.boneDark, s * 0.25, 0.4, 0, horn, { rz: -s * 0.15 });
  }
  part(new THREE.PlaneGeometry(0.8, 1.3, 1, 3), m.robe, 0, -0.1, -0.28, J.torso, { rx: 0.08 });
  for (const s of [-1, 1]) {
    const sh = J[s < 0 ? 'shR' : 'shL'] = joint(J.torso, s * 0.36, 0.5, 0);
    part(cyl(0.11, 0.16, 0.6, 6), m.robe, 0, -0.28, 0, sh);
    const el = J[s < 0 ? 'elR' : 'elL'] = joint(sh, 0, -0.55, 0);
    part(cyl(0.03, 0.03, 0.3, 5), m.bone, 0, -0.15, 0, el);
    J[s < 0 ? 'handR' : 'handL'] = joint(el, 0, -0.32, 0);
  }
  // crimson staff
  const st = J.staff = joint(J.handR, 0, 0, 0);
  part(cyl(0.035, 0.04, 2.3, 6), m.leather, 0, 0.35, 0, st);
  part(new THREE.TorusGeometry(0.13, 0.025, 5, 10), m.brass, 0, 1.55, 0, st);
  for (let k = 0; k < 3; k++) part(new THREE.ConeGeometry(0.025, 0.24, 4), m.boneDark, Math.cos(k * 2.1) * 0.12, 1.66, Math.sin(k * 2.1) * 0.12, st);
  J.gem = part(new THREE.OctahedronGeometry(0.11, 0), m.gem, 0, 1.55, 0, st);
  J.gem.castShadow = false;
  J.root = root;
  return J;
}

function addOutline(J) {
  const group = [];
  J.root.traverse(o => {
    if (o.isMesh && !o.userData.isOutline && o.material !== mats().eye) {
      const ol = new THREE.Mesh(o.geometry, mats().outline); ol.userData.isOutline = true; ol.scale.setScalar(1.08); ol.castShadow = false; ol.visible = false;
      o.add(ol); group.push(ol);
    }
  });
  J.outline = group;
}

// Arc strip with u along the sweep and v across the blade path.
function arcGeometry(r0, r1, a0, a1, n = 32) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = a0 + (a1 - a0) * t;
    for (let j = 0; j < 2; j++) { const rr = j ? r1 : r0; pos.push(Math.sin(a) * rr, 0, Math.cos(a) * rr); uv.push(t, j); }
    if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- entity
class Actor {
  constructor(J, kind, hp, scene) {
    this.J = J; this.kind = kind; this.hp = this.maxHp = hp; this.pos = J.root.position; this.facing = 0;
    this.anim = 'idle'; this.animT = 0; this.walk = 0; this.walkAmt = 0; this.stun = 0; this.hitT = 0; this.cd = 0; this.dead = false; this.deadT = 0;
    this.vel = new THREE.Vector3(); this.radius = kind === 'warden' ? 0.6 : 0.4;
    J.root.scale.setScalar(ACTOR_SCALE); scene.add(J.root);
  }
  face(dx, dz, k = 1) { const target = Math.atan2(dx, dz); let d = target - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d)); this.facing += d * k; }
  play(name) { this.anim = name; this.animT = 0; }
}

export class Combat {
  constructor(scene, world, hooks) {
    this.scene = scene; this.world = world; this.hooks = hooks;
    this.group = new THREE.Group(); scene.add(this.group);
    this.r = P.rng(777);
    this.tex = { arc: P.arcTex(), spark: P.sparkTex(), disc: P.softDisc(64), marker: P.markerTex(), rune: P.runeRingTex(91) };
    this.particles = [];
    this.projectiles = [];
    this.buildFx();
    this.knight = new Actor(buildKnight(), 'knight', MAX_HP, this.group);
    this.enemies = [];
    this.active = false;
  }

  buildFx() {
    const add = (mesh) => { this.group.add(mesh); return mesh; };
    this.arc = add(new THREE.Mesh(arcGeometry(1.45, 1.95, -1.25, 1.3), new THREE.MeshBasicMaterial({ map: this.tex.arc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, color: '#ffe7b0' })));
    this.arc.visible = false;
    this.marker = add(new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ map: this.tex.marker, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: '#ffd48a' })));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false;
    this.markerFlame = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.spark, color: '#ffd890', blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
    this.markerFlame.scale.set(0.16, 0.5, 1); this.markerFlame.visible = false;
    this.wardRing = add(new THREE.Mesh(new THREE.PlaneGeometry(6.4, 6.4), new THREE.MeshBasicMaterial({ map: this.tex.marker, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: '#d69a45', opacity: 0.8 })));
    this.wardRing.rotation.x = -Math.PI / 2; this.wardRing.visible = false;
    this.wardLight = new THREE.PointLight('#e0a050', 0, 6, 1.5); this.group.add(this.wardLight);
    this.rune = add(new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), new THREE.MeshBasicMaterial({ map: this.tex.rune, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: '#ff5040' })));
    this.rune.rotation.x = -Math.PI / 2;
    this.staffLight = new THREE.PointLight('#ff3020', 4, 5, 1.6); this.group.add(this.staffLight);
    this.staffGlow = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.disc, color: '#ff4030', blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.9 })));
    this.staffGlow.scale.setScalar(0.7);
    this.knightLight = new THREE.PointLight('#c8d0d8', 9, 7, 1.3); this.group.add(this.knightLight);
  }

  spawnEnemy(kind, x, z, seed) {
    const J = kind === 'warden' ? buildWarden() : buildThrall(seed);
    if (kind === 'warden') J.root.scale.setScalar(0.98 * ACTOR_SCALE);
    const e = new Actor(J, kind, kind === 'warden' ? WARDEN_HP : THRALL_HP, this.group);
    if (kind !== 'warden') addOutline(J);
    e.pos.set(x, 0, z); e.cd = 1 + this.r() * 1.5; e.castCd = 2.5; e.summonCd = 12;
    this.enemies.push(e); return e;
  }
  clearEnemies() { for (const e of this.enemies) this.group.remove(e.J.root); this.enemies = []; for (const p of this.projectiles) this.group.remove(p.mesh); this.projectiles = []; }

  // Start a fresh encounter, or the reference combat snapshot when `snapshot` is set.
  reset(snapshot = false) {
    this.clearEnemies();
    for (const p of this.particles) this.group.remove(p.obj); this.particles = [];
    const k = this.knight;
    k.dead = false; k.anim = 'idle'; k.animT = 0; k.stun = 0;
    this.cooldowns = Object.fromEntries(ABILITIES.map(a => [a.key, 0]));
    this.selected = '1'; this.ward = 0; this.dest = null; this.lunge = null; this.outcome = null; this.lootShown = false; this.killCount = 0;
    this.warden = this.spawnEnemy('warden', -1.3, -3.6);
    if (snapshot) {
      k.pos.set(-0.05, 0, 1.0); k.facing = 1.95; k.hp = 82; this.essence = 46;
      this.warden.hp = Math.round(WARDEN_HP * 0.63); this.warden.facing = 0.5; this.warden.play('cast'); this.warden.animT = 0.45;
      const t1 = this.spawnEnemy('thrall', 2.35, 1.25, 11); t1.facing = -1.6; t1.play('recoil'); t1.animT = 0.08; t1.hp = 22; this.target = t1;
      const t2 = this.spawnEnemy('thrall', -4.3, -2.3, 12); t2.facing = 2.3; t2.walk = 1.3; t2.walkAmt = 1;
      const t3 = this.spawnEnemy('thrall', 2.7, -4.3, 13); t3.facing = -2.6;
      k.play('slash'); k.animT = 0.3; this.arcT = 0.12; this.arcFacing = k.facing;
      this.cooldowns['2'] = ABILITIES[1].cd * 0.42; this.cooldowns['3'] = ABILITIES[2].cd * 0.62;
      this.dest = new THREE.Vector3(1.05, 0, 3.05);
      this.snapshotFx(t1);
      this.lootShown = true;
    } else {
      k.pos.set(0, 0, 4.5); k.facing = Math.PI; k.hp = MAX_HP; this.essence = MAX_ES;
      this.spawnEnemy('thrall', 2.6, -1.0, 11); this.spawnEnemy('thrall', -4.3, -2.3, 12); this.spawnEnemy('thrall', 2.7, -4.3, 13);
      this.target = null; this.arcT = 0;
    }
    this.active = true;
  }

  snapshotFx(t) {
    const hit = new THREE.Vector3(t.pos.x - 0.15, 1.15, t.pos.z + 0.05);
    this.addParticle({ tex: this.tex.spark, color: '#fff0c8', pos: hit, size: 0.75, life: 1e9, additive: true });
    this.addParticle({ tex: this.tex.disc, color: '#ff8050', pos: hit.clone().add(new THREE.Vector3(0.05, 0.05, 0)), size: 0.5, life: 1e9, additive: true });
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2;
      this.addParticle({ tex: this.tex.disc, color: '#7a6a58', pos: new THREE.Vector3(t.pos.x + 0.3 + Math.cos(a) * 0.45, 0.2 + (k % 3) * 0.08, t.pos.z + Math.sin(a) * 0.35), size: 0.6 + (k % 3) * 0.15, life: 1e9, opacity: 0.28 });
    }
    this.hooks.number?.(new THREE.Vector3(t.pos.x + 0.05, 2.15, t.pos.z), '18', true);
  }

  addParticle({ tex, color, pos, vel = null, size = 0.3, grow = 0, life = 0.5, additive = false, opacity = 1, gravity = 0 }) {
    const obj = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !additive, opacity }));
    obj.position.copy(pos); obj.scale.setScalar(size); this.group.add(obj);
    this.particles.push({ obj, vel: vel || new THREE.Vector3(), size, grow, life, max: life, opacity, gravity });
  }
  burst(pos, n, opts) { for (let k = 0; k < n; k++) { const a = this.r() * Math.PI * 2, s = (opts.speed || 2) * (0.4 + this.r() * 0.6); this.addParticle({ ...opts, pos: pos.clone(), vel: new THREE.Vector3(Math.cos(a) * s, (opts.up ?? 1) * (0.5 + this.r()) * s * 0.6, Math.sin(a) * s) }); } }

  // ------------------------------------------------------------ abilities
  canCast(key) { const a = ABILITIES.find(x => x.key === key); return a && this.cooldowns[key] <= 0 && this.essence >= a.cost && !this.knight.dead && !this.outcome && !this.lunge; }
  cast(key, aim) {
    if (!this.canCast(key)) { if (ABILITIES.find(x => x.key === key)) this.hooks.sfx?.('deny'); return false; }
    const a = ABILITIES.find(x => x.key === key), k = this.knight;
    this.cooldowns[key] = a.cd; this.essence -= a.cost; this.selected = key;
    if (aim) k.face(aim.x - k.pos.x, aim.z - k.pos.z);
    const fx = Math.sin(k.facing), fz = Math.cos(k.facing);
    this.dest = null;
    if (a.id === 'cleave') {
      k.play('slash'); this.arcT = 0.32; this.arcFacing = k.facing; this.hooks.sfx?.('swing');
      this.pendingHit = { t: 0.12, fn: () => this.hitCone(2.5, 1.25, 16, 22, 0.8, 0.25) };
    } else if (a.id === 'bash') {
      k.play('bash'); this.hooks.sfx?.('bash');
      this.pendingHit = { t: 0.12, fn: () => { this.hitCone(2.0, 0.9, 10, 14, 1.8, 1.6); this.ring(k.pos.clone().add(new THREE.Vector3(fx * 0.8, 0.05, fz * 0.8)), '#d8c8a0', 0.5, 2.4); } };
    } else if (a.id === 'lunge') {
      k.play('lunge'); this.hooks.sfx?.('lunge');
      const from = k.pos.clone(), to = from.clone().add(new THREE.Vector3(fx * 5, 0, fz * 5));
      for (let s = 0; s <= 20; s++) { const p = from.clone().lerp(to, s / 20); if (!this.world.walkable(p.x, p.z)) { to.copy(from.clone().lerp(to, Math.max(0, s - 1) / 20)); break; } }
      this.lunge = { from, to, t: 0, hit: new Set() };
    } else if (a.id === 'ward') {
      k.play('ward'); this.ward = 5; this.wardCenter = k.pos.clone(); this.hooks.sfx?.('ward');
      this.ring(k.pos.clone().setY(0.05), '#ffd080', 0.6, 6.5);
    } else if (a.id === 'vial') {
      k.play('drink'); k.hp = Math.min(MAX_HP, k.hp + 35); this.hooks.sfx?.('vial');
      this.burst(k.pos.clone().setY(1.0), 18, { tex: this.tex.disc, color: '#ff5a5a', size: 0.14, life: 0.9, additive: true, speed: 1.2, gravity: -1.5 });
      this.hooks.number?.(k.pos.clone().setY(2.3), '+35', false, '#7fd07f');
    }
    return true;
  }
  ring(pos, color, life, size) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.tex.marker, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos); this.group.add(m);
    this.particles.push({ obj: m, vel: new THREE.Vector3(), size: 0.3, grow: size / life, life, max: life, opacity: 1, gravity: 0, flat: true });
  }
  hitCone(range, halfAngle, dmin, dmax, knock, stun) {
    const k = this.knight, fx = Math.sin(k.facing), fz = Math.cos(k.facing);
    let hits = 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - k.pos.x, dz = e.pos.z - k.pos.z, d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / (d || 1))));
      if (ang > halfAngle && d > 0.6) continue;
      this.damage(e, Math.round(dmin + this.r() * (dmax - dmin)), dx / (d || 1), dz / (d || 1), knock, stun);
      hits++;
    }
    if (hits) { this.essence = Math.min(MAX_ES, this.essence + 4 * hits); this.hooks.shake?.(0.12); }
    return hits;
  }
  damage(e, amount, nx, nz, knock = 0.5, stun = 0.2) {
    if (e.dead) return;
    e.hp -= amount; e.hitT = 0.25; e.stun = Math.max(e.stun, e.kind === 'warden' ? stun * 0.3 : stun);
    if (e.kind !== 'warden') e.vel.set(nx * knock * 4, 0, nz * knock * 4);
    this.target = e;
    const p = e.pos.clone().setY(e.kind === 'warden' ? 1.8 : 1.15);
    this.addParticle({ tex: this.tex.spark, color: '#fff0c8', pos: p, size: 0.8, grow: -1.2, life: 0.18, additive: true });
    this.burst(e.pos.clone().setY(0.25), 5, { tex: this.tex.disc, color: '#6e6050', size: 0.45, grow: 1.2, life: 0.6, speed: 1.2, up: 0.3, opacity: 0.3 });
    this.hooks.number?.(p.clone().setY(p.y + 0.9), String(amount), true);
    this.hooks.sfx?.(e.kind === 'warden' ? 'hitBoss' : 'hit');
    if (e.kind !== 'warden') e.play('recoil');
    if (e.hp <= 0) this.kill(e);
  }
  kill(e) {
    e.dead = true; e.hp = 0; e.deadT = 0; e.play('die'); this.hooks.sfx?.('death'); this.killCount++;
    this.essence = Math.min(MAX_ES, this.essence + 8);
    if (e.J.outline) e.J.outline.forEach(o => o.visible = false);
    if (e.kind === 'warden') { this.outcome = 'victory'; this.hooks.event?.('victory'); for (const t of this.enemies) if (!t.dead) this.kill(t); }
    else if (!this.lootShown) { this.lootShown = true; this.hooks.event?.('loot'); }
  }
  hurtPlayer(amount) {
    const k = this.knight; if (k.dead || this.outcome) return;
    if (this.ward > 0) amount = Math.round(amount * 0.5);
    k.hp -= amount; k.hitT = 0.2; this.hooks.shake?.(0.18); this.hooks.sfx?.('hurt');
    this.hooks.number?.(k.pos.clone().setY(2.2), String(amount), true, '#ff7060');
    if (k.hp <= 0) { k.hp = 0; k.dead = true; k.play('die'); this.outcome = 'defeat'; this.hooks.event?.('defeat'); }
  }

  // ------------------------------------------------------------ update
  update(dt, input, t) {
    const k = this.knight;
    if (this.active && !this.outcome) this.simulate(dt, input);
    for (const key in this.cooldowns) this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);
    if (!this.outcome && this.active) this.essence = Math.min(MAX_ES, this.essence + dt * 2.5);
    // animation
    k.animT += dt; this.poseKnight(k, dt);
    for (const e of this.enemies) { e.animT += dt; e.kind === 'warden' ? this.poseWarden(e, dt, t) : this.poseThrall(e, dt); }
    this.enemies = this.enemies.filter(e => { if (e.dead && e.kind !== 'warden' && e.deadT > 3) { this.group.remove(e.J.root); return false; } return true; });
    // fx
    this.arcT = Math.max(0, (this.arcT || 0) - dt);
    this.arc.visible = this.arcT > 0;
    if (this.arc.visible) {
      const s = 1 - this.arcT / 0.32;
      this.arc.position.set(k.pos.x, 1.05, k.pos.z); this.arc.rotation.set(0, this.arcFacing, 0); this.arc.rotateX(-0.22);
      this.arc.material.opacity = Math.min(1, this.arcT / 0.12);
      this.arc.scale.setScalar(0.9 + s * 0.1);
    }
    this.marker.visible = this.markerFlame.visible = !!this.dest;
    if (this.dest) {
      const pulse = 1 + Math.sin(t * 5) * 0.06;
      this.marker.position.set(this.dest.x, 0.04, this.dest.z); this.marker.scale.setScalar(pulse);
      this.markerFlame.position.set(this.dest.x, 0.3 + Math.sin(t * 4) * 0.03, this.dest.z);
    }
    this.wardRing.visible = this.ward > 0;
    if (this.ward > 0) {
      this.wardRing.position.set(this.wardCenter.x, 0.05, this.wardCenter.z); this.wardRing.rotation.z = t * 0.6;
      this.wardRing.material.opacity = Math.min(1, this.ward) * (0.7 + 0.2 * Math.sin(t * 6));
      this.wardLight.position.set(this.wardCenter.x, 1.2, this.wardCenter.z); this.wardLight.intensity = 8 * Math.min(1, this.ward);
    } else this.wardLight.intensity = 0;
    const w = this.warden;
    this.rune.visible = !!w && !w.dead;
    if (w) {
      this.rune.position.set(w.pos.x, 0.03, w.pos.z); this.rune.rotation.z = t * 0.25;
      const gp = new THREE.Vector3(); w.J.gem.getWorldPosition(gp);
      this.staffGlow.position.copy(gp); this.staffLight.position.copy(gp);
      this.staffGlow.visible = !w.dead; this.staffLight.intensity = w.dead ? 0 : 6 + Math.sin(t * 6) * 1.5;
    }
    this.knightLight.position.set(k.pos.x - 1.5, 3.2, k.pos.z + 2.0);
    for (const e of this.enemies) if (e.J.outline) { const on = e === this.target && !e.dead; e.J.outline.forEach(o => o.visible = on); }
    // projectiles
    for (const p of this.projectiles) {
      p.life -= dt; p.mesh.position.addScaledVector(p.vel, dt);
      if (Math.hypot(p.mesh.position.x - k.pos.x, p.mesh.position.z - k.pos.z) < 0.55 && !k.dead) { this.hurtPlayer(p.dmg); p.life = 0; this.burst(p.mesh.position, 8, { tex: this.tex.disc, color: '#ff4030', size: 0.2, life: 0.4, additive: true, speed: 2 }); }
      if (!this.world.walkable(p.mesh.position.x, p.mesh.position.z) && p.life < p.max - 0.3) p.life = 0;
      if (this.r() < 0.6) this.addParticle({ tex: this.tex.disc, color: '#ff3020', pos: p.mesh.position.clone(), size: 0.25, grow: -0.4, life: 0.3, additive: true });
    }
    this.projectiles = this.projectiles.filter(p => { if (p.life <= 0) { this.group.remove(p.mesh); return false; } return true; });
    // particles
    for (const p of this.particles) {
      p.life -= dt; p.obj.position.addScaledVector(p.vel, dt); p.vel.y -= p.gravity * dt; p.vel.multiplyScalar(Math.exp(-dt * 2));
      const s = Math.max(0.01, p.size + p.grow * (p.max - p.life));
      if (p.flat) p.obj.scale.set(s, s, 1); else p.obj.scale.setScalar(s);
      p.obj.material.opacity = p.opacity * Math.min(1, p.life / Math.min(0.25, p.max));
    }
    this.particles = this.particles.filter(p => { if (p.life <= 0) { this.group.remove(p.obj); p.obj.material.dispose(); return false; } return true; });
    if (this.pendingHit) { this.pendingHit.t -= dt; if (this.pendingHit.t <= 0) { const f = this.pendingHit.fn; this.pendingHit = null; f(); } }
  }

  simulate(dt, input) {
    const k = this.knight, prev = k.pos.clone();
    if (this.ward > 0) {
      this.ward -= dt;
      for (const e of this.enemies) if (!e.dead && e.pos.distanceTo(this.wardCenter) < 3.2) { e.wardTick = (e.wardTick || 0) - dt; if (e.wardTick <= 0) { e.wardTick = 0.5; this.damage(e, 6, 0, 0, 0, 0.05); } }
    }
    // knight movement
    const busy = ['slash', 'bash', 'drink', 'ward'].includes(k.anim) && k.animT < 0.3;
    let mx = input.move.x, mz = input.move.z;
    if (input.dest) this.dest = input.dest.clone();
    if (mx || mz) this.dest = null;
    if (!mx && !mz && this.dest) { const dx = this.dest.x - k.pos.x, dz = this.dest.z - k.pos.z, d = Math.hypot(dx, dz); if (d < 0.15) this.dest = null; else { mx = dx / d; mz = dz / d; } }
    const len = Math.hypot(mx, mz);
    if (this.lunge) {
      const L = this.lunge; L.t += dt / 0.22;
      k.pos.copy(L.from).lerp(L.to, ease(L.t));
      if (this.r() < 0.9) this.addParticle({ tex: this.tex.disc, color: '#20242c', pos: k.pos.clone().setY(0.9), size: 0.9, grow: 0.8, life: 0.5, opacity: 0.5 });
      for (const e of this.enemies) if (!e.dead && !L.hit.has(e) && e.pos.distanceTo(k.pos) < 1.1 + e.radius) { L.hit.add(e); const d = new THREE.Vector3().subVectors(e.pos, k.pos).normalize(); this.damage(e, 22 + Math.floor(this.r() * 6), d.x, d.z, 0.9, 0.5); }
      if (L.t >= 1) this.lunge = null;
    } else if (len > 0.01 && !busy && !k.dead) {
      const sp = 4.2 * dt; k.pos.x += mx / len * sp; k.pos.z += mz / len * sp; k.face(mx, mz, 1 - Math.exp(-dt * 14));
      k.walk += dt * 9; k.walkAmt = Math.min(1, k.walkAmt + dt * 6);
    } else k.walkAmt = Math.max(0, k.walkAmt - dt * 6);
    this.world.resolve(k.pos, 0.4, prev);
    // abilities
    if (input.cast) this.cast(input.cast, input.aim);
    // enemies
    const alive = this.enemies.filter(e => !e.dead);
    for (const e of alive) {
      const eprev = e.pos.clone();
      e.cd -= dt; e.hitT = Math.max(0, e.hitT - dt); e.stun = Math.max(0, e.stun - dt);
      const dx = k.pos.x - e.pos.x, dz = k.pos.z - e.pos.z, d = Math.hypot(dx, dz);
      e.pos.addScaledVector(e.vel, dt); e.vel.multiplyScalar(Math.exp(-dt * 8));
      if (e.stun > 0 || k.dead) { e.walkAmt = Math.max(0, e.walkAmt - dt * 5); }
      else if (e.kind === 'warden') this.wardenAI(e, dt, dx, dz, d);
      else {
        e.face(dx, dz, 1 - Math.exp(-dt * 8));
        if (e.anim === 'attack') {
          if (e.animT > 0.45 && !e.struck) { e.struck = true; if (d < 1.6) { this.hurtPlayer(7 + Math.floor(this.r() * 4)); this.hooks.sfx?.('clang'); } }
          if (e.animT > 0.8) e.play('idle');
        } else if (d > 1.25) {
          const sp = 2.6 * dt; e.pos.x += dx / d * sp; e.pos.z += dz / d * sp; e.walk += dt * 8; e.walkAmt = Math.min(1, e.walkAmt + dt * 5);
        } else {
          e.walkAmt = Math.max(0, e.walkAmt - dt * 5);
          if (e.cd <= 0) { e.play('attack'); e.struck = false; e.cd = 1.1 + this.r() * 0.5; }
        }
      }
      // separation
      for (const o of alive) if (o !== e) { const sx = e.pos.x - o.pos.x, sz = e.pos.z - o.pos.z, sd = Math.hypot(sx, sz), min = e.radius + o.radius; if (sd < min && sd > 1e-3) { e.pos.x += sx / sd * (min - sd) * 0.5; e.pos.z += sz / sd * (min - sd) * 0.5; } }
      const kd = Math.hypot(e.pos.x - k.pos.x, e.pos.z - k.pos.z), kmin = e.radius + 0.4;
      if (kd < kmin && kd > 1e-3) { e.pos.x = k.pos.x + (e.pos.x - k.pos.x) / kd * kmin; e.pos.z = k.pos.z + (e.pos.z - k.pos.z) / kd * kmin; }
      this.world.resolve(e.pos, e.radius, eprev);
    }
  }
  wardenAI(e, dt, dx, dz, d) {
    e.face(dx, dz, 1 - Math.exp(-dt * 4));
    e.castCd -= dt; e.summonCd -= dt;
    if (e.anim === 'cast') {
      if (e.animT > 0.6 && !e.fired) {
        e.fired = true;
        const gp = new THREE.Vector3(); e.J.gem.getWorldPosition(gp);
        const n = e.hp < e.maxHp * 0.25 ? 5 : e.hp < e.maxHp * 0.5 ? 3 : 1;
        for (let s = 0; s < n; s++) {
          const a = Math.atan2(dx, dz) + (s - (n - 1) / 2) * 0.24;
          const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mats().gem); mesh.position.set(gp.x, 1.1, gp.z);
          this.group.add(mesh);
          this.projectiles.push({ mesh, vel: new THREE.Vector3(Math.sin(a) * 7.5, 0, Math.cos(a) * 7.5), life: 3, max: 3, dmg: 11 });
        }
        this.hooks.sfx?.('bolt');
      }
      if (e.animT > 1.0) e.play('idle');
      return;
    }
    // Grave Nova: a telegraphed ring of crimson fire when the knight closes to melee range.
    e.novaCd = (e.novaCd ?? 3) - dt;
    if (e.nova) {
      e.nova.t -= dt;
      if (e.nova.t <= 0) {
        const kp = this.knight.pos, dd = Math.hypot(kp.x - e.pos.x, kp.z - e.pos.z);
        this.ring(e.pos.clone().setY(0.06), '#ff3a20', 0.45, 7.2); this.hooks.sfx?.('bash'); this.hooks.shake?.(0.15);
        this.burst(e.pos.clone().setY(0.3), 14, { tex: this.tex.disc, color: '#ff4020', size: 0.3, life: 0.5, additive: true, speed: 5, up: 0.3 });
        if (dd < 3.3) { this.hurtPlayer(16); if (dd > 1e-3) this.knight.pos.add(new THREE.Vector3((kp.x - e.pos.x) / dd * 1.2, 0, (kp.z - e.pos.z) / dd * 1.2)); }
        e.nova = null;
      }
      return;
    }
    if (d < 3.0 && e.novaCd <= 0) {
      e.novaCd = e.hp < e.maxHp * 0.5 ? 4.5 : 6.5; e.nova = { t: 0.8 }; e.play('cast');
      this.ring(e.pos.clone().setY(0.05), '#ff5030', 0.8, 6.6); this.hooks.sfx?.('summon');
      return;
    }
    const cap = e.hp < e.maxHp * 0.5 ? 4 : 3;
    if (e.summonCd <= 0 && this.enemies.filter(x => !x.dead && x.kind === 'thrall').length < cap) {
      e.summonCd = e.hp < e.maxHp * 0.5 ? 8 : 11; const sp = this.world.spawns[Math.floor(this.r() * this.world.spawns.length)];
      const t = this.spawnEnemy('thrall', sp[0], sp[1], 20 + Math.floor(this.r() * 1000));
      this.ring(new THREE.Vector3(sp[0], 0.05, sp[1]), '#ff4030', 0.8, 3); this.hooks.sfx?.('summon'); t.cd = 1.5;
    }
    if (e.castCd <= 0 && d < 12) { e.castCd = 2.0 + this.r() * 0.8; e.play('cast'); e.fired = false; return; }
    const want = d < 4.5 ? -1 : d > 7.5 ? 1 : 0;
    if (want) { const sp = 1.5 * dt * want; e.pos.x += dx / d * sp; e.pos.z += dz / d * sp; e.walk += dt * 4; e.walkAmt = Math.min(1, e.walkAmt + dt * 3); }
    else e.walkAmt = Math.max(0, e.walkAmt - dt * 3);
  }

  // ------------------------------------------------------------ poses
  legs(J, walk, amt, stride = 0.55) {
    const s = Math.sin(walk) * stride * amt;
    J.hipL.rotation.x = s; J.hipR.rotation.x = -s;
    J.kneeL.rotation.x = Math.max(0, -Math.sin(walk - 0.9)) * 0.8 * amt; J.kneeR.rotation.x = Math.max(0, Math.sin(walk - 0.9)) * 0.8 * amt;
  }
  poseKnight(k, dt) {
    const J = k.J, t = k.animT;
    J.root.rotation.set(0, k.facing, 0); J.root.position.y = 0;
    this.legs(J, k.walk, k.walkAmt);
    const bob = Math.abs(Math.sin(k.walk)) * 0.04 * k.walkAmt;
    J.hips.position.y = 0.98 - bob; J.hips.rotation.set(0, 0, 0);
    J.torso.rotation.set(0.08 * k.walkAmt, 0, 0); J.head.rotation.set(0, 0, 0);
    J.shR.rotation.set(-0.35 - Math.sin(k.walk) * 0.25 * k.walkAmt, 0, -0.12); J.elR.rotation.set(-0.5, 0, 0);
    J.shL.rotation.set(-0.3 + Math.sin(k.walk) * 0.25 * k.walkAmt, 0, 0.18); J.elL.rotation.set(-1.1, 0.3, 0);
    J.handR.rotation.set(-1.2, 0, 0);
    if (k.anim === 'slash') {
      const wind = ease(t / 0.08), swing = ease((t - 0.06) / 0.16), rec = ease((t - 0.3) / 0.35);
      const yaw = t < 0.06 ? lerp(0, 1.25, wind) : lerp(1.25, -1.05, swing);
      J.torso.rotation.y = lerp(yaw, 0, rec);
      J.torso.rotation.x = lerp(0.25, 0.08, rec);
      J.hips.rotation.y = J.torso.rotation.y * -0.25; J.hips.position.y = lerp(0.86, 0.98, rec);
      J.hipL.rotation.x = lerp(-0.7, 0, rec); J.kneeL.rotation.x = lerp(0.6, 0, rec); J.hipR.rotation.x = lerp(0.55, 0, rec); J.kneeR.rotation.x = lerp(0.35, 0, rec);
      J.shR.rotation.set(lerp(-1.35, -0.35, rec), lerp(-0.2, 0, rec), lerp(-0.55, -0.12, rec)); J.elR.rotation.set(lerp(-0.15, -0.5, rec), 0, 0);
      J.handR.rotation.set(lerp(-1.45, -1.2, rec), 0, lerp(0.25, 0, rec));
      J.shL.rotation.set(lerp(-0.8, -0.3, rec), 0, lerp(0.7, 0.18, rec));
      if (t > 0.7) k.play('idle');
    } else if (k.anim === 'bash') {
      const p = Math.sin(Math.min(1, t / 0.4) * Math.PI);
      J.shL.rotation.set(-1.4 * p - 0.3, 0, 0.18); J.elL.rotation.set(-0.4, 0.3, 0); J.torso.rotation.y = -0.4 * p; J.hips.position.y = 0.98 - 0.08 * p;
      if (t > 0.45) k.play('idle');
    } else if (k.anim === 'lunge') {
      J.torso.rotation.x = 0.5; J.hips.position.y = 0.85; J.hipL.rotation.x = -0.9; J.hipR.rotation.x = 0.8; J.kneeR.rotation.x = 0.6;
      J.shR.rotation.set(-1.5, 0, -0.1); J.elR.rotation.set(0, 0, 0); J.handR.rotation.set(-1.57, 0, 0);
      if (t > 0.3 && !this.lunge) k.play('idle');
    } else if (k.anim === 'ward') {
      const p = Math.min(1, t / 0.2);
      J.shR.rotation.set(-2.8 * p, 0, -0.1); J.elR.rotation.set(0, 0, 0); J.handR.rotation.set(0, 0, 0); J.hips.position.y = 0.98 - 0.06 * p;
      J.shL.rotation.set(-0.8 * p, 0, 0.5);
      if (t > 0.6) k.play('idle');
    } else if (k.anim === 'drink') {
      const p = Math.sin(Math.min(1, t / 0.6) * Math.PI);
      J.shL.rotation.set(-1.4 * p - 0.3, 0, 0.6 * p); J.elL.rotation.set(-1.6 * p, 0, 0); J.head.rotation.x = -0.4 * p;
      if (t > 0.65) k.play('idle');
    } else if (k.anim === 'die') {
      const p = ease(t / 0.8); J.root.rotation.x = -1.45 * p; J.root.position.y = 0.15 * p; J.hips.position.y = 0.98 - 0.2 * p;
    }
    if (k.hitT > 0) { k.hitT -= dt; J.torso.rotation.x -= 0.15; }
  }
  poseThrall(e, dt) {
    const J = e.J, t = e.animT;
    J.root.rotation.set(0, e.facing, 0); J.root.position.y = 0;
    this.legs(J, e.walk, e.walkAmt, 0.6);
    J.hips.position.y = 0.9 - Math.abs(Math.sin(e.walk)) * 0.04 * e.walkAmt;
    J.torso.rotation.set(0.2 + 0.1 * e.walkAmt, 0, 0); J.head.rotation.set(-0.1, Math.sin(t * 1.3) * 0.1, 0);
    J.shR.rotation.set(-0.5 - Math.sin(e.walk) * 0.4 * e.walkAmt, 0, -0.2); J.elR.rotation.set(-0.7, 0, 0); J.handR.rotation.set(-1.0, 0, 0);
    J.shL.rotation.set(-0.7 + Math.sin(e.walk) * 0.4 * e.walkAmt, 0, 0.25); J.elL.rotation.set(-0.8, 0, 0); J.handL.rotation.set(0, 0, 0);
    if (e.anim === 'attack') {
      const up = ease(t / 0.4), down = ease((t - 0.4) / 0.12);
      J.shR.rotation.x = lerp(lerp(-0.5, -2.7, up), -0.6, down); J.elR.rotation.x = lerp(-0.2, -0.3, down); J.torso.rotation.x = lerp(lerp(0.2, -0.1, up), 0.45, down);
    } else if (e.anim === 'recoil') {
      const p = Math.sin(Math.min(1, t / 0.35) * Math.PI);
      J.torso.rotation.x = 0.2 - 0.65 * p; J.head.rotation.x = -0.5 * p; J.hips.position.y = 0.9 - 0.06 * p;
      J.shR.rotation.set(-0.3 + 0.5 * p, 0, -0.2 - 0.9 * p); J.shL.rotation.set(-0.4, 0, 0.3 + 0.9 * p);
      J.hipL.rotation.x = -0.35 * p; J.hipR.rotation.x = 0.3 * p; J.kneeR.rotation.x = 0.4 * p;
      J.root.rotation.z = -0.12 * p;
      if (t > 0.4) e.play('idle');
    } else if (e.anim === 'die') {
      e.deadT += dt; const p = ease(t / 0.6);
      J.root.rotation.x = -1.4 * p; J.root.position.y = 0.1 * p; J.hips.position.y = 0.9 - 0.4 * p; J.head.position.y = 0.64 - 0.2 * p;
      if (e.deadT > 2) J.root.position.y = -0.4 * (e.deadT - 2);
    }
  }
  poseWarden(e, dt, time) {
    const J = e.J, t = e.animT;
    J.root.rotation.set(0, e.facing, 0);
    J.hips.position.y = Math.sin(time * 1.6) * 0.04; J.torso.rotation.set(0.05, 0, 0);
    J.shR.rotation.set(-0.6, 0, -0.35); J.elR.rotation.set(-0.6, 0, 0); J.handR.rotation.set(0.7, 0, 0.2);
    J.shL.rotation.set(-0.4, 0, 0.4); J.elL.rotation.set(-0.9, 0, 0);
    J.head.rotation.set(0, 0, 0);
    if (e.anim === 'cast') {
      const p = Math.sin(Math.min(1, t / 0.9) * Math.PI);
      J.shR.rotation.set(-0.6 - 1.9 * p, 0, -0.35 - 0.2 * p); J.elR.rotation.set(-0.6 + 0.4 * p, 0, 0); J.handR.rotation.set(0.7 + 0.4 * p, 0, 0.2);
      J.shL.rotation.set(-0.4 - 0.6 * p, 0, 0.4 + 0.4 * p); J.head.rotation.x = -0.2 * p; J.torso.rotation.x = -0.12 * p;
    } else if (e.anim === 'die') {
      e.deadT += dt; const p = ease(t / 1.2); J.root.rotation.x = -0.4 * p; J.root.position.y = -1.3 * p; J.root.scale.setScalar(0.98 * ACTOR_SCALE * (1 - 0.3 * p));
    }
    if (e.hitT > 0) J.torso.rotation.x -= 0.1;
    J.root.position.y = e.dead ? J.root.position.y : 0;
  }

  // ------------------------------------------------------------ telemetry
  state() {
    const k = this.knight, w = this.warden;
    return {
      hp: Math.round(k.hp), maxHp: MAX_HP, essence: Math.round(this.essence), maxEssence: MAX_ES,
      bossHp: w ? Math.max(0, Math.round(w.hp / w.maxHp * 100)) : 0,
      cooldowns: Object.fromEntries(ABILITIES.map(a => [a.key, +(this.cooldowns[a.key] / a.cd).toFixed(3)])),
      cooldownSeconds: Object.fromEntries(ABILITIES.map(a => [a.key, +this.cooldowns[a.key].toFixed(2)])),
      selected: this.selected, outcome: this.outcome,
      player: { x: +k.pos.x.toFixed(2), z: +k.pos.z.toFixed(2), facing: +k.facing.toFixed(3) },
      enemies: this.enemies.filter(e => !e.dead).map(e => ({ kind: e.kind, hp: Math.round(e.hp), x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2), nova: !!e.nova })),
    };
  }
  setVisible(v) { this.group.visible = v; }
}
