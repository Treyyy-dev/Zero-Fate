import * as THREE from 'three';
import { getItem, RARITY } from '../rpg/ItemDefs.js';
import { SPELLS } from '../rpg/SkillTree.js';
import { QUESTS } from '../rpg/Quests.js';
import { iconFor, svg, ICONS } from './icons.js';

/**
 * In-game heads-up display (no menus here — the Journal is separate):
 * resource bars, level/XP, hotbar, compass with markers, quest tracker,
 * interaction prompt, notifications, region banners, boss bar, floating
 * enemy health bars, dialogue box and the death screen.
 */
const _v = new THREE.Vector3();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class HUD {
  constructor(container, { touch = false } = {}) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="hud-bars">
        <div class="hud-level"><span class="lvl-num">1</span></div>
        <div class="bar-stack">
          <div class="bar hp"><span class="fill"></span><span class="ghost"></span><em></em></div>
          <div class="bar st"><span class="fill"></span><em></em></div>
          <div class="bar mp"><span class="fill"></span><em></em></div>
          <div class="bar xp"><span class="fill"></span></div>
        </div>
      </div>
      <div class="hud-compass"><div class="compass-track"></div><div class="compass-center"></div></div>
      <div class="hud-boss hidden"><div class="boss-name"></div><div class="bar boss"><span class="fill"></span></div></div>
      <div class="hud-quest"></div>
      <div class="hud-notes"></div>
      <div class="hud-banner"><div class="banner-title"></div><div class="banner-sub"></div></div>
      <div class="hud-prompt hidden"></div>
      <div class="hud-hotbar"></div>
      <div class="hud-time"></div>
      <div class="enemy-bars"></div>
      <div class="hud-dialogue hidden" role="dialog"></div>
      <div class="hud-death hidden"><div class="death-title">You have fallen</div><div class="death-sub">Returning to Brookhollow…</div></div>
      <div class="hud-vignette"></div>`;
    container.appendChild(this.root);
    this.touch = touch;
    const q = (s) => this.root.querySelector(s);
    this.el = {
      lvl: q('.lvl-num'), hp: q('.bar.hp'), st: q('.bar.st'), mp: q('.bar.mp'), xp: q('.bar.xp'),
      compass: q('.compass-track'), boss: q('.hud-boss'), bossName: q('.boss-name'), bossFill: q('.bar.boss .fill'),
      quest: q('.hud-quest'), notes: q('.hud-notes'), banner: q('.hud-banner'), prompt: q('.hud-prompt'),
      hotbar: q('.hud-hotbar'), time: q('.hud-time'), enemyBars: q('.enemy-bars'), dialogue: q('.hud-dialogue'),
      death: q('.hud-death'), vignette: q('.hud-vignette'),
    };
    this.ghostHp = 1;
    this.enemyBarEls = new Map();
    this.hotbarSlots = [];
    for (let i = 0; i < 4; i++) {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'hot-slot';
      s.innerHTML = `<span class="hot-icon"></span><span class="hot-count"></span><span class="hot-key">${i + 1}</span><span class="hot-cd"></span>`;
      s.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onHotbar?.(i);
      });
      this.el.hotbar.appendChild(s);
      this.hotbarSlots.push(s);
    }
    this._buildCompass();
  }

  _buildCompass() {
    const marks = [];
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let deg = 0; deg < 360; deg += 15) {
      marks.push(`<span class="cmark ${labels[deg] ? 'major' : ''}" data-deg="${deg}">${labels[deg] ?? '·'}</span>`);
    }
    this.el.compass.innerHTML = marks.join('') + '<div class="cmarkers"></div>';
    this.compassMarks = [...this.el.compass.querySelectorAll('.cmark')];
    this.compassMarkers = this.el.compass.querySelector('.cmarkers');
  }

  /* ---------------- per-frame updates ---------------- */

  updateBars(stats) {
    const hp = stats.health / stats.maxHealth;
    this.el.hp.querySelector('.fill').style.transform = `scaleX(${hp})`;
    this.ghostHp = Math.max(hp, this.ghostHp - 0.01);
    if (hp > this.ghostHp) this.ghostHp = hp;
    this.el.hp.querySelector('.ghost').style.transform = `scaleX(${this.ghostHp})`;
    this.el.hp.querySelector('em').textContent = `${Math.ceil(stats.health)} / ${stats.maxHealth}`;
    this.el.st.querySelector('.fill').style.transform = `scaleX(${stats.stamina / stats.maxStamina})`;
    this.el.st.querySelector('em').textContent = `${Math.floor(stats.stamina)}`;
    this.el.mp.querySelector('.fill').style.transform = `scaleX(${stats.mana / stats.maxMana})`;
    this.el.mp.querySelector('em').textContent = `${Math.floor(stats.mana)}`;
    this.el.xp.querySelector('.fill').style.transform = `scaleX(${stats.xp / stats.xpToNext})`;
    this.el.lvl.textContent = stats.level;
    this.el.vignette.style.opacity = String(hp < 0.3 ? (0.3 - hp) * 2.5 : 0);
    this.el.st.classList.toggle('empty', stats.stamina < 1);
  }

  updateHotbar(inventory, skills, cooldowns) {
    inventory.hotbar.forEach((entry, i) => {
      const slot = this.hotbarSlots[i];
      const icon = slot.querySelector('.hot-icon');
      const count = slot.querySelector('.hot-count');
      const cd = slot.querySelector('.hot-cd');
      const key = entry ?? '';
      if (slot.dataset.key !== key) {
        slot.dataset.key = key;
        if (!entry) {
          icon.innerHTML = '';
          icon.style.color = '';
        } else if (entry.startsWith('spell:')) {
          const sp = SPELLS[entry.slice(6)];
          icon.innerHTML = svg(entry === 'spell:heal' ? ICONS.heal : ICONS.fire, 26);
          icon.style.color = sp.color;
        } else {
          const item = getItem(entry);
          icon.innerHTML = svg(iconFor(item), 26);
          icon.style.color = item.color ?? RARITY[item.rarity].color;
        }
      }
      if (entry && !entry.startsWith('spell:')) {
        const n = inventory.count(entry);
        count.textContent = n;
        slot.classList.toggle('dim', n === 0);
        cd.style.transform = 'scaleY(0)';
      } else if (entry) {
        const id = entry.slice(6);
        count.textContent = '';
        slot.classList.toggle('dim', !skills.spellUnlocked(id));
        const sp = SPELLS[id];
        cd.style.transform = `scaleY(${Math.min(1, (cooldowns[id] ?? 0) / sp.cooldown)})`;
      } else {
        count.textContent = '';
        slot.classList.remove('dim');
      }
    });
  }

  updateCompass(yaw, playerPos, markers) {
    // yaw → heading where 0 = north (−Z)
    const heading = ((-yaw * 180) / Math.PI + 360) % 360;
    const width = this.el.compass.clientWidth || 300;
    const pxPerDeg = width / 120;
    for (const m of this.compassMarks) {
      let d = ((+m.dataset.deg - heading + 540) % 360) - 180;
      m.style.transform = `translateX(${d * pxPerDeg}px)`;
      m.style.opacity = Math.abs(d) > 60 ? '0' : String(1 - Math.abs(d) / 70);
    }
    let html = '';
    for (const mk of markers) {
      const dx = mk.x - playerPos.x;
      const dz = mk.z - playerPos.z;
      const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      const d = ((bearing - heading + 540) % 360) - 180;
      if (Math.abs(d) > 60) continue;
      const dist = Math.hypot(dx, dz);
      html += `<span class="cmarker ${mk.kind}" style="transform:translateX(${d * pxPerDeg}px)"><i></i><b>${dist < 1000 ? Math.round(dist) + 'm' : ''}</b></span>`;
    }
    this.compassMarkers.innerHTML = html;
  }

  updateQuest(questLog) {
    const id = questLog.tracked;
    const key = id ? `${id}|${JSON.stringify(questLog.state[id])}` : '';
    if (key === this._questKey) return;
    this._questKey = key;
    if (!id || !QUESTS[id]) {
      this.el.quest.innerHTML = '';
      return;
    }
    const lines = questLog.objectiveText(id).map((o) => `<li class="${o.done ? 'done' : ''}">${esc(o.text)}</li>`).join('');
    this.el.quest.innerHTML = `<div class="q-title">${esc(QUESTS[id].title)}</div><ul>${lines}</ul>`;
  }

  setPrompt(text) {
    if (text === this._prompt) return;
    this._prompt = text;
    this.el.prompt.classList.toggle('hidden', !text);
    if (text) this.el.prompt.innerHTML = `<kbd>${this.touch ? 'USE' : 'E'}</kbd> ${esc(text)}`;
  }

  setTime(text) {
    if (text !== this._time) this.el.time.textContent = this._time = text;
  }

  notify(text, kind = 'info') {
    const n = document.createElement('div');
    n.className = `note ${kind}`;
    n.innerHTML = text;
    this.el.notes.prepend(n);
    while (this.el.notes.children.length > 6) this.el.notes.lastChild.remove();
    setTimeout(() => n.classList.add('out'), 4200);
    setTimeout(() => n.remove(), 5000);
  }

  banner(title, sub = '') {
    this.el.banner.querySelector('.banner-title').textContent = title;
    this.el.banner.querySelector('.banner-sub').textContent = sub;
    this.el.banner.classList.remove('show');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
  }

  setBoss(enemy) {
    if (!enemy) {
      this.el.boss.classList.add('hidden');
      return;
    }
    this.el.boss.classList.remove('hidden');
    this.el.bossName.textContent = enemy.name;
    this.el.bossFill.style.transform = `scaleX(${Math.max(0, enemy.health / enemy.maxHealth)})`;
  }

  updateEnemyBars(enemies, camera, width, height) {
    const seen = new Set();
    for (const e of enemies) {
      if (e.def.boss) continue;
      const p = e.position;
      _v.set(p.x, p.y + 1.25 * e.scale, p.z).project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) continue;
      seen.add(e);
      let el = this.enemyBarEls.get(e);
      if (!el) {
        el = document.createElement('div');
        el.className = 'enemy-bar';
        el.innerHTML = '<span class="fill"></span>';
        this.el.enemyBars.appendChild(el);
        this.enemyBarEls.set(e, el);
      }
      el.style.transform = `translate(${(_v.x * 0.5 + 0.5) * width}px, ${(-_v.y * 0.5 + 0.5) * height}px) translate(-50%, -100%)`;
      el.firstChild.style.transform = `scaleX(${Math.max(0, e.health / e.maxHealth)})`;
    }
    for (const [e, el] of this.enemyBarEls) {
      if (!seen.has(e)) {
        el.remove();
        this.enemyBarEls.delete(e);
      }
    }
  }

  /* ---------------- dialogue ---------------- */

  showDialogue({ name, text, options }) {
    const d = this.el.dialogue;
    d.innerHTML = `<div class="dlg-name">${esc(name)}</div><div class="dlg-text">${esc(text)}</div><div class="dlg-options"></div>`;
    const box = d.querySelector('.dlg-options');
    options.forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `dlg-opt ${o.primary ? 'primary' : ''}`;
      b.innerHTML = `<span class="dlg-key">${i + 1}</span>${esc(o.label)}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        o.action();
      });
      box.appendChild(b);
    });
    d.classList.remove('hidden');
    this.dialogueOptions = options;
  }

  hideDialogue() {
    this.el.dialogue.classList.add('hidden');
    this.dialogueOptions = null;
  }

  get dialogueOpen() {
    return !this.el.dialogue.classList.contains('hidden');
  }

  showDeath(show) {
    this.el.death.classList.toggle('hidden', !show);
  }
}
