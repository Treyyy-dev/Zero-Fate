import { Emitter } from '../core/Emitter.js';
import { Enemy } from './Enemy.js';
import { ENEMIES } from './EnemyDefs.js';
import { mulberry32 } from '../utils/noise.js';

/**
 * Spawns enemies from spawn groups when the player comes near and removes
 * them when the player leaves (distance-based streaming). Tracks kills,
 * respawn timers and unique enemies (bosses stay dead across saves).
 * Also limits how many enemies may swing at the player at once.
 *
 * Events: 'kill' {enemy, killer}, 'spawned' {enemy}
 */
export class EnemyManager extends Emitter {
  constructor({ scene, physics, combat, effects, floatingText, getGroundHeight, hasGround = () => true, spawnGroups, maxAttackers = 2 }) {
    super();
    this.hasGround = hasGround;
    this.scene = scene;
    this.physics = physics;
    this.combat = combat;
    this.effects = effects;
    this.floatingText = floatingText;
    this.getGroundHeight = getGroundHeight;
    this.maxAttackers = maxAttackers;
    this.attackers = new Set();
    this.groups = spawnGroups.map((g) => ({ ...g, active: [], respawnAt: {}, killed: new Set() }));
    this.enemies = new Set();
    this.uniqueKilled = new Set();
    this.time = 0;
    this.activateRadius = 110;
    this.deactivateRadius = 160;
  }

  requestToken(enemy) {
    if (this.attackers.has(enemy)) return true;
    if (this.attackers.size >= this.maxAttackers) return false;
    this.attackers.add(enemy);
    return true;
  }

  releaseToken(enemy) {
    this.attackers.delete(enemy);
  }

  update(dt, player) {
    this.time += dt;
    const pp = player.position;
    for (const g of this.groups) {
      const d = Math.hypot(pp.x - g.x, pp.z - g.z);
      if (d < this.activateRadius && this.hasGround(g.x, g.z)) this._fillGroup(g);
      else if (d > this.deactivateRadius) this._emptyGroup(g);
    }
    for (const e of this.enemies) {
      e.update(dt, player);
      if (e.state === 'dead' && e.deadTime > 10.5) this._remove(e);
    }
  }

  fixedUpdate(dt) {
    // Enemies standing on terrain whose collider isn't streamed in yet wait in place.
    for (const e of this.enemies) if (this.hasGround(e.position.x, e.position.z)) e.fixedUpdate(dt);
  }

  syncVisuals(alpha) {
    for (const e of this.enemies) e.syncVisual(alpha);
  }

  /** Enemies currently fighting the player (for health bars and music cues). */
  engaged() {
    return [...this.enemies].filter((e) => e.alive && e.aggro);
  }

  _fillGroup(g) {
    const def = ENEMIES[g.type];
    for (let i = 0; i < g.count; i++) {
      const slotId = `${g.id}:${i}`;
      if (g.active[i]) continue;
      if (def.unique && this.uniqueKilled.has(slotId)) continue;
      if ((g.respawnAt[i] ?? 0) > this.time) continue;
      const rng = mulberry32(hash(slotId) + Math.floor(this.time));
      const a = (i / g.count) * Math.PI * 2 + rng() * 0.6;
      const r = g.count > 1 ? g.radius * (0.4 + rng() * 0.6) : 0;
      const x = g.x + Math.cos(a) * r;
      const z = g.z + Math.sin(a) * r;
      const y = this.getGroundHeight(x, z) + 0.95 + 0.3;
      const enemy = new Enemy({
        def, type: g.type, id: slotId, position: { x, y, z }, scene: this.scene, physics: this.physics,
        combat: this.combat, effects: this.effects, floatingText: this.floatingText, manager: this, rng,
      });
      enemy.groupSlot = { g, i };
      enemy.on('death', (ev) => this._onDeath(ev));
      g.active[i] = enemy;
      this.enemies.add(enemy);
      this.emit('spawned', { enemy });
    }
  }

  _emptyGroup(g) {
    g.active.forEach((e, i) => {
      if (!e) return;
      if (e.alive && e.aggro) return; // never despawn mid-fight
      this._remove(e);
      g.active[i] = null;
    });
  }

  _onDeath({ enemy, killer }) {
    const { g, i } = enemy.groupSlot;
    if (enemy.def.unique) this.uniqueKilled.add(enemy.id);
    g.respawnAt[i] = this.time + (g.respawn ?? 300);
    this.emit('kill', { enemy, killer });
  }

  _remove(e) {
    if (!this.enemies.has(e)) return;
    this.enemies.delete(e);
    this.attackers.delete(e);
    const { g, i } = e.groupSlot;
    if (g.active[i] === e) g.active[i] = null;
    e.dispose();
  }

  toJSON() {
    return { uniqueKilled: [...this.uniqueKilled] };
  }

  fromJSON(d) {
    this.uniqueKilled = new Set(d?.uniqueKilled ?? []);
    for (const e of [...this.enemies]) if (e.def.unique && this.uniqueKilled.has(e.id)) this._remove(e);
  }
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
