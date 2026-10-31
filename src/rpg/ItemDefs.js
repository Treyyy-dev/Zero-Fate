/**
 * Item database. Every item in the game is defined here as data.
 *
 * type: 'weapon' | 'armor' | 'consumable' | 'quest' | 'material'
 * Weapons pick a weaponType from src/combat/Weapon.js (WEAPON_TYPES).
 * Armour picks a slot and an outfit patch that changes the character's look.
 * `mods` are stat modifiers applied while equipped (see src/rpg/Stats.js).
 */
export const RARITY = {
  common: { label: 'Common', color: '#c9c3b5' },
  uncommon: { label: 'Uncommon', color: '#7fc46a' },
  rare: { label: 'Rare', color: '#5aa6f0' },
  epic: { label: 'Epic', color: '#b57af0' },
  legendary: { label: 'Legendary', color: '#f0a43c' },
};

export const ITEMS = {
  // ---------------- weapons ----------------
  rusty_sword: {
    name: 'Rusty Sword', type: 'weapon', weaponType: 'sword', rarity: 'common', damage: 11, value: 8,
    visual: { blade: 0x8a7a6a, grip: 0x3a2a1c, trim: 0x6a5a48 }, description: 'Pitted and dull, but it still cuts.',
  },
  iron_sword: {
    name: 'Iron Sword', type: 'weapon', weaponType: 'sword', rarity: 'common', damage: 17, value: 40,
    visual: { blade: 0xb9bec6, grip: 0x3b2414, trim: 0x8a7a5a }, description: 'Reliable village-forged steel.',
  },
  steel_longsword: {
    name: 'Steel Longsword', type: 'weapon', weaponType: 'longsword', rarity: 'uncommon', damage: 25, value: 120,
    mods: { strength: 1 }, visual: { blade: 0xd6dbe2, grip: 0x26180e, trim: 0xc9a54a }, description: 'Longer reach, heavier swings.',
  },
  bandit_axe: {
    name: 'Bandit Axe', type: 'weapon', weaponType: 'axe', rarity: 'common', damage: 20, value: 45,
    visual: { blade: 0x9ea2a8, grip: 0x5a3a20 }, description: 'Crude, brutal, effective.',
  },
  chieftain_cleaver: {
    name: "Chieftain's Cleaver", type: 'weapon', weaponType: 'axe', rarity: 'rare', damage: 34, value: 260,
    mods: { strength: 2, physicalPct: 0.05 }, visual: { blade: 0xc7ccd2, grip: 0x2a1a10, trim: 0x8f1e1a }, description: 'Taken from the bandit chieftain.',
  },
  emberbrand: {
    name: 'Emberbrand', type: 'weapon', weaponType: 'longsword', rarity: 'epic', damage: 33, value: 600,
    mods: { intelligence: 2, spellPct: 0.15 }, visual: { blade: 0xff8a3a, grip: 0x1a0f08, trim: 0xd4a017, emissive: 0x6a1c00 },
    description: 'A blade that remembers the forge. Empowers fire magic.',
  },

  // ---------------- armour ----------------
  leather_cap: { name: 'Leather Cap', type: 'armor', slot: 'head', rarity: 'common', mods: { armor: 4 }, outfit: { helmet: 'leather' }, value: 12 },
  iron_helm: { name: 'Iron Helm', type: 'armor', slot: 'head', rarity: 'uncommon', mods: { armor: 9 }, outfit: { helmet: 'iron' }, value: 55 },
  steel_helm: { name: 'Steel Greathelm', type: 'armor', slot: 'head', rarity: 'rare', mods: { armor: 15, defense: 1 }, outfit: { helmet: 'steel' }, value: 160 },
  padded_tunic: { name: 'Padded Tunic', type: 'armor', slot: 'chest', rarity: 'common', mods: { armor: 6 }, outfit: { chestArmor: null, tunic: 0x6a5a3a }, value: 15 },
  leather_armor: { name: 'Leather Armor', type: 'armor', slot: 'chest', rarity: 'common', mods: { armor: 10, agility: 1 }, outfit: { chestArmor: 'leather' }, value: 45 },
  chainmail: { name: 'Chainmail Hauberk', type: 'armor', slot: 'chest', rarity: 'uncommon', mods: { armor: 18 }, outfit: { chestArmor: 'chain', pauldrons: true }, value: 140 },
  plate_armor: { name: 'Knight Plate', type: 'armor', slot: 'chest', rarity: 'rare', mods: { armor: 30, defense: 2, speedPct: -0.04 }, outfit: { chestArmor: 'plate', pauldrons: true }, value: 380 },
  traveler_boots: { name: "Traveler's Boots", type: 'armor', slot: 'feet', rarity: 'common', mods: { armor: 3, speedPct: 0.03 }, outfit: { boots: 0x4a3322 }, value: 20 },
  iron_greaves: { name: 'Iron Greaves', type: 'armor', slot: 'legs', rarity: 'uncommon', mods: { armor: 8 }, outfit: { pants: 0x5d6168 }, value: 70 },
  wool_trousers: { name: 'Wool Trousers', type: 'armor', slot: 'legs', rarity: 'common', mods: { armor: 2 }, outfit: { pants: 0x3b3530 }, value: 6 },
  ring_of_vigor: { name: 'Ring of Vigor', type: 'armor', slot: 'ring', rarity: 'rare', mods: { maxStamina: 30, staminaRegenPct: 0.15 }, value: 200 },
  ring_of_insight: { name: 'Ring of Insight', type: 'armor', slot: 'ring', rarity: 'rare', mods: { intelligence: 3, manaRegenPct: 0.2 }, value: 220 },

  // ---------------- consumables ----------------
  health_potion: { name: 'Health Potion', type: 'consumable', rarity: 'common', stack: 20, value: 15, effect: { heal: 50 }, color: '#d8463c', description: 'Restores 50 health.' },
  greater_health_potion: { name: 'Greater Health Potion', type: 'consumable', rarity: 'uncommon', stack: 20, value: 45, effect: { heal: 130 }, color: '#ff5a4a', description: 'Restores 130 health.' },
  stamina_potion: { name: 'Stamina Draught', type: 'consumable', rarity: 'common', stack: 20, value: 15, effect: { stamina: 100, buff: { stat: 'staminaRegenPct', value: 0.5, time: 30 } }, color: '#5ec46a', description: 'Restores stamina; faster recovery for 30 s.' },
  mana_potion: { name: 'Mana Potion', type: 'consumable', rarity: 'common', stack: 20, value: 18, effect: { mana: 60 }, color: '#4a7ae0', description: 'Restores 60 mana.' },
  bread: { name: 'Bread Loaf', type: 'consumable', rarity: 'common', stack: 20, value: 3, effect: { buff: { stat: 'healOverTime', value: 3, time: 12 } }, color: '#c8964a', description: 'Restores 36 health over 12 s.' },

  // ---------------- quest & materials ----------------
  bandit_insignia: { name: 'Bandit Insignia', type: 'quest', rarity: 'common', stack: 99, value: 0, description: 'Proof of a bandit defeated.' },
  sunstone_relic: { name: 'Sunstone Relic', type: 'quest', rarity: 'epic', stack: 1, value: 0, description: 'Warm to the touch. Elder Maren wants it back.' },
  iron_ore: { name: 'Iron Ore', type: 'material', rarity: 'common', stack: 50, value: 6, description: 'Hilde the smith needs this.' },
  bone_dust: { name: 'Bone Dust', type: 'material', rarity: 'common', stack: 50, value: 4, description: 'Left behind by the restless dead.' },
};

export const EQUIP_SLOTS = ['weapon', 'head', 'chest', 'legs', 'feet', 'ring'];

export function getItem(id) {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item: ${id}`);
  return { id, ...def };
}

export function slotFor(item) {
  return item.type === 'weapon' ? 'weapon' : item.slot ?? null;
}
