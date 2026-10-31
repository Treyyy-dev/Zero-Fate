import * as THREE from 'three';
import { Emitter } from '../core/Emitter.js';
import { PlayerController } from './PlayerController.js';
import { PlayerCombat } from '../combat/PlayerCombat.js';
import { Weapon } from '../combat/Weapon.js';
import { OUTFITS } from '../character/HumanoidRig.js';
import { getItem } from '../rpg/ItemDefs.js';
import { dampFactor } from '../utils/math.js';

/** The hero's look with nothing equipped; armour items patch it. */
const BASE_OUTFIT = { ...OUTFITS.hero, chestArmor: null, pauldrons: false, helmet: null, tunic: 0x4a5a6a };

/**
 * The player: movement controller + animated character + weapon + combat +
 * stats. This is what the combat system and enemies see as the 'player' team.
 *
 * Events: 'hurt' {amount, blocked}, 'dodged', 'death'
 */
export class Player extends Emitter {
  constructor({ scene, physics, combat, stats, inventory, skills, spells, effects, cfg, spawn, model }) {
    super();
    this.team = 'player';
    this.cfg = cfg;
    this.stats = stats;
    this.inventory = inventory;
    this.skills = skills;
    this.effects = effects;
    this.controller = new PlayerController(physics, spawn, cfg.player);
    this.model = model;
    scene.add(model.object);
    this.weapon = null;
    this.modelOffsetY = 0;
    this.running = false;

    this.combatState = new PlayerCombat({ player: this, combat, stats, skills, spells, effects, cfg: cfg.player });
    combat.register(this);

    const anim = model.animator;
    this.controller.on('jump', () => {
      if (!this.combatState.busy) anim.play('jump', { fadeIn: 0.06, fadeOut: 0.3 });
    });
    this.controller.on('land', ({ airTime }) => {
      if (this.combatState.busy) return;
      if (airTime > 0.55) anim.play('land', { fadeIn: 0.04, fadeOut: 0.2 });
      else if (anim.isPlaying('jump')) anim.stop(0.15);
    });

    inventory.on('equip', ({ slot, item }) => this._onEquip(slot, item));
  }

  get alive() {
    return this.stats.alive;
  }

  get position() {
    return this.controller.position;
  }

  /* ---------- combatant interface ---------- */

  getHurtbox(outA, outB) {
    const p = this.controller.position;
    const feet = p.y - this.controller.centerToFeet;
    outA.set(p.x, feet + 0.3, p.z);
    outB.set(p.x, feet + 1.55, p.z);
    return 0.38;
  }

  receiveHit(hit) {
    const res = this.combatState.handleIncoming(hit);
    if (res.dodged) this.emit('dodged');
    else if (res.applied) this.emit('hurt', { amount: res.amount, blocked: res.blocked, guardBreak: res.guardBreak, hit });
    return res;
  }

  /* ---------- equipment ---------- */

  _onEquip(slot, item) {
    if (slot === 'weapon') {
      this.weapon?.dispose();
      this.weapon = null;
      if (item) {
        this.weapon = new Weapon(item);
        this.model.attach('rightHand', this.weapon.mesh);
      }
      return;
    }
    // Rebuild the outfit from every equipped armour piece.
    const outfit = { ...BASE_OUTFIT };
    for (const [s, id] of Object.entries(this.inventory.equipped)) {
      if (!id || s === 'weapon') continue;
      Object.assign(outfit, getItem(id).outfit ?? {});
    }
    this.model.setOutfit(outfit);
  }

  /* ---------- per tick / per frame ---------- */

  fixedUpdate(dt, move, run, cameraYaw) {
    const opts = this.combatState.movementOptions();
    const wantsRun = run && this.combatState.canRun();
    this.running = wantsRun && move.magnitude > 0.1;
    this.controller.fixedUpdate(dt, move, wantsRun, cameraYaw, opts);
  }

  update(dt, renderPosition, intent) {
    const c = this.controller;
    this.combatState.update(dt, intent);
    this.stats.update(dt, {
      blocking: this.combatState.blocking,
      sprinting: this.running && c.horizontalSpeed > this.cfg.player.walkSpeed + 0.5 && c.grounded,
      inCombat: this.combatState.inCombat,
    });

    // Animation layer selection.
    const anim = this.model.animator;
    let mode = 'locomotion';
    if (c.swimming) mode = 'swim';
    else if (!c.grounded && c.airTime > 0.12) mode = 'air';
    else if (this.combatState.blocking) mode = 'guard';
    anim.setMode(mode);
    this.model.update(dt, c.horizontalSpeed);

    // Raise the body while swimming so the prone swim pose sits at the surface.
    const targetOffset = c.swimming ? 1.0 : 0;
    this.modelOffsetY += (targetOffset - this.modelOffsetY) * dampFactor(6, dt);
    this.model.object.position.set(renderPosition.x, renderPosition.y - c.centerToFeet + this.modelOffsetY, renderPosition.z);
    this.model.object.rotation.y = c.facing;
  }

  revive(position) {
    this.stats.revive();
    if (position) {
      this.controller.spawnPoint.copy(position);
    }
    this.controller.respawn();
    this.combatState.revive();
  }

  onDeath() {
    this.emit('death');
  }
}
