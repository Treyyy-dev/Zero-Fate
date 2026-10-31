import * as THREE from 'three';
import { createNoise2D } from '../utils/noise.js';
import { smoothstep } from '../utils/math.js';

/**
 * Streams the terrain in square chunks around the player.
 *
 *  - LOD: chunk resolution drops with ring distance (64 → 32 → 16 → 8 cells).
 *  - Skirts hide cracks where neighbouring LODs meet.
 *  - Physics: only chunks within `colliderRing` get a trimesh collider,
 *    always at full resolution, built from the same height samples.
 *  - Streaming: builds/unloads are queued and processed within a per-frame
 *    millisecond budget, nearest first, so movement never stalls.
 *  - Each chunk is its own mesh with a bounding sphere, so Three.js frustum
 *    culling skips everything off-screen.
 *
 * Listeners ('chunkReady', 'chunkUnload', 'colliderReady') let vegetation and
 * props stream with the terrain.
 */

const LOD_SEGMENTS = [64, 32, 16, 8];
const COLORS = {
  grass: new THREE.Color(0x4f7b2c),
  grassDry: new THREE.Color(0x8a8b45),
  forest: new THREE.Color(0x34522a),
  dirt: new THREE.Color(0x6e5a3e),
  road: new THREE.Color(0x7d6a4c),
  sand: new THREE.Color(0xb7a57c),
  mud: new THREE.Color(0x4a3f30),
  rock: new THREE.Color(0x77736b),
  snow: new THREE.Color(0xe8ecef),
  village: new THREE.Color(0x6f6446),
};

export class ChunkManager {
  constructor({ scene, physics, worldGen, quality, texture, chunkSize = 128 }) {
    this.scene = scene;
    this.physics = physics;
    this.gen = worldGen;
    this.size = chunkSize;
    this.viewRing = quality.viewRing ?? 5;
    this.colliderRing = quality.colliderRing ?? 1;
    this.chunks = new Map(); // key → chunk
    this.queue = [];
    this.listeners = { chunkReady: [], chunkUnload: [], colliderReady: [], colliderUnload: [], ringChange: [] };
    this.centerKey = null;
    this.budgetMs = quality.mobile ? 5 : 7;
    this.colorNoise = createNoise2D(worldGen.waterLevel * 100 + 5);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, map: texture, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    this.group = new THREE.Group();
    this.group.name = 'Terrain';
    scene.add(this.group);
    this.stats = { built: 0, unloaded: 0 };
    this.maxIndex = Math.floor(worldGen.half / chunkSize);
  }

  on(event, fn) {
    this.listeners[event].push(fn);
  }

  _emit(event, payload) {
    for (const fn of this.listeners[event]) fn(payload);
  }

  key(cx, cz) {
    return `${cx},${cz}`;
  }

  lodFor(ring) {
    if (ring <= 1) return 0;
    if (ring === 2) return 1;
    if (ring <= 4) return 2;
    return 3;
  }

  /** Re-evaluates what should be loaded around the focus point. */
  update(focus, { force = false } = {}) {
    const cx = Math.floor(focus.x / this.size);
    const cz = Math.floor(focus.z / this.size);
    const key = this.key(cx, cz);
    if (key !== this.centerKey || force) {
      this.centerKey = key;
      this.center = { cx, cz };
      this._plan(cx, cz);
    }
    this._process();
  }

