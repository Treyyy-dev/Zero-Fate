import { getItem, RARITY, EQUIP_SLOTS, slotFor } from '../rpg/ItemDefs.js';
import { SKILL_TREES, SPELLS } from '../rpg/SkillTree.js';
import { QUESTS } from '../rpg/Quests.js';
import { iconFor, svg, ICONS } from './icons.js';

/**
 * The Journal: one panel with tabs for Inventory, Character, Skills, Quests
 * and System (save/load/new game). Opening it pauses the world.
 * Keys: I inventory · U character · K skills · J quests · Esc close.
 */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SLOT_LABEL = { weapon: 'Weapon', head: 'Head', chest: 'Chest', legs: 'Legs', feet: 'Feet', ring: 'Ring' };
const ATTR = {
  strength: ['Strength', 'Physical damage'],
  defense: ['Defense', 'Health and armour'],
  agility: ['Agility', 'Stamina, speed, cheaper dodges'],
  intelligence: ['Intelligence', 'Mana and spell power'],
};

export class Journal {
  constructor(container, game) {
    this.game = game;
    this.tab = 'inventory';
    this.selected = null;
    this.root = document.createElement('div');
    this.root.id = 'journal';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="jr-panel" role="dialog" aria-label="Journal">
        <header class="jr-head">
          <nav class="jr-tabs">
            <button type="button" data-tab="inventory">Inventory<kbd>I</kbd></button>
            <button type="button" data-tab="character">Character<kbd>U</kbd></button>
            <button type="button" data-tab="skills">Skills<kbd>K</kbd></button>
            <button type="button" data-tab="quests">Quests<kbd>J</kbd></button>
            <button type="button" data-tab="system">System</button>
          </nav>
          <button type="button" class="jr-close" aria-label="Close journal">✕</button>
        </header>
        <div class="jr-body"></div>
      </div>`;
    container.appendChild(this.root);
    this.body = this.root.querySelector('.jr-body');
    this.root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => this.open(b.dataset.tab)));
    this.root.querySelector('.jr-close').addEventListener('click', () => this.close());
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.body.addEventListener('click', (e) => this._onClick(e));
    const refresh = () => this.isOpen && this.render();
    game.inventory.on('change', refresh);
    game.stats.on('change', refresh);
    game.skills.on('change', refresh);
    game.quests.on('change', refresh);
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  open(tab = this.tab) {
    this.tab = tab;
    this.root.classList.remove('hidden');
    this.root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    this.render();
    this.onToggle?.(true);
  }

  close() {
    this.root.classList.add('hidden');
    this.confirmNew = false;
    this.onToggle?.(false);
  }

  toggle(tab) {
    if (this.isOpen && this.tab === tab) this.close();
    else this.open(tab);
  }

  render() {
    const fn = { inventory: this._inventory, character: this._character, skills: this._skills, quests: this._quests, system: this._system }[this.tab];
    this.body.innerHTML = fn.call(this);
  }

  /* ---------------- tabs ---------------- */

  _inventory() {
    const inv = this.game.inventory;
    const stats = this.game.stats;
    const slots = EQUIP_SLOTS.map((s) => {
      const id = inv.equipped[s];
      const item = id ? getItem(id) : null;
      return `<button type="button" class="eq-slot ${item ? '' : 'empty'}" data-act="select-eq" data-slot="${s}" style="--rc:${item ? RARITY[item.rarity].color : 'transparent'}">
        <span class="eq-icon">${item ? svg(iconFor(item), 26) : ''}</span>
        <span class="eq-text"><small>${SLOT_LABEL[s]}</small>${item ? esc(item.name) : '<i>Empty</i>'}</span></button>`;
    }).join('');
    const cells = [];
    for (let i = 0; i < inv.capacity; i++) {
      const s = inv.items[i];
      if (!s) {
        cells.push('<div class="inv-cell empty"></div>');
        continue;
      }
      const item = getItem(s.id);
      const sel = this.selected?.type === 'item' && this.selected.index === i ? 'selected' : '';
      cells.push(`<button type="button" class="inv-cell ${sel}" data-act="select-item" data-index="${i}" style="--rc:${RARITY[item.rarity].color}" title="${esc(item.name)}">
        <span style="color:${item.color ?? RARITY[item.rarity].color}">${svg(iconFor(item), 28)}</span>${s.count > 1 ? `<b>${s.count}</b>` : ''}</button>`);
    }
    return `<div class="inv-layout">
      <section class="inv-equip"><h3>Equipped</h3>${slots}<div class="inv-gold">${svg(ICONS.token, 16)} ${stats.gold} gold</div></section>
      <section class="inv-grid-wrap"><h3>Pack <small>${inv.items.length}/${inv.capacity}</small></h3><div class="inv-grid">${cells.join('')}</div></section>
      <section class="inv-detail">${this._detail()}</section>
    </div>`;
  }

  _detail() {
    const inv = this.game.inventory;
    const sel = this.selected;
    let item = null;
    let equippedSlot = null;
    if (sel?.type === 'item' && inv.items[sel.index]) item = getItem(inv.items[sel.index].id);
    if (sel?.type === 'eq' && inv.equipped[sel.slot]) {
      item = getItem(inv.equipped[sel.slot]);
      equippedSlot = sel.slot;
    }
    if (!item) return '<p class="muted">Select an item to see its details.</p>';
    const rows = [];
    if (item.type === 'weapon') rows.push(['Damage', item.damage], ['Type', item.weaponType]);
    for (const [k, v] of Object.entries(item.mods ?? {})) rows.push([k.replace(/Pct$/, ' %').replace(/([A-Z])/g, ' $1'), k.endsWith('Pct') ? `${v > 0 ? '+' : ''}${Math.round(v * 100)}%` : `${v > 0 ? '+' : ''}${v}`]);
    if (item.value) rows.push(['Value', `${item.value} g`]);
    const actions = [];
    if (!equippedSlot && slotFor(item)) actions.push('<button type="button" class="btn primary" data-act="equip">Equip</button>');
    if (equippedSlot && equippedSlot !== 'weapon') actions.push('<button type="button" class="btn" data-act="unequip">Unequip</button>');
    if (!equippedSlot && item.type === 'consumable') {
      actions.push('<button type="button" class="btn primary" data-act="use">Use</button>');
      actions.push(`<span class="hot-assign">Hotbar: ${[0, 1, 2, 3].map((i) => `<button type="button" class="btn small" data-act="hotbar" data-slot="${i}">${i + 1}</button>`).join('')}</span>`);
    }
    if (!equippedSlot && (item.type === 'weapon' || item.type === 'armor' || item.type === 'material')) actions.push('<button type="button" class="btn ghost" data-act="sell">Sell (' + Math.max(1, Math.round((item.value ?? 0) * 0.4)) + ' g)</button>');
    return `<div class="detail-head" style="color:${RARITY[item.rarity].color}">${svg(iconFor(item), 34)}<div><h4>${esc(item.name)}</h4><small>${RARITY[item.rarity].label} ${esc(item.type)}</small></div></div>
      ${item.description ? `<p>${esc(item.description)}</p>` : ''}
      <dl class="detail-stats">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="detail-actions">${actions.join('')}</div>`;
  }

  _character() {
    const s = this.game.stats;
    const attrs = Object.entries(ATTR).map(([k, [label, hint]]) => `
      <div class="attr-row"><div><b>${label}</b><small>${hint}</small></div>
      <span class="attr-val">${s.attr(k)}${s.mod(k) ? ` <small>(${s.attributes[k]}+${s.mod(k)})</small>` : ''}</span>
      <button type="button" class="btn small" data-act="allocate" data-attr="${k}" ${s.unspentPoints ? '' : 'disabled'} aria-label="Add point to ${label}">+</button></div>`).join('');
    const derived = [
      ['Health', `${Math.ceil(s.health)} / ${s.maxHealth}`], ['Stamina', s.maxStamina], ['Mana', s.maxMana],
      ['Armour', s.armor], ['Physical damage', `×${s.physicalMultiplier.toFixed(2)}`], ['Spell power', `×${s.spellPower.toFixed(2)}`],
      ['Move speed', `${Math.round(s.moveSpeedMul * 100)}%`], ['Stamina regen', `${s.staminaRegen.toFixed(1)}/s`], ['Mana regen', `${s.manaRegen.toFixed(1)}/s`],
      ['Damage taken', `${Math.round((100 / (100 + s.armor)) * 100)}%`],
    ];
    return `<div class="char-layout">
      <section><h3>Level ${s.level}</h3>
        <div class="xp-line"><div class="bar xp big"><span class="fill" style="transform:scaleX(${s.xp / s.xpToNext})"></span></div><small>${s.xp} / ${s.xpToNext} XP</small></div>
        <p class="points">${s.unspentPoints ? `<b>${s.unspentPoints}</b> attribute point${s.unspentPoints > 1 ? 's' : ''} to spend` : 'No attribute points to spend'} · <b>${s.skillPoints}</b> skill point${s.skillPoints === 1 ? '' : 's'}</p>
        ${attrs}</section>
      <section><h3>Statistics</h3><dl class="detail-stats">${derived.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>
    </div>`;
  }

  _skills() {
    const sk = this.game.skills;
    const stats = this.game.stats;
    const trees = Object.entries(SKILL_TREES).map(([tid, tree]) => {
      const rows = [0, 1, 2].map((row) => {
        const nodes = Object.entries(tree.nodes).filter(([, n]) => n.row === row).sort((a, b) => a[1].col - b[1].col);
        return `<div class="sk-row">${nodes.map(([id, n]) => {
          const r = sk.rank(id);
          const block = sk.blocker(id);
          const state = r >= n.maxRank ? 'maxed' : !block ? 'available' : r > 0 ? 'learned' : 'locked';
          return `<button type="button" class="sk-node ${state}" data-act="learn" data-skill="${id}" style="--tc:${tree.color}" title="${esc(block ?? 'Learn')}">
            <b>${esc(n.name)}</b><small>${r}/${n.maxRank}</small><span>${esc(n.desc)}</span>${block && r < n.maxRank ? `<em>${esc(block)}</em>` : ''}</button>`;
        }).join('')}</div>`;
      }).join('');
      return `<section class="sk-tree" style="--tc:${tree.color}"><h3>${tree.name}</h3>${rows}</section>`;
    }).join('');
    const spells = Object.entries(SPELLS).filter(([id]) => sk.spellUnlocked(id)).map(([id, sp]) =>
      `<span class="spell-chip" style="color:${sp.color}">${svg(id === 'heal' ? ICONS.heal : ICONS.fire, 18)} ${sp.name} · ${sp.mana} mana
       ${[0, 1, 2, 3].map((i) => `<button type="button" class="btn small" data-act="hotbar-spell" data-spell="${id}" data-slot="${i}">${i + 1}</button>`).join('')}</span>`).join('');
    return `<p class="points"><b>${stats.skillPoints}</b> skill point${stats.skillPoints === 1 ? '' : 's'} available. You earn one per level.</p>
      <div class="sk-layout">${trees}</div>
      ${spells ? `<div class="spell-bar"><b>Spells</b> — assign to hotbar slot: ${spells}</div>` : ''}`;
  }

  _quests() {
    const ql = this.game.quests;
    const entries = Object.entries(QUESTS).map(([id, q]) => ({ id, q, status: ql.status(id) })).filter((e) => e.status !== 'locked' && e.status !== 'available');
    if (!entries.length) return '<p class="muted">No quests yet. Talk to the people of Brookhollow — look for Elder Maren by the well.</p>';
    const order = { ready: 0, active: 1, done: 2 };
    entries.sort((a, b) => order[a.status] - order[b.status]);
    return `<div class="quest-list">${entries.map(({ id, q, status }) => `
      <article class="quest ${status}">
        <header><h4>${esc(q.title)}</h4><span class="q-status">${status === 'done' ? 'Completed' : status === 'ready' ? 'Ready to turn in' : 'Active'}</span></header>
        <p>${esc(q.summary)}</p>
        ${status !== 'done' ? `<ul>${ql.objectiveText(id).map((o) => `<li class="${o.done ? 'done' : ''}">${esc(o.text)}</li>`).join('')}</ul>` : ''}
        <footer><small>Reward: ${q.rewards.xp} XP · ${q.rewards.gold ?? 0} gold${(q.rewards.items ?? []).map(([it, n]) => ` · ${n > 1 ? n + '× ' : ''}${esc(getItem(it).name)}`).join('')}</small>
        ${status !== 'done' ? `<button type="button" class="btn small ${ql.tracked === id ? 'primary' : ''}" data-act="track" data-quest="${id}">${ql.tracked === id ? 'Tracked' : 'Track'}</button>` : ''}</footer>
      </article>`).join('')}</div>`;
  }

  _system() {
    const g = this.game;
    return `<div class="sys-layout">
      <section><h3>Saves</h3>
        <p class="muted">Progress saves automatically every minute and when you complete quests. Saves live in this browser (IndexedDB).</p>
        <div class="detail-actions">
          <button type="button" class="btn primary" data-act="save">Save now <kbd>F5</kbd></button>
          <button type="button" class="btn" data-act="load">Load last save <kbd>F9</kbd></button>
          ${this.confirmNew
            ? '<span class="confirm">Erase your progress? <button type="button" class="btn danger" data-act="new-confirm">Yes, start over</button><button type="button" class="btn ghost" data-act="new-cancel">Keep playing</button></span>'
            : '<button type="button" class="btn ghost" data-act="new">New game</button>'}
        </div>
        <p class="sys-status">${esc(g.lastSaveText ?? '')}</p>
      </section>
      <section><h3>World</h3><dl class="detail-stats">
        <dt>Time</dt><dd>${g.timeText}</dd><dt>Weather</dt><dd>${g.weatherLabel}</dd>
        <dt>Graphics</dt><dd>${g.quality.tier === 'low' ? 'Mobile' : 'High'} · res ×${g.renderer.pixelRatio.toFixed(2)}</dd>
        <dt>Character model</dt><dd>${g.characterSource}</dd></dl></section>
      <section><h3>Controls</h3>
        <dl class="detail-stats controls">
          <dt>Move / run</dt><dd>WASD · Shift</dd><dt>Jump</dt><dd>Space</dd><dt>Light / heavy attack</dt><dd>Left click · F</dd>
          <dt>Block</dt><dd>Hold right click</dd><dt>Dodge roll</dt><dd>C or Alt</dd><dt>Interact</dt><dd>E</dd>
          <dt>Hotbar</dt><dd>1 – 4</dd><dt>Journal</dt><dd>I · U · K · J</dd><dt>Debug panel</dt><dd>F3</dd>
        </dl></section>
    </div>`;
  }

  /* ---------------- actions ---------------- */

  _onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const g = this.game;
    const inv = g.inventory;
    const act = t.dataset.act;
    const selItem = this.selected?.type === 'item' ? inv.items[this.selected.index] : null;
    switch (act) {
      case 'select-item':
        this.selected = { type: 'item', index: +t.dataset.index };
        break;
      case 'select-eq':
        this.selected = { type: 'eq', slot: t.dataset.slot };
        break;
      case 'equip':
        if (selItem) inv.equip(selItem.id);
        this.selected = null;
        break;
      case 'unequip':
        if (this.selected?.slot) inv.unequip(this.selected.slot);
        this.selected = null;
        break;
      case 'use':
        if (selItem) g.useItem(selItem.id);
        break;
      case 'sell':
        if (selItem) {
          const item = getItem(selItem.id);
          inv.remove(selItem.id, 1);
          g.stats.gold += Math.max(1, Math.round((item.value ?? 0) * 0.4));
          g.stats.emit('change');
          if (!inv.items[this.selected.index]) this.selected = null;
        }
        break;
      case 'hotbar':
        if (selItem) inv.setHotbar(+t.dataset.slot, selItem.id);
        break;
      case 'hotbar-spell':
        inv.setHotbar(+t.dataset.slot, `spell:${t.dataset.spell}`);
        break;
      case 'allocate':
        g.stats.allocate(t.dataset.attr);
        break;
      case 'learn':
        if (g.skills.learn(t.dataset.skill)) {
          const n = g.skills.node(t.dataset.skill);
          if (t.dataset.skill === 'firebolt' && !inv.hotbar.includes('spell:firebolt')) inv.setHotbar(inv.hotbar[2] ? 3 : 2, 'spell:firebolt');
          if (t.dataset.skill === 'healingLight' && !inv.hotbar.includes('spell:heal')) inv.setHotbar(3, 'spell:heal');
          g.hud.notify(`Learned <b>${esc(n.name)}</b>`, 'skill');
        }
        break;
      case 'track':
        g.quests.tracked = t.dataset.quest;
        g.quests.emit('change');
        break;
      case 'save':
        g.saveGame(true);
        break;
      case 'load':
        g.loadGame(true);
        break;
      case 'new':
        this.confirmNew = true;
        break;
      case 'new-cancel':
        this.confirmNew = false;
        break;
      case 'new-confirm':
        g.newGame();
        return;
      default:
        break;
    }
    this.render();
  }
}
