import * as THREE from 'three';
import { CharacterModel } from '../character/CharacterModel.js';
import { OUTFITS } from '../character/HumanoidRig.js';
import { lerpAngle, wrapAngle } from '../utils/math.js';

/**
 * Non-hostile characters. Quest givers stand at their post and turn to face
 * the player; ambient villagers wander around their home spot. NPCs use the
 * same skinned humanoid and animation state machine as everyone else, and
 * have a static collider so you can't walk through them.
 */
export class NPC {
  constructor({ spec, scene, physics, gen }) {
    this.id = spec.id;
    this.spec = spec;
    this.gen = gen;
    this.model = CharacterModel.procedural(OUTFITS[spec.outfit] ?? OUTFITS.villager);
    this.home = spec.position.clone();
    this.position = spec.position.clone();
    this.position.y = gen.heightAt(this.position.x, this.position.z);
    this.facing = spec.rotY ?? 0;
    this.baseFacing = this.facing;
    this.wander = spec.wander ?? 0;
    this.target = null;
    this.wait = 2 + Math.random() * 3;
    this.speed = 0;
    scene.add(this.model.object);
    this.physics = physics;
    this.collider = spec.wander ? null : physics.addStaticCylinder(0.9, 0.38, { x: this.position.x, y: this.position.y + 0.9, z: this.position.z });
    this._place();
  }

  get headPosition() {
    return new THREE.Vector3(this.position.x, this.position.y + 2.1, this.position.z);
  }

  update(dt, playerPos) {
    const d = playerPos ? Math.hypot(playerPos.x - this.position.x, playerPos.z - this.position.z) : 99;
    if (d > 70) return; // too far to bother animating
    if (this.wander) {
      if (!this.target) {
        this.wait -= dt;
        this.speed = 0;
        if (this.wait <= 0) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * this.wander;
          this.target = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
        }
      } else {
        const dx = this.target.x - this.position.x;
        const dz = this.target.z - this.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.3 || d < 2.2) {
          this.target = null;
          this.wait = 3 + Math.random() * 5;
        } else {
          this.facing = wrapAngle(lerpAngle(this.facing, Math.atan2(dx, dz), Math.min(1, dt * 5)));
          this.speed = 1.3;
          this.position.x += Math.sin(this.facing) * this.speed * dt;
          this.position.z += Math.cos(this.facing) * this.speed * dt;
          this.position.y = this.gen.heightAt(this.position.x, this.position.z);
        }
      }
    }
    if (d < 6 && (!this.target || d < 2.2)) {
      const a = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z);
      this.facing = wrapAngle(lerpAngle(this.facing, a, Math.min(1, dt * 4)));
    } else if (!this.wander) {
      this.facing = wrapAngle(lerpAngle(this.facing, this.baseFacing, Math.min(1, dt * 2)));
    }
    this.model.update(dt, this.speed);
    this._place();
  }

  _place() {
    this.model.object.position.copy(this.position);
    this.model.object.rotation.y = this.facing;
  }

  dispose() {
    if (this.collider) this.physics.world.removeCollider(this.collider, false);
    this.model.object.removeFromParent();
    this.model.dispose();
  }
}
