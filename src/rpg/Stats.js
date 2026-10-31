import { Emitter } from '../core/Emitter.js';

/**
 * Player progression and live resources.
 *
 * Attributes (allocated with points earned on level-up):
 *   strength     → physical damage
 *   defense      → max health and armour
 *   agility      → max stamina, stamina regen, move speed, cheaper dodges
 *   intelligence → max mana, mana regen, spell power
 *
 * Equipment and skills add MODIFIERS (flat or percent) without touching base
 * values, so unequipping or respeccing is exact.
 *
 * Events: 'change', 'levelup' {level}, 'xp' {amount}, 'damaged' {amount}, 'death'
 */

export const XP_CURVE = (level) => Math.round(100 * Math.pow(level, 1.55));
export const POINTS_PER_LEVEL = 3;
export const SKILL_POINTS_PER_LEVEL = 1;
export const MAX_LEVEL = 50;

export class PlayerStats extends Emitter {
  constructor() {
    super();
    this.level = 1;
    this.xp = 0;
    this.attributes = { strength: 5, defense: 5, agility: 5, intelligence: 5 };
    this.unspentPoints = 0;
    this.skillPoints = 1;
    this.gold = 25;
    this._sources = new Map(); // source id → { stat: value }
    this.buffs = []; // { id, stat, value, time }
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.mana = this.maxMana;
    this.staminaDelay = 0;
  }

  /* ---------- modifiers ---------- */

  /** Replaces all modifiers from one source (e.g. 'equip:chest', 'skill:ironSkin'). */
  setModifiers(source, mods) {
    if (!mods || Object.keys(mods).length === 0) this._sources.delete(source);
    else this._sources.set(source, mods);
    this._clampResources();
    this.emit('change');
  }

  mod(stat) {
    let total = 0;
    for (const mods of this._sources.values()) total += mods[stat] ?? 0;
    for (const b of this.buffs) if (b.stat === stat) total += b.value;
    return total;
  }

  attr(name) {
    return this.attributes[name] + this.mod(name);
  }

  /* ---------- derived stats ---------- */

  get maxHealth() {
    return Math.round((100 + 10 * (this.level - 1) + 6 * this.attr('defense') + this.mod('maxHealth')) * (1 + this.mod('maxHealthPct')));
  }

  get maxStamina() {
    return Math.round(100 + 4 * (this.level - 1) + 5 * this.attr('agility') + this.mod('maxStamina'));
  }

  get maxMana() {
    return Math.round(50 + 4 * (this.level - 1) + 8 * this.attr('intelligence') + this.mod('maxMana'));
  }

  get armor() {
    return Math.round(this.mod('armor') + 2 * this.attr('defense'));
  }

  get physicalMultiplier() {
    return (1 + this.attr('strength') * 0.04) * (1 + this.mod('physicalPct'));
  }

  get heavyMultiplier() {
    return 1 + this.mod('heavyPct');
  }

  get spellPower() {
    return (1 + this.attr('intelligence') * 0.06) * (1 + this.mod('spellPct'));
  }

  get moveSpeedMul() {
    return Math.min(1.3, 1 + this.attr('agility') * 0.006 + this.mod('speedPct'));
  }

  get staminaRegen() {
    return (24 + this.attr('agility') * 0.8) * (1 + this.mod('staminaRegenPct'));
  }

  get manaRegen() {
    return (1.2 + this.attr('intelligence') * 0.12) * (1 + this.mod('manaRegenPct'));
  }

  get healthRegen() {
    return 0.6 + this.mod('healthRegen');
  }

  get dodgeCostMul() {
    return Math.max(0.4, (1 - this.attr('agility') * 0.008) * (1 - this.mod('dodgeCostPct')));
  }

  get blockReduction() {
    return Math.min(0.97, 0.8 + this.mod('blockPct'));
  }

  get blockStaminaMul() {
    return Math.max(0.3, 1 - this.mod('blockStaminaPct'));
  }

  get xpToNext() {
    return XP_CURVE(this.level);
  }

  get alive() {
    return this.health > 0;
  }

  /* ---------- resources ---------- */

  /** Applies incoming physical damage after armour. Returns the final amount. */
  takeDamage(raw, { ignoreArmor = false } = {}) {
    if (this.health <= 0) return 0;
    const reduced = ignoreArmor ? raw : raw * (100 / (100 + this.armor));
    const amount = Math.max(1, Math.round(reduced));
    this.health = Math.max(0, this.health - amount);
    this.emit('damaged', { amount });
    this.emit('change');
    if (this.health <= 0) this.emit('death');
    return amount;
  }

