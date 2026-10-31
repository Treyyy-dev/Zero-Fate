import * as THREE from 'three';
import { mulberry32 } from '../../utils/noise.js';
import { VILLAGE_PLOTS, RIVER, ORE_NODES } from '../WorldLayout.js';

/**
 * Procedural builders for every site in the region. Each returns a "site
 * spec" the StructureManager turns into meshes, colliders, interactables,
 * torches, NPCs and indoor volumes:
 *
 *   { builder, interactables: [], torches: [], npcs: [], indoor: fn(p) → 0..1 }
 */

const C = {
  stone: 0x9a958a,
  darkStone: 0x77726a,
  plaster: 0xdcd0b4,
  plaster2: 0xd2c19a,
  timber: 0x4a3424,
  wood: 0x8a6440,
  darkWood: 0x3b2a1a,
  thatch: 0x9a7a45,
  tiles: 0x8a4434,
  slate: 0x4e5560,
  window: 0x2c2c30, // dark glass by day; glows at night via the window material
  cloth1: 0x8a2a24,
  cloth2: 0x2a4a7a,
  cloth3: 0xc9b07a,
  metal: 0x6a6c70,
  hay: 0xc8a454,
  rock: 0x7b766d,
};

/* ------------------------------------------------------------------ helpers */

function house(b, { w = 7, d = 5.5, floors = 1, roof = C.thatch, plaster = C.plaster, rng = Math.random, chimney = true, door = true } = {}) {
  const H = 2.9 * floors;
  const top = 0.6 + H;
  b.box('stone', w + 0.35, 0.8, d + 0.35, 0, 0.2, 0, C.darkStone);
  b.box('plaster', w, H, d, 0, 0.6 + H / 2, 0, plaster);
  b.collideBox(w + 0.35, top + 0.3, d + 0.35, 0, top / 2, 0);

  // Timber framing
  const postsX = Math.max(2, Math.round(w / 1.7));
  for (let i = 0; i <= postsX; i++) {
    const x = -w / 2 + (i * w) / postsX;
    b.box('wood', 0.18, H, 0.07, x, 0.6 + H / 2, d / 2 + 0.03, C.timber);
    b.box('wood', 0.18, H, 0.07, x, 0.6 + H / 2, -d / 2 - 0.03, C.timber);
  }
  const postsZ = Math.max(2, Math.round(d / 1.7));
  for (let i = 0; i <= postsZ; i++) {
    const z = -d / 2 + (i * d) / postsZ;
    b.box('wood', 0.07, H, 0.18, w / 2 + 0.03, 0.6 + H / 2, z, C.timber);
    b.box('wood', 0.07, H, 0.18, -w / 2 - 0.03, 0.6 + H / 2, z, C.timber);
  }
  for (let f = 0; f <= floors; f++) {
    const y = Math.min(top - 0.09, 0.6 + f * 2.9);
    b.box('wood', w + 0.14, 0.18, 0.07, 0, y, d / 2 + 0.04, C.timber);
    b.box('wood', w + 0.14, 0.18, 0.07, 0, y, -d / 2 - 0.04, C.timber);
    b.box('wood', 0.07, 0.18, d + 0.14, w / 2 + 0.04, y, 0, C.timber);
    b.box('wood', 0.07, 0.18, d + 0.14, -w / 2 - 0.04, y, 0, C.timber);
  }
  // Diagonal braces on the gable sides
  for (const sx of [-1, 1]) {
    b.box('wood', 0.07, Math.hypot(d * 0.45, 2.6), 0.14, sx * (w / 2 + 0.05), 0.6 + 1.45, -d * 0.22, C.timber, { rx: Math.atan2(d * 0.45, 2.6) });
  }
  // Door & windows
  if (door) {
    b.box('wood', 1.15, 2.05, 0.1, 0, 0.6 + 1.02, d / 2 + 0.06, C.darkWood);
    b.box('wood', 1.4, 0.16, 0.14, 0, 0.6 + 2.12, d / 2 + 0.07, C.timber);
  }
  for (let f = 0; f < floors; f++) {
    const y = 0.6 + f * 2.9 + 1.55;
    for (const x of [-w / 3.2, w / 3.2]) {
      if (f === 0 && Math.abs(x) < 1.0) continue;
      b.box('window', 0.72, 0.82, 0.08, x, y, d / 2 + 0.06, C.window);
      b.box('window', 0.72, 0.82, 0.08, x, y, -d / 2 - 0.06, C.window);
    }
    b.box('window', 0.08, 0.82, 0.72, w / 2 + 0.06, y, 0, C.window);
    b.box('window', 0.08, 0.82, 0.72, -w / 2 - 0.06, y, 0, C.window);
  }
  // Gable roof along X
  const pitch = 0.68;
  const run = d / 2 + 0.55;
  const slab = run / Math.cos(pitch);
  const rise = run * Math.tan(pitch);
  for (const s of [-1, 1]) {
    b.box('plain', w + 0.9, 0.2, slab, 0, top + rise / 2 - 0.08, (s * run) / 2, roof, { rx: s * pitch });
  }
  b.prism('plaster', d, (d / 2) * Math.tan(pitch), 0.2, w / 2 - 0.1, top, 0, plaster, { ry: Math.PI / 2 });
  b.prism('plaster', d, (d / 2) * Math.tan(pitch), 0.2, -w / 2 + 0.1, top, 0, plaster, { ry: Math.PI / 2 });
  b.box('wood', w + 1.0, 0.22, 0.22, 0, top + rise - 0.02, 0, C.timber);
  if (chimney) b.box('stone', 0.7, rise + 1.6, 0.7, w / 2 - 0.9, top + (rise + 1.6) / 2 - 0.3, -d / 4, C.darkStone);
  void rng;
}

