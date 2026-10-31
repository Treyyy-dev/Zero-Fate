import * as THREE from 'three';
import { Emitter } from '../core/Emitter.js';
import { CharacterModel } from '../character/CharacterModel.js';
import { OUTFITS } from '../character/HumanoidRig.js';
import { ATTACK_TIMINGS } from '../character/AnimationLibrary.js';
import { CharacterMotor } from './CharacterMotor.js';
import { Weapon } from '../combat/Weapon.js';
import { getItem } from '../rpg/ItemDefs.js';
import { isInFront } from '../combat/CombatSystem.js';
import { lerpAngle, wrapAngle } from '../utils/math.js';

/**
 * An enemy combatant with a finite-state AI:
 *   idle/patrol → alert → chase → (circle ↔ attack → recover) → return
 *   any → stagger (hit reaction) · any → dead
 *
 * Attacks use the same swept-blade hit detection as the player, with a
 * readable wind-up (the enemy keeps tracking the player only until its hit
 * window opens, so well-timed dodges work).
 */

const _base = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _to = new THREE.Vector3();

export class Enemy extends Emitter {
  constructor({ def, type, id, position, scene, physics, combat, effects, floatingText, manager, rng = Math.random }) {
    super();
    this.def = def;
    this.type = type;
    this.id = id;
    this.team = 'enemy';
    this.scene = scene;
    this.combat = combat;
    this.effects = effects;
    this.floatingText = floatingText;
    this.manager = manager;
    this.rng = rng;

    this.model = CharacterModel.procedural(OUTFITS[def.outfit]);
    scene.add(this.model.object);
    const weaponId = def.weapons[Math.floor(rng() * def.weapons.length)];
    this.weapon = new Weapon(getItem(weaponId));
    this.model.attach('rightHand', this.weapon.mesh);
    this.scale = OUTFITS[def.outfit].scale ?? 1;

    this.motor = new CharacterMotor(physics, position, { radius: 0.35 * this.scale, halfHeight: 0.55 * this.scale });
    this.home = new THREE.Vector3().copy(position);
    this.motor.facing = rng() * Math.PI * 2;

    this.maxHealth = def.health;
    this.health = def.health;
    this.poise = def.poise;
    this.alive = true;
    this.state = 'idle';
    this.stateTime = 0;
    this.cooldown = 1 + rng();
    this.aggro = false;
    this.desired = new THREE.Vector3();
    this.patrolTarget = null;
    this.strafeDir = rng() < 0.5 ? 1 : -1;
    this.attack = null;
    this.blocking = false;
    this.deadTime = 0;
    this.lastHitTime = -10;
    this.time = 0;
    combat.register(this);
  }

  get position() {
    return this.motor.position;
  }

  get name() {
    return this.def.name;
  }

  getHurtbox(outA, outB) {
    const p = this.motor.position;
    const feet = p.y - this.motor.centerToFeet;
    outA.set(p.x, feet + 0.3 * this.scale, p.z);
    outB.set(p.x, feet + 1.55 * this.scale, p.z);
    return 0.38 * this.scale;
  }

  /* ------------------------------------------------------------ damage */

  receiveHit(hit) {
    if (!this.alive) return { applied: false };
    this.aggro = true;
    this.lastHitTime = this.time;
    if (this.blocking && !hit.magic && isInFront(this.motor.facing, hit.from, this.motor.position, 70)) {
      const amount = Math.max(1, Math.round(hit.damage * 0.15));
      this.health -= amount;
      this.effects.sparks(hit.point ?? this.motor.position, 0xffd27a, 14);
      this.floatingText?.show(this._headPos(), 'Blocked', 'blocked');
      this.poise -= hit.poise * 0.5;
      if (this.poise <= 0) this._stagger(hit);
      return { applied: true, blocked: true, amount };
    }
    const amount = Math.max(1, Math.round(hit.damage * (100 / (100 + this.def.armor))));
    this.health -= amount;
    this.floatingText?.show(this._headPos(), String(amount), hit.crit ? 'crit' : 'damage');
    if (this.def.outfit === 'skeleton') this.effects.burst(hit.point ?? this.motor.position, 10, { color: 0xe8e0cc, speed: 3, size: 0.1, life: 0.5, gravity: -9 });
    else this.effects.blood(hit.point ?? this.motor.position);
    if (this.health <= 0) {
      this._die(hit);
      return { applied: true, killed: true, amount };
    }
    this.poise -= hit.poise;
    if (this.poise <= 0 || hit.heavy) this._stagger(hit);
    return { applied: true, amount };
  }

  _headPos() {
    return new THREE.Vector3(this.motor.position.x, this.motor.position.y + 1.05 * this.scale, this.motor.position.z);
  }

