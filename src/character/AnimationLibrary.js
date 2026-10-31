import * as THREE from 'three';
import { BONES } from './HumanoidRig.js';

/**
 * Procedurally authored skeletal animation clips for the humanoid rig.
 *
 * Every clip is a real THREE.AnimationClip with a QuaternionKeyframeTrack per
 * bone (plus a hips position track), sampled from pose functions. Angles are
 * degrees, Euler order YXZ: X = swing forward(−)/back(+) for limbs and lean
 * forward(+) for the spine, Y = twist / horizontal swing, Z = sideways.
 *
 * Also exports ATTACK_TIMINGS: the normalized hit windows the combat system
 * uses, authored next to the motion they belong to.
 */

const D2R = Math.PI / 180;
const REST_HIPS_Y = 0.98;
const TAU = Math.PI * 2;

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

/** Combine pose objects (later ones override earlier ones). */
const merge = (...poses) => Object.assign({}, ...poses);

// ---------------------------------------------------------------- poses

const READY = {
  spine: [3, 0, 0],
  chest: [2, 0, 0],
  head: [-3, 0, 0],
  upperArmL: [6, 0, 9],
  forearmL: [-14, 0, 0],
  upperArmR: [-14, 0, -12],
  forearmR: [-62, 0, 0],
  handR: [12, 0, 0],
  thighL: [-3, 0, 3],
  thighR: [4, 0, -4],
  shinL: [5, 0, 0],
  shinR: [5, 0, 0],
  footL: [-2, 0, 0],
  footR: [-6, 0, 0],
};

const BLOCK_ARMS = {
  spine: [8, 0, 0],
  chest: [0, -10, 0],
  upperArmR: [-72, 28, -6],
  forearmR: [-78, 0, 0],
  handR: [0, 90, 0],
  upperArmL: [-58, -24, 6],
  forearmL: [-88, 0, 0],
  head: [-6, 0, 0],
};

// ---------------------------------------------------------------- samplers

function idle(p) {
  const b = Math.sin(p * TAU);
  return merge(READY, {
    spine: [3 + b * 1.4, 0, 0],
    chest: [2 + b * 1.0, 0, 0],
    upperArmL: [6 - b * 1.5, 0, 9],
    hipsY: -0.01 - b * 0.004,
  });
}

function walk(p, opts = {}) {
  const c = Math.cos(p * TAU);
  const s = Math.sin(p * TAU);
  const amp = opts.amp ?? 26;
  const thighL = -amp * c;
  const thighR = amp * c;
  const shinL = 6 + 42 * Math.max(0, -s);
  const shinR = 6 + 42 * Math.max(0, s);
  const legs = {
    thighL: [thighL, 0, 2],
    thighR: [thighR, 0, -2],
    shinL: [shinL, 0, 0],
    shinR: [shinR, 0, 0],
    footL: [-(thighL + shinL) * 0.65, 0, 0],
    footR: [-(thighR + shinR) * 0.65, 0, 0],
    hips: [0, 6 * c, 0],
    hipsY: -0.02 - 0.016 * Math.cos(p * TAU * 2),
  };
  if (opts.legsOnly) return legs;
  return merge(READY, legs, {
    spine: [5, 0, 0],
    chest: [2, -8 * c, 0],
    upperArmL: [18 * c, 0, 8],
    forearmL: [-18 - 8 * Math.max(0, -c), 0, 0],
    upperArmR: [-14 - 6 * c, 0, -12],
  });
}

function run(p) {
  const c = Math.cos(p * TAU);
  const s = Math.sin(p * TAU);
  const thighL = -46 * c - 8;
  const thighR = 46 * c - 8;
  const shinL = 22 + 78 * Math.max(0, -s);
  const shinR = 22 + 78 * Math.max(0, s);
  return merge(READY, {
    thighL: [thighL, 0, 2],
    thighR: [thighR, 0, -2],
    shinL: [shinL, 0, 0],
    shinR: [shinR, 0, 0],
    footL: [-(thighL + shinL) * 0.5, 0, 0],
    footR: [-(thighR + shinR) * 0.5, 0, 0],
    hips: [0, 10 * c, 0],
    spine: [14, 0, 0],
    chest: [4, -12 * c, 0],
    head: [-12, 0, 0],
    upperArmL: [40 * c, 0, 10],
    forearmL: [-70, 0, 0],
    upperArmR: [-28 - 16 * c, 0, -14],
    forearmR: [-72, 0, 0],
    hipsY: -0.06 - 0.035 * Math.cos(p * TAU * 2),
  });
}