function barrel(b, x, z, y = 0) {
  b.cyl('wood', 0.36, 0.32, 0.9, x, y + 0.45, z, C.wood, { seg: 10, collide: true });
  b.cyl('metal', 0.37, 0.37, 0.06, x, y + 0.25, z, C.metal, { seg: 10 });
  b.cyl('metal', 0.37, 0.37, 0.06, x, y + 0.68, z, C.metal, { seg: 10 });
}

function crate(b, x, z, y = 0, s = 0.8, ry = 0) {
  b.box('wood', s, s, s, x, y + s / 2, z, C.wood, { ry, collide: true });
  b.box('wood', s + 0.02, 0.08, s + 0.02, x, y + s * 0.85, z, C.timber, { ry });
}

function torchPost(b, site, x, z, y = 0, h = 2.4) {
  b.cyl('wood', 0.06, 0.08, h, x, y + h / 2, z, C.timber, { seg: 6, collide: true });
  b.box('metal', 0.3, 0.32, 0.3, x, y + h + 0.1, z, C.metal);
  b.box('glow', 0.18, 0.2, 0.18, x, y + h + 0.1, z, 0xffc070);
  site.torches.push(b.toWorld(x, y + h + 0.2, z));
}

function wallTorch(b, site, x, y, z) {
  b.box('glow', 0.14, 0.32, 0.14, x, y, z, 0xffa040);
  site.torches.push(b.toWorld(x, y + 0.2, z));
}

function chestSpec(b, site, id, loot, x, z, y, ry) {
  site.interactables.push({ kind: 'chest', id, loot, position: b.toWorld(x, y, z), rotY: b.rotY + ry });
}

function npcSpec(site, b, id, outfit, x, z, y, ry) {
  site.npcs.push({ id, outfit, position: b.toWorld(x, y, z), rotY: b.rotY + ry });
}

function newSite() {
  return { interactables: [], torches: [], npcs: [], indoor: null };
}

/* ------------------------------------------------------------------ village */

