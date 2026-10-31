import * as THREE from 'three';

/**
 * Registry of things the player can use with the interact key (E / USE):
 * NPCs, chests, loot bags, ore veins, the relic pedestal.
 * Each entry: { id, position (Vector3), radius, label, available()?, action() }
 */
export class Interactions {
  constructor() {
    this.entries = new Map();
    this.current = null;
  }

  add(entry) {
    this.entries.set(entry.id, { radius: 2.4, available: () => true, ...entry });
    return () => this.entries.delete(entry.id);
  }

  remove(id) {
    this.entries.delete(id);
  }

  /** Finds the best entry in front of / near the player. */
  update(position, facing) {
    let best = null;
    let bestScore = Infinity;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    for (const e of this.entries.values()) {
      const p = typeof e.position === 'function' ? e.position() : e.position;
      const dx = p.x - position.x;
      const dz = p.z - position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > e.radius || Math.abs(p.y - position.y) > 3) continue;
      if (!e.available()) continue;
      const facingBonus = dist > 0.01 ? (dx * fx + dz * fz) / dist : 1;
      const score = dist - facingBonus * 0.8;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    this.current = best;
    return best;
  }

  activate() {
    const e = this.current;
    if (!e) return false;
    e.action();
    return true;
  }
}

/** Point-light pool assigned to the nearest torches each frame (cheap, fixed shader cost). */
export class TorchLights {
  constructor(scene, count) {
    this.groups = new Map(); // site id → Vector3[]
    this.lights = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffa04a, 0, 14, 1.8);
      scene.add(l);
      this.lights.push(l);
    }
    this.time = 0;
  }

  add(id, list) {
    this.groups.set(id, list);
    return () => this.groups.delete(id);
  }

  update(dt, focus, darkness, indoor) {
    this.time += dt;
    const all = [];
    for (const list of this.groups.values()) for (const p of list) all.push(p);
    all.sort((a, b) => a.distanceToSquared(focus) - b.distanceToSquared(focus));
    const level = Math.max(darkness, indoor);
    this.lights.forEach((l, i) => {
      const p = all[i];
      if (!p || p.distanceTo(focus) > 45 || level < 0.15) {
        l.intensity = 0;
        return;
      }
      l.position.copy(p);
      const flicker = 0.85 + Math.sin(this.time * 13 + i * 3.1) * 0.08 + Math.sin(this.time * 7.3 + i) * 0.07;
      l.intensity = 9 * level * flicker;
    });
  }
}
