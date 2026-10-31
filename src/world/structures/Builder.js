import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Accumulates procedural geometry by material and physics colliders for one
 * structure group, then merges everything into a handful of meshes (one draw
 * call per material per site).
 *
 * All coordinates passed in are LOCAL to the builder's origin (a world
 * position + Y rotation), so a house can be placed anywhere at any angle.
 */
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Builder {
  constructor(origin = new THREE.Vector3(), rotY = 0) {
    this.parts = {};
    this.colliders = [];
    this.setFrame(origin, rotY);
  }

  /** Changes the local frame for subsequent parts (e.g. per house). */
  setFrame(origin, rotY = 0) {
    this.origin = origin.clone();
    this.rotY = rotY;
    this.frame = new THREE.Matrix4().compose(this.origin, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1));
    return this;
  }

  /** Adds a geometry (local space) with a colour to a material bucket. */
  add(material, geom, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
    _m2.multiplyMatrices(this.frame, _m);
    geom.applyMatrix4(_m2);
    let g = geom.index ? geom.toNonIndexed() : geom;
    if (g !== geom) geom.dispose();
    const keep = material === 'stone' || material === 'wood' || material === 'plaster' || material === 'rock';
    if (!keep) g.deleteAttribute('uv');
    else if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    // World-space triplanar-ish UVs for textured materials so tiling is consistent.
    if (keep) this._worldUV(g);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (this.parts[material] ??= []).push(g);
    return g;
  }

  _worldUV(g) {
    const p = g.attributes.position;
    const nrm = g.attributes.normal;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(nrm.getX(i));
      const ay = Math.abs(nrm.getY(i));
      const az = Math.abs(nrm.getZ(i));
      const s = 0.4;
      if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) * s, p.getZ(i) * s);
      else if (ax >= az) uv.setXY(i, p.getZ(i) * s, p.getY(i) * s);
      else uv.setXY(i, p.getX(i) * s, p.getY(i) * s);
    }
  }

  /** Box centred at (x, y, z) local; `collide` adds a matching cuboid collider. */
  box(material, w, h, d, x, y, z, color, { ry = 0, rx = 0, rz = 0, collide = false } = {}) {
    this.add(material, new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
    if (collide) this.collideBox(w, h, d, x, y, z, ry, rx, rz);
  }

  cyl(material, rt, rb, h, x, y, z, color, { seg = 12, collide = false, rx = 0, rz = 0, ry = 0 } = {}) {
    this.add(material, new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz);
    if (collide) this.colliders.push({ type: 'cylinder', halfHeight: h / 2, radius: Math.max(rt, rb), ...this._world(x, y, z, ry, rx, rz) });
  }

  cone(material, r, h, x, y, z, color, { seg = 12, ry = 0 } = {}) {
    this.add(material, new THREE.ConeGeometry(r, h, seg), color, x, y, z, 0, ry, 0);
  }

  /** Triangular prism (gable end / tent / roof ridge): base width w, height h, depth d along local Z. */
  prism(material, w, h, d, x, y, z, color, { ry = 0 } = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    this.add(material, g, color, x, y, z, 0, ry, 0);
  }

  collideBox(w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) {
    this.colliders.push({ type: 'cuboid', half: { x: w / 2, y: h / 2, z: d / 2 }, ...this._world(x, y, z, ry, rx, rz) });
  }

  _world(x, y, z, ry, rx = 0, rz = 0) {
    const pos = new THREE.Vector3(x, y, z).applyMatrix4(this.frame);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rotY);
    const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    q.multiply(local);
    return { position: pos, quaternion: q };
  }

  /** Converts a local point to world space. */
  toWorld(x, y, z) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.frame);
  }

  /** Merges parts into meshes and creates colliders. Returns { group, colliders }. */
  finish(materials, physics, { castShadow = true } = {}) {
    const group = new THREE.Group();
    for (const [name, list] of Object.entries(this.parts)) {
      if (!list.length) continue;
      const merged = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[name] ?? materials.plain);
      mesh.castShadow = castShadow && name !== 'window' && name !== 'glow';
      mesh.receiveShadow = true;
      mesh.name = name;
      group.add(mesh);
    }
    const colliders = [];
    for (const c of this.colliders) {
      if (c.type === 'cuboid') colliders.push(physics.addStaticCuboid(c.half, c.position, c.quaternion));
      else if (c.type === 'cylinder') colliders.push(physics.addStaticCylinder(c.halfHeight, c.radius, c.position, c.quaternion));
      else if (c.type === 'trimesh') colliders.push(physics.addStaticTrimesh(c.vertices, c.indices));
    }
    return { group, colliders };
  }
}

/** Shared structure materials (vertex colours modulate them). */
export function createStructureMaterials(textures) {
  return {
    stone: new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.stone, roughness: 0.92 }),
    rock: new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.stone, roughness: 0.96, flatShading: true, side: THREE.DoubleSide }),
    plaster: new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.ground, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ vertexColors: true, map: textures.wood, roughness: 0.85 }),
    plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.8 }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
    window: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0xffb45a, emissiveIntensity: 0 }),
    glow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xff7a24, emissiveIntensity: 2.2 }),
  };
}
