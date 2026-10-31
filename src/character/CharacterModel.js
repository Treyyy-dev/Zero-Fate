import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { HumanoidRig, OUTFITS } from './HumanoidRig.js';
import { getHumanoidClips, CLIP_NAMES } from './AnimationLibrary.js';
import { AnimationStateMachine } from './AnimationStateMachine.js';

/**
 * A renderable, animated character: either an imported rigged GLB or the
 * procedural humanoid. Both expose the same interface:
 *
 *   object        THREE.Object3D (feet at origin, facing +Z)
 *   animator      AnimationStateMachine
 *   attach(slot, object3D)   slot: 'rightHand' | 'leftHand' | 'head' | 'back'
 *   setOutfit(patch)          procedural only (armour colours/parts)
 *   source        'glb' | 'procedural'
 *
 * GLB requirements (see README): skinned humanoid ~1.8 m tall, facing +Z,
 * feet at origin. Clips are matched by name keywords (idle, walk, run, jump,
 * fall, land, roll/dodge, attack, heavy, block, hit, death, swim, cast).
 * Missing clips fall back to the closest available one.
 */

const loader = new GLTFLoader();
const glbCache = new Map(); // url → Promise<gltf | null>

/** Keyword patterns used to map a GLB's clip names to our canonical names. */
const CLIP_KEYWORDS = {
  idle: [/idle/i],
  walk: [/walk/i],
  run: [/run|sprint|jog/i],
  blockIdle: [/block.*idle|guard|block/i],
  blockWalk: [/block.*walk|guard.*walk/i],
  fall: [/fall|air/i],
  swim: [/swim/i],
  jump: [/jump.*start|jump/i],
  land: [/land/i],
  dodge: [/roll|dodge|evade/i],
  attackLight1: [/attack.?1|slash.?1|light.?1|attack|slash/i],
  attackLight2: [/attack.?2|slash.?2|light.?2/i],
  attackLight3: [/attack.?3|slash.?3|light.?3/i],
  attackHeavy: [/heavy|power|smash/i],
  hit: [/hit|react|damage/i],
  death: [/death|die|dying/i],
  cast: [/cast|spell/i],
  use: [/use|interact|pick/i],
  drink: [/drink|potion/i],
};
const CLIP_FALLBACKS = {
  blockIdle: 'idle', blockWalk: 'walk', fall: 'idle', swim: 'walk', jump: 'fall', land: 'idle',
  dodge: 'run', attackLight1: 'idle', attackLight2: 'attackLight1', attackLight3: 'attackLight1',
  attackHeavy: 'attackLight1', hit: 'idle', death: 'idle', cast: 'attackLight1', use: 'idle', drink: 'idle',
};
const BONE_PATTERNS = {
  rightHand: [/righthand$/i, /hand[_.]?r$/i, /r[_.]?hand$/i, /hand_right/i],
  leftHand: [/lefthand$/i, /hand[_.]?l$/i, /l[_.]?hand$/i, /hand_left/i],
  head: [/head$/i],
  back: [/spine2$/i, /chest$/i, /spine1$/i],
};

function loadGLB(url) {
  if (!glbCache.has(url)) {
    glbCache.set(
      url,
      loader.loadAsync(url).catch((err) => {
        console.warn(`[assets] MISSING ASSET: ${url} — falling back to the procedural humanoid.`, err?.message ?? err);
        return null;
      }),
    );
  }
  return glbCache.get(url);
}

export class CharacterModel {
  /**
   * @param {object} opts
   * @param {object} [opts.outfit] procedural outfit
   * @param {string} [opts.glbUrl] optional GLB to try first
   */
  static async create({ outfit = OUTFITS.hero, glbUrl = null } = {}) {
    if (glbUrl) {
      const gltf = await loadGLB(glbUrl);
      if (gltf) {
        try {
          return CharacterModel._fromGLTF(gltf, glbUrl);
        } catch (err) {
          console.warn(`[assets] ${glbUrl} loaded but is not a usable humanoid:`, err.message);
        }
      }
    }
    return new CharacterModel({ rig: new HumanoidRig(outfit) });
  }

  /** Synchronous procedural creation (enemies, NPCs). */
  static procedural(outfit) {
    return new CharacterModel({ rig: new HumanoidRig(outfit) });
  }

  static _fromGLTF(gltf, url) {
    const scene = SkeletonUtils.clone(gltf.scene);
    let skinned = null;
    scene.traverse((o) => {
      if (o.isSkinnedMesh && !skinned) skinned = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    if (!skinned) throw new Error('no SkinnedMesh found');

    // Normalise height to 1.8 m with feet on the ground.
    const box = new THREE.Box3().setFromObject(scene);
    const h = box.max.y - box.min.y;
    if (h > 0.01) scene.scale.multiplyScalar(1.8 / h);
    const box2 = new THREE.Box3().setFromObject(scene);
    scene.position.y -= box2.min.y;

    const wrapper = new THREE.Group();
    wrapper.add(scene);

    // Map clips by keyword, then fill gaps with fallbacks.
    const clips = {};
    const used = new Set();
    for (const name of CLIP_NAMES) {
      const pats = CLIP_KEYWORDS[name] || [];
      const found = gltf.animations.find((c) => !used.has(c) && pats.some((re) => re.test(c.name)))
        || gltf.animations.find((c) => pats.some((re) => re.test(c.name)));
      if (found) {
        clips[name] = found.clone();
        clips[name].name = name;
        used.add(found);
      }
    }
    if (!clips.idle) {
      if (!gltf.animations.length) throw new Error('GLB has no animations');
      clips.idle = gltf.animations[0].clone();
      clips.idle.name = 'idle';
    }
    for (const name of CLIP_NAMES) {
      let src = name;
      const seen = new Set();
      while (!clips[src] && CLIP_FALLBACKS[src] && !seen.has(src)) {
        seen.add(src);
        src = CLIP_FALLBACKS[src];
      }
      if (!clips[name]) {
        clips[name] = (clips[src] || clips.idle).clone();
        clips[name].name = name;
      }
    }

    const bones = {};
    for (const [slot, pats] of Object.entries(BONE_PATTERNS)) {
      skinned.skeleton.bones.some((b) => {
        if (pats.some((re) => re.test(b.name))) {
          bones[slot] = b;
          return true;
        }
        return false;
      });
    }
    const model = new CharacterModel({ glb: { root: wrapper, clips, bones, url } });
    return model;
  }

  constructor({ rig = null, glb = null }) {
    if (rig) {
      this.source = 'procedural';
      this.rig = rig;
      this.object = rig.root;
      this.animator = new AnimationStateMachine(rig.mesh, getHumanoidClips(rig));
      this._slots = {
        rightHand: rig.bones.handR,
        leftHand: rig.bones.handL,
        head: rig.bones.head,
        back: rig.bones.chest,
      };
    } else {
      this.source = 'glb';
      this.url = glb.url;
      this.object = glb.root;
      this.animator = new AnimationStateMachine(glb.root, glb.clips);
      this._slots = glb.bones;
    }
  }

  attach(slot, object) {
    const bone = this._slots[slot];
    if (!bone) return null;
    bone.add(object);
    return object;
  }

  setOutfit(patch) {
    this.rig?.setOutfit(patch);
  }

  update(dt, speed) {
    this.animator.update(dt, speed);
  }

  dispose() {
    this.animator.dispose();
    this.rig?.dispose();
  }
}