function blockWalk(p) {
  return merge(walk(p, { amp: 18, legsOnly: true }), BLOCK_ARMS);
}

function blockIdle(p) {
  const b = Math.sin(p * TAU);
  return merge(READY, BLOCK_ARMS, {
    thighL: [-16, 0, 4],
    thighR: [-6, 0, -4],
    shinL: [26, 0, 0],
    shinR: [20, 0, 0],
    footL: [-10, 0, 0],
    footR: [-14, 0, 0],
    hipsY: -0.06 + b * 0.004,
  });
}

function fall(p) {
  const s = Math.sin(p * TAU);
  return merge(READY, {
    thighL: [-28 + s * 4, 0, 4],
    thighR: [4 - s * 4, 0, -4],
    shinL: [38, 0, 0],
    shinR: [22, 0, 0],
    upperArmL: [-22, 0, 38 + s * 4],
    forearmL: [-20, 0, 0],
    upperArmR: [-30, 0, -30 - s * 4],
    spine: [6, 0, 0],
  });
}

function swim(p) {
  const s = Math.sin(p * TAU);
  const c = Math.cos(p * TAU);
  return {
    hips: [72, 0, 0],
    spine: [4, 0, 0],
    head: [-58, 0, 0],
    upperArmL: [-150 + 40 * c, -30 * s, 30],
    upperArmR: [-150 + 40 * c, 30 * s, -30],
    forearmL: [-30 - 30 * Math.max(0, s), 0, 0],
    forearmR: [-30 - 30 * Math.max(0, s), 0, 0],
    thighL: [14 * s, 0, 8],
    thighR: [-14 * s, 0, -8],
    shinL: [20 + 15 * Math.max(0, s), 0, 0],
    shinR: [20 + 15 * Math.max(0, -s), 0, 0],
    hipsY: -0.55,
  };
}

/** Builds a sampler from timed key poses (t in seconds) with smooth easing. */
function keyed(keys) {
  return (p, t) => {
    if (t <= keys[0].t) return keys[0].pose;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (t <= b.t) {
        const k = smooth((t - a.t) / (b.t - a.t));
        return blendPose(a.pose, b.pose, k);
      }
    }
    return keys[keys.length - 1].pose;
  };
}

function blendPose(a, b, k) {
  const out = {};
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const name of names) {
    const va = a[name] ?? (name === 'hipsY' || name === 'hipsZ' ? 0 : [0, 0, 0]);
    const vb = b[name] ?? (name === 'hipsY' || name === 'hipsZ' ? 0 : [0, 0, 0]);
    out[name] = Array.isArray(va) ? [lerp(va[0], vb[0], k), lerp(va[1], vb[1], k), lerp(va[2], vb[2], k)] : lerp(va, vb, k);
  }
  return out;
}

const STEP_FWD = { thighL: [-26, 0, 3], shinL: [24, 0, 0], footL: [2, 0, 0], thighR: [16, 0, -4], shinR: [12, 0, 0], footR: [-20, 0, 0], hipsY: -0.05 };

const LIGHT_1 = keyed([
  { t: 0, pose: READY },
  { t: 0.16, pose: merge(READY, STEP_FWD, { chest: [0, -38, 0], spine: [6, -10, 0], upperArmR: [-100, -62, -4], forearmR: [-50, 0, 0], handR: [10, 0, 0] }) },
  { t: 0.3, pose: merge(READY, STEP_FWD, { chest: [4, -10, 0], spine: [10, 0, 0], upperArmR: [-78, -22, 0], forearmR: [-16, 0, 0], handR: [68, 0, 0] }) },
  { t: 0.42, pose: merge(READY, STEP_FWD, { chest: [8, 34, 0], spine: [12, 10, 0], upperArmR: [-66, 52, 0], forearmR: [-10, 0, 0], handR: [74, 0, 0] }) },
  { t: 0.75, pose: READY },
]);

