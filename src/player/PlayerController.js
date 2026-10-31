import * as THREE from 'three';
import { Emitter } from '../core/Emitter.js';
import { dampFactor, lerpAngle, wrapAngle } from '../utils/math.js';

export const PlayerState = Object.freeze({
  IDLE: 'idle',
  WALK: 'walk',
  RUN: 'run',
  JUMP: 'jump',
  FALL: 'fall',
  SWIM: 'swim',
});

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _move = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _settle = new THREE.Vector3();
const _stepStart = new THREE.Vector3();
const _stepPos = new THREE.Vector3();
const _stepDelta = new THREE.Vector3();
const NO_OPTS = Object.freeze({});

/**
 * Physics-driven player movement using Rapier's kinematic character controller.
 *
 * Pure gameplay logic: no rendering. The visual (placeholder now, rigged GLB in
 * Phase 2) reads `position`, `facing`, `state` and listens to events:
 *   'jump'    – left the ground
 *   'land'    – { impactSpeed, airTime }
 *   'respawn'
 *
 * Run `fixedUpdate` once per physics tick, then step the physics world.
 */
export class PlayerController extends Emitter {
  constructor(physics, spawn, cfg) {
    super();
    this.cfg = cfg;
    this.world = physics.world;
    const R = physics.RAPIER;
    this.R = R;
    this.waterQuery = null; // (x, z) => water surface height or null
    this.swimming = false;
    this.inWater = false;
    this._cosMaxSlope = Math.cos((cfg.maxSlopeDeg * Math.PI) / 180);

    this.spawnPoint = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
    this.position = this.spawnPoint.clone(); // capsule centre, current tick
    this.prevPosition = this.position.clone(); // previous tick (for interpolation)
    this.velocity = new THREE.Vector3();
    this.facing = cfg.initialFacing ?? 0; // yaw; 0 faces +Z
    this.grounded = false;
    this.state = PlayerState.FALL;
    this.airTime = 0;

    this.jumpBufferTimer = 0;
    this.coyoteTimer = 0;
    this.jumpLockTimer = 0;

    this.body = this.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = this.world.createCollider(
      R.ColliderDesc.capsule(cfg.halfHeight, cfg.radius).setFriction(0),
      this.body,
    );

    const c = this.world.createCharacterController(cfg.skinWidth);
    c.setUp({ x: 0, y: 1, z: 0 });
    c.setSlideEnabled(true);
    c.enableAutostep(cfg.stepHeight, cfg.stepMinWidth, false);
    c.enableSnapToGround(cfg.snapDistance);
    c.setMaxSlopeClimbAngle((cfg.maxSlopeDeg * Math.PI) / 180);
    c.setMinSlopeSlideAngle((cfg.slideSlopeDeg * Math.PI) / 180);
    c.setApplyImpulsesToDynamicBodies(true);
    if (typeof c.setCharacterMass === 'function') c.setCharacterMass(cfg.mass);
    this.controller = c;
    this._snapEnabled = true;
  }