  _stagger(hit) {
    this.poise = this.def.poise;
    this._releaseToken();
    this.attack = null;
    this.blocking = false;
    this._setState('stagger');
    _to.subVectors(this.motor.position, hit.from).setY(0);
    if (_to.lengthSq() < 1e-6) _to.set(0, 0, 1);
    this.knockback = _to.normalize().multiplyScalar(hit.knockback ?? 2);
    this.model.animator.play('hit', { fadeIn: 0.05, fadeOut: 0.15 });
  }

  _die(hit) {
    this.alive = false;
    this.health = 0;
    this._releaseToken();
    this.blocking = false;
    this._setState('dead');
    this.model.animator.play('death', { fadeIn: 0.08, hold: true });
    this.motor.disablePhysics();
    this.combat.unregister(this);
    this.emit('death', { enemy: this, killer: hit.attacker });
  }

  /* ------------------------------------------------------------ AI */

  _setState(s) {
    this.state = s;
    this.stateTime = 0;
  }

  _releaseToken() {
    this.manager?.releaseToken(this);
  }

  /** Per-frame AI. `player` is the Player instance. */
  update(dt, player) {
    this.time += dt;
    this.stateTime += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const d = this.def;
    const m = this.motor;
    this.desired.set(0, 0, 0);

    if (this.state === 'dead') {
      this.deadTime += dt;
      this._animate(dt, 0);
      if (this.deadTime > 8) this.model.object.position.y -= dt * 0.5;
      return;
    }

    const pp = player.position;
    _to.subVectors(pp, m.position).setY(0);
    const dist = _to.length();
    const playerAlive = player.alive;
    const angleToPlayer = Math.atan2(_to.x, _to.z);
    const homeDist = Math.hypot(m.position.x - this.home.x, m.position.z - this.home.z);

    // Perception
    if (!this.aggro && playerAlive) {
      const facingDot = Math.cos(wrapAngle(angleToPlayer - m.facing));
      if (dist < d.detectRange && (facingDot > 0.2 || dist < 6)) this.aggro = true;
    }
    if (this.aggro && (!playerAlive || homeDist > 48 || dist > d.detectRange * 2.6)) {
      this.aggro = false;
      this._releaseToken();
      if (this.state !== 'stagger') this._setState('return');
    }

    switch (this.state) {
      case 'idle':
      case 'patrol': {
        if (this.aggro) {
          this._setState('chase');
          break;
        }
        if (this.state === 'idle' && this.stateTime > 3 + this.rng() * 4) {
          const a = this.rng() * Math.PI * 2;
          const r = 3 + this.rng() * 8;
          this.patrolTarget = new THREE.Vector3(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
          this._setState('patrol');
        }
        if (this.state === 'patrol' && this.patrolTarget) {
          if (this._moveToward(this.patrolTarget, d.walkSpeed, dt) < 0.6 || this.stateTime > 10) this._setState('idle');
        }
        break;
      }
      case 'return': {
        if (this.aggro) {
          this._setState('chase');
          break;
        }
        if (this._moveToward(this.home, d.runSpeed * 0.8, dt) < 1) {
          this.health = this.maxHealth;
          this._setState('idle');
        }
        break;
      }
      case 'chase': {
        if (!this.aggro) {
          this._setState('return');
          break;
        }
        if (dist <= d.attackRange + 1.2) {
          this._setState('circle');
          break;
        }
        this._moveToward(pp, d.runSpeed, dt);
        break;
      }
      case 'circle': {
        if (!this.aggro) {
          this._setState('return');
          break;
        }
        this._turnToward(angleToPlayer, dt, 8);
        if (dist > d.attackRange + 2.5) {
          this._setState('chase');
          break;
        }
        // Block sometimes while waiting (chieftain).
        this.blocking = d.blockChance > 0 && this.stateTime < 1.2 && this.rng() < d.blockChance * dt * 6 ? true : this.blocking && this.stateTime < 1.4;
        const ready = this.cooldown <= 0;
        if (ready && dist <= d.attackRange + 0.3 && this.manager.requestToken(this)) {
          this.blocking = false;
          this._startAttack(angleToPlayer);
          break;
        }
        // Strafe around the player: close in when ready to swing, hang back while recovering.
        const side = new THREE.Vector3(Math.cos(angleToPlayer), 0, -Math.sin(angleToPlayer)).multiplyScalar(this.strafeDir);
        const want = ready ? d.attackRange - 0.2 : d.attackRange + 0.9;
        const keep = dist < want - 0.4 ? -1 : dist > want + 0.3 ? 1 : 0;
        const fwd = new THREE.Vector3(Math.sin(angleToPlayer), 0, Math.cos(angleToPlayer)).multiplyScalar(keep);
        this.desired.copy(side.multiplyScalar(ready ? d.walkSpeed * 0.3 : d.walkSpeed * 0.7)).addScaledVector(fwd, ready ? d.runSpeed * 0.6 : d.walkSpeed);
        if (this.stateTime > 2 + this.rng() * 2) {
          this.strafeDir *= -1;
          this.stateTime = 0;
        }
        break;
      }
      case 'attack': {
        const a = this.attack;
        const prog = this.stateTime / a.duration;
        if (prog < a.timing.hitStart * 0.85) this._turnToward(angleToPlayer, dt, 7); // track during wind-up only
        const lunge = prog > 0.18 && prog < 0.4 ? 1.8 : 0;
        this.desired.set(Math.sin(m.facing) * lunge, 0, Math.cos(m.facing) * lunge);
        if (prog >= a.timing.hitStart && prog <= a.timing.hitEnd + 0.02) this._sweep(a, player);
        if (prog >= 1) {
          this._releaseToken();
          this.cooldown = d.cooldown[0] + this.rng() * (d.cooldown[1] - d.cooldown[0]);
          this.attack = null;
          this._setState('circle');
        }
        break;
      }
      case 'stagger': {
        if (this.knockback) {
          this.desired.copy(this.knockback);
          this.knockback.multiplyScalar(Math.max(0, 1 - dt * 6));
        }
        if (this.stateTime > 0.55) this._setState(this.aggro ? 'circle' : 'idle');
        break;
      }
      default:
        break;
    }

    this._animate(dt, Math.hypot(this.desired.x, this.desired.z));
  }

  _startAttack(angleToPlayer) {
    const heavy = this.rng() < this.def.heavyChance;
    const clip = heavy ? 'attackHeavy' : this.rng() < 0.5 ? 'attackLight1' : 'attackLight2';
    const timeScale = this.def.attackSpeed * this.weapon.type.speed;
    this.model.animator.play(clip, { fadeIn: 0.1, fadeOut: 0.2, timeScale });
    const dur = this.model.animator.actions[clip].getClip().duration / timeScale;
    this.attack = {
      clip, heavy, duration: dur, timing: ATTACK_TIMINGS[clip], hitSet: new Set(),
      hasPrev: false, prevBase: new THREE.Vector3(), prevTip: new THREE.Vector3(),
    };
    this.motor.facing = wrapAngle(lerpAngle(this.motor.facing, angleToPlayer, 0.5));
    this._setState('attack');
  }

  _sweep(a, player) {
    this.weapon.getBlade(_base, _tip);
    if (!a.hasPrev) {
      a.prevBase.copy(_base);
      a.prevTip.copy(_tip);
      a.hasPrev = true;
    }
    const lvlScale = 1;
    this.combat.sweepBlade({
      attacker: this,
      prevBase: a.prevBase,
      prevTip: a.prevTip,
      base: _base,
      tip: _tip,
      radius: this.weapon.radius,
      alreadyHit: a.hitSet,
      makeHit: (target, point) => ({
        attacker: this,
        damage: Math.round(this.def.damage * (a.heavy ? 1.8 : 1) * lvlScale * (0.9 + this.rng() * 0.2)),
        poise: a.heavy ? 60 : 25,
        heavy: a.heavy,
        point,
        from: this.motor.position.clone(),
        knockback: a.heavy ? 4 : 2,
      }),
    });
    a.prevBase.copy(_base);
    a.prevTip.copy(_tip);
    void player;
  }

  _moveToward(target, speed, dt) {
    const m = this.motor;
    const dx = target.x - m.position.x;
    const dz = target.z - m.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.05) {
      const ang = Math.atan2(dx, dz);
      this._turnToward(ang, dt, 9);
      const s = Math.min(speed, dist * 3);
      this.desired.set(Math.sin(m.facing) * s, 0, Math.cos(m.facing) * s);
    }
    return dist;
  }