const LIGHT_2 = keyed([
  { t: 0, pose: merge(READY, { chest: [6, 30, 0], upperArmR: [-66, 50, 0], forearmR: [-12, 0, 0], handR: [70, 0, 0] }) },
  { t: 0.15, pose: merge(READY, STEP_FWD, { chest: [4, 38, 0], spine: [6, 10, 0], upperArmR: [-82, 66, 0], forearmR: [-30, 0, 0], handR: [60, 0, 0] }) },
  { t: 0.28, pose: merge(READY, STEP_FWD, { chest: [6, 4, 0], spine: [10, 0, 0], upperArmR: [-74, 8, 0], forearmR: [-12, 0, 0], handR: [72, 0, 0] }) },
  { t: 0.4, pose: merge(READY, STEP_FWD, { chest: [8, -36, 0], spine: [10, -12, 0], upperArmR: [-64, -62, 0], forearmR: [-10, 0, 0], handR: [74, 0, 0] }) },
  { t: 0.7, pose: READY },
]);

const LIGHT_3 = keyed([
  { t: 0, pose: READY },
  { t: 0.24, pose: merge(READY, { spine: [-12, 0, 0], chest: [-6, -10, 0], upperArmR: [-168, -6, 0], forearmR: [-46, 0, 0], handR: [-20, 0, 0], upperArmL: [-40, 0, 20], thighL: [-12, 0, 3], shinL: [14, 0, 0] }) },
  { t: 0.38, pose: merge(READY, STEP_FWD, { spine: [16, 0, 0], chest: [10, 0, 0], upperArmR: [-96, 0, 0], forearmR: [-20, 0, 0], handR: [10, 0, 0], hipsY: -0.1 }) },
  { t: 0.5, pose: merge(READY, STEP_FWD, { spine: [28, 0, 0], chest: [12, 6, 0], upperArmR: [-42, 6, 0], forearmR: [-8, 0, 0], handR: [30, 0, 0], hipsY: -0.14, thighL: [-40, 0, 3], shinL: [48, 0, 0] }) },
  { t: 0.9, pose: READY },
]);

const HEAVY = keyed([
  { t: 0, pose: READY },
  { t: 0.42, pose: merge(READY, { spine: [-16, 0, 0], chest: [-8, -22, 0], head: [-10, 0, 0], upperArmR: [-176, 10, 0], forearmR: [-72, 0, 0], handR: [-10, 0, 0], upperArmL: [-150, 30, 0], forearmL: [-64, 0, 0], thighL: [-10, 0, 4], thighR: [12, 0, -4], shinL: [16, 0, 0], shinR: [14, 0, 0], hipsY: -0.03 }) },
  { t: 0.58, pose: merge(READY, { spine: [36, 0, 0], chest: [14, 8, 0], head: [-18, 0, 0], upperArmR: [-34, 10, 0], forearmR: [-4, 0, 0], handR: [36, 0, 0], upperArmL: [-36, -14, 0], forearmL: [-20, 0, 0], thighL: [-42, 0, 4], shinL: [52, 0, 0], footL: [-6, 0, 0], thighR: [26, 0, -4], shinR: [16, 0, 0], footR: [-34, 0, 0], hipsY: -0.2 }) },
  { t: 0.82, pose: merge(READY, { spine: [32, 0, 0], chest: [12, 6, 0], upperArmR: [-36, 10, 0], forearmR: [-6, 0, 0], handR: [36, 0, 0], upperArmL: [-36, -14, 0], forearmL: [-22, 0, 0], thighL: [-40, 0, 4], shinL: [50, 0, 0], thighR: [24, 0, -4], shinR: [16, 0, 0], footR: [-30, 0, 0], hipsY: -0.19 }) },
  { t: 1.25, pose: READY },
]);

const JUMP = keyed([
  { t: 0, pose: merge(READY, { thighL: [-24, 0, 3], thighR: [-20, 0, -3], shinL: [42, 0, 0], shinR: [40, 0, 0], hipsY: -0.08 }) },
  { t: 0.3, pose: merge(READY, { thighL: [-52, 0, 4], shinL: [72, 0, 0], footL: [-10, 0, 0], thighR: [8, 0, -4], shinR: [34, 0, 0], upperArmL: [-42, 0, 22], upperArmR: [-50, 0, -16], spine: [8, 0, 0] }) },
]);

const LAND = keyed([
  { t: 0, pose: merge(READY, { thighL: [-56, 0, 6], thighR: [-48, 0, -6], shinL: [88, 0, 0], shinR: [84, 0, 0], footL: [-28, 0, 0], footR: [-30, 0, 0], spine: [22, 0, 0], upperArmL: [-30, 0, 20], upperArmR: [-36, 0, -18], hipsY: -0.24 }) },
  { t: 0.12, pose: merge(READY, { thighL: [-50, 0, 6], thighR: [-44, 0, -6], shinL: [80, 0, 0], shinR: [76, 0, 0], footL: [-26, 0, 0], footR: [-28, 0, 0], spine: [18, 0, 0], hipsY: -0.21 }) },
  { t: 0.42, pose: READY },
]);

