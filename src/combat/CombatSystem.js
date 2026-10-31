import * as THREE from 'three';
import { Emitter } from '../core/Emitter.js';

/**
 * Central hit detection.
 *
 * Every combatant registers a capsule HURTBOX (a segment + radius that
 * follows its body). Weapons are swept BLADE SEGMENTS: each frame of an attack's
 * active window, the blade's previous and current positions are interpolated
 * into several segments and tested against every opposing hurtbox using exact
 * segment–segment distance. A target can be hit once per swing.
 *
 * Combatant interface:
 *   team: 'player' | 'enemy'
 *   alive: boolean
 *   getHurtbox(outA, outB) → radius      (capsule axis in world space)
 *   receiveHit(hit) → { applied, blocked, dodged }
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();
const _hA = new THREE.Vector3();
const _hB = new THREE.Vector3();
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/** Squared distance between segments p1q1 and p2q2; writes closest points to c1/c2. */
export function segmentSegmentDistSq(p1, q1, p2, q2, c1, c2) {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r);
  let s;
  let t;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    c1.copy(p1);
    c2.copy(p2);
    return c1.distanceToSquared(c2);
  }
  if (a <= EPS) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  c1.copy(p1).addScaledVector(_d1, s);
  c2.copy(p2).addScaledVector(_d2, t);
  return c1.distanceToSquared(c2);
}

/** Squared distance from point p to segment ab. */
export function pointSegmentDistSq(p, a, b, out) {
  _d1.subVectors(b, a);
  const len = _d1.lengthSq();
  const t = len > 0 ? THREE.MathUtils.clamp(_r.subVectors(p, a).dot(_d1) / len, 0, 1) : 0;
  out.copy(a).addScaledVector(_d1, t);
  return out.distanceToSquared(p);
}

export class CombatSystem extends Emitter {
  constructor() {
    super();
    this.combatants = new Set();
  }

  register(c) {
    this.combatants.add(c);
    return () => this.combatants.delete(c);
  }

  unregister(c) {
    this.combatants.delete(c);
  }

  /** Opponents of `team` that are alive. */
  *opponents(team) {
    for (const c of this.combatants) if (c.alive && c.team !== team) yield c;
  }

  /**
   * Sweeps a blade from (prevBase, prevTip) to (base, tip).
   * @returns array of hit results
   */
  sweepBlade({ attacker, prevBase, prevTip, base, tip, radius, alreadyHit, makeHit, steps = 4 }) {
    const results = [];
    for (const target of this.opponents(attacker.team)) {
      if (alreadyHit.has(target)) continue;
      const hurtR = target.getHurtbox(_hA, _hB);
      const reach = (hurtR + radius) * (hurtR + radius);
      // Broad phase: skip far targets.
      if (_hA.distanceToSquared(base) > 16 && _hA.distanceToSquared(tip) > 16) continue;
      for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        _a.lerpVectors(prevBase, base, k);
        _b.lerpVectors(prevTip, tip, k);
        if (segmentSegmentDistSq(_a, _b, _hA, _hB, _c1, _c2) <= reach) {
          alreadyHit.add(target);
          const hit = makeHit(target, _c1.clone());
          const res = target.receiveHit(hit);
          results.push({ target, hit, ...res });
          this.emit('hit', { attacker, target, hit, result: res });
          break;
        }
      }
    }
    return results;
  }

  /** Sphere query (spells, explosions). */
  sphereQuery(team, center, radius, cb) {
    for (const target of this.opponents(team)) {
      const hurtR = target.getHurtbox(_hA, _hB);
      if (pointSegmentDistSq(center, _hA, _hB, _p) <= (radius + hurtR) ** 2) cb(target, _p.clone());
    }
  }

  /** Nearest opponent within range and in front of a facing angle (soft lock-on). */
  findTarget(team, position, facing, range = 4, coneDeg = 70) {
    let best = null;
    let bestScore = Infinity;
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const cosCone = Math.cos((coneDeg * Math.PI) / 180);
    for (const t of this.opponents(team)) {
      t.getHurtbox(_hA, _hB);
      const dx = _hA.x - position.x;
      const dz = _hA.z - position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range || dist < 1e-3) continue;
      const dot = (dx * fx + dz * fz) / dist;
      if (dot < cosCone) continue;
      const score = dist * (2 - dot);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }
}

/** Shared helper for hit direction checks (blocking from the front). */
export function isInFront(facing, from, to, coneDeg) {
  const dx = from.x - to.x;
  const dz = from.z - to.z;
  const len = Math.hypot(dx, dz) || 1;
  const dot = (dx * Math.sin(facing) + dz * Math.cos(facing)) / len;
  return dot >= Math.cos((coneDeg * Math.PI) / 180);
}