  _turnToward(angle, dt, rate) {
    this.motor.facing = wrapAngle(lerpAngle(this.motor.facing, angle, Math.min(1, dt * rate)));
  }

  _animate(dt, speed) {
    const anim = this.model.animator;
    anim.setMode(this.blocking ? 'guard' : !this.motor.grounded && this.motor.enabled ? 'air' : 'locomotion');
    this.model.update(dt, speed);
  }

  /** Physics tick. */
  fixedUpdate(dt) {
    if (this.state === 'dead') return;
    this.motor.step(dt, this.desired.x, this.desired.z);
  }

  /** Visual sync after physics (with interpolation). */
  syncVisual(alpha) {
    if (this.state === 'dead' && this.deadTime > 0) {
      // keep the corpse where it fell (sinking handled in update)
      if (this.deadTime < 0.05) this._placeModel(this.motor.position);
      return;
    }
    this._placeModel(this.motor.interpolate(alpha));
  }

  _placeModel(p) {
    this.model.object.position.set(p.x, p.y - this.motor.centerToFeet, p.z);
    this.model.object.rotation.y = this.motor.facing;
  }

  dispose() {
    this.combat.unregister(this);
    this._releaseToken();
    this.motor.dispose();
    this.weapon.dispose();
    this.model.object.removeFromParent();
    this.model.dispose();
  }
}