export function buildVillage(b, gen, poi) {
  const site = newSite();
  const rng = mulberry32(42);
  const ground = (dx, dz) => gen.heightAt(poi.x + dx, poi.z + dz);
  const frameAt = (dx, dz, ry = 0) => b.setFrame(new THREE.Vector3(poi.x + dx, ground(dx, dz), poi.z + dz), ry);

  // Plaza: cobbles + well
  frameAt(0, 0);
  b.cyl('stone', 9, 9, 0.12, 0, 0.02, 0, 0x8d877b, { seg: 28 });
  b.cyl('stone', 1.3, 1.4, 0.9, 0, 0.45, 0, C.stone, { seg: 14, collide: true });
  b.cyl('plain', 1.05, 1.05, 0.05, 0, 0.88, 0, 0x1e2a33, { seg: 14 });
  for (const sx of [-1, 1]) b.box('wood', 0.16, 2.2, 0.16, sx * 1.15, 1.1, 0, C.timber, { collide: true });
  b.box('wood', 2.6, 0.16, 0.16, 0, 2.2, 0, C.timber);
  b.prism('plain', 3.0, 0.9, 1.6, 0, 2.25, 0, C.tiles, { ry: Math.PI / 2 });

  // Houses
  for (const [dx, dz, rot, kind] of VILLAGE_PLOTS) {
    const ry = THREE.MathUtils.degToRad(rot);
    frameAt(dx, dz, ry);
    if (kind === 'house') {
      house(b, { w: 6 + rng() * 2.5, d: 5 + rng() * 1.5, floors: rng() < 0.4 ? 2 : 1, roof: rng() < 0.5 ? C.thatch : C.tiles, plaster: rng() < 0.5 ? C.plaster : C.plaster2, rng });
    } else if (kind === 'longhouse') {
      house(b, { w: 12, d: 6, floors: 1, roof: C.thatch, rng });
    } else if (kind === 'tavern') {
      house(b, { w: 10, d: 7, floors: 2, roof: C.tiles, plaster: C.plaster2, rng });
      b.box('wood', 0.1, 1.6, 0.1, 2.2, 3.6, 4.1, C.timber);
      b.box('wood', 1.0, 0.7, 0.06, 2.2, 3.1, 4.1, C.darkWood); // sign
      barrel(b, -4.2, 4.6);
      barrel(b, -3.4, 4.9);
      chestSpec(b, site, 'chest_village', 'village_chest', 3.8, 4.8, 0, Math.PI);
    } else if (kind === 'barn') {
      house(b, { w: 10, d: 8, floors: 1, roof: C.thatch, plaster: 0x8a6440, chimney: false, rng });
      for (let i = 0; i < 3; i++) b.box('plain', 1.2, 0.8, 0.9, -3 + i * 1.3, 0.4, 5.2, C.hay, { collide: true });
    } else if (kind === 'forge') {
      // Open-sided smithy with a glowing hearth
      for (const [px, pz] of [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]]) b.box('wood', 0.25, 3.2, 0.25, px, 1.6, pz, C.timber, { collide: true });
      b.box('plain', 7.4, 0.2, 3.4, 0, 3.6, -1.35, C.slate, { rx: 0.35 });
      b.box('plain', 7.4, 0.2, 3.4, 0, 3.6, 1.35, C.slate, { rx: -0.35 });
      b.box('stone', 2.2, 1.0, 1.6, -1.6, 0.5, -1.4, C.darkStone, { collide: true });
      b.box('glow', 1.4, 0.18, 0.9, -1.6, 1.02, -1.4, 0xff6a20);
      b.box('stone', 0.9, 3.4, 0.9, -1.6, 2.6, -1.9, C.darkStone);
      b.box('metal', 0.9, 0.35, 0.35, 1.2, 0.85, 0.2, 0x4a4c50);
      b.box('stone', 0.5, 0.65, 0.4, 1.2, 0.33, 0.2, C.darkStone, { collide: true });
      barrel(b, 2.6, -1.8);
      site.torches.push(b.toWorld(-1.6, 1.6, -1.4));
      npcSpec(site, b, 'smith_hilde', 'smith', 1.6, 1.6, 0, Math.PI * 0.85);
    }
  }

  // Market stalls
  const stallColors = [C.cloth1, C.cloth2, C.cloth3];
  [[-9, 8, 0.3], [9, 9, -0.4], [11, -6, -1.6]].forEach(([dx, dz, ry], i) => {
    frameAt(dx, dz, ry);
    for (const [px, pz] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) b.box('wood', 0.12, 2.4, 0.12, px, 1.2, pz, C.timber, { collide: true });
    b.box('wood', 3.0, 0.9, 1.6, 0, 0.45, 0.2, C.wood, { collide: true });
    b.box('cloth', 3.3, 0.06, 2.4, 0, 2.45, 0, stallColors[i], { rx: 0.18 });
    crate(b, -1.0, -1.5, 0, 0.6, 0.3);
  });

  // Lamp posts around the plaza and along the roads
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    frameAt(Math.cos(a) * 11, Math.sin(a) * 11);
    torchPost(b, site, 0, 0);
  }
  // Fences around the barn yard
  frameAt(-40, -34, 0.5);
  for (let i = 0; i < 9; i++) {
    b.box('wood', 0.12, 1.1, 0.12, -8 + i * 2, 0.55, 8, C.timber, { collide: true });
    if (i < 8) b.box('wood', 2.0, 0.1, 0.06, -7 + i * 2, 0.8, 8, C.wood, { collide: true });
  }
  // Benches & crates
  frameAt(-5, -9, 0.8);
  b.box('wood', 2.2, 0.1, 0.5, 0, 0.5, 0, C.wood, { collide: true });
  b.box('wood', 0.1, 0.5, 0.4, -0.9, 0.25, 0, C.timber);
  b.box('wood', 0.1, 0.5, 0.4, 0.9, 0.25, 0, C.timber);
  frameAt(6, -12, 0.2);
  crate(b, 0, 0);
  crate(b, 0.9, 0.2, 0, 0.8, 0.4);
  crate(b, 0.4, 0.1, 0.8, 0.7, 0.9);

  // Elder by the well
  frameAt(0, 0);
  npcSpec(site, b, 'elder_maren', 'elder', -3.2, 3.0, 0, Math.PI * 0.75);
  // Ambient villagers
  site.npcs.push({ id: 'villager_1', outfit: 'villager', position: b.toWorld(6, 0, 4), rotY: 2, wander: 12, ambient: true });
  site.npcs.push({ id: 'villager_2', outfit: 'villager', position: b.toWorld(-8, 0, -6), rotY: 0.5, wander: 14, ambient: true });
  return site;
}

