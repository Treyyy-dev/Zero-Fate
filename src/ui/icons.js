/**
 * Inline SVG icons for items and spells (no image files). 24×24 viewBox,
 * drawn with currentColor so rarity colours tint them.
 */
const P = {
  sword: '<path d="M19 3l2 2-9.5 9.5-2-2z" fill="currentColor"/><path d="M8 13l3 3-2 1-3 3-2-2 3-3z" fill="currentColor" opacity=".75"/><path d="M6.5 12.5l5 5" stroke="currentColor" stroke-width="2"/>',
  longsword: '<path d="M20 2l2 2-11 11-2-2z" fill="currentColor"/><path d="M5.5 13.5l5 5M7 16l-4 4" stroke="currentColor" stroke-width="2"/>',
  axe: '<path d="M6 21L17 5" stroke="currentColor" stroke-width="2.2"/><path d="M13 4c3-2 7-1 8 2-2 0-4 2-4 5-3-1-5-4-4-7z" fill="currentColor"/>',
  head: '<path d="M5 14a7 7 0 0114 0v4H5z" fill="currentColor"/><path d="M8 14h8" stroke="#000" stroke-opacity=".5" stroke-width="1.5"/>',
  chest: '<path d="M7 4l5 2 5-2 3 4-2 3v9H6v-9L4 8z" fill="currentColor"/>',
  legs: '<path d="M7 3h10l-1 18h-3l-1-11-1 11H8z" fill="currentColor"/>',
  feet: '<path d="M7 4h5v10l7 3v3H6z" fill="currentColor"/>',
  ring: '<circle cx="12" cy="14" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M10 4h4l1 4h-6z" fill="currentColor"/>',
  potion: '<path d="M10 3h4v4l4 5a6 6 0 11-12 0l4-5z" fill="currentColor"/><path d="M9 3h6" stroke="currentColor" stroke-width="2"/>',
  food: '<ellipse cx="12" cy="14" rx="8" ry="5" fill="currentColor"/><path d="M8 12l1-2M12 11l1-2M16 12l1-2" stroke="#000" stroke-opacity=".4"/>',
  ore: '<path d="M4 16l4-8 6-3 6 6-2 8H7z" fill="currentColor"/><circle cx="10" cy="12" r="1.5" fill="#000" fill-opacity=".35"/><circle cx="15" cy="15" r="1.2" fill="#000" fill-opacity=".35"/>',
  relic: '<circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" stroke="currentColor" stroke-width="1.6"/>',
  token: '<circle cx="12" cy="12" r="8" fill="currentColor"/><path d="M8 12h8M12 8v8" stroke="#000" stroke-opacity=".4" stroke-width="2"/>',
  fire: '<path d="M12 2c1 4 6 6 6 12a6 6 0 01-12 0c0-3 2-5 3-7 0 3 1 4 2 4 0-3-1-6 1-9z" fill="currentColor"/>',
  heal: '<path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z" fill="currentColor"/>',
  bag: '<path d="M8 7V5a4 4 0 018 0v2h3l1 14H4L5 7z" fill="currentColor"/>',
};

export function iconFor(item) {
  if (!item) return '';
  if (item.type === 'weapon') return P[item.weaponType] ?? P.sword;
  if (item.type === 'armor') return P[item.slot] ?? P.chest;
  if (item.type === 'consumable') return item.id === 'bread' ? P.food : P.potion;
  if (item.id === 'sunstone_relic') return P.relic;
  if (item.type === 'material') return P.ore;
  return P.token;
}

export function svg(inner, size = 24) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${inner}</svg>`;
}

export const ICONS = P;
