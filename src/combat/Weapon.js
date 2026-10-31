import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Modular weapons.
 *
 * A WEAPON TYPE defines how a class of weapon behaves (moveset, hitbox,
 * stamina costs, speed) and how its mesh is built. An ITEM (src/rpg/ItemDefs.js)
 * picks a type and sets damage, colours and bonuses. Adding a weapon = adding
 * a data entry; adding a new weapon class = adding one WEAPON_TYPES entry.
 *
 * Mesh convention: grip at the origin of the hand, blade along +Z.
 */
export const WEAPON_TYPES = {
  sword: {
    label: 'Sword',
    moveset: { light: ['attackLight1', 'attackLight2', 'attackLight3'], heavy: 'attackHeavy' },
    lightMultipliers: [1, 1.05, 1.3],
    heavyMultiplier: 2.0,
    speed: 1.0,
    staminaLight: 14,
    staminaHeavy: 30,
    poiseLight: 22,
    poiseHeavy: 60,
    hitbox: { base: 0.14, tip: 0.95, radius: 0.07 },
    build: (o) => buildBlade({ length: 0.95, width: 0.055, ...o }),
  },
  longsword: {
    label: 'Longsword',
    moveset: { light: ['attackLight1', 'attackLight2', 'attackLight3'], heavy: 'attackHeavy' },
    lightMultipliers: [1, 1.05, 1.35],
    heavyMultiplier: 2.1,
    speed: 0.9,
    staminaLight: 17,
    staminaHeavy: 34,
    poiseLight: 28,
    poiseHeavy: 70,
    hitbox: { base: 0.16, tip: 1.18, radius: 0.08 },
    build: (o) => buildBlade({ length: 1.18, width: 0.062, guard: 0.26, ...o }),
  },
  axe: {
    label: 'Axe',
    moveset: { light: ['attackLight1', 'attackLight3'], heavy: 'attackHeavy' },
    lightMultipliers: [1, 1.25],
    heavyMultiplier: 2.2,
    speed: 0.82,
    staminaLight: 19,
    staminaHeavy: 38,
    poiseLight: 35,
    poiseHeavy: 85,
    hitbox: { base: 0.55, tip: 0.92, radius: 0.13 },
    build: (o) => buildAxe(o),
  },
};

function paint(geom, hex) {
  geom.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom.index ? geom.toNonIndexed() : geom;
}

function place(geom, x, y, z, rx = 0, ry = 0, rz = 0) {
  geom.rotateX(rx);
  geom.rotateY(ry);
  geom.rotateZ(rz);
  geom.translate(x, y, z);
  return geom;
}

function finish(metalParts, otherParts, { emissive = null } = {}) {
  const metal = mergeGeometries(metalParts);
  const other = mergeGeometries(otherParts);
  const geom = mergeGeometries([metal, other], true);
  const mats = [
    new THREE.MeshStandardMaterial({
      vertexColors: true, metalness: 0.9, roughness: 0.28,
      emissive: emissive ?? 0x000000, emissiveIntensity: emissive ? 1.4 : 0,
    }),
    new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.7 }),
  ];
  const mesh = new THREE.Mesh(geom, mats);
  mesh.castShadow = true;
  metal.dispose();
  other.dispose();
  return mesh;
}

function buildBlade({ length = 0.95, width = 0.055, guard = 0.22, blade = 0xc9ced6, grip = 0x3b2414, trim = 0xb08d3a, emissive = null }) {
  const metal = [];
  const other = [];
  const bladeLen = length - 0.14;
  metal.push(paint(place(new THREE.BoxGeometry(width, 0.012, bladeLen - 0.1), 0, -0.06, 0.14 + (bladeLen - 0.1) / 2), blade));
  // Tapered tip: a flattened 4-sided cone.
  const tip = new THREE.ConeGeometry(width * 0.72, 0.14, 4);
  tip.scale(1, 1, 0.22);
  metal.push(paint(place(tip, 0, -0.06, 0.14 + bladeLen - 0.03, Math.PI / 2, 0, Math.PI / 4), blade));
  metal.push(paint(place(new THREE.BoxGeometry(width * 0.25, 0.016, bladeLen - 0.15), 0, -0.06, 0.12 + (bladeLen - 0.15) / 2), 0x8f949c)); // fuller
  metal.push(paint(place(new THREE.BoxGeometry(guard, 0.035, 0.035), 0, -0.06, 0.12), trim));
  metal.push(paint(place(new THREE.SphereGeometry(0.03, 8, 6), 0, -0.06, -0.12), trim)); // pommel
  other.push(paint(place(new THREE.CylinderGeometry(0.018, 0.02, 0.22, 8), 0, -0.06, 0.0, Math.PI / 2), grip));
  return finish(metal, other, { emissive });
}

function buildAxe({ blade = 0xb4b8be, grip = 0x5a3a20, trim = 0x7d7d7d, emissive = null }) {
  const metal = [];
  const other = [];
  other.push(paint(place(new THREE.CylinderGeometry(0.022, 0.026, 1.0, 8), 0, -0.06, 0.38, Math.PI / 2), grip));
  const head = new THREE.CylinderGeometry(0.2, 0.2, 0.02, 3, 1, false, 0, Math.PI);
  head.scale(1, 1, 1);
  metal.push(paint(place(head, 0.0, -0.06, 0.78, 0, 0, Math.PI / 2), blade));
  metal.push(paint(place(new THREE.BoxGeometry(0.05, 0.06, 0.12), 0, -0.06, 0.78), trim));
  metal.push(paint(place(new THREE.SphereGeometry(0.03, 8, 6), 0, -0.06, -0.12), trim));
  return finish(metal, other, { emissive });
}

/** An equipped weapon instance: mesh + blade hitbox points. */
export class Weapon {
  constructor(itemDef) {
    this.item = itemDef;
    this.type = WEAPON_TYPES[itemDef.weaponType] ?? WEAPON_TYPES.sword;
    this.mesh = this.type.build({ ...(itemDef.visual ?? {}) });
    this.mesh.name = `Weapon_${itemDef.id}`;
    const hb = this.type.hitbox;
    this.baseLocal = new THREE.Vector3(0, -0.06, hb.base);
    this.tipLocal = new THREE.Vector3(0, -0.06, hb.tip);
    this.radius = hb.radius;
  }

  get damage() {
    return this.item.damage ?? 10;
  }

  getBlade(outBase, outTip) {
    this.mesh.updateWorldMatrix(true, false);
    outBase.copy(this.baseLocal).applyMatrix4(this.mesh.matrixWorld);
    outTip.copy(this.tipLocal).applyMatrix4(this.mesh.matrixWorld);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.forEach((m) => m.dispose());
    this.mesh.removeFromParent();
  }
}