/* ------------------------------------------------------------------ castle */

export function buildCastle(b, gen, poi) {
  const site = newSite();
  b.setFrame(new THREE.Vector3(poi.x, poi.height, poi.z), 0);
  const S = 84;
  const h = S / 2;
  const WH = 11;
  const T = 3;

  // Courtyard flagstones
  b.box('stone', S - 2, 0.2, S - 2, 0, 0.0, 0, 0x8a857a);

  // Curtain walls (gate gap on the east wall)
  b.box('stone', S, WH, T, 0, WH / 2, -h, C.stone, { collide: true });
  b.box('stone', S, WH, T, 0, WH / 2, h, C.stone, { collide: true });
  b.box('stone', T, WH, S, -h, WH / 2, 0, C.stone, { collide: true });
  const seg = (S - 8) / 2;
  b.box('stone', T, WH, seg, h, WH / 2, -4 - seg / 2, C.stone, { collide: true });
  b.box('stone', T, WH, seg, h, WH / 2, 4 + seg / 2, C.stone, { collide: true });

  // Crenellations on the outer edges
  const merlon = (x, z, alongX) => b.box('stone', alongX ? 1.3 : 0.9, 1.2, alongX ? 0.9 : 1.3, x, WH + 0.6, z, C.stone, { collide: true });
  for (let x = -h + 3; x <= h - 3; x += 2.6) {
    merlon(x, -h - T / 2 + 0.45, true);
    merlon(x, h + T / 2 - 0.45, true);
  }
  for (let z = -h + 3; z <= h - 3; z += 2.6) {
    merlon(-h - T / 2 + 0.45, z, false);
    if (Math.abs(z) > 5) merlon(h + T / 2 - 0.45, z, false);
  }

  // Corner towers with conical roofs
  for (const [x, z] of [[-h, -h], [h, -h], [-h, h], [h, h]]) {
    b.cyl('stone', 6, 6.3, 17, x, 8.5, z, C.stone, { seg: 18, collide: true });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.box('stone', 1.1, 1.2, 0.8, x + Math.cos(a) * 5.7, 17.6, z + Math.sin(a) * 5.7, C.stone, { ry: -a + Math.PI / 2 });
    }
    b.cone('plain', 7, 8, x, 21, z, C.tiles, { seg: 18 });
    wallTorch(b, site, x + (x > 0 ? -6.4 : 6.4), 4, z);
  }

  // Gatehouse
  for (const z of [-7, 7]) b.cyl('stone', 4, 4.2, 15, h, 7.5, z, C.darkStone, { seg: 14, collide: true });
  b.box('stone', 4, 3.2, 8, h, WH - 1.6, 0, C.darkStone, { collide: true });
  b.box('metal', 0.3, 2.5, 7.6, h + 0.6, 7.2, 0, 0x3a3c40);
  wallTorch(b, site, h + 2.2, 3.4, -4.6);
  wallTorch(b, site, h + 2.2, 3.4, 4.6);

  // Stairs up to the north wall walk
  const steps = 32;
  for (let i = 0; i < steps; i++) {
    const y = (i + 1) * (WH / steps);
    b.box('stone', 0.52, y, 2.4, -30 + i * 0.5, y / 2, -h + T / 2 + 1.25, C.darkStone, { collide: true });
  }

  // Keep
  b.box('stone', 22, 20, 24, -14, 10, 0, C.darkStone, { collide: true });
  b.cone('plain', 18, 10, -14, 25, 0, C.slate, { seg: 4, ry: Math.PI / 4 });
  b.box('wood', 0.2, 4, 3, -2.9, 2, 0, C.darkWood);
  for (const z of [-7, 7]) for (const y of [8, 14]) b.box('window', 0.2, 1.6, 0.9, -2.9, y, z, C.window);
  for (const z of [-5, 5]) {
    b.box('cloth', 0.08, 6, 2, -2.85, 11, z, C.cloth1);
    b.box('cloth', 0.09, 0.3, 2, -2.84, 8.2, z, 0xd4b052);
  }
  wallTorch(b, site, -2.6, 3.2, -2.4);
  wallTorch(b, site, -2.6, 3.2, 2.4);

  // Courtyard props
  b.cyl('stone', 1.3, 1.4, 0.9, 14, 0.45, -14, C.stone, { seg: 14, collide: true });
  for (let i = 0; i < 3; i++) {
    b.cyl('wood', 0.1, 0.1, 1.8, 18 + i * 3, 0.9, 16, C.timber, { collide: true, seg: 6 });
    b.cyl('plain', 0.32, 0.36, 0.9, 18 + i * 3, 1.4, 16, C.hay, { seg: 8 });
  }
  barrel(b, 26, -30);
  barrel(b, 27, -29);
  crate(b, 25, -27);
  chestSpec(b, site, 'chest_castle', 'castle_chest', -2, -9, 0.1, Math.PI / 2);
  npcSpec(site, b, 'captain_roderic', 'captain', 4, 3, 0.1, Math.PI / 2);
  site.npcs.push({ id: 'guard_1', outfit: 'captain', position: b.toWorld(h + 5, 0, -5), rotY: Math.PI / 2, ambient: true });
  site.npcs.push({ id: 'guard_2', outfit: 'captain', position: b.toWorld(h + 5, 0, 5), rotY: Math.PI / 2, ambient: true });
  return site;
}

