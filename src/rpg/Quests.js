import { Emitter } from '../core/Emitter.js';

/**
 * Quest definitions and tracking.
 *
 * Objective types:
 *   kill     { enemy, count }          counted from combat kill events
 *   collect  { item, count }           counted live from the inventory
 *   reach    { poi, label }            entering a point-of-interest radius
 *   interact { target, label }         using a world object (pedestal, chest…)
 *
 * Status: 'active' → 'ready' (all objectives met, return to turnIn NPC) → 'done'
 * Events: 'change', 'accepted', 'updated' {quest, objective}, 'ready', 'completed'
 */
export const QUESTS = {
  bandit_trouble: {
    title: 'Bandit Trouble',
    giver: 'elder_maren',
    turnIn: 'elder_maren',
    summary: 'Bandits have been raiding the east road. Thin their numbers.',
    offer: 'Bandits camp beyond the east road and rob anyone who passes. Drive them off, and Brookhollow will reward you.',
    objectives: [{ type: 'kill', enemy: 'bandit', count: 4, label: 'Defeat bandits' }],
    rewards: { xp: 160, gold: 60, items: [['iron_sword', 1], ['health_potion', 2]] },
  },
  lost_relic: {
    title: 'The Sunstone Relic',
    giver: 'elder_maren',
    turnIn: 'elder_maren',
    requires: ['bandit_trouble'],
    summary: 'Recover the Sunstone Relic from the old ruins to the south-east.',
    offer: 'Our Sunstone was taken to the ruins long ago. Skeletons guard the place now. Bring it home.',
    objectives: [
      { type: 'reach', poi: 'ruins', label: 'Travel to the ruins' },
      { type: 'interact', target: 'relic_pedestal', label: 'Take the Sunstone Relic' },
    ],
    consume: [['sunstone_relic', 1]],
    rewards: { xp: 280, gold: 80, items: [['greater_health_potion', 2], ['ring_of_insight', 1]] },
  },
  smiths_ore: {
    title: "The Smith's Ore",
    giver: 'smith_hilde',
    turnIn: 'smith_hilde',
    summary: 'Hilde needs iron ore. Look for ore veins along the north road.',
    offer: "My forge is cold without iron. There are ore veins along the north road toward the cave. Bring me three chunks and I'll make it worth your while.",
    objectives: [{ type: 'collect', item: 'iron_ore', count: 3, label: 'Collect iron ore' }],
    consume: [['iron_ore', 3]],
    rewards: { xp: 120, gold: 30, items: [['chainmail', 1]] },
  },
  into_the_dark: {
    title: 'Into the Dark',
    giver: 'captain_roderic',
    turnIn: 'captain_roderic',
    summary: 'The dead walk in the northern cave. Destroy them.',
    offer: 'My scouts saw skeletons crawling out of the northern cave. Go in there and put them back in the ground.',
    objectives: [
      { type: 'reach', poi: 'cave', label: 'Enter the northern cave' },
      { type: 'kill', enemy: 'skeleton', count: 5, label: 'Destroy skeletons' },
    ],
    rewards: { xp: 420, gold: 120, items: [['steel_longsword', 1]] },
  },
  the_chieftain: {
    title: 'The Chieftain',
    giver: 'captain_roderic',
    turnIn: 'captain_roderic',
    requires: ['bandit_trouble'],
    summary: 'Slay the bandit chieftain at the camp on the east road.',
    offer: "You've rattled the bandits. Their chieftain still holds the camp. End him and the road is safe.",
    objectives: [{ type: 'kill', enemy: 'bandit_chief', count: 1, label: 'Slay the bandit chieftain' }],
    rewards: { xp: 520, gold: 150, items: [['steel_helm', 1]] },
  },
};

export class QuestLog extends Emitter {
  constructor(inventory, stats) {
    super();
    this.inventory = inventory;
    this.stats = stats;
    this.state = {}; // id → { status, progress: [n...] }
    this.tracked = null;
    inventory.on('change', () => this._recountCollect());
  }

  status(id) {
    return this.state[id]?.status ?? (this.isAvailable(id) ? 'available' : 'locked');
  }

  isAvailable(id) {
    const q = QUESTS[id];
    if (!q || this.state[id]) return false;
    return (q.requires ?? []).every((r) => this.state[r]?.status === 'done');
  }

  /** Quests an NPC can offer or accept a turn-in for. */
  forNpc(npcId) {
    const offers = [];
    const turnIns = [];
    const active = [];
    for (const [id, q] of Object.entries(QUESTS)) {
      const st = this.status(id);
      if (q.giver === npcId && st === 'available') offers.push(id);
      if (q.turnIn === npcId && st === 'ready') turnIns.push(id);
      if (q.turnIn === npcId && st === 'active') active.push(id);
    }
    return { offers, turnIns, active };
  }