  _plan(cx, cz) {
    const wanted = new Map();
    const R = this.viewRing;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < -this.maxIndex || x >= this.maxIndex || z < -this.maxIndex || z >= this.maxIndex) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        if (ring > R) continue;
        wanted.set(this.key(x, z), { cx: x, cz: z, ring, lod: this.lodFor(ring), collider: ring <= this.colliderRing });
      }
    }
    // Unload chunks no longer wanted.
    for (const [k, chunk] of this.chunks) if (!wanted.has(k)) this._unload(k, chunk);
    // Queue builds / LOD changes / collider changes.
    this.queue = [];
    for (const [k, w] of wanted) {
      const c = this.chunks.get(k);
      if (!c || c.lod !== w.lod || c.wantCollider !== w.collider || !c.hasColliderMatch(w.collider)) {
        this.queue.push({ key: k, ...w });
      }
      if (c && c.ring !== w.ring) {
        c.ring = w.ring;
        this._emit('ringChange', c);
      }
    }
    this.queue.sort((a, b) => a.ring - b.ring);
  }

  /** Processes queued work within the frame budget. */
  _process(budgetMs = this.budgetMs) {
    const start = performance.now();
    while (this.queue.length && performance.now() - start < budgetMs) {
      const job = this.queue.shift();
      this._build(job);
    }
  }

  /** Builds everything that is queued (used during the loading screen). */
  flush() {
    while (this.queue.length) this._build(this.queue.shift());
  }

  get pending() {
    return this.queue.length;
  }

  _build(job) {
    let chunk = this.chunks.get(job.key);
    if (!chunk) {
      chunk = new TerrainChunk(this, job.cx, job.cz);
      this.chunks.set(job.key, chunk);
    }
    chunk.ring = job.ring;
    if (chunk.lod !== job.lod) {
      chunk.buildMesh(job.lod);
      this.stats.built++;
      this._emit('chunkReady', chunk);
    }
    chunk.wantCollider = job.collider;
    if (job.collider && !chunk.collider) {
      chunk.buildCollider();
      this._emit('colliderReady', chunk);
    } else if (!job.collider && chunk.collider) {
      chunk.removeCollider();
      this._emit('colliderUnload', chunk);
    }
  }

  _unload(key, chunk) {
    this._emit('chunkUnload', chunk);
    if (chunk.collider) this._emit('colliderUnload', chunk);
    chunk.dispose();
    this.chunks.delete(key);
    this.stats.unloaded++;
  }

  /** True when the chunk under (x,z) has its collider (safe to spawn things there). */
  hasColliderAt(x, z) {
    const c = this.chunks.get(this.key(Math.floor(x / this.size), Math.floor(z / this.size)));
    return !!c?.collider;
  }

  terrainColor(x, z, h, slope, s, out) {
    const n = this.colorNoise;
    out.copy(COLORS.grass).lerp(COLORS.grassDry, smoothstep(-0.25, 0.7, n(x * 0.015, z * 0.015)) * 0.55);
    out.lerp(COLORS.forest, s.forest * 0.85);
    out.lerp(COLORS.village, s.poiMask * 0.35);
    out.lerp(COLORS.road, s.roadMask * 0.9);
    const wl = this.gen.waterLevel;
    out.lerp(COLORS.sand, smoothstep(wl + 2.2, wl + 0.6, h) * (1 - s.roadMask));
    out.lerp(COLORS.mud, smoothstep(wl + 0.2, wl - 1.5, h));
    out.lerp(COLORS.dirt, smoothstep(0.12, 0.24, slope) * 0.7);
    out.lerp(COLORS.rock, smoothstep(0.26, 0.42, slope));
    out.lerp(COLORS.snow, smoothstep(105, 125, h + n(x * 0.03, z * 0.03) * 10) * (1 - smoothstep(0.5, 0.65, slope)));
    const v = 1 + n(x * 0.006 + 7, z * 0.006) * 0.07;
    out.multiplyScalar(v);
    return out;
  }
}

class TerrainChunk {
  constructor(manager, cx, cz) {
    this.m = manager;
    this.cx = cx;
    this.cz = cz;
    this.x0 = cx * manager.size;
    this.z0 = cz * manager.size;
    this.lod = -1;
    this.mesh = null;
    this.collider = null;
    this.wantCollider = false;
    this.fullHeights = null; // cached at LOD 0 resolution for colliders
    this.ring = 99;
  }

  hasColliderMatch(want) {
    return want === !!this.collider;
  }

