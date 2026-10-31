import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../utils/noise.js';

/**
 * Forests, bushes and boulders, streamed per terrain chunk with GPU
 * instancing (one InstancedMesh per species per chunk, frustum-culled per
 * chunk). Near chunks use detailed models, farther chunks low-poly ones;
 * nothing is drawn beyond the vegetation ring. Tree trunks and boulders get
 * physics colliders only in chunks that have terrain collision.
 *
 * Foliage sways in the wind via a small vertex-shader patch.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

function colorize(geom, hex, jitter = 0, rng = Math.random) {
  geom.deleteAttribute('uv');
  const g = geom.index ? geom.toNonIndexed() : geom;
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const base = new THREE.Color(hex);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (rng() - 0.5) * jitter;
    for (let j = 0; j < 3 && i + j < n; j++) {
      arr[(i + j) * 3] = base.r * k;
      arr[(i + j) * 3 + 1] = base.g * k;
      arr[(i + j) * 3 + 2] = base.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function jitterVerts(geom, amount, rng) {
  const p = geom.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let off = seen.get(key);
    if (!off) {
      off = [(rng() - 0.5) * amount, (rng() - 0.5) * amount, (rng() - 0.5) * amount];
      seen.set(key, off);
    }
    p.setXYZ(i, p.getX(i) + off[0], p.getY(i) + off[1], p.getZ(i) + off[2]);
  }
  geom.computeVertexNormals();
  return geom;
}

/** Builds species geometries (high + low detail). Heights are ~1 unit, scaled per instance. */
function buildSpecies() {
  const rng = mulberry32(99);
  const pineHigh = (() => {
    const parts = [colorize(new THREE.CylinderGeometry(0.035, 0.06, 0.35, 6).translate(0, 0.175, 0), 0x4a3424)];
    const layers = 5;
    for (let i = 0; i < layers; i++) {
      const r = 0.36 - i * 0.06;
      const cone = new THREE.ConeGeometry(r, 0.34, 8, 1);
      cone.translate(0, 0.3 + i * 0.15, 0);
      parts.push(colorize(jitterVerts(cone, 0.03, rng), i % 2 ? 0x2c4a28 : 0x325530, 0.18, rng));
    }
    return mergeGeometries(parts);
  })();
  const pineLow = mergeGeometries([
    colorize(new THREE.CylinderGeometry(0.04, 0.06, 0.3, 4).translate(0, 0.15, 0), 0x4a3424),
    colorize(new THREE.ConeGeometry(0.34, 0.95, 5).translate(0, 0.62, 0), 0x2f5030),
  ]);
  const oakHigh = (() => {
    const parts = [colorize(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 7).translate(0, 0.25, 0), 0x5a4030)];
    const blobs = [[0, 0.62, 0, 0.3], [0.17, 0.55, 0.06, 0.22], [-0.16, 0.57, -0.05, 0.22], [0.04, 0.78, -0.12, 0.2], [-0.05, 0.74, 0.15, 0.2]];
    for (const [x, y, z, r] of blobs) {
      const s = new THREE.IcosahedronGeometry(r, 1);
      s.translate(x, y, z);
      parts.push(colorize(jitterVerts(s, 0.05, rng), 0x46702e, 0.25, rng));
    }
    return mergeGeometries(parts);
  })();
  const oakLow = mergeGeometries([
    colorize(new THREE.CylinderGeometry(0.05, 0.08, 0.45, 4).translate(0, 0.22, 0), 0x5a4030),
    colorize(new THREE.IcosahedronGeometry(0.36, 0).translate(0, 0.65, 0), 0x46702e),
  ]);
  const bush = mergeGeometries([0, 1, 2].map((i) => {
    const s = new THREE.IcosahedronGeometry(0.32 - i * 0.05, 1);
    s.translate((i - 1) * 0.18, 0.22 + (i % 2) * 0.05, (i % 2) * 0.1);
    return colorize(jitterVerts(s, 0.06, rng), 0x3f6a2a, 0.3, rng);
  }));
  const rock = (() => {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _p.fromBufferAttribute(p, i);
      const d = 1 + 0.2 * Math.sin(_p.x * 5.1) * Math.cos(_p.z * 4.3) + 0.1 * Math.sin(_p.y * 7);
      _p.multiplyScalar(d);
      if (_p.y < -0.15) _p.y = -0.15 + (_p.y + 0.15) * 0.3;
      p.setXYZ(i, _p.x, _p.y, _p.z);
    }
    g.computeVertexNormals();
    return colorize(g, 0x86827a, 0.12, rng);
  })();
  return {
    pine: { high: pineHigh, low: pineLow, trunkRadius: 0.05, sway: 1 },
    oak: { high: oakHigh, low: oakLow, trunkRadius: 0.07, sway: 0.8 },
    bush: { high: bush, low: bush, trunkRadius: 0, sway: 1.4 },
    rock: { high: rock, low: rock, trunkRadius: 0, sway: 0, rock: true },
  };
}

function windMaterial(base, uniforms) {
  base.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float h = max(0.0, position.y - 0.25);
          float phase = uTime * 1.7 + ip.x * 0.13 + ip.z * 0.11;
          transformed.x += sin(phase) * h * 0.06 * uWind;
          transformed.z += cos(phase * 0.8) * h * 0.04 * uWind;
        #endif`,
      );
  };
  return base;
}

