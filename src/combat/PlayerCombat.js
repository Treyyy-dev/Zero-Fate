import * as THREE from 'three';
import { ATTACK_TIMINGS } from '../character/AnimationLibrary.js';
import { isInFront } from './CombatSystem.js';
import { SPELLS } from '../rpg/SkillTree.js';
import { lerpAngle, wrapAngle } from '../utils/math.js';

/**
 * Player action state machine: light combos, heavy attacks, blocking,
 * dodge rolls with invulnerability, stagger, spells, potions and death.
 *
 * States: free · attack · dodge · hit · cast · drink · use · dead
 *
 * It produces per-tick movement modifiers for the PlayerController
 * (rooting, lunges, dodge velocity, knockback) and runs hit detection while
 * an attack's active window is open.
 */

const _base = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _forced = new THREE.Vector3();

export class PlayerCombat {
  constructor({ player, combat, stats, skills, spells, effects, cfg }) {
    this.player = player;
    this.combat = combat;
    this.stats = stats;
    this.skills = skills;
    this.spells = spells;
    this.effects = effects;
    this.cfg = cfg;

    this.state = 'free';
    this.t = 0;
    this.duration = 0;
    this.blocking = false;
    this.attack = null;
    this.queuedLight = 0; // input buffer timer
    this.queuedHeavy = 0;
    this.queuedDodge = 0;
    this.invulnerable = 0;
    this.dodgeDir = new THREE.Vector3();
    this.knockback = new THREE.Vector3();
    this.riposteTimer = 0;
    this.dodgeAvoided = false;
    this.spellCooldowns = {};
    this.pendingRelease = null;
    this.lastCombatTime = -99;
    this.time = 0;
  }

  get busy() {
    return this.state !== 'free';
  }

  get inCombat() {
    return this.time - this.lastCombatTime < 6;
  }

  /* ------------------------------------------------------------ input */

  /**
   * @param {number} dt
   * @param {object} intent { light, heavy, block, dodge, move:{x,y,magnitude}, cameraYaw }
   */
  update(dt, intent) {
    this.time += dt;
    this.t += dt;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.riposteTimer = Math.max(0, this.riposteTimer - dt);
    for (const k of Object.keys(this.spellCooldowns)) this.spellCooldowns[k] = Math.max(0, this.spellCooldowns[k] - dt);
    this.queuedLight = intent.light ? 0.35 : Math.max(0, this.queuedLight - dt);
    this.queuedHeavy = intent.heavy ? 0.35 : Math.max(0, this.queuedHeavy - dt);
    this.queuedDodge = intent.dodge ? 0.3 : Math.max(0, this.queuedDodge - dt);
    this.intent = intent;

    const p = this.player;
    if (this.state === 'dead') return;
    if (!this.stats.alive) {
      this._die();
      return;
    }

    const canAct = p.controller.grounded && !p.controller.swimming;

    switch (this.state) {
      case 'free': {
        this.blocking = !!intent.block && canAct && this.stats.stamina > 0;
        if (this.queuedDodge && canAct) this._startDodge(intent);
        else if (this.queuedHeavy && canAct) this._startAttack('heavy', 0, intent);
        else if (this.queuedLight && canAct) this._startAttack('light', 0, intent);
        break;
      }
      case 'attack':
        this._updateAttack(dt, intent);
        break;
      case 'dodge':
        if (this.t >= this.duration) this._toFree();
        break;
      case 'hit':
        this.knockback.multiplyScalar(Math.max(0, 1 - dt * 6));
        if (this.t >= this.duration) this._toFree();
        break;
      case 'cast':
      case 'drink':
      case 'use':
        if (this.pendingRelease && this.t >= this.pendingRelease.at) {
          const fn = this.pendingRelease.fn;
          this.pendingRelease = null;
          fn();
        }
        if (this.t >= this.duration) this._toFree();
        break;
      default:
        break;
    }
    if (this.state !== 'free') this.blocking = false;
  }