  /** Distance from capsule centre down to the feet. */
  get centerToFeet() {
    return this.cfg.halfHeight + this.cfg.radius;
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  requestJump() {
    this.jumpBufferTimer = this.cfg.jumpBuffer;
  }

  respawn() {
    this.position.copy(this.spawnPoint);
    this.prevPosition.copy(this.spawnPoint);
    this.velocity.set(0, 0, 0);
    this.body.setTranslation(this.spawnPoint, true);
    this.body.setNextKinematicTranslation(this.spawnPoint);
    this.grounded = false;
    this.airTime = 0;
    this.emit('respawn');
  }

  /**
   * @param {number} dt fixed timestep
   * @param {{x:number,y:number,magnitude:number}} move camera-space intent (x right, y forward)
   * @param {boolean} running
   * @param {number} cameraYaw camera yaw; movement is relative to it
   * @param {object} [opts] gameplay modifiers (all optional; defaults = plain movement)
   * @param {number} [opts.speedMul=1]   multiplies target speed (stats, blocking, attacking)
   * @param {THREE.Vector3|null} [opts.forced]  forced horizontal velocity (dodge, lunge, knockback)
   * @param {boolean} [opts.canJump=true]
   * @param {boolean} [opts.canTurn=true]
   * @param {number} [opts.jumpMul=1]
   */
  fixedUpdate(dt, move, running, cameraYaw, opts = NO_OPTS) {
    const cfg = this.cfg;
    const speedMul = opts.speedMul ?? 1;
    const forced = opts.forced ?? null;
    const canJump = opts.canJump ?? true;
    const canTurn = opts.canTurn ?? true;
    this.prevPosition.copy(this.position);

    // --- Water ---
    const surface = this.waterQuery ? this.waterQuery(this.position.x, this.position.z) : null;
    const feetY = this.position.y - this.centerToFeet;
    const depth = surface === null ? 0 : surface - feetY;
    const wasSwimming = this.swimming;
    this.swimming = surface !== null && depth > (wasSwimming ? cfg.swimExitDepth : cfg.swimDepth);
    this.inWater = surface !== null && depth > 0.25;

    // --- Desired horizontal velocity, relative to the camera ---
    _forward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    _right.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    _wish.set(0, 0, 0).addScaledVector(_forward, move.y).addScaledVector(_right, move.x);
    const wishLen = _wish.length();
    if (wishLen > 1e-4) _wish.divideScalar(wishLen);
    const amount = Math.min(1, move.magnitude ?? wishLen);
    const hasInput = wishLen > 1e-4 && amount > 0.01;
    let targetSpeed = hasInput ? (running ? cfg.runSpeed : cfg.walkSpeed * amount) : 0;
    if (this.swimming) targetSpeed = hasInput ? (running ? cfg.swimSprintSpeed : cfg.swimSpeed * amount) : 0;
    else if (this.inWater) targetSpeed *= cfg.wadeSpeedMul;
    targetSpeed *= speedMul;

    if (forced) {
      this.velocity.x = forced.x;
      this.velocity.z = forced.z;
    } else {
      const accel = this.grounded || this.swimming ? (hasInput ? cfg.groundAccel : cfg.groundDecel) : cfg.airAccel;
      const k = dampFactor(accel, dt);
      this.velocity.x += (_wish.x * targetSpeed - this.velocity.x) * k;
      this.velocity.z += (_wish.z * targetSpeed - this.velocity.z) * k;
    }

    // --- Jump timers (buffer + coyote time) ---
    this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    this.jumpLockTimer = Math.max(0, this.jumpLockTimer - dt);
    this.coyoteTimer = this.grounded ? cfg.coyoteTime : Math.max(0, this.coyoteTimer - dt);

    let jumped = false;
    if (canJump && !this.swimming && this.jumpBufferTimer > 0 && this.coyoteTimer > 0 && this.jumpLockTimer === 0) {
      this.velocity.y = cfg.jumpVelocity * (opts.jumpMul ?? 1);
      this.jumpBufferTimer = 0;
      this.coyoteTimer = 0;
      this.jumpLockTimer = cfg.jumpLockTime;
      this.grounded = false;
      jumped = true;
    }

    // --- Gravity / buoyancy ---
    if (this.swimming) {
      const targetY = surface - cfg.swimFloatDepth; // capsule centre just below the surface
      this.velocity.y = Math.max(-3, Math.min(3, (targetY - this.position.y) * 4));
      this.jumpBufferTimer = 0;
    } else if (this.grounded && !jumped) {
      this.velocity.y = 0; // the settle pass below keeps us on the ground
    } else {
      const g = this.velocity.y < 0 ? cfg.gravity * cfg.fallGravityMultiplier : cfg.gravity;
      this.velocity.y = Math.max(this.velocity.y + g * dt, -cfg.maxFallSpeed);
      if (this.inWater && this.velocity.y < -4) this.velocity.y = -4; // water slows falls
    }

    // Snap-to-ground only runs in the settle pass below: during the main pass it
    // would pull us back down off a step we just auto-stepped onto.
    this._setSnap(false);

    // --- Collide & slide ---
    // Pass 1: the intended motion. While grounded it has no downward component,
    // because a downward push makes Rapier treat ledges as floor and skip auto-step.
    _desired.copy(this.velocity).multiplyScalar(dt);
    this.controller.computeColliderMovement(this.collider, _desired);
    const computed = this.controller.computedMovement();
    _move.set(computed.x, computed.y, computed.z);
    const groundedPass = this.grounded && !jumped && !this.swimming && this.jumpLockTimer === 0;
    // Blocked while walking on the ground? Try stepping up onto the obstacle.
    const blockedH = Math.hypot(_desired.x, _desired.z);
    if (groundedPass && blockedH > 1e-4 && Math.hypot(_move.x, _move.z) < blockedH * 0.5) this._tryStepUp(_desired, _move);
    let nowGrounded;
    if (groundedPass) {
      // Pass 2: settle down onto the ground from the new spot (snap-to-ground
      // extends this down stairs and slopes). This is what reports "grounded".
      _probe.copy(this.position).add(_move);
      this.collider.setTranslation(_probe);
      this._setSnap(true);
      this.controller.computeColliderMovement(this.collider, _settle.set(0, -cfg.groundProbe, 0));
      const settle = this.controller.computedMovement();
      _move.y += settle.y;
      nowGrounded = this.controller.computedGrounded();
    } else {
      nowGrounded = this.jumpLockTimer > 0 || this.swimming ? false : this.controller.computedGrounded();
    }

    // Steep-slope guard: never gain height on ground steeper than the climb limit
    // (auto-step must not let us stair-climb up a cliff).
    if (!jumped && this.jumpLockTimer === 0 && _move.y > 1e-4 && this.grounded) this._limitSlope(_move);

    // Bumped a ceiling while rising.
    if (this.velocity.y > 0 && _desired.y > 1e-5 && _move.y < _desired.y * 0.25) this.velocity.y = 0;

    // Blocked by a wall: don't keep accumulating speed into it.
    const desiredH = Math.hypot(_desired.x, _desired.z);
    const actualH = Math.hypot(_move.x, _move.z);
    if (!forced && desiredH > 1e-5 && actualH < desiredH * 0.7) {
      this.velocity.x = _move.x / dt;
      this.velocity.z = _move.z / dt;
    }

    this.position.add(_move);
    this.body.setNextKinematicTranslation(this.position);

    // --- Ground events ---
    if (!this.grounded && nowGrounded) {
      this.emit('land', { impactSpeed: Math.max(0, -this.velocity.y), airTime: this.airTime });
      this.airTime = 0;
    }
    if (!nowGrounded && !this.swimming) this.airTime += dt;
    else if (this.swimming) this.airTime = 0;
    if (jumped) this.emit('jump');
    this.grounded = nowGrounded;

    // --- Face the direction of travel ---
    if (canTurn && hasInput && this.horizontalSpeed > 0.05) {
      const target = Math.atan2(_wish.x, _wish.z);
      this.facing = wrapAngle(lerpAngle(this.facing, target, dampFactor(cfg.turnSpeed, dt)));
    }

    // --- Locomotion state (drives the animation state machine) ---
    const speed = this.horizontalSpeed;
    if (this.swimming) {
      this.state = PlayerState.SWIM;
    } else if (!this.grounded) {
      this.state = this.velocity.y > 0 ? PlayerState.JUMP : PlayerState.FALL;
    } else if (speed < 0.2) {
      this.state = PlayerState.IDLE;
    } else if (speed > (cfg.walkSpeed + cfg.runSpeed) * 0.5) {
      this.state = PlayerState.RUN;
    } else {
      this.state = PlayerState.WALK;
    }

    if (this.position.y < cfg.killY) this.respawn();
  }

  /**
   * Step-up: lift by stepHeight, move forward onto the obstacle, settle back
   * down. Accepted only if we land on ground and gained a step's worth of
   * height. (Rapier's own auto-step only advances by the current tick's motion,
   * which at walking speed slides back off the edge.)
   */
  _tryStepUp(desired, move) {
    const cfg = this.cfg;
    const c = this.controller;
    const start = _stepStart.copy(this.position);
    this._setSnap(false);
    // 1. Up (respects ceilings).
    this.collider.setTranslation(start);
    c.computeColliderMovement(this.collider, _stepDelta.set(0, cfg.stepHeight, 0));
    const up = c.computedMovement().y;
    if (up < 0.05) return false;
    // 2. Forward, at least far enough to get the capsule over the edge.
    const len = Math.hypot(desired.x, desired.z);
    const dist = Math.max(len, 0.14);
    _stepPos.copy(start).y += up;
    this.collider.setTranslation(_stepPos);
    c.computeColliderMovement(this.collider, _stepDelta.set((desired.x / len) * dist, 0, (desired.z / len) * dist));
    const f = c.computedMovement();
    if (Math.hypot(f.x, f.z) < Math.hypot(move.x, move.z) + 0.02) return false;
    _stepPos.x += f.x;
    _stepPos.z += f.z;
    // 3. Back down onto whatever we're standing on now.
    this.collider.setTranslation(_stepPos);
    c.computeColliderMovement(this.collider, _stepDelta.set(0, -(up + 0.05), 0));
    const d = c.computedMovement();
    if (!c.computedGrounded()) return false;
    _stepPos.y += d.y;
    const gain = _stepPos.y - start.y;
    if (gain < 0.02 || gain > cfg.stepHeight + 0.02) return false;
    move.subVectors(_stepPos, start);
    return true;
  }

  _setSnap(on) {
    if (on === this._snapEnabled) return;
    if (on) this.controller.enableSnapToGround(this.cfg.snapDistance);
    else this.controller.disableSnapToGround();
    this._snapEnabled = on;
  }

  _limitSlope(mv) {
    const R = this.R;
    const origin = { x: this.position.x + mv.x, y: this.position.y + mv.y, z: this.position.z + mv.z };
    const ray = new R.Ray(origin, { x: 0, y: -1, z: 0 });
    let hit = null;
    try {
      hit = this.world.castRayAndGetNormal(ray, this.centerToFeet + 0.6, true, undefined, undefined, this.collider, this.body);
    } catch {
      return;
    }
    if (!hit || hit.normal.y >= this._cosMaxSlope || hit.normal.y < 0.05) return;
    // Remove the uphill part of the motion and any height gain.
    const nx = hit.normal.x;
    const nz = hit.normal.z;
    const len = Math.hypot(nx, nz) || 1;
    const dx = nx / len; // points downhill
    const dz = nz / len;
    const uphill = -(mv.x * dx + mv.z * dz);
    if (uphill > 0) {
      mv.x += dx * uphill;
      mv.z += dz * uphill;
    }
    mv.y = 0;
  }

  /** Smooth render position between the last two physics ticks. */
  getInterpolatedPosition(alpha, out) {
    return out.lerpVectors(this.prevPosition, this.position, alpha);
  }

  dispose() {
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
  }
}
