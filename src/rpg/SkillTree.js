import { Emitter } from '../core/Emitter.js';

/**
 * Three skill trees. Each node has ranks, a prerequisite and either stat
 * modifiers (applied to PlayerStats per rank) or an unlock flag that combat
 * code checks with `skills.has(id)` / `skills.rank(id)`.
 */
export const SKILL_TREES = {
  warrior: {
    name: 'Warrior',
    color: '#d0674a',
    nodes: {
      bruteForce: { name: 'Brute Force', maxRank: 3, row: 0, col: 1, mods: { physicalPct: 0.08 }, desc: '+8% physical damage per rank.' },
      ironSkin: { name: 'Iron Skin', maxRank: 3, row: 1, col: 0, requires: 'bruteForce', mods: { armor: 8 }, desc: '+8 armour per rank.' },
      powerStrike: { name: 'Power Strike', maxRank: 1, row: 1, col: 2, requires: 'bruteForce', mods: { heavyPct: 0.3 }, desc: 'Heavy attacks deal 30% more damage and cost 20% less stamina.' },
      unbreakable: { name: 'Unbreakable', maxRank: 1, row: 2, col: 0, requires: 'ironSkin', mods: { blockPct: 0.12, blockStaminaPct: 0.35 }, desc: 'Blocks absorb more damage and cost less stamina.' },
      battleFury: { name: 'Battle Fury', maxRank: 1, row: 2, col: 2, requires: 'powerStrike', desc: 'Each kill restores 25 stamina and 8% health.' },
    },
  },
  ranger: {
    name: 'Agility',
    color: '#6fb85a',
    nodes: {
      fleetFoot: { name: 'Fleet Foot', maxRank: 2, row: 0, col: 1, mods: { speedPct: 0.05 }, desc: '+5% movement speed per rank.' },
      secondWind: { name: 'Second Wind', maxRank: 2, row: 1, col: 0, requires: 'fleetFoot', mods: { staminaRegenPct: 0.2 }, desc: '+20% stamina regeneration per rank.' },
      evasion: { name: 'Evasion', maxRank: 1, row: 1, col: 2, requires: 'fleetFoot', mods: { dodgeCostPct: 0.25 }, desc: 'Dodges cost 25% less and grant longer invulnerability.' },
      riposte: { name: 'Riposte', maxRank: 1, row: 2, col: 2, requires: 'evasion', desc: 'Attacking within 1 s of a dodge that avoided a hit deals +60% damage.' },
      endurance: { name: 'Endurance', maxRank: 2, row: 2, col: 0, requires: 'secondWind', mods: { maxStamina: 20 }, desc: '+20 maximum stamina per rank.' },
    },
  },
  mage: {
    name: 'Arcane',
    color: '#6a8cf0',
    nodes: {
      firebolt: { name: 'Firebolt', maxRank: 1, row: 0, col: 1, desc: 'Unlocks Firebolt (15 mana). Assign it to the hotbar.' },
      manaFlow: { name: 'Mana Flow', maxRank: 2, row: 1, col: 0, requires: 'firebolt', mods: { manaRegenPct: 0.5 }, desc: '+50% mana regeneration per rank.' },
      healingLight: { name: 'Healing Light', maxRank: 1, row: 1, col: 2, requires: 'firebolt', desc: 'Unlocks Healing Light (30 mana).' },
      fireball: { name: 'Fireball', maxRank: 1, row: 2, col: 0, requires: 'manaFlow', minLevel: 5, desc: 'Firebolt explodes, damaging all nearby enemies.' },
      arcaneMight: { name: 'Arcane Might', maxRank: 2, row: 2, col: 2, requires: 'healingLight', mods: { spellPct: 0.15, maxMana: 15 }, desc: '+15% spell power and +15 mana per rank.' },
    },
  },
};

export const SPELLS = {
  firebolt: { name: 'Firebolt', skill: 'firebolt', mana: 15, cooldown: 0.6, color: '#ff7a2a' },
  heal: { name: 'Healing Light', skill: 'healingLight', mana: 30, cooldown: 4, color: '#8fe07a' },
};

const NODE_INDEX = {};
for (const [treeId, tree] of Object.entries(SKILL_TREES)) {
  for (const [id, node] of Object.entries(tree.nodes)) NODE_INDEX[id] = { ...node, id, treeId };
}

export class SkillTree extends Emitter {
  constructor(stats) {
    super();
    this.stats = stats;
    this.ranks = {};
  }

  rank(id) {
    return this.ranks[id] ?? 0;
  }

  has(id) {
    return this.rank(id) > 0;
  }

  node(id) {
    return NODE_INDEX[id];
  }

  /** Why a node cannot be learned right now, or null if it can. */
  blocker(id) {
    const n = NODE_INDEX[id];
    if (!n) return 'Unknown skill';
    if (this.rank(id) >= n.maxRank) return 'Maxed';
    if (this.stats.skillPoints <= 0) return 'No skill points';
    if (n.requires && !this.has(n.requires)) return `Requires ${NODE_INDEX[n.requires].name}`;
    if (n.minLevel && this.stats.level < n.minLevel) return `Requires level ${n.minLevel}`;
    return null;
  }

  learn(id) {
    if (this.blocker(id)) return false;
    this.ranks[id] = this.rank(id) + 1;
    this.stats.skillPoints -= 1;
    this._apply(id);
    this.emit('learn', { id, rank: this.ranks[id], node: NODE_INDEX[id] });
    this.emit('change');
    return true;
  }

  _apply(id) {
    const n = NODE_INDEX[id];
    if (!n.mods) return;
    const r = this.rank(id);
    const scaled = {};
    for (const [k, v] of Object.entries(n.mods)) scaled[k] = v * r;
    this.stats.setModifiers(`skill:${id}`, scaled);
  }

  spellUnlocked(spellId) {
    const s = SPELLS[spellId];
    return !!s && this.has(s.skill);
  }

  toJSON() {
    return { ...this.ranks };
  }

  fromJSON(d) {
    this.ranks = { ...(d ?? {}) };
    for (const id of Object.keys(this.ranks)) if (NODE_INDEX[id]) this._apply(id);
    this.emit('change');
  }
}