/* ------------------------------------------------------------------ ruins */

export function buildRuins(b, gen, poi) {
  const site = newSite();
  const rng = mulberry32(777);
  b.setFrame(new THREE.Vector3(poi.x, poi.height, poi.z), 0.25);
  const W = 30;
  const D = 22;
  const wallSeg = (x0, z0, x1, z1, skip) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.round(len / 2);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i < n; i++) {
      if (skip(i, n) || rng() < 0.12) continue;
      const t = (i + 0.5) / n;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const hgt = 0.8 + rng() * 4.2;
      b.box('stone', 1.2, hgt, 2.02, x, hgt / 2, z, rng() < 0.5 ? C.stone : C.darkStone, { ry, collide: true });
      if (rng() < 0.3) b.box('stone', 0.8, 0.6, 0.9, x + (rng() - 0.5) * 3, 0.3, z + (rng() - 0.5) * 3, C.darkStone, { ry: rng() * 3, collide: true });
    }
  };
  wallSeg(-W / 2, -D / 2, W / 2, -D / 2, () => false);
  wallSeg(-W / 2, D / 2, W / 2, D / 2, (i, n) => Math.abs(i - n / 2) < 2); // entrance
  wallSeg(-W / 2, -D / 2, -W / 2, D / 2, () => false);
  wallSeg(W / 2, -D / 2, W / 2, D / 2, () => false);

  // Colonnade
  for (const x of [-6, 6]) {
    for (let i = 0; i < 5; i++) {
      const z = -7 + i * 3.5;
      const broken = rng() < 0.45;
      const hgt = broken ? 1.2 + rng() * 2.2 : 6;
      b.cyl('stone', 0.6, 0.7, hgt, x, hgt / 2, z, C.stone, { seg: 12, collide: true });
      if (!broken) b.box('stone', 1.7, 0.4, 1.7, x, hgt + 0.2, z, C.darkStone);
    }
  }
  b.cyl('stone', 0.6, 0.6, 5, -3, 0.6, 9, C.stone, { seg: 12, rz: Math.PI / 2, ry: 0.6, collide: true });

  // Dais, pedestal and relic
  b.box('stone', 9, 0.6, 7, 0, 0.3, -6, C.darkStone, { collide: true });
  b.box('stone', 4, 0.3, 1, 0, 0.15, -2.1, C.darkStone, { collide: true });
  b.cyl('stone', 0.45, 0.6, 1.1, 0, 1.15, -7, C.stone, { seg: 10, collide: true });
  site.interactables.push({ kind: 'relic', id: 'relic_pedestal', position: b.toWorld(0, 2.0, -7) });

  // Entrance arch
  for (const x of [-2.4, 2.4]) b.box('stone', 1.1, 5, 1.1, x, 2.5, D / 2 + 2, C.stone, { collide: true });
  b.box('stone', 6.2, 1.0, 1.3, 0, 5.4, D / 2 + 2, C.darkStone);

  chestSpec(b, site, 'chest_ruins', 'ruins_chest', 4, -8.5, 0.6, 0);
  // Moss-covered rubble
  for (let i = 0; i < 18; i++) {
    const x = (rng() - 0.5) * 40;
    const z = (rng() - 0.5) * 34;
    const s = 0.4 + rng() * 0.8;
    b.box('stone', s * 1.4, s, s, x, s / 2, z, rng() < 0.5 ? 0x6e7660 : C.darkStone, { ry: rng() * 3, collide: s > 0.7 });
  }
  return site;
}

