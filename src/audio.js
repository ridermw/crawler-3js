// All sound is synthesized with WebAudio: a dark crypt drone plus combat and UI effects.
let ctx = null, master = null, amb = null, sfxBus = null, dripT = 3, seed = 0x5eed;
const vol = { master: 0.8, ambient: 0.65 };
const rand = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.connect(ctx.destination);
  amb = ctx.createGain(); amb.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
  applyVolumes();
  // drone: detuned low saws through a slowly breathing low-pass
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 3;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
  const lfoG = ctx.createGain(); lfoG.gain.value = 120; lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
  const droneG = ctx.createGain(); droneG.gain.value = 0.05; lp.connect(droneG); droneG.connect(amb);
  for (const [f, d] of [[55, -7], [55, 6], [82.4, 3], [110, -4]]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start();
  }
  // cold wind through the broken roof
  const src = ctx.createBufferSource(); src.buffer = noiseBuffer(5); src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.7;
  const windG = ctx.createGain(); windG.gain.value = 0.035;
  const wl = ctx.createOscillator(); wl.frequency.value = 0.08; const wlG = ctx.createGain(); wlG.gain.value = 0.025; wl.connect(wlG); wlG.connect(windG.gain); wl.start();
  src.connect(bp); bp.connect(windG); windG.connect(amb); src.start();
}

export function setVolumes(master01, ambient01) { vol.master = master01; vol.ambient = ambient01; applyVolumes(); }
function applyVolumes() { if (!ctx) return; master.gain.value = vol.master * 0.7; amb.gain.value = vol.ambient; }

function noiseBuffer(sec) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  return b;
}
function tone(freq, dur, { type = 'sine', v = 0.1, at = 0, slide = 0, bus = sfxBus } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, freq, { v = 0.3, q = 1, at = 0, sweep = 0, type = 'bandpass', bus = sfxBus } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuffer(dur + 0.05); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(bus); s.start(t); s.stop(t + dur + 0.05);
}

export const sfx = {
  swing: () => { noise(0.22, 600, { v: 0.35, q: 1.5, sweep: 2400 }); },
  hit: () => { tone(110, 0.18, { type: 'triangle', v: 0.3, slide: -60 }); noise(0.08, 2600, { v: 0.25, q: 2 }); for (let k = 0; k < 3; k++) tone(900 + rand() * 900, 0.04, { type: 'square', v: 0.03, at: 0.02 + k * 0.025 }); },
  hitBoss: () => { tone(80, 0.3, { type: 'triangle', v: 0.35, slide: -40 }); noise(0.12, 1800, { v: 0.25, q: 1.5 }); },
  bash: () => { tone(70, 0.3, { type: 'sine', v: 0.5, slide: -30 }); noise(0.15, 300, { v: 0.4, q: 0.8 }); tone(1600, 0.25, { type: 'triangle', v: 0.05, at: 0.05 }); },
  lunge: () => { noise(0.35, 300, { v: 0.4, q: 1, sweep: 1800 }); tone(160, 0.35, { type: 'sawtooth', v: 0.05, slide: -100 }); },
  ward: () => { [392, 494, 587, 784].forEach((f, k) => tone(f, 1.4, { type: 'sine', v: 0.08, at: k * 0.05 })); noise(1.0, 3000, { v: 0.05, q: 4 }); },
  vial: () => { for (let k = 0; k < 6; k++) tone(300 + rand() * 300, 0.08, { type: 'sine', v: 0.12, at: k * 0.07, slide: 200 }); },
  bolt: () => { tone(220, 0.5, { type: 'sawtooth', v: 0.08, slide: 400 }); noise(0.4, 900, { v: 0.12, q: 3, sweep: -600 }); },
  summon: () => { tone(60, 1.2, { type: 'sawtooth', v: 0.12, slide: 30 }); noise(1.0, 200, { v: 0.2, q: 1 }); },
  hurt: () => { tone(140, 0.2, { type: 'square', v: 0.1, slide: -70 }); noise(0.1, 800, { v: 0.2 }); },
  clang: () => { tone(1200, 0.3, { type: 'triangle', v: 0.05 }); tone(1730, 0.25, { type: 'triangle', v: 0.03 }); },
  death: () => { for (let k = 0; k < 8; k++) { tone(500 + rand() * 1400, 0.05, { type: 'square', v: 0.04, at: k * 0.045 }); } noise(0.4, 400, { v: 0.15, at: 0.2 }); },
  deny: () => tone(120, 0.12, { type: 'square', v: 0.05 }),
  move: () => tone(880, 0.05, { type: 'sine', v: 0.05 }),
  select: () => { tone(660, 0.08, { type: 'triangle', v: 0.08 }); tone(990, 0.15, { type: 'triangle', v: 0.06, at: 0.06 }); },
  back: () => tone(440, 0.1, { type: 'triangle', v: 0.07, slide: -120 }),
  victory: () => { [262, 330, 392, 523].forEach((f, k) => tone(f, 1.6, { type: 'triangle', v: 0.1, at: k * 0.18 })); },
  defeat: () => { [220, 175, 147].forEach((f, k) => tone(f, 1.2, { type: 'sawtooth', v: 0.06, at: k * 0.35 })); },
};

// Occasional water drips and distant bell tolls in the ambience bus.
export function updateAudio(dt) {
  if (!ctx) return;
  dripT -= dt;
  if (dripT <= 0) {
    dripT = 2 + rand() * 6;
    if (rand() < 0.8) tone(1400 + rand() * 900, 0.12, { type: 'sine', v: 0.03, slide: -700, bus: amb });
    else tone(98, 3.5, { type: 'sine', v: 0.05, bus: amb });
  }
}
