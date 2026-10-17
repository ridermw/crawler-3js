// DOM UI controller: title menu, settings (draft / apply / discard), combat HUD and floating numbers.
import * as P from './pixel.js';
import { ABILITIES } from './combat.js';
import { sfx } from './audio.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const STORE = 'ashen-reliquary-settings-v1';
export const DEFAULT_SETTINGS = { master: 80, ambient: 65, windowMode: 'windowed', cameraDrift: true, vignette: true };

export class UI {
  constructor(app, { frozen = false } = {}) {
    this.app = app; this.frozen = frozen;
    this.settings = { ...DEFAULT_SETTINGS };
    if (!frozen) try { Object.assign(this.settings, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* storage unavailable */ }
    this.draft = { ...this.settings };
    this.titleSel = 0; this.focusRow = 0; this.state = null;
    this.numbers = []; this.orbCache = {}; this.mapT = 0;
    this.bindTitle(); this.bindSettings();
  }

  // Rasters that depend on webfonts are drawn once fonts are ready.
  drawStatic() {
    const lock = $('#titleLockup'), lc = P.titleLockup(2);
    lock.width = lc.width; lock.height = lc.height; lock.getContext('2d').drawImage(lc, 0, 0);
    const blit = (el, w, h, opts) => { const c = P.dividerCanvas(w, h, opts); el.width = w; el.height = h; el.getContext('2d').drawImage(c, 0, 0); };
    blit($('#titleDivider'), 640, 52);
    $$('.panel-divider').forEach(el => blit(el, 1022, 28));
    const key = P.keyIcon(64); $('#keyIcon').getContext('2d').drawImage(key, 0, 0);
    const bar = $('#actionbar'); bar.innerHTML = '';
    ABILITIES.forEach((a, i) => {
      const slot = document.createElement('div'); slot.className = 'slot'; slot.dataset.key = a.key; slot.title = `${a.name} (${a.key})`;
      slot.style.left = `calc(${13 + i * 110} * var(--u))`;
      const c = P.abilityIcon(a.key, 128); slot.appendChild(c);
      const cd = document.createElement('div'); cd.className = 'cd'; slot.appendChild(cd);
      const k = document.createElement('div'); k.className = 'k'; k.textContent = a.key; slot.appendChild(k);
      slot.addEventListener('pointerdown', e => { e.stopPropagation(); this.app.castFromUI(a.key); });
      bar.appendChild(slot);
    });
    this.slots = $$('.slot', bar);
  }

  show(state) {
    this.state = state;
    $('#title').hidden = state !== 'title';
    $('#settings').hidden = state !== 'settings';
    $('#hud').hidden = state !== 'crypt';
    $('#quit').hidden = state !== 'quit';
    if (state === 'settings') { this.draft = { ...this.settings }; this.focusRow = 0; this.renderSettings(); }
    if (state === 'title') this.renderTitle();
    if (state !== 'crypt') this.clearNumbers();
  }

  // ------------------------------------------------------------ title
  bindTitle() {
    $$('#titleMenu .menu-item').forEach((b, i) => {
      b.addEventListener('pointerenter', () => { if (this.titleSel !== i) { this.titleSel = i; this.renderTitle(); sfx.move(); } });
      b.addEventListener('click', () => { this.titleSel = i; this.activateTitle(); });
    });
  }
  renderTitle() {
    $$('#titleMenu .menu-item').forEach((b, i) => b.classList.toggle('sel', i === this.titleSel));
    $('#titleMenu .menu-marker').style.transform = `translateY(calc(${this.titleSel * 50} * var(--u)))`;
  }
  activateTitle() {
    const action = $$('#titleMenu .menu-item')[this.titleSel].dataset.action;
    sfx.select();
    if (action === 'enter') this.app.go('crypt');
    else if (action === 'settings') this.app.go('settings');
    else this.app.go('quit');
  }

  // ------------------------------------------------------------ settings
  bindSettings() {
    $$('#settings .row').forEach(row => {
      const i = +row.dataset.row, key = row.dataset.key;
      row.addEventListener('pointerenter', () => { this.focusRow = i; this.renderSettings(); });
      if (row.classList.contains('slider-row')) {
        const track = $('.track', row);
        const set = e => { const r = track.getBoundingClientRect(); this.draft[key] = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 20) * 5; this.renderSettings(); this.app.previewSettings(this.draft); };
        row.addEventListener('pointerdown', e => { set(e); row.setPointerCapture(e.pointerId); row._drag = true; });
        row.addEventListener('pointermove', e => { if (row._drag) set(e); });
        row.addEventListener('pointerup', () => { row._drag = false; });
      } else if (row.classList.contains('choice-row')) {
        $$('.selector span', row).forEach(s => s.addEventListener('click', () => { this.draft.windowMode = s.dataset.v; sfx.move(); this.renderSettings(); }));
      } else {
        row.addEventListener('click', () => { this.draft[key] = !this.draft[key]; sfx.move(); this.renderSettings(); this.app.previewSettings(this.draft); });
      }
    });
    $$('#settings .act').forEach(b => {
      b.addEventListener('pointerenter', () => { this.focusRow = +b.dataset.row; this.renderSettings(); });
      b.addEventListener('click', () => b.dataset.action === 'apply' ? this.applySettings() : this.discardSettings());
    });
  }
  renderSettings() {
    const d = this.draft;
    for (const key of ['master', 'ambient']) {
      const row = $(`#settings .row[data-key=${key}]`);
      $('.value', row).textContent = `${d[key]}%`;
      $('.fill', row).style.width = `${d[key]}%`; $('.thumb', row).style.left = `${d[key]}%`;
    }
    $$('#settings .selector span').forEach(s => s.classList.toggle('on', s.dataset.v === d.windowMode));
    for (const key of ['cameraDrift', 'vignette']) {
      const tg = $(`#settings .row[data-key=${key}] .toggle`);
      tg.classList.toggle('off', !d[key]); $('.t', tg).textContent = d[key] ? 'ON' : 'OFF';
    }
    $$('#settings .row').forEach(r => r.classList.toggle('focus', +r.dataset.row === this.focusRow));
    const backFocused = this.focusRow === 6;
    $('#settings .act[data-action=apply]').classList.toggle('sel', !backFocused);
    $('#settings .act[data-action=back]').classList.toggle('sel', backFocused);
    $('#settings .act-marker').style.left = `calc(${backFocused ? 314 : 136} * var(--u))`;
  }
  adjust(dir) {
    const d = this.draft;
    switch (this.focusRow) {
      case 0: d.master = Math.max(0, Math.min(100, d.master + dir * 5)); break;
      case 1: d.ambient = Math.max(0, Math.min(100, d.ambient + dir * 5)); break;
      case 2: d.windowMode = d.windowMode === 'windowed' ? 'borderless' : 'windowed'; break;
      case 3: d.cameraDrift = !d.cameraDrift; break;
      case 4: d.vignette = !d.vignette; break;
      case 5: case 6: this.focusRow = this.focusRow === 5 ? 6 : 5; break;
    }
    sfx.move(); this.renderSettings(); this.app.previewSettings(this.draft);
  }
  applySettings() {
    this.settings = { ...this.draft };
    if (!this.frozen) try { localStorage.setItem(STORE, JSON.stringify(this.settings)); } catch { /* storage unavailable */ }
    sfx.select(); this.app.commitSettings(this.settings); this.app.go('title');
  }
  discardSettings() { this.draft = { ...this.settings }; sfx.back(); this.app.previewSettings(this.settings); this.app.go('title'); }

