import * as THREE from 'three';
import { CLIP_SPEEDS } from './AnimationLibrary.js';
import { dampFactor } from '../utils/math.js';

/**
 * Animation state machine with smooth weight-based transitions.
 *
 * Base layer (looping, blended continuously by weight):
 *   locomotion  idle ↔ walk ↔ run blended by ground speed (1D blend tree)
 *   guard       blockIdle ↔ blockWalk by speed
 *   air         fall loop (jump plays as a one-shot on take-off)
 *   swim        swim loop
 *
 * Action layer (one-shot, full body, fades over the base):
 *   jump, land, dodge, attacks, hit, death, cast, use, drink …
 *
 * Every transition is a cross-fade of action weights, so nothing ever pops.
 * Walk and run share phase so feet stay in sync while blending.
 */
const BASE_MODES = {
  locomotion: ['idle', 'walk', 'run'],
  guard: ['blockIdle', 'blockWalk'],
  air: ['fall'],
  swim: ['swim'],
};

export class AnimationStateMachine {
  constructor(root, clips, { walkSpeed = CLIP_SPEEDS.walk, runSpeed = CLIP_SPEEDS.run } = {}) {
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = clips;
    this.actions = {};
    this.walkSpeed = walkSpeed;
    this.runSpeed = runSpeed;
    this.mode = 'locomotion';
    this.speed = 0;
    this.baseWeights = {};
    this.oneShot = null; // { name, action, weight, fadeIn, fadeOut, hold, done }
    this.listeners = new Set();

    const looping = new Set(Object.values(BASE_MODES).flat());
    for (const [name, clip] of Object.entries(clips)) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      if (looping.has(name)) {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
        action.setEffectiveWeight(name === 'idle' ? 1 : 0);
        this.baseWeights[name] = name === 'idle' ? 1 : 0;
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions[name] = action;
    }
  }

  has(name) {
    return !!this.actions[name];
  }

  setMode(mode) {
    if (BASE_MODES[mode]) this.mode = mode;
  }

  /**
   * Plays a one-shot over the base layer.
   * @param {string} name clip name
   * @param {object} opts fadeIn, fadeOut, timeScale, hold (stay on last frame until stopped)
   */
  play(name, { fadeIn = 0.1, fadeOut = 0.18, timeScale = 1, hold = false } = {}) {
    const action = this.actions[name];
    if (!action) return false;
    if (this.oneShot && this.oneShot.action !== action) {
      // Hand the previous one-shot's weight over smoothly.
      this.oneShot.action.fadeOut(fadeIn);
    }
    action.reset();
    action.timeScale = timeScale;
    action.setEffectiveWeight(this.oneShot ? 1 : 0);
    action.play();
    this.oneShot = { name, action, weight: this.oneShot ? this.oneShot.weight : 0, fadeIn, fadeOut, hold, done: false };
    return true;
  }

  /** Ends the current one-shot early (e.g. dodge-cancel), fading back to base. */
  stop(fade = 0.15) {
    if (!this.oneShot) return;
    this.oneShot.fadeOut = fade;
    this.oneShot.hold = false;
    this.oneShot.forceOut = true;
  }

  get current() {
    return this.oneShot ? this.oneShot.name : this.mode;
  }

  /** 0..1 progress of the current one-shot (1 when none is playing). */
  progress() {
    if (!this.oneShot) return 1;
    const a = this.oneShot.action;
    return Math.min(1, a.time / a.getClip().duration);
  }

  isPlaying(name) {
    return !!this.oneShot && this.oneShot.name === name && !this.oneShot.done;
  }

  update(dt, speed = this.speed) {
    this.speed = speed;

    // --- base layer targets ---
    const targets = {};
    for (const n of Object.keys(this.baseWeights)) targets[n] = 0;
    if (this.mode === 'locomotion') {
      const w = this.walkSpeed;
      if (speed <= w) {
        const k = Math.min(1, speed / w);
        targets.idle = 1 - k;
        targets.walk = k;
      } else {
        const k = Math.min(1, (speed - w) / (this.runSpeed - w));
        targets.walk = 1 - k;
        targets.run = k;
      }
    } else if (this.mode === 'guard') {
      const k = Math.min(1, speed / (this.walkSpeed * 0.6));
      targets.blockIdle = 1 - k;
      targets.blockWalk = k;
    } else {
      targets[BASE_MODES[this.mode][0]] = 1;
    }

    // --- one-shot weight ---
    let oneW = 0;
    const os = this.oneShot;
    if (os) {
      const a = os.action;
      const dur = a.getClip().duration / Math.max(0.01, a.timeScale);
      const remaining = (a.getClip().duration - a.time) / Math.max(0.01, a.timeScale);
      const fadingOut = os.forceOut || (!os.hold && remaining <= os.fadeOut);
      if (fadingOut) os.weight -= dt / Math.max(0.01, os.fadeOut);
      else os.weight += dt / Math.max(0.01, Math.min(os.fadeIn, dur * 0.5));
      os.weight = Math.min(1, Math.max(0, os.weight));
      oneW = os.weight;
      a.setEffectiveWeight(oneW);
      if (fadingOut && os.weight <= 0) {
        a.stop();
        os.done = true;
        this.oneShot = null;
        for (const fn of this.listeners) fn(os.name);
      }
    }

    // --- apply base weights smoothly ---
    const k = dampFactor(12, dt);
    for (const [n, tw] of Object.entries(targets)) {
      const w = this.baseWeights[n] + (tw - this.baseWeights[n]) * k;
      this.baseWeights[n] = w;
      this.actions[n].setEffectiveWeight(w * (1 - oneW));
    }

    // --- locomotion playback speed & phase sync ---
    const walkA = this.actions.walk;
    const runA = this.actions.run;
    if (walkA && runA) {
      const scale = speed <= this.walkSpeed ? Math.max(0.6, speed / this.walkSpeed) : speed / this.runSpeed;
      const walkPhase = walkA.time / walkA.getClip().duration;
      walkA.timeScale = speed <= this.walkSpeed ? scale : (speed / this.runSpeed) * (walkA.getClip().duration / runA.getClip().duration);
      runA.timeScale = Math.max(0.7, scale);
      if (this.baseWeights.run > 0.01 && this.baseWeights.walk > 0.01) runA.time = walkPhase * runA.getClip().duration;
    }
    const bw = this.actions.blockWalk;
    if (bw) bw.timeScale = Math.max(0.6, speed / (this.walkSpeed * 0.6));

    this.mixer.update(dt);
  }

  /** Called with the clip name whenever a one-shot finishes fading out. */
  onFinished(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
