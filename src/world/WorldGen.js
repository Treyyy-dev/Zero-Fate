import { createNoise2D, fbm, ridged } from '../utils/noise.js';
import { clamp, lerp, smoothstep } from '../utils/math.js';
import { WORLD, POIS, RIVER, ROADS } from './WorldLayout.js';

/**
 * Deterministic world generator: terrain height and surface data at any
 * (x, z). Used by terrain chunks, vegetation, structures, AI and physics so
 * everything agrees on where the ground is.
 *
 * Layers (in order): rolling hills → northern mountains & border ranges →
 * castle hill → flattened POI sites → lake basin → river channel → roads.
 */

function makePolyline(points, width) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    segs.push({ ax, az, bx, bz, dx: bx - ax, dz: bz - az, len2: (bx - ax) ** 2 + (bz - az) ** 2 });
  }
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  return { segs, width, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** Distance from (x,z) to a polyline, or Infinity if outside its padded bounds. */
function polyDist(poly, x, z, pad) {
  if (x < poly.minX - pad || x > poly.maxX + pad || z < poly.minZ - pad || z > poly.maxZ + pad) return Infinity;
  let best = Infinity;
  for (const s of poly.segs) {
    let t = ((x - s.ax) * s.dx + (z - s.az) * s.dz) / s.len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = s.ax + s.dx * t - x;
    const pz = s.az + s.dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export class WorldGen {
  constructor() {
    this.waterLevel = WORLD.waterLevel;
    this.half = WORLD.half;
    this.noise = createNoise2D(WORLD.seed);
    this.noise2 = createNoise2D(WORLD.seed + 17);
    this.river = makePolyline(RIVER.points, RIVER.width);
    this.roads = ROADS.map((r) => ({ ...makePolyline(r.points, r.width), id: r.id }));

    // Resolve 'auto' POI heights from the natural terrain at their centres.
    this.pois = Object.entries(POIS).map(([id, p]) => ({ id, ...p }));
    for (const p of this.pois) {
      if (p.height === 'auto') p.height = Math.max(this.waterLevel + 3, this._natural(p.x, p.z));
    }
    this.poiById = Object.fromEntries(this.pois.map((p) => [p.id, p]));
    this.bridges = this._findBridges();
  }

  /** Hills + mountains, before any human-made or water shaping. */
  _natural(x, z) {
    const n = this.noise;
    let h = 6 + fbm(n, x * 0.0035, z * 0.0035, 5) * 15 + fbm(n, x * 0.02 + 31, z * 0.02 - 17, 3) * 2.2;

    // Northern mountains
    const north = smoothstep(-400, -700, z);
    if (north > 0) h += north * (40 + ridged(n, x * 0.004 + 9, z * 0.004 + 3, 5) * 130);

    // Border ranges close the region in.
    const edge = this.half - Math.max(Math.abs(x), Math.abs(z));
    const border = smoothstep(260, 40, edge);
    if (border > 0) h += border * (50 + ridged(this.noise2, x * 0.005, z * 0.005, 4) * 90);

    // Castle hill
    const cx = x - POIS.castle.x;
    const cz = z - POIS.castle.z;
    h += 26 * Math.exp(-(cx * cx + cz * cz) / (170 * 170));
    return h;
  }

  /** Full surface info at (x, z). */
  sample(x, z) {
    let h = this._natural(x, z);

    // Flatten POI sites.
    let poiMask = 0;
    for (const p of this.pois) {
      if (!p.flatten) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > p.flatten + p.falloff) continue;
      const k = 1 - smoothstep(p.flatten, p.flatten + p.falloff, d);
      h = lerp(h, p.height, k);
      poiMask = Math.max(poiMask, 1 - smoothstep(p.flatten * 0.8, p.flatten, d));
    }

    // Lake basin
    const lake = POIS.lake;
    const ld = Math.hypot(x - lake.x, z - lake.z);
    if (ld < lake.radius + 90) {
      const shore = lake.radius + fbm(this.noise2, x * 0.02, z * 0.02, 2) * 18;
      const k = smoothstep(shore + 70, shore * 0.55, ld);
      h = lerp(h, -13, k);
    }

    // River channel
    const rd = polyDist(this.river, x, z, RIVER.width + RIVER.bank + 60);
    let riverMask = 0;
    if (rd < RIVER.width + RIVER.bank + 60) {
      const wobble = fbm(this.noise2, x * 0.03, z * 0.03, 2) * 3;
      const core = RIVER.width + wobble;
      const k = 1 - smoothstep(core, core + RIVER.bank, rd);
      const valley = 1 - smoothstep(core, core + RIVER.bank + 60, rd);
      h = lerp(h, Math.min(h, this.waterLevel + 4), valley * 0.6);
      h = lerp(h, RIVER.bed, k * k * (3 - 2 * k));
      riverMask = 1 - smoothstep(core, core + 4, rd);
    }

    // Roads: smooth the bumps and lift them clear of shallow water.
    let roadMask = 0;
    for (const r of this.roads) {
      const d = polyDist(r, x, z, r.width + 8);
      if (d === Infinity) continue;
      const k = 1 - smoothstep(r.width * 0.5, r.width * 0.5 + 3, d);
      if (k <= 0) continue;
      roadMask = Math.max(roadMask, k);
    }
    if (roadMask > 0 && riverMask < 0.2) {
      const smoothH = h - fbm(this.noise, x * 0.02 + 31, z * 0.02 - 17, 3) * 2.2 * 0.8;
      h = lerp(h, Math.max(smoothH, this.waterLevel + 0.8), roadMask * 0.85);
    }

    // Forest density (large patches), suppressed near roads, water and POIs.
    let forest = smoothstep(0.05, 0.35, fbm(this.noise2, x * 0.0028 + 50, z * 0.0028 - 80, 4));
    forest *= 1 - roadMask;
    forest *= 1 - poiMask;
    forest *= smoothstep(this.waterLevel + 1.5, this.waterLevel + 4, h);
    forest *= 1 - smoothstep(60, 95, h); // tree line

    return { height: h, roadMask, riverMask, poiMask, forest };
  }

  heightAt(x, z) {
    return this.sample(x, z).height;
  }

  /** Water surface height if (x,z) is in water, otherwise null. */
  waterAt(x, z) {
    return this.heightAt(x, z) < this.waterLevel ? this.waterLevel : null;
  }

  poiAt(x, z, pad = 0) {
    for (const p of this.pois) {
      const r = (p.radius ?? p.flatten) + pad;
      if (Math.hypot(x - p.x, z - p.z) < r) return p;
    }
    return null;
  }

  /** Where roads cross the river (bridge sites). */
  _findBridges() {
    const out = [];
    for (const road of this.roads) {
      for (const a of road.segs) {
        for (const b of this.river.segs) {
          const den = a.dx * b.dz - a.dz * b.dx;
          if (Math.abs(den) < 1e-6) continue;
          const t = ((b.ax - a.ax) * b.dz - (b.az - a.az) * b.dx) / den;
          const u = ((b.ax - a.ax) * a.dz - (b.az - a.az) * a.dx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const x = a.ax + a.dx * t;
          const z = a.az + a.dz * t;
          out.push({ road: road.id, x, z, angle: Math.atan2(a.dx, a.dz), width: road.width + 1.5 });
        }
      }
    }
    return out;
  }

  /** Terrain colour parameters used by the chunk mesher. */
  clampToWorld(v) {
    return clamp(v, -this.half + 1, this.half - 1);
  }
}
