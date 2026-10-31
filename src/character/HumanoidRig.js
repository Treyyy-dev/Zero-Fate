import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural skinned humanoid.
 *
 * Builds a real THREE.Skeleton (17 bones) and ONE SkinnedMesh whose parts are
 * rigidly weighted to their bones. It animates through THREE.AnimationMixer
 * exactly like an imported GLB character, so the same animation state machine
 * drives both. Two material groups (cloth/skin and metal) keep it at two draw
 * calls per character.
 *
 * Coordinate convention: feet at the origin, facing +Z, character's left = +X.
 * Limb bones hang along their local −Y axis.
 */

export const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'forearmL', 'handL',
  'shoulderR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
];

// [parent, x, y, z] rest offsets in metres.
const LAYOUT = {
  hips: [null, 0, 0.98, 0],
  spine: ['hips', 0, 0.1, 0],
  chest: ['spine', 0, 0.2, 0],
  neck: ['chest', 0, 0.25, 0],
  head: ['neck', 0, 0.09, 0],
  shoulderL: ['chest', 0.07, 0.19, 0],
  upperArmL: ['shoulderL', 0.13, 0, 0],
  forearmL: ['upperArmL', 0, -0.28, 0],
  handL: ['forearmL', 0, -0.25, 0],
  shoulderR: ['chest', -0.07, 0.19, 0],
  upperArmR: ['shoulderR', -0.13, 0, 0],
  forearmR: ['upperArmR', 0, -0.28, 0],
  handR: ['forearmR', 0, -0.25, 0],
  thighL: ['hips', 0.1, -0.06, 0],
  shinL: ['thighL', 0, -0.42, 0],
  footL: ['shinL', 0, -0.42, 0],
  thighR: ['hips', -0.1, -0.06, 0],
  shinR: ['thighR', 0, -0.42, 0],
  footR: ['shinR', 0, -0.42, 0],
};