  accept(id) {
    if (!this.isAvailable(id)) return false;
    const q = QUESTS[id];
    this.state[id] = { status: 'active', progress: q.objectives.map(() => 0) };
    if (!this.tracked || this.state[this.tracked]?.status === 'done') this.tracked = id;
    this._recountCollect();
    this.emit('accepted', { id, quest: q });
    this._checkReady(id);
    this.emit('change');
    return true;
  }

  /** Feed gameplay events here: {type:'kill', enemy}, {type:'reach', poi}, {type:'interact', target}. */
  notify(event) {
    for (const [id, st] of Object.entries(this.state)) {
      if (st.status !== 'active') continue;
      const q = QUESTS[id];
      q.objectives.forEach((obj, i) => {
        if (obj.type !== event.type) return;
        const need = obj.count ?? 1;
        if (st.progress[i] >= need) return;
        const match =
          (obj.type === 'kill' && obj.enemy === event.enemy) ||
          (obj.type === 'reach' && obj.poi === event.poi) ||
          (obj.type === 'interact' && obj.target === event.target);
        if (!match) return;
        // Objectives complete in order for multi-step quests (reach before interact).
        if (obj.type === 'interact' && i > 0 && st.progress[i - 1] < (q.objectives[i - 1].count ?? 1)) return;
        st.progress[i] += 1;
        this.emit('updated', { id, quest: q, objective: obj, progress: st.progress[i], need });
      });
      this._checkReady(id);
    }
    this.emit('change');
  }

  /** True if an interact target is currently wanted by an active quest. */
  wantsInteract(target) {
    return Object.entries(this.state).some(([id, st]) => st.status === 'active' && QUESTS[id].objectives.some((o, i) => o.type === 'interact' && o.target === target && st.progress[i] < 1));
  }

  turnIn(id) {
    const st = this.state[id];
    if (!st || st.status !== 'ready') return null;
    const q = QUESTS[id];
    for (const [item, n] of q.consume ?? []) this.inventory.remove(item, n);
    st.status = 'done';
    const r = q.rewards;
    if (r.gold) this.stats.gold += r.gold;
    for (const [item, n] of r.items ?? []) this.inventory.add(item, n);
    if (r.xp) this.stats.addXP(r.xp);
    if (this.tracked === id) this.tracked = Object.keys(this.state).find((k) => this.state[k].status !== 'done') ?? null;
    this.emit('completed', { id, quest: q });
    this.emit('change');
    return r;
  }

  objectiveText(id) {
    const st = this.state[id];
    const q = QUESTS[id];
    if (!st || !q) return [];
    if (st.status === 'ready') return [{ text: `Return to ${npcName(q.turnIn)}`, done: false }];
    return q.objectives.map((o, i) => {
      const need = o.count ?? 1;
      const n = Math.min(need, st.progress[i]);
      return { text: need > 1 ? `${o.label} (${n}/${need})` : o.label, done: n >= need };
    });
  }

  _recountCollect() {
    for (const [id, st] of Object.entries(this.state)) {
      if (st.status === 'done') continue;
      const q = QUESTS[id];
      let changed = false;
      q.objectives.forEach((o, i) => {
        if (o.type !== 'collect') return;
        const n = this.inventory.count(o.item);
        if (n !== st.progress[i]) {
          st.progress[i] = n;
          changed = true;
        }
      });
      if (changed) {
        if (st.status === 'ready' && !this._allMet(id)) st.status = 'active';
        this._checkReady(id);
        this.emit('change');
      }
    }
  }

  _allMet(id) {
    const st = this.state[id];
    return QUESTS[id].objectives.every((o, i) => st.progress[i] >= (o.count ?? 1));
  }

  _checkReady(id) {
    const st = this.state[id];
    if (st.status === 'active' && this._allMet(id)) {
      st.status = 'ready';
      this.emit('ready', { id, quest: QUESTS[id] });
    }
  }

  toJSON() {
    return { state: JSON.parse(JSON.stringify(this.state)), tracked: this.tracked };
  }

  fromJSON(d) {
    this.state = d?.state ?? {};
    this.tracked = d?.tracked ?? null;
    this._recountCollect();
    this.emit('change');
  }
}

export const NPC_NAMES = {
  elder_maren: 'Elder Maren',
  smith_hilde: 'Hilde the Smith',
  captain_roderic: 'Captain Roderic',
};

export function npcName(id) {
  return NPC_NAMES[id] ?? id;
}
