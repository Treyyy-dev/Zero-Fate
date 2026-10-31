import * as THREE from 'three';

/**
 * Spell projectiles and effects (mana-based abilities from the Arcane tree).
 * Firebolt: fast projectile; collides with the world (physics ray) and enemy
 * hurtboxes; with the Fireball skill it explodes for area damage.
 * Healing Light: instant heal scaled by spell power.
 */
const _hA = new THREE.Vector3();
const _hB = new THREE.Vector3();
const _p = new THREE.Vector3();
const _next = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Spells {
  constructor({ scene, physics, combat, effects, stats, skills, floatingText }) {
    this.scene = scene;
    this.physics = physics;
    this.combat = combat;
    this.effects = effects;
    this.stats = stats;
    this.skills = skills;
    this.floatingText = floatingText;
    this.projectiles = [];
    this.geometry = new THREE.SphereGeometry(0.16, 12, 8);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffb060 });
    // A tiny pool of lights so spells light their surroundings without many lights.
    this.lights = [0, 1].map(() => {
      const l = new THREE.PointLight(0xff7a2a, 0, 7, 2);
      scene.add(l);
      return l;
    });
  }

  castFirebolt(player, aimDir) {
    const hand = new THREE.Vector3();
    player.model.object.updateMatrixWorld(true);
    const handBone = player.model._slots.leftHand;
    if (handBone) handBone.getWorldPosition(hand);
    else hand.copy(player.controller.position).add(new THREE.Vector3(0, 0.5, 0));
    const dir = aimDir ? aimDir.clone().normalize() : new THREE.Vector3(Math.sin(player.controller.facing), 0, Math.cos(player.controller.facing));
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.position.copy(hand);
    this.scene.add(mesh);
    const light = this.lights.find((l) => !l.userData.busy) ?? null;
    if (light) {
      light.userData.busy = true;
      light.intensity = 6;
    }
    this.projectiles.push({
      mesh, light, owner: player, velocity: dir.multiplyScalar(24), life: 2.2,
      damage: Math.round(24 * this.stats.spellPower), explode: this.skills.has('fireball'),
    });
  }

  castHeal(player) {
    const amount = Math.round(45 * this.stats.spellPower);
    const healed = this.stats.heal(amount);
    const p = player.controller.position;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.4;
      this.effects.spawn(p.x + Math.cos(a) * r, p.y - 0.8 + Math.random() * 0.6, p.z + Math.sin(a) * r, 0, 1.4 + Math.random(), 0, {
        size: 0.18, life: 1.1, color: 0x9ff08a,
      });
    }
    this.floatingText?.show(p.clone().setY(p.y + 1.1), `+${Math.round(healed)}`, 'heal');
  }

  update(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      const pos = pr.mesh.position;
      _next.copy(pos).addScaledVector(pr.velocity, dt);
      // Trail
      for (let k = 0; k < 3; k++) {
        this.effects.spawn(pos.x + (Math.random() - 0.5) * 0.1, pos.y + (Math.random() - 0.5) * 0.1, pos.z + (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.4, (Math.random() - 0.5) * 0.6,
          { size: 0.26, life: 0.35, color: k ? 0xff7a20 : 0xffd27a });
      }
      let hitPoint = null;
      // Enemies
      for (const target of this.combat.opponents('player')) {
        const r = target.getHurtbox(_hA, _hB);
        const d = _p.subVectors(_next, pos);
        const steps = 3;
        for (let s = 1; s <= steps && !hitPoint; s++) {
          const q = _dir.copy(pos).addScaledVector(d, s / steps);
          const seg = _hB.clone().sub(_hA);
          const t = THREE.MathUtils.clamp(q.clone().sub(_hA).dot(seg) / seg.lengthSq(), 0, 1);
          const closest = _hA.clone().addScaledVector(seg, t);
          if (closest.distanceToSquared(q) < (r + 0.2) ** 2) {
            hitPoint = q.clone();
            if (!pr.explode) this._damage(target, pr, hitPoint);
          }
        }
        if (hitPoint) break;
      }
      // World
      if (!hitPoint) {
        const seg = _p.subVectors(_next, pos);
        const len = seg.length();
        if (len > 0) {
          const toi = this.physics.castRay(pos, seg.clone().divideScalar(len), len, pr.owner.controller.body);
          if (toi !== null) hitPoint = pos.clone().addScaledVector(seg, toi / len);
        }
      }
      if (hitPoint || pr.life <= 0) {
        const at = hitPoint ?? pos;
        if (pr.explode) {
          this.effects.burst(at, 60, { color: 0xff8a2a, speed: 7, size: 0.32, life: 0.6, gravity: -2 });
          this.combat.sphereQuery('player', at, 3.2, (target) => this._damage(target, pr, at, 0.8));
        } else {
          this.effects.burst(at, 18, { color: 0xff9a40, speed: 3.5, size: 0.2, life: 0.4, gravity: -4 });
        }
        this._remove(i);
        continue;
      }
      pos.copy(_next);
      if (pr.light) pr.light.position.copy(pos);
    }
  }

  _damage(target, pr, point, mult = 1) {
    target.receiveHit({
      attacker: pr.owner, damage: Math.round(pr.damage * mult), poise: 30, heavy: false, magic: true,
      point, from: pr.owner.controller.position.clone(), knockback: 1.5,
    });
  }

  _remove(i) {
    const pr = this.projectiles[i];
    pr.mesh.removeFromParent();
    if (pr.light) {
      pr.light.intensity = 0;
      pr.light.userData.busy = false;
    }
    this.projectiles.splice(i, 1);
  }
}