/* ------------------------------------------------------------------ cave */

export function buildCave(b, gen, poi) {
  const site = newSite();
  const rng = mulberry32(1234);
  const floorY = poi.height;
  b.setFrame(new THREE.Vector3(poi.x, floorY, poi.z), 0);

  // Tube profile: entrance (s=0, south) → corridor → large chamber → end cap.
  const zStart = 26;
  const zEnd = -46;
  const pathX = (s) => 3 * Math.sin(s * Math.PI * 1.3);
  const radius = (s) => {
    if (s < 0.45) return 3.4;
    if (s < 0.7) return 3.4 + (11 - 3.4) * Math.sin(((s - 0.45) / 0.25) * Math.PI * 0.5);
    return 11 * Math.sqrt(Math.max(0, 1 - ((s - 0.7) / 0.3) ** 2));
  };
  const RINGS = 48;
  const ARC = 18;
  const noise = (i, j) => {
    const v = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const tubeVerts = [];
  for (let i = 0; i <= RINGS; i++) {
    const s = i / RINGS;
    const z = zStart + (zEnd - zStart) * s;
    const r = Math.max(0.01, radius(s));
    const cx = pathX(s);
    for (let j = 0; j <= ARC; j++) {
      const th = (j / ARC) * Math.PI;
      const jitter = i === 0 || i === RINGS ? 0 : (noise(i, j) - 0.5) * Math.min(0.9, r * 0.12);
      const rr = r + jitter;
      let y = Math.sin(th) * rr * 0.9;
      if (j === 0 || j === ARC) y = -0.8;
      tubeVerts.push(cx + Math.cos(th) * rr, y, z);
    }
  }
  const tubeIdx = [];
  const row = ARC + 1;
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < ARC; j++) {
      const a = i * row + j;
      const c = a + row;
      tubeIdx.push(a, a + 1, c, a + 1, c + 1, c); // winding faces inward
    }
  }
  const tubeGeom = new THREE.BufferGeometry();
  tubeGeom.setAttribute('position', new THREE.Float32BufferAttribute(tubeVerts, 3));
  tubeGeom.setIndex(tubeIdx);
  tubeGeom.computeVertexNormals();
  const tubeWorld = b.add('rock', tubeGeom, 0x6f6a62);
  b.colliders.push({ type: 'trimesh', ...toWorldTrimesh(tubeVerts, tubeIdx, b) });
  void tubeWorld;

  // Floor strip so the cave floor reads as rock, not grass.
  const floorVerts = [];
  const floorIdx = [];
  for (let i = 0; i <= RINGS; i++) {
    const s = i / RINGS;
    const z = zStart + (zEnd - zStart) * s;
    const r = Math.max(0.3, radius(s));
    const cx = pathX(s);
    for (const side of [-1, 1]) {
      const x = cx + side * r;
      const wp = b.toWorld(x, 0, z);
      floorVerts.push(x, gen.heightAt(wp.x, wp.z) - floorY + 0.06, z);
    }
    if (i < RINGS) {
      const a = i * 2;
      floorIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const floorGeom = new THREE.BufferGeometry();
  floorGeom.setAttribute('position', new THREE.Float32BufferAttribute(floorVerts, 3));
  floorGeom.setIndex(floorIdx);
  floorGeom.computeVertexNormals();
  b.add('rock', floorGeom, 0x4a4640);

  // Outer mound (hill), with a hole where the tube passes through.
  const inTube = (x, y, z) => {
    const s = (z - zStart) / (zEnd - zStart);
    if (s < -0.02 || s > 1.02) return false;
    const r = radius(Math.min(1, Math.max(0, s)));
    return Math.abs(x - pathX(Math.min(1, Math.max(0, s)))) < r + 0.6 && y < r * 0.9 + 0.8;
  };
  const R = 36;
  const H = 22;
  const cz = -10;
  const ringsM = 16;
  const segsM = 40;
  const mv = [];
  for (let i = 0; i <= ringsM; i++) {
    const d = (i / ringsM) * R;
    for (let j = 0; j < segsM; j++) {
      const a = (j / segsM) * Math.PI * 2;
      const x = Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const k = d / R;
      let y = H * Math.pow(Math.max(0, 1 - k * k), 0.55) + (noise(i * 3, j * 7) - 0.5) * 2.6 * (1 - k * 0.6);
      if (i === ringsM) y = -2.5;
      mv.push(x, y, z);
    }
  }
  const midx = [];
  for (let i = 0; i < ringsM; i++) {
    for (let j = 0; j < segsM; j++) {
      const a = i * segsM + j;
      const bb = i * segsM + ((j + 1) % segsM);
      const c = a + segsM;
      const d = bb + segsM;
      for (const tri of [[a, c, bb], [bb, c, d]]) {
        const cxm = (mv[tri[0] * 3] + mv[tri[1] * 3] + mv[tri[2] * 3]) / 3;
        const cym = (mv[tri[0] * 3 + 1] + mv[tri[1] * 3 + 1] + mv[tri[2] * 3 + 1]) / 3;
        const czm = (mv[tri[0] * 3 + 2] + mv[tri[1] * 3 + 2] + mv[tri[2] * 3 + 2]) / 3;
        if (!inTube(cxm, cym, czm)) midx.push(...tri);
      }
    }
  }
  const moundGeom = new THREE.BufferGeometry();
  moundGeom.setAttribute('position', new THREE.Float32BufferAttribute(mv, 3));
  moundGeom.setIndex(midx);
  moundGeom.computeVertexNormals();
  b.add('rock', moundGeom, 0x837d72);
  b.colliders.push({ type: 'trimesh', ...toWorldTrimesh(mv, midx, b) });

  // Entrance boulders, torches, loot
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const s = 1 + rng() * 1.6;
    b.add('rock', new THREE.IcosahedronGeometry(s, 0), 0x77716a, side * (4.5 + rng() * 2), s * 0.4, zStart - 2 + rng() * 4, rng(), rng(), rng());
  }
  for (const s of [0.15, 0.35, 0.55, 0.75, 0.9]) {
    const z = zStart + (zEnd - zStart) * s;
    const r = radius(s);
    const side = s * 10 % 2 < 1 ? 1 : -1;
    wallTorch(b, site, pathX(s) + side * (r - 0.4), Math.min(2.2, r * 0.6), z);
  }
  chestSpec(b, site, 'chest_cave', 'cave_chest', pathX(0.88), zStart + (zEnd - zStart) * 0.88, 0.1, 0);

  // Indoor volume: deeper inside → darker ambient light.
  site.indoor = (p) => {
    const lx = p.x - poi.x;
    const lz = p.z - poi.z;
    const s = (lz - zStart) / (zEnd - zStart);
    if (s < 0 || s > 1) return 0;
    if (Math.abs(lx - pathX(s)) > radius(s) + 0.5) return 0;
    if (p.y - floorY > radius(s) + 1) return 0;
    return Math.min(1, s * 4);
  };
  return site;
}