  /** Movement modifiers for this physics tick. */
  movementOptions() {
    const p = this.player;
    const opts = { speedMul: this.stats.moveSpeedMul, forced: null, canJump: this.state === 'free' && !this.blocking, canTurn: true };
    if (this.blocking) {
      opts.speedMul *= 0.45;
      opts.canTurn = true;
    }
    switch (this.state) {
      case 'attack': {
        const a = this.attack;
        const prog = this.t / this.duration;
        const lunge = a.kind === 'heavy' ? (prog > 0.42 && prog < 0.56 ? 3.2 : 0) : prog > 0.12 && prog < 0.38 ? 2.4 : 0;
        _forced.set(Math.sin(p.controller.facing) * lunge, 0, Math.cos(p.controller.facing) * lunge);
        opts.forced = _forced;
        opts.canTurn = false;
        opts.canJump = false;
        break;
      }
      case 'dodge': {
        const k = this.t / this.duration;
        const speed = this.cfg.dodgeSpeed * (k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35));
        _forced.copy(this.dodgeDir).multiplyScalar(speed);
        opts.forced = _forced;
        opts.canTurn = false;
        opts.canJump = false;
        break;
      }
      case 'hit':
        _forced.copy(this.knockback);
        opts.forced = _forced;
        opts.canTurn = false;
        opts.canJump = false;
        break;
      case 'dead':
        opts.forced = _zero;
        opts.canTurn = false;
        opts.canJump = false;
        break;
      case 'cast':
      case 'use':
        opts.forced = _zero;
        opts.canTurn = false;
        opts.canJump = false;
        break;
      case 'drink':
        opts.speedMul *= 0.4;
        opts.canJump = false;
        break;
      default:
        break;
    }
    return opts;
  }

  /** Whether movement should be treated as running (stamina-limited). */
  canRun() {
    return this.state === 'free' && !this.blocking && this.stats.stamina > 1;
  }

  /* ------------------------------------------------------------ attacks */

  _startAttack(kind, index, intent) {
    const weapon = this.player.weapon;
    if (!weapon) return;
    const type = weapon.type;
    let cost = kind === 'heavy' ? type.staminaHeavy : type.staminaLight;
    if (kind === 'heavy' && this.skills.has('powerStrike')) cost *= 0.8;
    // Need at least part of the cost available; exhausted fighters must back off.
    if (this.stats.stamina < cost * 0.5 || !this.stats.useStamina(cost)) {
      this._exhausted();
      return;
    }

    const clip = kind === 'heavy' ? type.moveset.heavy : type.moveset.light[index];
    const timeScale = type.speed * (1 + Math.min(0.15, this.stats.attr('agility') * 0.004));
    const anim = this.player.model.animator;
    anim.play(clip, { fadeIn: 0.08, fadeOut: 0.2, timeScale });
    const clipDuration = anim.actions[clip]?.getClip().duration ?? 0.8;

    this.state = 'attack';
    this.t = 0;
    this.duration = clipDuration / timeScale;
    this.queuedLight = 0;
    this.queuedHeavy = 0;
    this.attack = {
      kind,
      index,
      clip,
      timing: ATTACK_TIMINGS[clip] ?? { hitStart: 0.3, hitEnd: 0.55, comboOpen: 0.55, cancel: 0.75 },
      hitSet: new Set(),
      hasPrev: false,
      prevBase: new THREE.Vector3(),
      prevTip: new THREE.Vector3(),
      multiplier: kind === 'heavy' ? type.heavyMultiplier * this.stats.heavyMultiplier : type.lightMultipliers[index] ?? 1,
      poise: kind === 'heavy' ? type.poiseHeavy : type.poiseLight,
      riposte: this.riposteTimer > 0 && this.skills.has('riposte'),
    };
    this._aimAttack(intent);
    this.lastCombatTime = this.time;
  }

  _aimAttack(intent) {
    const c = this.player.controller;
    // Aim: input direction if moving, otherwise current facing; then soft-lock onto a target.
    let aim = c.facing;
    if (intent.move && intent.move.magnitude > 0.1) {
      const yaw = intent.cameraYaw;
      const wx = -Math.sin(yaw) * intent.move.y + Math.cos(yaw) * intent.move.x;
      const wz = -Math.cos(yaw) * intent.move.y - Math.sin(yaw) * intent.move.x;
      aim = Math.atan2(wx, wz);
    }
    const target = this.combat.findTarget('player', c.position, aim, 4.5, 75);
    if (target) {
      target.getHurtbox(_base, _tip);
      aim = Math.atan2(_base.x - c.position.x, _base.z - c.position.z);
    }
    this.attack.aim = aim;
  }

  _updateAttack(dt, intent) {
    const a = this.attack;
    const prog = this.t / this.duration;
    const c = this.player.controller;

    // Turn toward the aim during the wind-up only.
    if (prog < a.timing.hitStart) c.facing = wrapAngle(lerpAngle(c.facing, a.aim, Math.min(1, dt * 16)));

    // Active window: sweep the blade.
    const weapon = this.player.weapon;
    if (prog >= a.timing.hitStart && prog <= a.timing.hitEnd + 0.02) {
      weapon.getBlade(_base, _tip);
      if (!a.hasPrev) {
        a.prevBase.copy(_base);
        a.prevTip.copy(_tip);
        a.hasPrev = true;
      }
      const results = this.combat.sweepBlade({
        attacker: this.player,
        prevBase: a.prevBase,
        prevTip: a.prevTip,
        base: _base,
        tip: _tip,
        radius: weapon.radius,
        alreadyHit: a.hitSet,
        makeHit: (target, point) => this._makeHit(target, point),
      });
      if (results.length) {
        this.lastCombatTime = this.time;
        this.player.onHitLanded?.(results);
      }
      a.prevBase.copy(_base);
      a.prevTip.copy(_tip);
    }

    // Combos and cancels.
    const type = weapon.type;
    if (a.kind === 'light' && this.queuedLight && prog >= a.timing.comboOpen && a.index + 1 < type.moveset.light.length) {
      this._startAttack('light', a.index + 1, intent);
      return;
    }
    if (prog >= (a.timing.cancel ?? 0.75)) {
      if (this.queuedDodge) return this._startDodge(intent);
      if (this.queuedHeavy) return this._startAttack('heavy', 0, intent);
      if (this.queuedLight && a.kind === 'light' && a.index + 1 >= type.moveset.light.length) return this._startAttack('light', 0, intent);
    }
    if (prog >= a.timing.hitEnd && this.queuedDodge) return this._startDodge(intent); // recovery cancel
    if (this.t >= this.duration) this._toFree();
  }

  _makeHit(target, point) {
    const a = this.attack;
    const weapon = this.player.weapon;
    let damage = weapon.damage * a.multiplier * this.stats.physicalMultiplier;
    if (a.riposte) damage *= 1.6;
    damage *= 0.9 + Math.random() * 0.2;
    const crit = Math.random() < 0.06 + this.stats.attr('agility') * 0.004;
    if (crit) damage *= 1.5;
    return {
      attacker: this.player,
      damage: Math.round(damage),
      poise: a.poise,
      heavy: a.kind === 'heavy',
      crit,
      point,
      from: this.player.controller.position.clone(),
      knockback: a.kind === 'heavy' ? 4 : 1.8,
    };
  }

  _exhausted() {
    this.queuedLight = 0;
    this.queuedHeavy = 0;
    this.queuedDodge = 0;
    this.player.emit?.('exhausted');
  }

  /* ------------------------------------------------------------ dodge */

  _startDodge(intent) {
    const cost = 20 * this.stats.dodgeCostMul;
    if (this.stats.stamina < cost * 0.5 || !this.stats.useStamina(cost)) {
      this._exhausted();
      return;
    }
    const c = this.player.controller;
    const m = intent.move;
    if (m && m.magnitude > 0.1) {
      const yaw = intent.cameraYaw;
      _dir.set(-Math.sin(yaw) * m.y + Math.cos(yaw) * m.x, 0, -Math.cos(yaw) * m.y - Math.sin(yaw) * m.x).normalize();
    } else {
      _dir.set(Math.sin(c.facing), 0, Math.cos(c.facing));
    }
    this.dodgeDir.copy(_dir);
    c.facing = Math.atan2(_dir.x, _dir.z);
    this.state = 'dodge';
    this.t = 0;
    this.duration = this.cfg.dodgeDuration;
    this.queuedDodge = 0;
    this.dodgeAvoided = false;
    const [i0, i1] = this.cfg.dodgeIFrames;
    this._iframes = [i0, i1 + (this.skills.has('evasion') ? 0.1 : 0)];
    this.player.model.animator.play('dodge', { fadeIn: 0.06, fadeOut: 0.15, timeScale: 0.62 / this.cfg.dodgeDuration });
  }

  isInvulnerable() {
    if (this.invulnerable > 0) return true;
    if (this.state === 'dodge' && this._iframes) return this.t >= this._iframes[0] && this.t <= this._iframes[1];
    return this.state === 'dead';
  }

  /* ------------------------------------------------------------ defence */

  /** Called by Player.receiveHit. Returns { applied, blocked, dodged, amount }. */
  handleIncoming(hit) {
    const c = this.player.controller;
    if (this.isInvulnerable()) {
      if (this.state === 'dodge' && !this.dodgeAvoided) {
        this.dodgeAvoided = true;
        this.riposteTimer = 1.0;
      }
      return { applied: false, dodged: true, amount: 0 };
    }
    this.lastCombatTime = this.time;

    if (this.blocking && isInFront(c.facing, hit.from, c.position, 75)) {
      const staminaCost = hit.damage * 0.9 * this.stats.blockStaminaMul;
      const enough = this.stats.stamina >= staminaCost;
      this.stats.stamina = Math.max(0, this.stats.stamina - staminaCost);
      this.stats.staminaDelay = 0.6;
      if (enough) {
        const amount = this.stats.takeDamage(hit.damage * (1 - this.stats.blockReduction));
        this.effects?.sparks(hit.point ?? c.position, 0xffd27a, 14);
        this._knock(hit, 1.2);
        return { applied: true, blocked: true, amount };
      }
      // Guard broken: stagger and take part of the hit.
      const amount = this.stats.takeDamage(hit.damage * 0.5);
      this._stagger(hit, 0.7);
      return { applied: true, blocked: false, guardBreak: true, amount };
    }

    const amount = this.stats.takeDamage(hit.damage);
    if (this.stats.alive) {
      if (this.state !== 'attack' || hit.heavy || amount > this.stats.maxHealth * 0.15) this._stagger(hit, 0.45);
      this.invulnerable = 0.35;
    }
    return { applied: true, blocked: false, amount };
  }

  _knock(hit, strength) {
    const c = this.player.controller;
    _dir.subVectors(c.position, hit.from).setY(0);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
    _dir.normalize().multiplyScalar(strength);
    c.velocity.x += _dir.x;
    c.velocity.z += _dir.z;
  }

  _stagger(hit, duration) {
    const c = this.player.controller;
    _dir.subVectors(c.position, hit.from).setY(0);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
    this.knockback.copy(_dir.normalize().multiplyScalar(hit.knockback ?? 2.5));
    this.state = 'hit';
    this.t = 0;
    this.duration = duration;
    this.attack = null;
    this.player.model.animator.play('hit', { fadeIn: 0.05, fadeOut: 0.15 });
  }

  /* ------------------------------------------------------------ spells & items */

  castSpell(spellId, aimDir) {
    if (this.state !== 'free' || !this.player.controller.grounded) return 'busy';
    const spell = SPELLS[spellId];
    if (!spell || !this.skills.spellUnlocked(spellId)) return 'locked';
    if ((this.spellCooldowns[spellId] ?? 0) > 0) return 'cooldown';
    if (!this.stats.useMana(spell.mana)) return 'mana';
    this.spellCooldowns[spellId] = spell.cooldown;
    this.state = 'cast';
    this.t = 0;
    this.duration = 0.7;
    this.lastCombatTime = this.time;
    const c = this.player.controller;
    if (aimDir) c.facing = Math.atan2(aimDir.x, aimDir.z);
    this.player.model.animator.play('cast', { fadeIn: 0.08, fadeOut: 0.2 });
    this.pendingRelease = {
      at: 0.7 * ATTACK_TIMINGS.cast.release,
      fn: () => {
        if (spellId === 'firebolt') this.spells.castFirebolt(this.player, aimDir);
        else if (spellId === 'heal') this.spells.castHeal(this.player);
      },
    };
    return 'ok';
  }

  drink(onRelease) {
    if (this.state !== 'free') return false;
    this.state = 'drink';
    this.t = 0;
    this.duration = 0.9;
    this.player.model.animator.play('drink', { fadeIn: 0.1, fadeOut: 0.2 });
    this.pendingRelease = { at: 0.55, fn: onRelease };
    return true;
  }

  use(onRelease) {
    if (this.state !== 'free') return false;
    this.state = 'use';
    this.t = 0;
    this.duration = 0.85;
    this.player.model.animator.play('use', { fadeIn: 0.1, fadeOut: 0.2 });
    this.pendingRelease = { at: 0.4, fn: onRelease };
    return true;
  }

  /* ------------------------------------------------------------ lifecycle */

  _toFree() {
    this.state = 'free';
    this.t = 0;
    this.attack = null;
    this.knockback.set(0, 0, 0);
  }

  _die() {
    this.state = 'dead';
    this.t = 0;
    this.blocking = false;
    this.player.model.animator.play('death', { fadeIn: 0.1, hold: true });
    this.player.onDeath?.();
  }

  revive() {
    this._toFree();
    this.invulnerable = 2;
    this.player.model.animator.stop(0.2);
  }
}