  // ------------------------------------------------------------ keyboard
  key(e) {
    const k = e.code;
    if (this.state === 'title') {
      if (k === 'ArrowUp' || k === 'KeyW') { this.titleSel = (this.titleSel + 2) % 3; this.renderTitle(); sfx.move(); return true; }
      if (k === 'ArrowDown' || k === 'KeyS') { this.titleSel = (this.titleSel + 1) % 3; this.renderTitle(); sfx.move(); return true; }
      if (k === 'Enter' || k === 'Space' || k === 'NumpadEnter') { this.activateTitle(); return true; }
    } else if (this.state === 'settings') {
      if (k === 'ArrowUp') { this.focusRow = (this.focusRow + 6) % 7; this.renderSettings(); sfx.move(); return true; }
      if (k === 'ArrowDown') { this.focusRow = (this.focusRow + 1) % 7; this.renderSettings(); sfx.move(); return true; }
      if (k === 'ArrowLeft') { this.adjust(-1); return true; }
      if (k === 'ArrowRight') { this.adjust(1); return true; }
      if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') {
        if (this.focusRow === 6) this.discardSettings();
        else if (this.focusRow === 5) this.applySettings();
        else if (this.focusRow >= 2) this.adjust(1);
        else { this.focusRow = 5; this.renderSettings(); sfx.move(); }
        return true;
      }
      if (k === 'Escape' || k === 'Backspace') { this.discardSettings(); return true; }
    } else if (this.state === 'quit') { this.app.go('title'); return true; }
    return false;
  }

  // ------------------------------------------------------------ HUD
  hud(s, dt) {
    $('#bossFill').style.width = `calc(${s.bossHp}% - 2px)`;
    $('#bossPct').textContent = `${s.bossHp}%`;
    $('#hpText').textContent = `${s.hp} / ${s.maxHp}`;
    $('#esText').textContent = `${s.essence} / ${s.maxEssence}`;
    this.orb('orbHp', 'hp', s.hp / s.maxHp); this.orb('orbEs', 'es', s.essence / s.maxEssence);
    if (this.slots) this.slots.forEach(slot => {
      const k = slot.dataset.key, a = ABILITIES.find(x => x.key === k);
      slot.style.setProperty('--cd', s.cooldowns[k]);
      slot.classList.toggle('sel', s.selected === k);
      slot.classList.toggle('nores', s.essence < a.cost);
    });
    this.mapT -= dt;
    if (this.mapT <= 0) { this.mapT = 0.1; P.drawMinimap($('#minimap'), { player: s.player, enemies: s.enemies.map(e => ({ x: e.x, z: e.z, elite: e.kind === 'warden' })) }); }
    $('.obj-line').classList.toggle('done', s.outcome === 'victory');
  }
  orb(id, kind, frac) {
    const q = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    if (this.orbCache[id] === q) return; this.orbCache[id] = q;
    const c = $('#' + id), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.drawImage(P.orbCanvas(kind, q / 100, c.width), 0, 0);
  }
  flashSlot(key) { const s = this.slots?.find(x => x.dataset.key === key); if (s) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); } }
  loot(show) { $('#loot').hidden = !show; clearTimeout(this.lootT); if (show && !this.frozen) this.lootT = setTimeout(() => { $('#loot').hidden = true; }, 6000); }
  banner(title, sub) { const b = $('#bannerMsg'); b.hidden = !title; if (title) { $('.bm-title', b).textContent = title; $('.bm-sub', b).textContent = sub; } }

  // ------------------------------------------------------------ floating combat numbers
  number(worldPos, text, color = null) {
    const el = document.createElement('div'); el.className = 'dmg'; el.textContent = text; if (color) el.style.color = color;
    $('#fx-layer').appendChild(el);
    this.numbers.push({ el, pos: worldPos.clone(), t: 0, life: this.frozen ? Infinity : 0.9 });
  }
  clearNumbers() { for (const n of this.numbers) n.el.remove(); this.numbers = []; }
  updateNumbers(dt, project) {
    for (const n of this.numbers) {
      n.t += dt; const p = project(n.pos);
      const rise = this.frozen ? 0 : n.t * 60;
      n.el.style.left = `${p.x}px`; n.el.style.top = `${p.y - rise}px`;
      n.el.style.opacity = this.frozen ? 1 : Math.min(1, (n.life - n.t) / 0.3);
    }
    this.numbers = this.numbers.filter(n => { if (n.t >= n.life) { n.el.remove(); return false; } return true; });
  }
}
