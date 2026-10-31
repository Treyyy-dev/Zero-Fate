import * as THREE from 'three';

/**
 * Lightweight physics body for AI characters (enemies, NPCs): a Rapier
 * kinematic capsule driven by the character controller, with gravity,
 * slope limits and auto-step. Characters collide with the world, the player
 * and each other.
 */
export class CharacterMotor {
  constructor(physics, position, { radius = 0.35, halfHeight = 0.55, stepHeight = 0.35 } = {}) {
    const R = physics.RAPIER;
    this.world = physics.world;
    this.radius = radius;
    this.halfHeight = halfHeight;
    this.position = new THREE.Vector3(position.x, position.y, position.z);
    this.prevPosition = this.position.clone();
    this.renderPosition = this.position.clone();
    this.velocity = new THREE.Vector3();
    this.grounded = false;
    this.facing = 0;
    this.enabled = true;

    this.body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z));
    this.collider = this.world.createCollider(R.ColliderDesc.capsule(halfHeight, radius).setFriction(0), this.body);
    const c = this.world.createCharacterController(0.02);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setSlideEnabled(true);
    c.enableAutostep(stepHeight, 0.15, false);
    c.enableSnapToGround(0.4);
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.controller = c;
    this._desired = new THREE.Vector3();
  }

  get centerToFeet() {
    return this.halfHeight + this.radius;
  }

  get feetY() {
    return this.position.y - this.centerToFeet;
  }

  /** Teleport (spawning, leash reset). */
  setPosition(p) {
    this.position.copy(p);
    this.prevPosition.copy(p);
    this.body.setTranslation(p, true);
    this.body.setNextKinematicTranslation(p);
  }

  /** One physics tick toward a desired horizontal velocity (x, z). */
  step(dt, vx, vz) {
    if (!this.enabled) return;
    this.prevPosition.copy(this.position);
    this.velocity.x = vx;
    this.velocity.z = vz;
    const wasGrounded = this.grounded;
    if (wasGrounded) this.velocity.y = 0;
    else this.velocity.y = Math.max(this.velocity.y - 30 * dt, -40);
    // Pass 1: intended motion (no downward push or snapping, so auto-step works).
    this.controller.disableSnapToGround();
    this._desired.copy(this.velocity).multiplyScalar(dt);
    this.controller.computeColliderMovement(this.collider, this._desired);
    const mv = this.controller.computedMovement();
    this.position.x += mv.x;
    this.position.y += mv.y;
    this.position.z += mv.z;
    this.grounded = this.controller.computedGrounded();
    if (wasGrounded) {
      // Pass 2: settle onto the ground (and down slopes via snap-to-ground).
      this.collider.setTranslation(this.position);
      this.controller.enableSnapToGround(0.4);
      this.controller.computeColliderMovement(this.collider, { x: 0, y: -0.06, z: 0 });
      this.position.y += this.controller.computedMovement().y;
      this.grounded = this.controller.computedGrounded();
    }
    this.body.setNextKinematicTranslation(this.position);
  }

  interpolate(alpha) {
    this.renderPosition.lerpVectors(this.prevPosition, this.position, alpha);
    return this.renderPosition;
  }

  /** Removes the physics body (corpses) but keeps the motor object. */
  disablePhysics() {
    if (!this.enabled) return;
    this.enabled = false;
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }

  dispose() {
    this.disablePhysics();
  }
}
