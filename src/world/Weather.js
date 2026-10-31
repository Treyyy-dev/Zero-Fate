import * as THREE from 'three';
import { Emitter } from '../core/Emitter.js';
import { lerp } from '../utils/math.js';

/**
 * Dynamic weather: clear → cloudy → rain → storm → fog, chosen at random
 * with smooth 25 s transitions. Produces a parameter set the Environment,
 * vegetation wind and rain particles consume.
 *
 * Events: 'change' {type}
 */
export const WEATHER_TYPES = {
  clear: { label: 'Clear', cloud: 0.12, rain: 0, fog: 1.0, light: 1.0, wind: 0.6, next: { clear: 2, cloudy: 3, fog: 1 } },
  cloudy: { label: 'Overcast', cloud: 0.68, rain: 0, fog: 1.35, light: 0.72, wind: 1.0, next: { clear: 2, rain: 3, cloudy: 1 } },
  rain: { label: 'Rain', cloud: 0.9, rain: 0.7, fog: 2.0, light: 0.52, wind: 1.4, next: { cloudy: 3, storm: 1.5, rain: 1 } },
  storm: { label: 'Thunderstorm', cloud: 1.0, rain: 1.0, fog: 2.4, light: 0.38, wind: 2.2, lightning: true, next: { rain: 3, cloudy: 1 } },
  fog: { label: 'Fog', cloud: 0.45, rain: 0, fog: 4.2, light: 0.72, wind: 0.25, next: { clear: 2, cloudy: 2 } },
};
const KEYS = ['cloud', 'rain', 'fog', 'light', 'wind'];

export class Weather extends Emitter {
  constructor({ scene, quality, start = 'clear' }) {
    super();
    this.type = start;
    this.params = { ...pick(WEATHER_TYPES[start]), flash: 0 };
    this.target = pick(WEATHER_TYPES[start]);
    this.timeLeft = 120 + Math.random() * 120;
    this.flashTimer = 5;
    this.flash = 0;
    this.rain = new Rain(scene, quality.mobile ? 700 : 1600);
  }

  set(type) {
    if (!WEATHER_TYPES[type]) return;
    this.type = type;
    this.target = pick(WEATHER_TYPES[type]);
    this.timeLeft = 120 + Math.random() * 150;
    this.emit('change', { type, label: WEATHER_TYPES[type].label });
  }

  update(dt, camera) {
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      const next = WEATHER_TYPES[this.type].next;
      const total = Object.values(next).reduce((a, b) => a + b, 0);
      let r = Math.random() * total;
      let chosen = this.type;
      for (const [k, w] of Object.entries(next)) {
        r -= w;
        if (r <= 0) {
          chosen = k;
          break;
        }
      }
      this.set(chosen);
    }
    const k = Math.min(1, dt / 25);
    for (const key of KEYS) this.params[key] = lerp(this.params[key], this.target[key], k * 3);

    // Lightning
    this.flash = Math.max(0, this.flash - dt * 6);
    if (WEATHER_TYPES[this.type].lightning && this.params.rain > 0.6) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flash = 1;
        this.flashTimer = 5 + Math.random() * 12;
        if (Math.random() < 0.4) setTimeout(() => (this.flash = 0.8), 140);
      }
    }
    this.params.flash = this.flash;
    this.rain.update(dt, camera, this.params.rain, this.params.wind);
    return this.params;
  }

  toJSON() {
    return { type: this.type };
  }

  fromJSON(d) {
    if (d?.type && WEATHER_TYPES[d.type]) {
      this.type = d.type;
      this.target = pick(WEATHER_TYPES[d.type]);
      Object.assign(this.params, this.target);
    }
  }
}

function pick(t) {
  return { cloud: t.cloud, rain: t.rain, fog: t.fog, light: t.light, wind: t.wind };
}

/** Rain streaks in a box that travels with the camera. */
class Rain {
  constructor(scene, count) {
    this.count = count;
    this.box = { x: 46, y: 26, z: 46 };
    this.pos = new Float32Array(count * 6);
    this.drops = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * this.box.x;
      this.drops[i * 3 + 1] = Math.random() * this.box.y;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * this.box.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0, depthWrite: false, fog: true });
    this.lines = new THREE.LineSegments(g, this.material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  update(dt, camera, intensity, wind) {
    this.material.opacity = Math.min(0.55, intensity * 0.6);
    this.lines.visible = intensity > 0.03;
    if (!this.lines.visible) return;
    const active = Math.floor(this.count * Math.min(1, intensity * 1.2));
    const fall = 22;
    const wx = wind * 2.2;
    const c = camera.position;
    const len = 0.55;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      this.drops[o + 1] -= fall * dt;
      this.drops[o] += wx * dt;
      if (this.drops[o + 1] < -6) {
        this.drops[o + 1] += this.box.y;
        this.drops[o] = (Math.random() - 0.5) * this.box.x;
        this.drops[o + 2] = (Math.random() - 0.5) * this.box.z;
      }
      const x = c.x + this.drops[o];
      const y = c.y + this.drops[o + 1] - 6;
      const z = c.z + this.drops[o + 2];
      const p = i * 6;
      if (i >= active) {
        this.pos.fill(0, p, p + 6);
        continue;
      }
      this.pos[p] = x;
      this.pos[p + 1] = y;
      this.pos[p + 2] = z;
      this.pos[p + 3] = x - wx * 0.03;
      this.pos[p + 4] = y + len;
      this.pos[p + 5] = z;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