export class Vegetation {
  constructor({ scene, physics, worldGen, chunks, quality, uniforms }) {
    this.scene = scene;
    this.physics = physics;
    this.gen = worldGen;
    this.chunks = chunks;
    this.ring = quality.vegetationRing ?? 3;
    this.density = quality.treeDensity ?? 1;
    this.species = buildSpecies();
    this.uniforms = uniforms;
    this.material = windMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), uniforms);
    this.rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    this.byChunk = new Map(); // key → { meshes, instances, colliders, detail }

    chunks.on('chunkReady', (c) => this._onChunk(c));
    chunks.on('ringChange', (c) => this._onChunk(c));
    chunks.on('chunkUnload', (c) => this._remove(c));
    chunks.on('colliderReady', (c) => this._addColliders(c));
    chunks.on('colliderUnload', (c) => this._removeColliders(c));
  }

  /** Deterministic instance list for a chunk. */
  _instances(chunk) {
    const rng = mulberry32((chunk.cx * 73856093) ^ (chunk.cz * 19349663));
    const size = this.chunks.size;
    const list = [];
    const attempts = Math.round(260 * this.density);
    for (let i = 0; i < attempts; i++) {
      const x = chunk.x0 + rng() * size;
      const z = chunk.z0 + rng() * size;
      const s = this.gen.sample(x, z);
      const r = rng();
      if (s.height < this.gen.waterLevel + 1) continue;
      if (s.roadMask > 0.1 || s.poiMask > 0.2 || s.riverMask > 0) continue;
      let type = null;
      if (r < s.forest * 0.95) type = rng() < 0.55 ? 'pine' : 'oak';
      else if (r < s.forest * 0.95 + 0.06) type = 'bush';
      else if (r < s.forest * 0.95 + 0.085) type = 'rock';
      if (!type) continue;
      // Slope check with two extra samples.
      const hx = this.gen.heightAt(x + 1.5, z);
      const hz = this.gen.heightAt(x, z + 1.5);
      const slope = Math.max(Math.abs(hx - s.height), Math.abs(hz - s.height)) / 1.5;
      if (type !== 'rock' && slope > 0.8) continue;
      let scale;
      if (type === 'pine') scale = 9 + rng() * 9;
      else if (type === 'oak') scale = 7 + rng() * 6;
      else if (type === 'bush') scale = 1.2 + rng() * 1.2;
      else scale = 0.8 + Math.pow(rng(), 2) * 3.5;
      list.push({ type, x, z, y: s.height - (type === 'rock' ? scale * 0.15 : 0.1), scale, rot: rng() * Math.PI * 2, lean: (rng() - 0.5) * 0.08 });
    }
    return list;
  }

  _onChunk(chunk) {
    const key = `${chunk.cx},${chunk.cz}`;
    const wantDetail = chunk.ring <= 1 ? 'high' : chunk.ring <= this.ring ? 'low' : null;
    const existing = this.byChunk.get(key);
    if (existing && existing.detail === wantDetail) return;
    this._removeMeshes(existing);
    if (!wantDetail) {
      if (existing) existing.meshes = [];
      return;
    }
    const entry = existing ?? { instances: this._instances(chunk), colliders: [], meshes: [] };
    entry.detail = wantDetail;
    const groups = {};
    for (const inst of entry.instances) (groups[inst.type] ??= []).push(inst);
    for (const [type, list] of Object.entries(groups)) {
      const sp = this.species[type];
      const mesh = new THREE.InstancedMesh(sp[wantDetail], sp.rock ? this.rockMaterial : this.material, list.length);
      list.forEach((inst, i) => {
        _e.set(inst.lean, inst.rot, inst.lean * 0.7);
        _q.setFromEuler(_e);
        _p.set(inst.x, inst.y, inst.z);
        _s.setScalar(inst.scale);
        if (sp.rock) _s.set(inst.scale * 1.2, inst.scale * 0.8, inst.scale);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = wantDetail === 'high' || type !== 'bush';
      mesh.receiveShadow = true;
      mesh.name = `veg_${type}_${key}`;
      this.scene.add(mesh);
      entry.meshes.push(mesh);
    }
    this.byChunk.set(key, entry);
  }

  _addColliders(chunk) {
    const key = `${chunk.cx},${chunk.cz}`;
    let entry = this.byChunk.get(key);
    if (!entry) {
      entry = { instances: this._instances(chunk), colliders: [], meshes: [], detail: null };
      this.byChunk.set(key, entry);
    }
    if (entry.colliders.length) return;
    for (const inst of entry.instances) {
      const sp = this.species[inst.type];
      if (sp.rock) {
        const r = inst.scale * 0.45;
        const c = this.physics.addStaticCuboid({ x: r * 1.1, y: r * 0.55, z: r }, { x: inst.x, y: inst.y + r * 0.35, z: inst.z }, null);
        entry.colliders.push(c);
      } else if (sp.trunkRadius > 0) {
        const r = Math.max(0.2, sp.trunkRadius * inst.scale);
        const h = 2.5;
        entry.colliders.push(this.physics.addStaticCylinder(h / 2, r, { x: inst.x, y: inst.y + h / 2, z: inst.z }));
      }
    }
  }

  _removeColliders(chunk) {
    const entry = this.byChunk.get(`${chunk.cx},${chunk.cz}`);
    if (!entry) return;
    for (const c of entry.colliders) this.physics.world.removeCollider(c, false);
    entry.colliders = [];
  }

  _removeMeshes(entry) {
    if (!entry) return;
    for (const m of entry.meshes) {
      m.removeFromParent();
      m.dispose();
    }
    entry.meshes = [];
  }

  _remove(chunk) {
    const key = `${chunk.cx},${chunk.cz}`;
    const entry = this.byChunk.get(key);
    if (!entry) return;
    this._removeMeshes(entry);
    this._removeColliders(chunk);
    this.byChunk.delete(key);
  }

  get instanceCount() {
    let n = 0;
    for (const e of this.byChunk.values()) for (const m of e.meshes) n += m.count;
    return n;
  }
}