  _sampleGrid(segs) {
    const m = this.m;
    const step = m.size / segs;
    const n = segs + 1;
    const heights = new Float32Array(n * n);
    const samples = new Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const s = m.gen.sample(this.x0 + ix * step, this.z0 + iz * step);
        heights[iz * n + ix] = s.height;
        samples[iz * n + ix] = s;
      }
    }
    return { heights, samples, step, n };
  }

  buildMesh(lod) {
    const m = this.m;
    const segs = LOD_SEGMENTS[lod];
    const grid = this._sampleGrid(segs);
    const { heights, samples, step, n } = grid;
    if (lod === 0) this.fullGrid = { heights, step, n }; // kept for the physics collider

    // Vertices: grid + skirt ring.
    const skirtCount = segs * 4;
    const vCount = n * n + skirtCount;
    const pos = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = this.x0 + ix * step;
        const z = this.z0 + iz * step;
        pos[i * 3] = x;
        pos[i * 3 + 1] = heights[i];
        pos[i * 3 + 2] = z;
        uv[i * 2] = x / 6;
        uv[i * 2 + 1] = z / 6;
      }
    }
    const idx = [];
    for (let iz = 0; iz < segs; iz++) {
      for (let ix = 0; ix < segs; ix++) {
        const a = iz * n + ix;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    // Skirt: walk the border, duplicate each vertex lowered by `drop`.
    const border = [];
    for (let i = 0; i < segs; i++) border.push(i); // top edge (iz=0)
    for (let i = 0; i < segs; i++) border.push(segs + i * n); // right edge
    for (let i = 0; i < segs; i++) border.push(n * n - 1 - i); // bottom edge reversed
    for (let i = 0; i < segs; i++) border.push((segs - i) * n); // left edge upward
    const drop = 4 + step * 0.6;
    border.forEach((gi, k) => {
      const si = n * n + k;
      pos[si * 3] = pos[gi * 3];
      pos[si * 3 + 1] = pos[gi * 3 + 1] - drop;
      pos[si * 3 + 2] = pos[gi * 3 + 2];
      uv[si * 2] = uv[gi * 2];
      uv[si * 2 + 1] = uv[gi * 2 + 1];
    });
    for (let k = 0; k < border.length; k++) {
      const g0 = border[k];
      const g1 = border[(k + 1) % border.length];
      const s0 = n * n + k;
      const s1 = n * n + ((k + 1) % border.length);
      idx.push(g0, s0, g1, g1, s0, s1);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setIndex(idx);
    geom.computeVertexNormals();

    // Colours from slope/height/surface data (skirts copy their top vertex).
    const nrm = geom.attributes.normal.array;
    const c = new THREE.Color();
    for (let i = 0; i < n * n; i++) {
      m.terrainColor(pos[i * 3], pos[i * 3 + 2], heights[i], 1 - nrm[i * 3 + 1], samples[i], c);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    border.forEach((gi, k) => {
      const si = n * n + k;
      col[si * 3] = col[gi * 3];
      col[si * 3 + 1] = col[gi * 3 + 1];
      col[si * 3 + 2] = col[gi * 3 + 2];
      nrm[si * 3] = nrm[gi * 3];
      nrm[si * 3 + 1] = nrm[gi * 3 + 1];
      nrm[si * 3 + 2] = nrm[gi * 3 + 2];
    });
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.computeBoundingSphere();

    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geom;
    } else {
      this.mesh = new THREE.Mesh(geom, m.material);
      this.mesh.receiveShadow = true;
      this.mesh.name = `chunk ${this.cx},${this.cz}`;
      m.group.add(this.mesh);
    }
    // Only near chunks cast terrain shadows (mountains self-shadowing would be costly).
    this.mesh.castShadow = false;
    this.lod = lod;
  }

  buildCollider() {
    if (!this.fullGrid) this.fullGrid = this._sampleGrid(LOD_SEGMENTS[0]);
    const { heights, step, n } = this.fullGrid;
    const segs = n - 1;
    const verts = new Float32Array(n * n * 3);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        verts[i * 3] = this.x0 + ix * step;
        verts[i * 3 + 1] = heights[i];
        verts[i * 3 + 2] = this.z0 + iz * step;
      }
    }
    const idx = new Uint32Array(segs * segs * 6);
    let k = 0;
    for (let iz = 0; iz < segs; iz++) {
      for (let ix = 0; ix < segs; ix++) {
        const a = iz * n + ix;
        idx[k++] = a;
        idx[k++] = a + n;
        idx[k++] = a + 1;
        idx[k++] = a + 1;
        idx[k++] = a + n;
        idx[k++] = a + n + 1;
      }
    }
    this.collider = this.m.physics.addStaticTrimesh(verts, idx);
  }

  removeCollider() {
    if (!this.collider) return;
    this.m.physics.world.removeCollider(this.collider, false);
    this.collider = null;
  }

  /** Exact height of the full-resolution surface (what physics uses). */
  heightAt(x, z) {
    if (!this.fullGrid) return null;
    const { heights, step, n } = this.fullGrid;
    const fx = (x - this.x0) / step;
    const fz = (z - this.z0) / step;
    const ix = Math.min(n - 2, Math.max(0, Math.floor(fx)));
    const iz = Math.min(n - 2, Math.max(0, Math.floor(fz)));
    const tx = fx - ix;
    const tz = fz - iz;
    const h00 = heights[iz * n + ix];
    const h10 = heights[iz * n + ix + 1];
    const h01 = heights[(iz + 1) * n + ix];
    const h11 = heights[(iz + 1) * n + ix + 1];
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  dispose() {
    this.removeCollider();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.removeFromParent();
      this.mesh = null;
    }
  }
}