function dodge(p, t) {
  const rollK = smooth(Math.min(1, Math.max(0, (t - 0.06) / 0.5)));
  const tuck = Math.sin(Math.min(1, Math.max(0, (t - 0.02) / 0.58)) * Math.PI);
  return merge(READY, {
    hips: [rollK * 360, 0, 0],
    hipsY: -0.48 * tuck,
    spine: [42 * tuck, 0, 0],
    chest: [16 * tuck, 0, 0],
    head: [30 * tuck, 0, 0],
    thighL: [-100 * tuck, 0, 4],
    thighR: [-92 * tuck, 0, -4],
    shinL: [130 * tuck, 0, 0],
    shinR: [124 * tuck, 0, 0],
    upperArmL: [-60 * tuck, 0, 12],
    upperArmR: [-14 - 50 * tuck, 0, -12],
    forearmL: [-90 * tuck, 0, 0],
  });
}

const HIT = keyed([
  { t: 0, pose: READY },
  { t: 0.1, pose: merge(READY, { spine: [-18, 0, 4], chest: [-6, 12, 0], head: [-16, 8, 0], upperArmL: [-30, 0, 34], upperArmR: [-30, 0, -26], thighL: [8, 0, 3], thighR: [-6, 0, -4], hipsY: -0.04 }) },
  { t: 0.5, pose: READY },
]);

const DEATH = keyed([
  { t: 0, pose: READY },
  { t: 0.35, pose: merge(READY, { spine: [-22, 0, 6], head: [-20, 0, 0], thighL: [-18, 0, 4], shinL: [40, 0, 0], thighR: [-26, 0, -4], shinR: [50, 0, 0], upperArmL: [-40, 0, 40], hipsY: -0.2 }) },
  { t: 1.05, pose: { hips: [-86, 0, 0], hipsY: -0.82, spine: [-4, 0, 0], head: [-12, 20, 0], upperArmL: [-20, 0, 72], upperArmR: [-10, 0, -64], forearmL: [-20, 0, 0], forearmR: [-30, 0, 0], thighL: [-12, 0, 10], thighR: [-4, 0, -12], shinL: [18, 0, 0], shinR: [10, 0, 0] } },
  { t: 1.4, pose: { hips: [-88, 0, 0], hipsY: -0.84, spine: [-4, 0, 0], head: [-12, 22, 0], upperArmL: [-20, 0, 74], upperArmR: [-10, 0, -66], forearmL: [-20, 0, 0], forearmR: [-30, 0, 0], thighL: [-12, 0, 10], thighR: [-4, 0, -12], shinL: [18, 0, 0], shinR: [10, 0, 0] } },
]);

const CAST = keyed([
  { t: 0, pose: READY },
  { t: 0.22, pose: merge(READY, { chest: [0, 24, 0], upperArmL: [-60, 30, 10], forearmL: [-70, 0, 0], handL: [20, 0, 0] }) },
  { t: 0.34, pose: merge(READY, STEP_FWD, { chest: [6, -20, 0], spine: [8, -6, 0], upperArmL: [-92, -6, 0], forearmL: [-4, 0, 0], handL: [-30, 0, 0] }) },
  { t: 0.7, pose: READY },
]);

const USE = keyed([
  { t: 0, pose: READY },
  { t: 0.3, pose: merge(READY, { spine: [38, 0, 0], head: [10, 0, 0], thighL: [-50, 0, 4], thighR: [-30, 0, -4], shinL: [72, 0, 0], shinR: [56, 0, 0], footL: [-22, 0, 0], footR: [-26, 0, 0], upperArmL: [-64, 0, 6], forearmL: [-20, 0, 0], hipsY: -0.24 }) },
  { t: 0.5, pose: merge(READY, { spine: [36, 0, 0], thighL: [-48, 0, 4], thighR: [-28, 0, -4], shinL: [70, 0, 0], shinR: [54, 0, 0], footL: [-22, 0, 0], footR: [-26, 0, 0], upperArmL: [-60, 0, 6], forearmL: [-30, 0, 0], hipsY: -0.23 }) },
  { t: 0.85, pose: READY },
]);

function drink(p, t) {
  const k = Math.sin(Math.min(1, t / 0.9) * Math.PI);
  return merge(READY, { upperArmL: [-60 * k, -30 * k, 10], forearmL: [-14 - 110 * k, 0, 0], head: [-3 - 18 * k, 0, 0] });
}

