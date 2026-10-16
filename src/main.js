// The Ashen Reliquary — entry point: renderer, post-processing, camera poses, input, state machine,
// URL query harness (?state=, ?freeze=, ?frame=) and window.__crawler telemetry.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Combat, ABILITIES } from './combat.js';
import { UI } from './ui.js';
import { initAudio, sfx, setVolumes, updateAudio } from './audio.js';

const Q = new URLSearchParams(location.search);
const FREEZE = Q.get('freeze') === '1';
// Diagnostic render modes used to compare geometry against the image-run reference passes:
// ?pass=clay (uniform matte white, no textures or coloured light), ?ui=0, ?actors=0.
const PASS = Q.get('pass');
const SHOW_UI = Q.get('ui') !== '0', SHOW_ACTORS = Q.get('actors') !== '0';
if (!SHOW_UI) document.body.classList.add('no-ui');
const START = ['title', 'settings', 'crypt'].includes(Q.get('state')) ? Q.get('state') : 'title';
if (Q.get('frame') === 'ref') document.body.classList.add('frame-ref');
const FROZEN_TIME = 1.7;

// ---------------------------------------------------------------- renderer & post
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: FREEZE });
renderer.setPixelRatio(FREEZE ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07090c');
scene.fog = new THREE.FogExp2('#0e1318', 0.012);
// Perspective camera framed by the vertical extent (`height`) visible at the target, so a pose
// reads the same at any field of view; a narrow fov approaches the orthographic look.
const camera = new THREE.PerspectiveCamera(20, 16 / 9, 0.5, 400);
const FOG_DENSITY_X_DIST = 0.72;

const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.45, 0.5, 0.9);
composer.addPass(bloom);
// Cold-blue shadow / warm-amber highlight split-toning, vignette and screen dimming (linear HDR).
const CryptGrade = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 1 }, uDim: { value: 1 }, uAspect: { value: 16 / 9 }, uShade: { value: 0 },
    uLo: { value: new THREE.Vector3(0.96, 0.99, 1.04) }, uHi: { value: new THREE.Vector3(1.04, 1.0, 0.95) }, uSat: { value: 0.9 }, uGain: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uDim, uAspect, uShade, uSat, uGain; uniform vec3 uLo, uHi; varying vec2 vUv;
  void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float hw = smoothstep(0.02, 0.5, l);
    c.rgb *= mix(uLo, uHi, hw) * uGain;
    c.rgb = mix(vec3(l), c.rgb, uSat);
    vec2 d = (vUv - 0.5) * vec2(uAspect / 1.5, 1.0);
    float v = smoothstep(0.95, 0.3, length(d));
    c.rgb *= mix(1.0, mix(0.32, 1.0, v), uVig);
    // menu screens: a soft pool of shadow behind the lower-left interface
    vec2 sd = (vUv - vec2(0.36, 0.2)) * vec2(uAspect / 1.5, 1.0) * vec2(1.0, 1.6);
    c.rgb *= 1.0 - uShade * smoothstep(0.62, 0.0, length(sd));
    c.rgb *= uDim;
    gl_FragColor = c;
  }`,
};
const grade = new ShaderPass(CryptGrade); composer.addPass(grade);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- camera poses
// pitch/yaw in degrees; height = vertical extent of the orthographic view in world units.
const POSES = {
  title: { target: new THREE.Vector3(0, -1.25, 0.9), yaw: 9, pitch: 24.5, height: 14, fov: 24, moon: 0.35, hemi: 0.8, candles: 0.8, shade: 0, sat: 0.85, gain: 0.92, lo: [0.86, 0.99, 1.22], hi: [1.04, 1, 0.95] },
  settings: { target: new THREE.Vector3(-3.6, 1.5, -1.75), yaw: 6, pitch: 19.25, height: 13, fov: 2, moon: 2.1, hemi: 1.3, shade: 0.2, sat: 0.5, gain: 0.76, lo: [0.96, 0.99, 1.0] },
  crypt: { target: new THREE.Vector3(0.15, -1.1, 0.7), yaw: 0, pitch: 38, height: 17.2, fov: 2, moon: 2.15, hemi: 1.3, pool: 6, candles: 0.4, shade: 0.05, sat: 0.6, gain: 1, lo: [0.96, 0.99, 1.04], hi: [1, 1, 0.95] },
};
const cam = { target: POSES[START].target.clone(), yaw: POSES[START].yaw, pitch: POSES[START].pitch, height: POSES[START].height, fov: POSES[START].fov ?? 4 };
let shake = 0;
function placeCamera(t) {
  let yaw = cam.yaw, pitch = cam.pitch;
  if (settingsLive.cameraDrift && !FREEZE) { yaw += Math.sin(t * 0.11) * (state === 'crypt' ? 0.4 : 1.6); pitch += Math.sin(t * 0.07) * 0.5; }
  // narrow (portrait) screens see more of the room vertically so the width still frames the arena
  const fit = Math.max(1, 0.95 / (innerWidth / innerHeight));
  const fov = cam.fov, D = (cam.height * fit / 2) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const y = THREE.MathUtils.degToRad(yaw), p = THREE.MathUtils.degToRad(pitch);
  camera.position.set(cam.target.x + Math.sin(y) * Math.cos(p) * D, cam.target.y + Math.sin(p) * D, cam.target.z + Math.cos(y) * Math.cos(p) * D);
  if (shake > 0) { camera.position.x += (rand() - 0.5) * shake; camera.position.y += (rand() - 0.5) * shake; }
  camera.lookAt(cam.target);
  camera.fov = fov; camera.aspect = innerWidth / innerHeight; camera.near = Math.max(0.5, D - 40); camera.far = D + 60;
  camera.updateProjectionMatrix();
  if (scene.fog) scene.fog.density = FOG_DENSITY_X_DIST / D;
}
let rs = 0x9e3779b9; const rand = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  grade.uniforms.uAspect.value = w / h;
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- world, combat, ui
const world = new World(scene);
const project = (() => { const v = new THREE.Vector3(); return p => { v.copy(p).project(camera); return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; }; })();
let settingsLive;
const app = {
  go: s => go(s),
  castFromUI: key => { if (state === 'crypt') queueCast(key); },
  previewSettings: s => applyLive(s),
  commitSettings: s => { applyLive(s); applyWindowMode(s.windowMode); },
};
const ui = new UI(app, { frozen: FREEZE });
const combat = new Combat(scene, world, {
  sfx: name => sfx[name]?.(),
  shake: a => { if (!FREEZE) shake = Math.max(shake, a); },
  number: (pos, text, isDamage, color) => ui.number(pos, text, color),
  event: e => {
    if (e === 'loot') ui.loot(true);
    if (e === 'victory') { sfx.victory(); ui.banner('THE WARDEN IS DESTROYED', 'ENTER  DESCEND AGAIN      ESC  TITLE'); }
    if (e === 'defeat') { sfx.defeat(); ui.banner('YOU HAVE FALLEN', 'ENTER  RISE AGAIN      ESC  TITLE'); }
  },
});
combat.setVisible(false);

function applyLive(s) {
  settingsLive = { ...s };
  grade.uniforms.uVig.value = s.vignette ? 1 : 0;
  setVolumes(s.master / 100, s.ambient / 100);
}
function applyWindowMode(mode) {
  try {
    if (mode === 'borderless' && !document.fullscreenElement) document.documentElement.requestFullscreen?.();
    if (mode === 'windowed' && document.fullscreenElement) document.exitFullscreen?.();
  } catch { /* fullscreen not permitted */ }
}
applyLive(ui.settings);

// ---------------------------------------------------------------- state machine
let state = null;
function go(next) {
  const prev = state; state = next; telemetry.state = next;
  ui.show(next);
  if (next === 'crypt') {
    combat.reset(FREEZE); combat.setVisible(SHOW_ACTORS);
    ui.loot(FREEZE); ui.banner(null);
  } else if (next !== 'quit') {
    combat.setVisible(false); combat.active = false; ui.loot(false); ui.banner(null);
  }
  grade.uniforms.uDim.value = next === 'settings' ? 0.92 : 1;
  const pose = POSES[next] || POSES.title; world.setMood(pose.moon, pose.hemi, pose.pool);
  grade.uniforms.uShade.value = pose.shade || 0;
  grade.uniforms.uSat.value = pose.sat ?? 0.9; grade.uniforms.uGain.value = pose.gain ?? 1;
  grade.uniforms.uLo.value.set(...(pose.lo || [0.96, 0.99, 1.04])); grade.uniforms.uHi.value.set(...(pose.hi || [1.04, 1.0, 0.95]));
  world.setCandleScale(pose.candles ?? 1);
  if (!prev || FREEZE) { const p = POSES[next] || POSES.title; cam.target.copy(p.target); cam.yaw = p.yaw; cam.pitch = p.pitch; cam.height = p.height; cam.fov = p.fov ?? 4; }
  if (PASS === 'clay') applyClay();
}

// Clay pass: every opaque surface becomes one matte white material under even light; glows,
// fog, decals and post-processing are removed so only geometry and form remain.
let clayApplied = false;
function applyClay() {
  if (clayApplied) return; clayApplied = true;
  const clay = new THREE.MeshStandardMaterial({ color: '#d9d9d9', roughness: 1, metalness: 0 });
  scene.traverse(o => {
    if (o.isLight) { if (!o.isHemisphereLight && !o.isAmbientLight) o.visible = false; return; }
    if (!(o.isMesh || o.isSprite || o.isPoints)) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const glow = o.isSprite || o.isPoints || m.transparent || m.blending === THREE.AdditiveBlending || m.isMeshBasicMaterial;
    if (glow) { o.visible = false; return; }
    if (m.alphaTest > 0 && m.map) { o.material = clay.clone(); o.material.map = m.map; o.material.alphaTest = m.alphaTest; o.material.color.set('#d9d9d9'); o.material.side = m.side; return; }
    o.material = clay;
  });
  scene.add(new THREE.AmbientLight('#ffffff', 0.35));
  world.hemi.color.set('#ffffff'); world.hemi.groundColor.set('#5a5a5a'); world.hemi.intensity = 1.6;
  const key = new THREE.DirectionalLight('#ffffff', 1.4); key.position.set(-6, 14, 10); scene.add(key);
  scene.fog = null; scene.background = new THREE.Color('#dcdcdc');
  bloom.enabled = false; grade.enabled = false; renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
}

// ---------------------------------------------------------------- input
const keys = new Set();
const mouse = { ndc: new THREE.Vector2(), ground: null, held: false };
let pendingCast = null, pendingDest = null;
const KEYCAST = { Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', KeyQ: 'Q', Numpad1: '1', Numpad2: '2', Numpad3: '3', Numpad4: '4' };
function queueCast(key) { pendingCast = key; ui.flashSlot(key); }

addEventListener('keydown', e => {
  initAudio();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (state !== 'crypt') { if (!e.repeat) ui.key(e); return; }
  if (e.code === 'Escape') { sfx.back(); go('title'); return; }
  if (combat.outcome) { if (e.code === 'Enter' || e.code === 'KeyR') { sfx.select(); go('crypt'); } return; }
  keys.add(e.code);
  if (e.repeat) return;
  if (KEYCAST[e.code]) queueCast(KEYCAST[e.code]);
  if (e.code === 'Space') queueCast('1');
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('contextmenu', e => e.preventDefault());
const raycaster = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function updateGround(e) {
  mouse.ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse.ndc, camera);
  const hit = new THREE.Vector3(); mouse.ground = raycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
}
// Touch: a floating virtual stick on the left part of the screen moves the knight; a tap anywhere
// else walks to that spot. Abilities come from the action-bar slots and auto-aim at the nearest foe.
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 }, stickEl = document.getElementById('stick'), knob = stickEl.firstElementChild;
let touchMode = matchMedia('(pointer: coarse)').matches;
const setTouch = on => { touchMode = on; document.body.classList.toggle('touch', on); };
setTouch(touchMode);
canvas.addEventListener('pointermove', e => {
  if (e.pointerId === stick.id) {
    let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy; const l = Math.hypot(dx, dy), m = 50;
    if (l > m) { dx *= m / l; dy *= m / l; }
    stick.x = dx / m; stick.y = dy / m; knob.style.transform = `translate(${dx}px, ${dy}px)`;
    return;
  }
  updateGround(e); if (mouse.held && state === 'crypt' && mouse.ground) pendingDest = mouse.ground.clone();
});
canvas.addEventListener('pointerdown', e => {
  initAudio(); setTouch(e.pointerType === 'touch');
  if (state === 'title' || state === 'quit') { if (state === 'quit') go('title'); return; }
  if (state !== 'crypt' || combat.outcome) return;
  if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.42 && stick.id === null) {
    stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.x = stick.y = 0;
    stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px'; stickEl.hidden = false; knob.style.transform = '';
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  updateGround(e);
  if (e.button === 2) queueCast('1');
  else if (e.button === 0 && mouse.ground) { mouse.held = true; pendingDest = mouse.ground.clone(); }
});
const endStick = e => { if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; stickEl.hidden = true; } };
addEventListener('pointerup', e => { endStick(e); mouse.held = false; });
addEventListener('pointercancel', e => { endStick(e); mouse.held = false; });
function nearestEnemy() {
  const k = combat.knight.pos; let best = null, bd = 9;
  for (const e of combat.enemies) if (!e.dead) { const d = e.pos.distanceTo(k); if (d < bd) { bd = d; best = e.pos.clone(); } }
  return best;
}
document.getElementById('menuBtn').addEventListener('click', () => { sfx.back(); go('title'); });
document.querySelectorAll('#bannerMsg [data-act]').forEach(b => b.addEventListener('click', () => { sfx.select(); go(b.dataset.act === 'again' ? 'crypt' : 'title'); }));
document.getElementById('quit').addEventListener('pointerdown', () => go('title'));

function readMove() {
  let x = 0, z = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  if (stick.id !== null && Math.hypot(stick.x, stick.y) > 0.2) { x = stick.x; z = stick.y; }
  // rotate by camera yaw so W always moves "up" the screen
  const y = THREE.MathUtils.degToRad(cam.yaw), c = Math.cos(y), s = Math.sin(y);
  return { x: x * c + z * s, z: -x * s + z * c };
}

// ---------------------------------------------------------------- loop
const telemetry = window.__crawler = { ready: false, frozen: FREEZE, state: START };
window.__crawlerProject = (x, z) => project(new THREE.Vector3(x, 0.5, z));
// Inverse of the above for layout work: normalised 3:2-frame coords (u, v in 0..1) -> floor x, z at height y.
window.__crawlerUnproject = (u, v, y = 0) => {
  const fw = Math.min(innerWidth, innerHeight * 1.5), fx = (innerWidth - fw) / 2 + u * fw, fy = v * innerHeight;
  const r = new THREE.Raycaster(); r.setFromCamera(new THREE.Vector2(fx / innerWidth * 2 - 1, -(fy / innerHeight) * 2 + 1), camera);
  const h = new THREE.Vector3(); return r.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), h) ? [+h.x.toFixed(2), +h.z.toFixed(2)] : null;
};
// Tuning hook for tools/fidelity/search.mjs: adjust camera, grade and lights without a reload.
window.__crawlerDebug = {
  pose: p => { if (p.target) cam.target.set(...p.target); for (const k of ['yaw', 'pitch', 'height', 'fov']) if (p[k] !== undefined) cam[k] = p[k]; },
  grade: g => { const u = grade.uniforms; if (g.lo) u.uLo.value.set(...g.lo); if (g.hi) u.uHi.value.set(...g.hi); for (const k of ['sat', 'gain', 'shade', 'dim', 'vig']) if (g[k] !== undefined) u['u' + k[0].toUpperCase() + k.slice(1)].value = g[k]; },
  lights: l => { if (l.moon !== undefined) world.moon.intensity = l.moon; if (l.pool !== undefined) world.pool.intensity = l.pool; if (l.hemi !== undefined) world.hemi.intensity = l.hemi; if (l.candles !== undefined) world.setCandleScale(l.candles); if (l.exposure !== undefined) renderer.toneMappingExposure = l.exposure; if (l.moonColor) world.moon.color.set(l.moonColor); if (l.hemiColor) world.hemi.color.set(l.hemiColor); },
  state: () => ({ cam: { target: cam.target.toArray(), yaw: cam.yaw, pitch: cam.pitch, height: cam.height, fov: cam.fov } }),
};
Object.defineProperties(telemetry, {
  selectedMenu: { enumerable: true, get: () => ['ENTER THE CRYPT', 'SETTINGS', 'QUIT'][ui.titleSel] },
  settingsFocus: { enumerable: true, get: () => ui.focusRow },
  settings: { enumerable: true, get: () => ({ ...ui.settings }) },
  draft: { enumerable: true, get: () => ({ ...ui.draft }) },
});
let time = FREEZE ? FROZEN_TIME : 0, last = performance.now(), frames = 0;
function frame(now) {
  const dt = FREEZE ? 0 : Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  if (state === 'crypt') {
    combat.update(dt, { move: readMove(), dest: pendingDest, cast: pendingCast, aim: touchMode ? nearestEnemy() : mouse.ground }, time);
    pendingDest = null; pendingCast = null;
    const k = combat.knight.pos, P = POSES.crypt;
    const tx = THREE.MathUtils.clamp(k.x, -3, 3), tz = THREE.MathUtils.clamp(k.z, -1, 5.5);
    if (!FREEZE) cam.target.lerp(new THREE.Vector3(tx, P.target.y, tz), 1 - Math.exp(-dt * 4));
  }
  if (!FREEZE && state !== 'crypt') {
    const p = POSES[state] || POSES.title, k = 1 - Math.exp(-dt * 2.5);
    cam.target.lerp(p.target, k); cam.yaw += (p.yaw - cam.yaw) * k; cam.pitch += (p.pitch - cam.pitch) * k; cam.height += (p.height - cam.height) * k; cam.fov += ((p.fov ?? 4) - cam.fov) * k;
  } else if (!FREEZE && state === 'crypt') {
    const p = POSES.crypt, k = 1 - Math.exp(-dt * 2.5);
    cam.yaw += (p.yaw - cam.yaw) * k; cam.pitch += (p.pitch - cam.pitch) * k; cam.height += (p.height - cam.height) * k; cam.fov += ((p.fov ?? 4) - cam.fov) * k;
  }
  shake = Math.max(0, shake - dt * 0.9);
  placeCamera(time);
  world.update(time, camera);
  updateAudio(dt);
  if (state === 'crypt') {
    const s = combat.state();
    ui.hud(s, dt || 1);
    Object.assign(telemetry, s);
  }
  ui.updateNumbers(dt, project);
  composer.render(dt);
  Object.assign(telemetry, { state, time: +time.toFixed(3) });
  if (++frames === 4) telemetry.ready = true;
  requestAnimationFrame(frame);
}

async function boot() {
  try { await Promise.all(['600 60px Cinzel', '500 40px Cinzel', '400 16px Inter', '500 16px Inter', '600 16px Inter'].map(f => document.fonts.load(f))); await document.fonts.ready; } catch { /* fonts unavailable: fall back */ }
  ui.drawStatic();
  resize();
  go(START);
  requestAnimationFrame(frame);
}
boot();