/** Default outfit. Every colour is a hex; flags toggle parts. */
export const OUTFITS = {
  hero: {
    skin: 0xd8a888, hair: 0x4a3222, tunic: 0x2f4f7a, pants: 0x3b3530, boots: 0x3a2a1e,
    leather: 0x5a3d26, metal: 0xa8adb4, accent: 0x2b4e86, trim: 0xc9a54a,
    chestArmor: 'chain', pauldrons: true, helmet: null, beard: false, hood: false, skeleton: false,
  },
  bandit: {
    skin: 0xc79676, hair: 0x2a1d15, tunic: 0x5b4632, pants: 0x3a3226, boots: 0x2b2018,
    leather: 0x4a3322, metal: 0x7d7a74, accent: 0x7a2420, trim: 0x8a7350,
    chestArmor: 'leather', pauldrons: false, helmet: null, beard: true, hood: true, skeleton: false,
  },
  banditChief: {
    skin: 0xb98a6a, hair: 0x1a1410, tunic: 0x3d2b20, pants: 0x2d251d, boots: 0x22190f,
    leather: 0x3b2618, metal: 0x8d8a85, accent: 0x8f1e1a, trim: 0xb08d4a,
    chestArmor: 'plate', pauldrons: true, helmet: 'horned', beard: true, hood: false, skeleton: false, scale: 1.12,
  },
  skeleton: {
    skin: 0xd9d2bf, hair: 0xd9d2bf, tunic: 0x3a3a34, pants: 0x3a3a34, boots: 0x2a2a26,
    leather: 0x3d342a, metal: 0x6f6c66, accent: 0x3a3a34, trim: 0x6f6c66,
    chestArmor: null, pauldrons: false, helmet: 'rusted', beard: false, hood: false, skeleton: true,
  },
  villager: {
    skin: 0xdcae8c, hair: 0x6b4a2e, tunic: 0x7a6a3c, pants: 0x4a4034, boots: 0x3a2a1e,
    leather: 0x5a3d26, metal: 0x8a8a8a, accent: 0x6d5b2f, trim: 0x8f7a4a,
    chestArmor: null, pauldrons: false, helmet: null, beard: false, hood: false, skeleton: false,
  },
  elder: {
    skin: 0xd5a588, hair: 0xd8d6d0, tunic: 0x4d3f6b, pants: 0x3a334a, boots: 0x2e2620,
    leather: 0x4a3828, metal: 0x8a8a8a, accent: 0x6a5a8f, trim: 0xc9b47a,
    chestArmor: null, pauldrons: false, helmet: null, beard: true, hood: false, skeleton: false, robe: true,
  },
  smith: {
    skin: 0xc99a7a, hair: 0xa85a2a, tunic: 0x5d4a3a, pants: 0x3a3028, boots: 0x2a2018,
    leather: 0x6b4426, metal: 0x8a8a8a, accent: 0x6b4426, trim: 0x8a6a40,
    chestArmor: 'apron', pauldrons: false, helmet: null, beard: false, hood: false, skeleton: false,
  },
  captain: {
    skin: 0xd1a080, hair: 0x2d2018, tunic: 0x6e1f1f, pants: 0x2f2a28, boots: 0x261c14,
    leather: 0x4a3020, metal: 0xb7bcc3, accent: 0x8a1f1f, trim: 0xd4b052,
    chestArmor: 'plate', pauldrons: true, helmet: null, beard: true, hood: false, skeleton: false,
  },
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

export class HumanoidRig {
  constructor(outfit = OUTFITS.hero) {
    this.outfit = { ...outfit };
    this.root = new THREE.Group();
    this.root.name = 'Humanoid';
    this.bones = {};
    this.boneList = BONES.map((name) => {
      const b = new THREE.Bone();
      b.name = name;
      this.bones[name] = b;
      return b;
    });
    for (const name of BONES) {
      const [parent, x, y, z] = LAYOUT[name];
      const bone = this.bones[name];
      bone.position.set(x, y, z);
      if (parent) this.bones[parent].add(bone);
    }

    // Rest-pose model-space matrices (used to place parts and to rebuild).
    const temp = new THREE.Group();
    temp.add(this.bones.hips);
    temp.updateMatrixWorld(true);
    this.restWorld = this.boneList.map((b) => b.matrixWorld.clone());

    this.materials = [
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0 }),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.8 }),
    ];

    this.mesh = new THREE.SkinnedMesh(this._buildGeometry(), this.materials);
    this.mesh.name = 'HumanoidMesh';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.add(this.bones.hips);
    this.root.add(this.mesh);
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.boneList);
    this.mesh.bind(this.skeleton);
    // Generous fixed bounds so animated limbs are never culled by mistake.
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
    this.mesh.frustumCulled = true;

    if (outfit.scale) this.root.scale.setScalar(outfit.scale);
    this.height = 1.8 * (outfit.scale || 1);
  }

  /** Changes colours/parts (e.g. when armour is equipped). */
  setOutfit(patch) {
    Object.assign(this.outfit, patch);
    const old = this.mesh.geometry;
    this.mesh.geometry = this._buildGeometry();
    old.dispose();
  }

  /** Parents an object to a bone (weapons, shields, torches). */
  attach(boneName, object) {
    this.bones[boneName].add(object);
    return object;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.materials.forEach((m) => m.dispose());
  }

  /* ------------------------------------------------------------------ */

  _buildGeometry() {
    const o = this.outfit;
    const cloth = [];
    const metal = [];
    const add = (bone, geom, color, { metalPart = false, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) => {
      const boneIndex = BONES.indexOf(bone);
      _e.set(THREE.MathUtils.degToRad(rot[0]), THREE.MathUtils.degToRad(rot[1]), THREE.MathUtils.degToRad(rot[2]));
      _q.setFromEuler(_e);
      _m.compose(_v.set(pos[0], pos[1], pos[2]), _q, _s.set(scale[0], scale[1], scale[2]));
      geom.applyMatrix4(_m);
      geom.applyMatrix4(this.restWorld[boneIndex]);
      if (geom.index === null) throw new Error('rig parts must be indexed');
      geom.deleteAttribute('uv');
      const count = geom.attributes.position.count;
      const colors = new Float32Array(count * 3);
      const c = new THREE.Color(color);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      const skinIndex = new Uint16Array(count * 4);
      const skinWeight = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        skinIndex[i * 4] = boneIndex;
        skinWeight[i * 4] = 1;
      }
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      (metalPart ? metal : cloth).push(geom);
    };

    const cap = (r, len, rs = 8) => new THREE.CapsuleGeometry(r, len, 3, rs);
    const cyl = (rt, rb, h, rs = 10) => new THREE.CylinderGeometry(rt, rb, h, rs);
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const sph = (r, ws = 12, hs = 9) => new THREE.SphereGeometry(r, ws, hs);
    const halfSph = (r) => new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);

    if (o.skeleton) {
      this._skeletonParts(add, cap, cyl, box, sph, o);
    } else {
      // --- Torso ---
      add('hips', box(0.3, 0.18, 0.2), o.pants, { pos: [0, -0.02, 0] });
      add('hips', cyl(0.165, 0.165, 0.06, 14), o.leather, { pos: [0, 0.07, 0], scale: [1, 1, 0.72] });
      add('hips', box(0.06, 0.06, 0.03), o.trim, { metalPart: true, pos: [0, 0.07, 0.125] }); // buckle
      add('spine', cyl(0.15, 0.145, 0.22, 14), o.tunic, { pos: [0, 0.1, 0], scale: [1, 1, 0.72] });
      add('chest', cyl(0.19, 0.155, 0.3, 14), o.tunic, { pos: [0, 0.1, 0], scale: [1, 1, 0.68] });
      if (o.robe) {
        add('hips', cyl(0.2, 0.3, 0.75, 16), o.tunic, { pos: [0, -0.4, 0], scale: [1, 1, 0.8] });
      }
      if (o.chestArmor === 'chain') {
        add('chest', cyl(0.2, 0.165, 0.31, 14), 0x8d9298, { metalPart: true, pos: [0, 0.1, 0], scale: [1.02, 1, 0.71] });
        add('chest', box(0.22, 0.4, 0.03), o.accent, { pos: [0, 0.0, 0.125] }); // tabard
        add('chest', box(0.03, 0.4, 0.031), o.trim, { pos: [0, 0.0, 0.127] });
        add('hips', box(0.24, 0.28, 0.03), o.accent, { pos: [0, -0.16, 0.115] });
      } else if (o.chestArmor === 'plate') {
        add('chest', cyl(0.205, 0.17, 0.32, 14), o.metal, { metalPart: true, pos: [0, 0.1, 0], scale: [1.03, 1, 0.74] });
        add('spine', cyl(0.16, 0.155, 0.2, 14), o.metal, { metalPart: true, pos: [0, 0.1, 0], scale: [1.02, 1, 0.75] });
        add('hips', cyl(0.2, 0.24, 0.24, 14), o.accent, { pos: [0, -0.1, 0], scale: [1, 1, 0.8] }); // tassets cloth
      } else if (o.chestArmor === 'leather') {
        add('chest', cyl(0.198, 0.16, 0.28, 14), o.leather, { pos: [0, 0.09, 0], scale: [1.02, 1, 0.7] });
        add('chest', box(0.05, 0.36, 0.2), o.leather, { pos: [0.08, 0.05, 0], rot: [0, 0, 28] }); // strap
      } else if (o.chestArmor === 'apron') {
        add('chest', box(0.26, 0.42, 0.03), o.leather, { pos: [0, -0.02, 0.12] });
        add('hips', box(0.28, 0.32, 0.03), o.leather, { pos: [0, -0.16, 0.12] });
      }

      // --- Head ---
      add('neck', cyl(0.05, 0.055, 0.11), o.skin, { pos: [0, 0.04, 0] });
      add('head', sph(0.105, 14, 10), o.skin, { pos: [0, 0.11, 0.005], scale: [0.92, 1.08, 1] });
      add('head', box(0.025, 0.04, 0.03), o.skin, { pos: [0, 0.09, 0.105] }); // nose
      add('head', sph(0.013, 6, 4), 0x1d1d1d, { pos: [0.036, 0.125, 0.093] });
      add('head', sph(0.013, 6, 4), 0x1d1d1d, { pos: [-0.036, 0.125, 0.093] });
      add('head', box(0.06, 0.012, 0.012), 0x8a4a3a, { pos: [0, 0.06, 0.1] }); // mouth
      if (o.hood) {
        add('head', halfSph(0.13), o.accent, { pos: [0, 0.11, -0.01], scale: [1, 1.2, 1.05] });
        add('neck', cyl(0.12, 0.16, 0.12, 12), o.accent, { pos: [0, 0.0, -0.01] });
        add('head', box(0.17, 0.06, 0.02), o.accent, { pos: [0, 0.06, 0.1] }); // bandana mask
      } else if (!o.helmet) {
        add('head', halfSph(0.112), o.hair, { pos: [0, 0.125, -0.008], scale: [0.98, 1.0, 1.04] });
        add('head', box(0.2, 0.09, 0.06), o.hair, { pos: [0, 0.08, -0.075] });
      }
      if (o.beard) add('head', box(0.15, 0.08, 0.05), o.hair, { pos: [0, 0.045, 0.075] });
      this._helmet(add, cyl, halfSph, box, o);

      // --- Arms ---
      for (const side of ['L', 'R']) {
        const sx = side === 'L' ? 1 : -1;
        add(`shoulder${side}`, sph(0.07), o.tunic, { pos: [0.1 * sx, -0.01, 0] });
        if (o.pauldrons) {
          add(`shoulder${side}`, halfSph(0.095), o.metal, { metalPart: true, pos: [0.12 * sx, 0.0, 0], rot: [0, 0, -20 * sx], scale: [1.1, 0.8, 1.1] });
        }
        add(`upperArm${side}`, cap(0.052, 0.18), o.tunic, { pos: [0, -0.14, 0] });
        add(`forearm${side}`, cap(0.045, 0.17), o.skin, { pos: [0, -0.12, 0] });
        add(`forearm${side}`, cyl(0.053, 0.048, 0.13), o.leather, { pos: [0, -0.15, 0] }); // bracer
        add(`hand${side}`, box(0.07, 0.085, 0.05), o.chestArmor === 'plate' || o.pauldrons ? o.leather : o.skin, { pos: [0, -0.045, 0.005] });
      }

      // --- Legs ---
      for (const side of ['L', 'R']) {
        add(`thigh${side}`, cap(0.072, 0.28), o.pants, { pos: [0, -0.2, 0] });
        add(`shin${side}`, cap(0.058, 0.3), o.pants, { pos: [0, -0.18, 0] });
        add(`shin${side}`, cyl(0.07, 0.064, 0.22), o.boots, { pos: [0, -0.3, 0] });
        add(`foot${side}`, box(0.1, 0.07, 0.24), o.boots, { pos: [0, -0.035, 0.045] });
        if (o.chestArmor === 'plate') {
          add(`shin${side}`, cyl(0.072, 0.066, 0.2), o.metal, { metalPart: true, pos: [0, -0.14, 0.006] });
          add(`thigh${side}`, cyl(0.082, 0.075, 0.22), o.metal, { metalPart: true, pos: [0, -0.2, 0] });
        }
      }
    }

    const groups = [cloth, metal].map((list) => (list.length ? mergeGeometries(list, false) : null));
    const parts = groups.filter(Boolean);
    const merged = mergeGeometries(parts, true);
    // Material index per group: cloth = 0, metal = 1.
    if (!groups[1]) merged.groups.forEach((g) => (g.materialIndex = 0));
    else merged.groups[1].materialIndex = 1;
    cloth.forEach((g) => g.dispose());
    metal.forEach((g) => g.dispose());
    merged.computeBoundingBox();
    return merged;
  }

  _helmet(add, cyl, halfSph, box, o) {
    if (!o.helmet) return;
    const metalPart = true;
    if (o.helmet === 'leather') {
      add('head', halfSph(0.122), o.leather, { pos: [0, 0.12, 0] });
    } else if (o.helmet === 'iron' || o.helmet === 'rusted') {
      const col = o.helmet === 'rusted' ? 0x6e5a48 : o.metal;
      add('head', halfSph(0.125), col, { metalPart, pos: [0, 0.12, 0] });
      add('head', cyl(0.127, 0.127, 0.06, 14), col, { metalPart, pos: [0, 0.1, 0] });
      add('head', box(0.025, 0.11, 0.03), col, { metalPart, pos: [0, 0.08, 0.12] }); // nasal
    } else if (o.helmet === 'steel' || o.helmet === 'horned') {
      add('head', halfSph(0.128), o.metal, { metalPart, pos: [0, 0.12, 0] });
      add('head', cyl(0.13, 0.12, 0.16, 14), o.metal, { metalPart, pos: [0, 0.07, 0] });
      add('head', box(0.18, 0.018, 0.02), 0x111111, { pos: [0, 0.115, 0.125] }); // visor slit
      if (o.helmet === 'horned') {
        add('head', cyl(0.004, 0.03, 0.16, 6), 0xe6dcc0, { pos: [0.13, 0.2, 0], rot: [0, 0, -40] });
        add('head', cyl(0.004, 0.03, 0.16, 6), 0xe6dcc0, { pos: [-0.13, 0.2, 0], rot: [0, 0, 40] });
      } else {
        add('head', box(0.02, 0.09, 0.2), o.trim, { metalPart, pos: [0, 0.22, 0] }); // crest
      }
    }
  }

  _skeletonParts(add, cap, cyl, box, sph, o) {
    const bone = o.skin;
    add('hips', box(0.26, 0.1, 0.12), bone, { pos: [0, 0, 0] });
    add('spine', cyl(0.025, 0.025, 0.22, 6), bone, { pos: [0, 0.1, -0.03] });
    for (let i = 0; i < 4; i++) {
      add('chest', new THREE.TorusGeometry(0.13 - i * 0.012, 0.012, 4, 12), bone, {
        pos: [0, 0.2 - i * 0.055, 0], rot: [90, 0, 0], scale: [1, 0.75, 1],
      });
    }
    add('chest', cyl(0.025, 0.025, 0.3, 6), bone, { pos: [0, 0.1, -0.08] });
    add('chest', box(0.32, 0.03, 0.05), bone, { pos: [0, 0.2, -0.02] }); // collarbones
    add('neck', cyl(0.02, 0.02, 0.11, 6), bone, { pos: [0, 0.04, 0] });
    add('head', sph(0.1, 12, 9), bone, { pos: [0, 0.12, 0], scale: [0.9, 1.05, 1] });
    add('head', box(0.1, 0.05, 0.08), bone, { pos: [0, 0.035, 0.04] }); // jaw
    add('head', sph(0.024, 6, 4), 0x120c08, { pos: [0.035, 0.125, 0.085] });
    add('head', sph(0.024, 6, 4), 0x120c08, { pos: [-0.035, 0.125, 0.085] });
    add('head', sph(0.01, 6, 4), 0xff6a2a, { pos: [0.035, 0.125, 0.095] }); // ember eyes
    add('head', sph(0.01, 6, 4), 0xff6a2a, { pos: [-0.035, 0.125, 0.095] });
    this._helmet(add, cyl, (r) => new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), box, o);
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      add(`shoulder${side}`, sph(0.035), bone, { pos: [0.1 * sx, 0, 0] });
      add(`upperArm${side}`, cyl(0.02, 0.018, 0.26, 6), bone, { pos: [0, -0.14, 0] });
      add(`forearm${side}`, cyl(0.017, 0.015, 0.24, 6), bone, { pos: [0, -0.12, 0] });
      add(`hand${side}`, box(0.06, 0.08, 0.025), bone, { pos: [0, -0.045, 0] });
      add(`thigh${side}`, cyl(0.025, 0.022, 0.42, 6), bone, { pos: [0, -0.21, 0] });
      add(`shin${side}`, cyl(0.02, 0.018, 0.42, 6), bone, { pos: [0, -0.21, 0] });
      add(`foot${side}`, box(0.07, 0.04, 0.18), bone, { pos: [0, -0.02, 0.04] });
    }
    // Tattered loincloth so it reads as an undead warrior.
    add('hips', box(0.24, 0.26, 0.02), o.tunic, { pos: [0, -0.15, 0.07] });
  }
}