function toWorldTrimesh(verts, idx, b) {
  const out = new Float32Array(verts.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < verts.length; i += 3) {
    v.set(verts[i], verts[i + 1], verts[i + 2]).applyMatrix4(b.frame);
    out[i] = v.x;
    out[i + 1] = v.y;
    out[i + 2] = v.z;
  }
  return { vertices: out, indices: new Uint32Array(idx) };
}

/* ------------------------------------------------------------------ bridge */

export function buildBridge(b, gen, bridge) {
  const site = newSite();
  const deckY = gen.waterLevel + 2.7;
  const dirX = Math.sin(bridge.angle);
  const dirZ = Math.cos(bridge.angle);
  const reach = (sign) => {
    for (let t = 6; t < 90; t += 1) {
      if (gen.heightAt(bridge.x + dirX * t * sign, bridge.z + dirZ * t * sign) >= deckY - 0.15) return t;
    }
    return 40;
  };
  const tA = reach(1);
  const tB = reach(-1);
  const L = tA + tB + 3;
  const centerOffset = (tA - tB) / 2;
  b.setFrame(new THREE.Vector3(bridge.x + dirX * centerOffset, deckY, bridge.z + dirZ * centerOffset), bridge.angle);
  const W = bridge.width;
  b.box('wood', W, 0.35, L, 0, -0.17, 0, C.wood, { collide: true });
  for (let i = 0; i <= Math.floor(L / 0.9); i++) b.box('wood', W + 0.1, 0.06, 0.12, 0, 0.02, -L / 2 + i * 0.9, C.timber);
  for (const sx of [-1, 1]) {
    for (let z = -L / 2; z <= L / 2; z += 2.5) b.box('wood', 0.14, 1.1, 0.14, (sx * W) / 2, 0.55, z, C.timber);
    b.box('wood', 0.1, 0.12, L, (sx * W) / 2, 1.05, 0, C.wood, { collide: true });
  }
  for (let z = -L / 2 + 6; z < L / 2 - 4; z += 8) {
    for (const sx of [-1, 1]) b.box('stone', 0.8, 9, 0.8, (sx * (W - 0.6)) / 2, -4.7, z, C.darkStone, { collide: true });
  }
  return site;
}

