import * as THREE from 'three';
import { clamp, dampFactor } from '../utils/math.js';

const _goal = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _toCam = new THREE.Vector3();

/**
 * Orbiting third-person camera.
 * - yaw/pitch driven by mouse or touch
 * - smoothed follow (softer vertically so stairs and landings don't jolt)
 * - over-the-shoulder offset
 * - physics ray test so it never clips through walls or terrain
 *
 * Yaw convention: camera sits at pivot + (sin(yaw), ·, cos(yaw)) * distance,
 * so movement "forward" is (-sin(yaw), 0, -cos(yaw)).
 */
export class ThirdPersonCamera {
  constructor(camera, physics, cfg) {
    this.camera = camera;
    this.physics = physics;
    this.cfg = cfg;
    this.yaw = cfg.initialYaw;
    this.pitch = cfg.initialPitch;
    this.distance = cfg.distance;
    this.currentDistance = cfg.distance;
    this.pivot = new THREE.Vector3();
    this._initialized = false;
  }

  rotate(dx, dy) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch + dy, this.cfg.pitchMin, this.cfg.pitchMax);
  }

  zoom(steps) {
    if (!steps) return;
    this.distance = clamp(this.distance + steps * this.cfg.zoomStep, this.cfg.minDistance, this.cfg.maxDistance);
  }

  /** Jump straight to the target (spawn / respawn). */
  snapTo(target) {
    this.pivot.set(target.x, target.y + this.cfg.pivotHeight, target.z);
    this.currentDistance = this.distance;
    this._initialized = true;
  }

  /**
   * @param {number} dt frame delta
   * @param {THREE.Vector3} target player capsule centre (interpolated)
   * @param {object} excludeBody Rapier body ignored by the collision ray
   */
  update(dt, target, excludeBody) {
    const cfg = this.cfg;
    if (!this._initialized) this.snapTo(target);

    _goal.set(target.x, target.y + cfg.pivotHeight, target.z);
    const kxz = dampFactor(cfg.followSharpness, dt);
    const ky = dampFactor(cfg.followSharpnessY, dt);
    this.pivot.x += (_goal.x - this.pivot.x) * kxz;
    this.pivot.z += (_goal.z - this.pivot.z) * kxz;
    this.pivot.y += (_goal.y - this.pivot.y) * ky;

    const cosP = Math.cos(this.pitch);
    _dir.set(Math.sin(this.yaw) * cosP, Math.sin(this.pitch), Math.cos(this.yaw) * cosP);
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _origin.copy(this.pivot).addScaledVector(_right, cfg.shoulderOffset);
    _desired.copy(_origin).addScaledVector(_dir, this.distance);

    _toCam.subVectors(_desired, this.pivot);
    const fullLength = _toCam.length();
    _toCam.divideScalar(fullLength);

    let allowed = fullLength;
    const hit = this.physics.castRay(this.pivot, _toCam, fullLength + cfg.collisionPadding, excludeBody);
    if (hit !== null) allowed = Math.max(cfg.minCollisionDistance, hit - cfg.collisionPadding);

    // Pull in instantly (never show the inside of a wall), ease back out.
    if (allowed < this.currentDistance) this.currentDistance = allowed;
    else this.currentDistance += (allowed - this.currentDistance) * dampFactor(cfg.recoverSharpness, dt);

    this.camera.position.copy(this.pivot).addScaledVector(_toCam, this.currentDistance);
    this.camera.lookAt(_origin);
  }

  /** Adjust field of view for portrait vs landscape screens. */
  setAspect(aspect) {
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 1 ? this.cfg.portraitFov : this.cfg.fov;
    this.camera.updateProjectionMatrix();
  }
}