  heal(amount) {
    if (this.health <= 0) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    this.emit('change');
    return this.health - before;
  }

  restoreStamina(amount) {
    this.stamina = Math.min(this.maxStamina, this.stamina + amount);
  }

  restoreMana(amount) {
    this.mana = Math.min(this.maxMana, this.mana + amount);
    this.emit('change');
  }

  /** Spends stamina if at least part is available (actions may dip to zero). */
  useStamina(cost) {
    if (this.stamina <= 0) return false;
    this.stamina = Math.max(0, this.stamina - cost);
    this.staminaDelay = 0.8;
    return true;
  }

  useMana(cost) {
    if (this.mana < cost) return false;
    this.mana -= cost;
    this.emit('change');
    return true;
  }

  addBuff(id, stat, value, time) {
    this.buffs = this.buffs.filter((b) => b.id !== id);
    this.buffs.push({ id, stat, value, time });
    this.emit('change');
  }

  update(dt, { blocking = false, sprinting = false, inCombat = false } = {}) {
    if (this.health <= 0) return;
    this.staminaDelay = Math.max(0, this.staminaDelay - dt);
    if (sprinting) {
      this.stamina = Math.max(0, this.stamina - 9 * dt);
      this.staminaDelay = Math.max(this.staminaDelay, 0.3);
    } else if (this.staminaDelay === 0) {
      this.stamina = Math.min(this.maxStamina, this.stamina + this.staminaRegen * (blocking ? 0.35 : 1) * dt);
    }
    this.mana = Math.min(this.maxMana, this.mana + this.manaRegen * dt);
    if (!inCombat) this.health = Math.min(this.maxHealth, this.health + this.healthRegen * dt * 3);
    else this.health = Math.min(this.maxHealth, this.health + this.healthRegen * dt);
    let changed = false;
    for (const b of this.buffs) {
      b.time -= dt;
      if (b.stat === 'healOverTime') this.health = Math.min(this.maxHealth, this.health + b.value * dt);
      if (b.time <= 0) changed = true;
    }
    if (changed) {
      this.buffs = this.buffs.filter((b) => b.time > 0);
      this.emit('change');
    }
  }

  /* ---------- progression ---------- */

  addXP(amount) {
    if (this.level >= MAX_LEVEL) return 0;
    this.xp += amount;
    this.emit('xp', { amount });
    let levels = 0;
    while (this.xp >= this.xpToNext && this.level < MAX_LEVEL) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.unspentPoints += POINTS_PER_LEVEL;
      this.skillPoints += SKILL_POINTS_PER_LEVEL;
      levels += 1;
      this.health = this.maxHealth;
      this.stamina = this.maxStamina;
      this.mana = this.maxMana;
      this.emit('levelup', { level: this.level });
    }
    this.emit('change');
    return levels;
  }

  allocate(attribute) {
    if (this.unspentPoints <= 0 || !(attribute in this.attributes)) return false;
    const hpRatio = this.health / this.maxHealth;
    this.attributes[attribute] += 1;
    this.unspentPoints -= 1;
    if (attribute === 'defense') this.health = Math.round(this.maxHealth * hpRatio);
    this._clampResources();
    this.emit('change');
    return true;
  }

  revive() {
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.mana = this.maxMana;
    this.emit('change');
  }

  _clampResources() {
    this.health = Math.min(this.health, this.maxHealth);
    this.stamina = Math.min(this.stamina, this.maxStamina);
    this.mana = Math.min(this.mana, this.maxMana);
  }

  /* ---------- persistence ---------- */

  toJSON() {
    return {
      level: this.level, xp: this.xp, attributes: { ...this.attributes }, unspentPoints: this.unspentPoints,
      skillPoints: this.skillPoints, gold: this.gold, health: this.health, stamina: this.stamina, mana: this.mana,
    };
  }

  fromJSON(d) {
    if (!d) return;
    this.level = d.level ?? 1;
    this.xp = d.xp ?? 0;
    Object.assign(this.attributes, d.attributes ?? {});
    this.unspentPoints = d.unspentPoints ?? 0;
    this.skillPoints = d.skillPoints ?? 0;
    this.gold = d.gold ?? 0;
    this.health = Math.min(d.health ?? this.maxHealth, this.maxHealth) || this.maxHealth;
    this.stamina = this.maxStamina;
    this.mana = Math.min(d.mana ?? this.maxMana, this.maxMana);
    this.emit('change');
  }
}