/* ------------------------------------------------------------------ bandit camp */

export function buildCamp(b, gen, poi) {
  const site = newSite();
  const rng = mulberry32(31337);
  b.setFrame(new THREE.Vector3(poi.x, poi.height, poi.z), 0);
  // Campfire
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.box('stone', 0.4, 0.3, 0.35, Math.cos(a) * 0.9, 0.15, Math.sin(a) * 0.9, C.darkStone, { ry: -a });
  }
  b.box('glow', 0.9, 0.25, 0.9, 0, 0.2, 0, 0xff6a1a);
  site.torches.push(b.toWorld(0, 0.8, 0));
  site.fire = b.toWorld(0, 0.5, 0);
  // Tents
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const r = 9 + rng() * 2;
    const big = i === 2;
    const w = big ? 5 : 3.4;
    const hgt = big ? 3.2 : 2.3;
    const dep = big ? 5 : 3.6;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    b.prism('cloth', w, hgt, dep, x, 0, z, big ? C.cloth1 : 0x6a5a40, { ry: -a + Math.PI / 2 });
    b.collideBox(w * 0.8, hgt * 0.8, dep, x, hgt * 0.4, z, -a + Math.PI / 2);
  }
  // Palisade (partial ring of sharpened stakes)
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    if (Math.abs(Math.sin(a - Math.PI)) < 0.25 && Math.cos(a - Math.PI) > 0) continue; // gate toward the road (west)
    if (rng() < 0.15) continue;
    const r = 17;
    const hgt = 2.2 + rng() * 0.8;
    b.cyl('wood', 0.02, 0.18, hgt, Math.cos(a) * r, hgt / 2, Math.sin(a) * r, 0x5a4028, { seg: 6, collide: true });
  }
  for (let i = 0; i < 5; i++) crate(b, -6 + rng() * 12, -14 + rng() * 3, 0, 0.7 + rng() * 0.3, rng() * 3);
  barrel(b, 5, 6);
  barrel(b, 5.8, 6.6);
  b.box('wood', 0.15, 4, 0.15, 7, 2, -3, C.timber);
  b.box('cloth', 0.05, 1.2, 1.6, 7, 3.3, -2.2, C.cloth1);
  return site;
}

/* ------------------------------------------------------------------ ore nodes */

export function oreNodeSpecs() {
  return ORE_NODES.map(([x, z], i) => ({ kind: 'ore', id: `ore_${i}`, x, z }));
}

export function buildOreNode(b, gen, spec) {
  const site = newSite();
  const y = gen.heightAt(spec.x, spec.z);
  b.setFrame(new THREE.Vector3(spec.x, y, spec.z), spec.x);
  b.add('rock', new THREE.IcosahedronGeometry(1.1, 0), 0x6d675e, 0, 0.4, 0, 0.3, 0.2, 0.1);
  for (let i = 0; i < 5; i++) {
    b.add('metal', new THREE.OctahedronGeometry(0.22, 0), 0xb06a3a, Math.cos(i * 1.3) * 0.75, 0.55 + (i % 2) * 0.35, Math.sin(i * 1.3) * 0.75, i, i * 2, 0);
  }
  b.collideBox(1.8, 1.4, 1.8, 0, 0.5, 0);
  site.interactables.push({ kind: 'ore', id: spec.id, position: b.toWorld(0, 0.8, 0), mesh: true });
  return site;
}

export const RIVER_INFO = RIVER;
