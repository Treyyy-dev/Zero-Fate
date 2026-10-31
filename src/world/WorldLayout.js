/**
 * Hand-placed layout of the starting region, "the Vale of Brookhollow".
 * Everything procedural (terrain, forests, grass, buildings) is generated
 * around these anchors, so the region stays deterministic and expandable:
 * add a POI here and the terrain flattens for it, roads connect to it, and
 * the streaming systems load it on demand.
 *
 * Units: metres. World spans ±1024 on X and Z. North is −Z.
 */
export const WORLD = {
  size: 2048,
  half: 1024,
  waterLevel: -3.5,
  seed: 1337,
};

/** Points of interest. `flatten` = radius of levelled ground; `height` = target ground height or 'auto'. */
export const POIS = {
  training: { name: 'Training Yard', x: 0, z: 8, flatten: 26, falloff: 34, height: 0, discover: false },
  village: { name: 'Brookhollow', x: 78, z: 46, flatten: 58, falloff: 40, height: 0.4, discover: true },
  castle: { name: 'Highwatch Keep', x: -310, z: -210, flatten: 72, falloff: 50, height: 24, discover: true },
  ruins: { name: 'Sunken Ruins', x: 262, z: -320, flatten: 44, falloff: 40, height: 'auto', discover: true },
  bandit_camp: { name: 'Bandit Camp', x: 318, z: 30, flatten: 34, falloff: 30, height: 'auto', discover: true },
  cave: { name: 'Hollow Deep Cave', x: 58, z: -540, flatten: 46, falloff: 40, height: 'auto', discover: true },
  lake: { name: 'Mirrormere', x: 345, z: 315, flatten: 0, falloff: 0, height: 'auto', discover: true, radius: 125 },
};

/** River centreline from the northern mountains to the lake. */
export const RIVER = {
  width: 8,
  bank: 26,
  bed: -7.0,
  points: [
    [-280, -1000], [-240, -760], [-170, -560], [-60, -360], [110, -190],
    [196, -40], [238, 110], [300, 230], [345, 315],
  ],
};

/** Roads as polylines (width in metres). */
export const ROADS = [
  { id: 'yard', width: 4, points: [[42, 34], [16, 16], [4, 10]] },
  { id: 'north', width: 5, points: [[78, -6], [74, -150], [52, -300], [56, -440], [58, -500]] },
  { id: 'west', width: 5, points: [[24, 44], [-80, 22], [-180, -86], [-250, -170], [-280, -190]] },
  { id: 'east', width: 5, points: [[132, 40], [190, 12], [262, 4], [300, 22]] },
  { id: 'ruins', width: 4, points: [[262, 4], [272, -150], [264, -290]] },
  { id: 'lake', width: 4, points: [[96, 98], [180, 200], [250, 252]] },
];

/** Village building plots relative to the village centre: [dx, dz, rotY(deg), kind]. */
export const VILLAGE_PLOTS = [
  [-24, -20, 15, 'house'], [-30, 6, 90, 'house'], [-22, 28, 160, 'longhouse'],
  [4, -30, 0, 'house'], [24, -22, -20, 'house'], [32, 6, -90, 'forge'],
  [22, 30, 200, 'house'], [-2, 34, 180, 'tavern'], [-40, -34, 30, 'barn'],
  [42, -36, -40, 'house'],
];

/** Enemy spawn groups. */
export const SPAWN_GROUPS = [
  { id: 'camp_bandits', type: 'bandit', x: 312, z: 24, radius: 12, count: 4, respawn: 240 },
  { id: 'road_bandits', type: 'bandit', x: 226, z: 0, radius: 6, count: 2, respawn: 300 },
  { id: 'chief', type: 'bandit_chief', x: 326, z: 36, radius: 0, count: 1 },
  { id: 'ruins_skeletons', type: 'skeleton', x: 262, z: -322, radius: 14, count: 3, respawn: 240 },
  { id: 'cave_skeletons_a', type: 'skeleton', x: 58, z: -552, radius: 4, count: 2, respawn: 300 },
  { id: 'cave_skeletons_b', type: 'skeleton', x: 58, z: -572, radius: 8, count: 4, respawn: 300 },
  { id: 'west_bandits', type: 'bandit', x: -170, z: -60, radius: 8, count: 2, respawn: 300 },
];

/** Interactable resources. */
export const ORE_NODES = [
  [86, -90], [64, -230], [70, -380], [48, -470], [92, -330],
];

/** Where the player starts and respawns. */
export const SPAWN_POINT = { x: 0, z: 8 };
export const REST_POINT = { x: 66, z: 52 }; // village square