// ---------------------------------------------------------------- clip build

const CLIPS = {
  idle: { duration: 2.6, loop: true, sampler: idle },
  walk: { duration: 1.0, loop: true, sampler: (p) => walk(p) },
  run: { duration: 0.68, loop: true, sampler: run },
  blockIdle: { duration: 1.6, loop: true, sampler: blockIdle },
  blockWalk: { duration: 1.0, loop: true, sampler: blockWalk },
  fall: { duration: 0.9, loop: true, sampler: fall },
  swim: { duration: 1.3, loop: true, sampler: swim },
  jump: { duration: 0.3, loop: false, sampler: JUMP },
  land: { duration: 0.42, loop: false, sampler: LAND },
  dodge: { duration: 0.62, loop: false, sampler: dodge },
  attackLight1: { duration: 0.75, loop: false, sampler: LIGHT_1 },
  attackLight2: { duration: 0.7, loop: false, sampler: LIGHT_2 },
  attackLight3: { duration: 0.9, loop: false, sampler: LIGHT_3 },
  attackHeavy: { duration: 1.25, loop: false, sampler: HEAVY },
  hit: { duration: 0.5, loop: false, sampler: HIT },
  death: { duration: 1.4, loop: false, sampler: DEATH },
  cast: { duration: 0.7, loop: false, sampler: CAST },
  use: { duration: 0.85, loop: false, sampler: USE },
  drink: { duration: 0.9, loop: false, sampler: drink },
};

/** Normalized windows (0..1 of the clip) when the weapon can deal damage. */
export const ATTACK_TIMINGS = {
  attackLight1: { hitStart: 0.3, hitEnd: 0.6, comboOpen: 0.5, cancel: 0.72 },
  attackLight2: { hitStart: 0.28, hitEnd: 0.6, comboOpen: 0.5, cancel: 0.72 },
  attackLight3: { hitStart: 0.34, hitEnd: 0.58, comboOpen: 1.1, cancel: 0.8 },
  attackHeavy: { hitStart: 0.4, hitEnd: 0.56, comboOpen: 1.1, cancel: 0.8 },
  cast: { release: 0.45 },
  drink: { release: 0.6 },
  use: { release: 0.45 },
};

/** Reference speeds the locomotion clips were authored for (m/s). */
export const CLIP_SPEEDS = { walk: 2.6, run: 6.2 };

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();
const _restPos = {};

function buildClip(name, def, restPositions) {
  const fps = 30;
  const frames = Math.max(2, Math.round(def.duration * fps) + 1);
  const times = new Float32Array(frames);
  const rot = {};
  for (const b of BONES) rot[b] = new Float32Array(frames * 4);
  const hipsPos = new Float32Array(frames * 3);
  const hipsRest = restPositions.hips;

  for (let i = 0; i < frames; i++) {
    const t = (i / (frames - 1)) * def.duration;
    const p = t / def.duration;
    times[i] = t;
    const pose = def.sampler(p, t);
    for (const b of BONES) {
      const e = pose[b] || [0, 0, 0];
      _euler.set(e[0] * D2R, e[1] * D2R, e[2] * D2R, 'YXZ');
      _quat.setFromEuler(_euler);
      rot[b].set([_quat.x, _quat.y, _quat.z, _quat.w], i * 4);
    }
    hipsPos[i * 3] = hipsRest.x;
    hipsPos[i * 3 + 1] = REST_HIPS_Y + (pose.hipsY || 0);
    hipsPos[i * 3 + 2] = hipsRest.z + (pose.hipsZ || 0);
  }

  const tracks = BONES.map((b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, rot[b]));
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, hipsPos));
  const clip = new THREE.AnimationClip(name, def.duration, tracks);
  clip.userData = { loop: def.loop };
  return clip;
}

let _cache = null;

/** Returns { name: AnimationClip } for the procedural humanoid (built once, shared). */
export function getHumanoidClips(rig) {
  if (_cache) return _cache;
  for (const b of BONES) _restPos[b] = rig.bones[b].position.clone();
  _cache = {};
  for (const [name, def] of Object.entries(CLIPS)) _cache[name] = buildClip(name, def, _restPos);
  return _cache;
}

export const CLIP_NAMES = Object.keys(CLIPS);
export const LOOPING_CLIPS = new Set(Object.entries(CLIPS).filter(([, d]) => d.loop).map(([n]) => n));
