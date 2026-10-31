import * as THREE from 'three';
import { mulberry32 } from '../utils/noise.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();

/**
 * Phase 1 movement test course on the spawn plateau (all at ground height 0).
 * Every piece has a matching physics collider. Layout, looking from spawn (−Z):
 *
 *   • Step blocks 0.2 / 0.35 m (walk up), 0.7 m (jump up), 1.2 m (blocked)
 *   • Stairs (0.25 m rise) to a 2 m platform
 *   • 20° ramp (climbable) to a platform, 58° ramp (too steep)
 *   • Long wall (collision + camera collision)
 *   • Ruined pillar ring with a fallen column
 *   • Pushable crates
 *   • Rocks scattered across the surrounding hills (instanced, convex colliders)
 */
export class TestGrounds {
  constructor({ scene, physics, terrain, textures, quality }) {
    this.scene = scene;
    this.physics = physics;
    this.group = new THREE.Group();
    this.group.name = 'TestGrounds';
    scene.add(this.group);

    this.stoneMat = new THREE.MeshStandardMaterial({ color: 0x9b958a, map: textures.stone, roughness: 0.92 });
    this.darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x7d776d, map: textures.stone, roughness: 0.95 });
    this.woodMat = new THREE.MeshStandardMaterial({ color: 0x8a5f36, map: textures.wood, roughness: 0.85 });
    this.rockMat = new THREE.MeshStandardMaterial({ color: 0x86827a, map: textures.stone, roughness: 0.97, flatShading: true });

    this._buildStepBlocks();
    this._buildStairs(7, 0);
    this._buildRamp(-11, 0, 20, 8, 3, true);
    this._buildRamp(-16.5, 0, 58, 5, 2.5, false);
    this._box([9, 3, 0.6], [0, 1.5, -16]); // wall
    this._buildPillarRing(-13, 9, 5);
    this._buildCrates(5.5, 3.5);
    this._buildRocks(terrain, quality.rockCount);
  }

  /** Static box with a matching cuboid collider. size = [w,h,d], pos = centre. */
  _box(size, pos, { rotX = 0, rotY = 0, material = this.stoneMat } = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rotX, rotY, 0, 'YXZ');
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.physics.addStaticCuboid(
      { x: size[0] / 2, y: size[1] / 2, z: size[2] / 2 },
      mesh.position,
      mesh.quaternion,
    );
    return mesh;
  }

  _buildStepBlocks() {
    const heights = [0.2, 0.35, 0.7, 1.2];
    heights.forEach((h, i) => {
      const x = -4.5 + i * 3;
      this._box([1.8, h, 1.8], [x, h / 2, -5], { material: i % 2 ? this.darkStoneMat : this.stoneMat });
    });
  }

  /** Stairs rising toward −Z starting at (x, z0). */
  _buildStairs(x, z0) {
    const rise = 0.25;
    const run = 0.45;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
      const h = (i + 1) * rise;
      this._box([2.4, h, run], [x, h / 2, z0 - i * run - run / 2], {
        material: i % 2 ? this.darkStoneMat : this.stoneMat,
      });
    }
    const top = steps * rise;
    this._box([3.2, top, 3.2], [x, top / 2, z0 - steps * run - 1.6]);
  }

  /** Ramp rising toward −Z, its low edge at (x, z0). */
  _buildRamp(x, z0, angleDeg, length, width, withPlatform) {
    const a = THREE.MathUtils.degToRad(angleDeg);
    const t = 0.4;
    const cy = (length / 2) * Math.sin(a) - (t / 2) * Math.cos(a) - 0.02;
    const cz = z0 - (length / 2) * Math.cos(a);
    this._box([width, t, length], [x, cy, cz], { rotX: a, material: this.darkStoneMat });
    if (withPlatform) {
      const top = length * Math.sin(a);
      this._box([width, top, 3], [x, top / 2, z0 - length * Math.cos(a) - 1.5]);
    }
  }

  _buildPillarRing(cx, cz, radius) {
    const rand = mulberry32(7);
    const count = 8;
    for (let i = 0; i < count; i++) {
      if (i === 5) continue; // gap where the fallen column lies
      const ang = (i / count) * Math.PI * 2;
      const h = 1.4 + rand() * 3.2;
      const x = cx + Math.cos(ang) * radius;
      const z = cz + Math.sin(ang) * radius;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, h, 14), this.stoneMat);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.physics.addStaticCylinder(h / 2, 0.48, mesh.position);
      // capital stone
      const cap = this._box([1.15, 0.25, 1.15], [x, h + 0.125, z], { rotY: rand() * 0.3 });
      cap.material = this.darkStoneMat;
    }
    // Fallen column lying on its side.
    const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 3.6, 14), this.stoneMat);
    const ang = (5 / count) * Math.PI * 2;
    fallen.position.set(cx + Math.cos(ang) * (radius + 1.2), 0.45, cz + Math.sin(ang) * (radius + 1.2));
    fallen.rotation.set(0, ang + 0.4, Math.PI / 2, 'YXZ');
    fallen.castShadow = true;
    fallen.receiveShadow = true;
    this.group.add(fallen);
    this.physics.addStaticCylinder(1.8, 0.45, fallen.position, fallen.quaternion);
    // Flagstone floor (visual, flush with ground).
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.8, radius + 0.8, 0.06, 32), this.darkStoneMat);
    floor.position.set(cx, 0.02, cz);
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  _buildCrates(x, z) {
    const size = 0.8;
    const geom = new THREE.BoxGeometry(size, size, size);
    const half = { x: size / 2, y: size / 2, z: size / 2 };
    const spots = [
      [0, 0, 0], [0.85, 0, 0], [1.7, 0, 0], [0.42, 1, 0], [1.27, 1, 0], [0.85, 2, 0],
    ];
    for (const [ox, level, oz] of spots) {
      const mesh = new THREE.Mesh(geom, this.woodMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(x + ox, size / 2 + level * (size + 0.01), z + oz);
      this.group.add(mesh);
      this.physics.addDynamicCuboid(mesh, half, mesh.position, { density: 45 });
    }
  }

  /** Instanced rocks on the hills, each with a convex-hull collider. */
  _buildRocks(terrain, count) {
    const variants = [0, 1, 2].map((v) => this._rockGeometry(v));
    const perVariant = Math.ceil(count / variants.length);
    const rand = mulberry32(4242);

    variants.forEach((geom, vi) => {
      const mesh = new THREE.InstancedMesh(geom, this.rockMat, perVariant);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const src = geom.attributes.position.array;

      for (let i = 0; i < perVariant; i++) {
        let x;
        let z;
        let tries = 0;
        do {
          const ang = rand() * Math.PI * 2;
          const r = 34 + rand() * 120;
          x = Math.cos(ang) * r;
          z = Math.sin(ang) * r;
          tries++;
          // keep the path ahead of spawn, roads, water and building sites clear
        } while (tries < 30 && ((Math.abs(x) < 20 && z < 0) || (terrain.isClear && !terrain.isClear(x, z))));

        const scale = 0.5 + Math.pow(rand(), 2) * 2.4;
        _s.set(scale * (0.9 + rand() * 0.4), scale * (0.7 + rand() * 0.4), scale * (0.9 + rand() * 0.4));
        _e.set(0, rand() * Math.PI * 2, (rand() - 0.5) * 0.3);
        _q.setFromEuler(_e);
        _p.set(x, terrain.getHeightAt(x, z) - _s.y * 0.25, z);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);

        // Collider uses the same transformed vertices (relative to _p).
        const pts = new Float32Array(src.length);
        for (let j = 0; j < src.length; j += 3) {
          _v.set(src[j] * _s.x, src[j + 1] * _s.y, src[j + 2] * _s.z).applyQuaternion(_q);
          pts[j] = _v.x;
          pts[j + 1] = _v.y;
          pts[j + 2] = _v.z;
        }
        this.physics.addStaticConvexHull(pts, _p);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.name = `Rocks_${vi}`;
      this.group.add(mesh);
    });
  }

  _rockGeometry(variant) {
    const geom = new THREE.IcosahedronGeometry(1, 1); // non-indexed → faceted
    const pos = geom.attributes.position;
    const seed = variant * 13.7;
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i);
      // Displacement depends only on direction, so shared corners stay welded.
      const d =
        1 +
        0.22 * Math.sin(_v.x * 3.1 + seed) * Math.cos(_v.z * 2.7 - seed) +
        0.12 * Math.sin(_v.y * 5.3 + seed * 2);
      _v.multiplyScalar(d);
      if (_v.y < -0.35) _v.y = -0.35 + (_v.y + 0.35) * 0.3; // flattened base
      pos.setXYZ(i, _v.x, _v.y, _v.z);
    }
    geom.computeVertexNormals();
    return geom;
  }

  update() {
    this.physics.syncDynamic();
  }
}
