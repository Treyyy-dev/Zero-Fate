/**
 * Loot tables. `roll(tableId, rng)` returns [{ id, count }] plus gold.
 * Entries: [itemId, chance 0..1, minCount, maxCount]
 */
export const LOOT_TABLES = {
  bandit: {
    gold: [4, 14],
    entries: [
      ['bandit_insignia', 1, 1, 1],
      ['health_potion', 0.35, 1, 1],
      ['bread', 0.3, 1, 2],
      ['bandit_axe', 0.08, 1, 1],
      ['leather_cap', 0.08, 1, 1],
      ['leather_armor', 0.05, 1, 1],
      ['stamina_potion', 0.15, 1, 1],
    ],
  },
  bandit_chief: {
    gold: [60, 90],
    entries: [
      ['chieftain_cleaver', 1, 1, 1],
      ['greater_health_potion', 1, 1, 2],
      ['ring_of_vigor', 0.6, 1, 1],
      ['iron_greaves', 0.5, 1, 1],
    ],
  },
  skeleton: {
    gold: [2, 9],
    entries: [
      ['bone_dust', 0.8, 1, 2],
      ['mana_potion', 0.25, 1, 1],
      ['health_potion', 0.2, 1, 1],
      ['iron_helm', 0.05, 1, 1],
      ['rusty_sword', 0.06, 1, 1],
    ],
  },
  cave_chest: {
    gold: [70, 110],
    entries: [
      ['emberbrand', 1, 1, 1],
      ['mana_potion', 1, 2, 3],
      ['greater_health_potion', 1, 1, 2],
    ],
  },
  ruins_chest: {
    gold: [30, 50],
    entries: [
      ['iron_helm', 1, 1, 1],
      ['health_potion', 1, 2, 2],
      ['traveler_boots', 0.7, 1, 1],
    ],
  },
  village_chest: {
    gold: [10, 20],
    entries: [
      ['health_potion', 1, 2, 2],
      ['padded_tunic', 1, 1, 1],
      ['bread', 1, 2, 3],
    ],
  },
  castle_chest: {
    gold: [40, 60],
    entries: [
      ['stamina_potion', 1, 2, 2],
      ['mana_potion', 1, 1, 2],
      ['iron_greaves', 0.6, 1, 1],
    ],
  },
};

export function rollLoot(tableId, rng = Math.random) {
  const t = LOOT_TABLES[tableId];
  if (!t) return { gold: 0, items: [] };
  const items = [];
  for (const [id, chance, min, max] of t.entries) {
    if (rng() <= chance) items.push({ id, count: min + Math.floor(rng() * (max - min + 1)) });
  }
  const gold = t.gold ? t.gold[0] + Math.floor(rng() * (t.gold[1] - t.gold[0] + 1)) : 0;
  return { gold, items };
}
