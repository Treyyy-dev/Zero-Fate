import { Emitter } from '../core/Emitter.js';
import { getItem, slotFor, EQUIP_SLOTS } from './ItemDefs.js';

/**
 * Inventory (stacks) + equipment slots.
 * Equipping applies the item's stat modifiers to PlayerStats and emits
 * 'equip' so the character's weapon mesh and outfit update.
 *
 * Events: 'change', 'equip' {slot, item|null}, 'added' {item, count}
 */
export class Inventory extends Emitter {
  constructor(stats, { capacity = 40 } = {}) {
    super();
    this.stats = stats;
    this.capacity = capacity;
    this.items = []; // [{ id, count }]
    this.equipped = Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null]));
    this.hotbar = ['health_potion', 'stamina_potion', null, null]; // item ids or spell ids ('spell:firebolt')
  }

  count(id) {
    return this.items.filter((s) => s.id === id).reduce((n, s) => n + s.count, 0);
  }

  has(id, n = 1) {
    return this.count(id) >= n;
  }

  /** Adds items; returns how many were added (0 if full). */
  add(id, count = 1, { silent = false } = {}) {
    const def = getItem(id);
    const stackMax = def.stack ?? 1;
    let left = count;
    if (stackMax > 1) {
      for (const s of this.items) {
        if (s.id !== id || s.count >= stackMax) continue;
        const take = Math.min(left, stackMax - s.count);
        s.count += take;
        left -= take;
        if (!left) break;
      }
    }
    while (left > 0 && this.items.length < this.capacity) {
      const take = Math.min(left, stackMax);
      this.items.push({ id, count: take });
      left -= take;
    }
    const added = count - left;
    if (added > 0) {
      if (!silent) this.emit('added', { item: def, count: added });
      this.emit('change');
    }
    return added;
  }

  remove(id, count = 1) {
    let left = count;
    for (let i = this.items.length - 1; i >= 0 && left > 0; i--) {
      const s = this.items[i];
      if (s.id !== id) continue;
      const take = Math.min(left, s.count);
      s.count -= take;
      left -= take;
      if (s.count <= 0) this.items.splice(i, 1);
    }
    if (left < count) this.emit('change');
    return count - left;
  }

  equip(id) {
    if (!this.has(id)) return false;
    const item = getItem(id);
    const slot = slotFor(item);
    if (!slot) return false;
    this.remove(id, 1);
    if (this.equipped[slot]) this.add(this.equipped[slot], 1, { silent: true });
    this.equipped[slot] = id;
    this.stats.setModifiers(`equip:${slot}`, item.mods ?? {});
    this.emit('equip', { slot, item });
    this.emit('change');
    return true;
  }

  unequip(slot) {
    const id = this.equipped[slot];
    if (!id || slot === 'weapon') return false; // always keep a weapon in hand
    if (this.items.length >= this.capacity) return false;
    this.equipped[slot] = null;
    this.add(id, 1, { silent: true });
    this.stats.setModifiers(`equip:${slot}`, {});
    this.emit('equip', { slot, item: null });
    this.emit('change');
    return true;
  }

  /** Re-applies all equipment modifiers (after loading). */
  refreshEquipment() {
    for (const slot of EQUIP_SLOTS) {
      const id = this.equipped[slot];
      const item = id ? getItem(id) : null;
      this.stats.setModifiers(`equip:${slot}`, item?.mods ?? {});
      this.emit('equip', { slot, item });
    }
    this.emit('change');
  }

  setHotbar(index, value) {
    this.hotbar[index] = value;
    this.emit('change');
  }

  toJSON() {
    return { items: this.items.map((s) => ({ ...s })), equipped: { ...this.equipped }, hotbar: [...this.hotbar] };
  }

  fromJSON(d) {
    if (!d) return;
    this.items = (d.items ?? []).filter((s) => {
      try {
        getItem(s.id);
        return true;
      } catch {
        return false;
      }
    });
    Object.assign(this.equipped, d.equipped ?? {});
    if (Array.isArray(d.hotbar)) this.hotbar = d.hotbar.slice(0, 4);
    this.refreshEquipment();
  }
}
