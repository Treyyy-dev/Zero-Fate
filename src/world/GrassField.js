import * as THREE from 'three';
import { mulberry32 } from '../utils/noise.js';

/**
 * Instanced grass that only exists near the player.
 *
 * A fixed pool of blades is split into square cells. As the player moves,
 * cells that fall behind are recycled to the new cells ahead, so the cost is
 * constant no matter how big the world is. Blades fade out toward the edge
 * of the radius and sway with the shared wind uniforms.
 */
export class GrassField {
  constructor({ scene, worldGen, quality, uniforms }) {
    this.gen = worldGen;
    this.cellSize = 8;
    this.cellsPerSide = quality.grassCells ?? 11; // odd number
    this.perCell = quality.grassPerCell ?? 180;
    this.half = Math.floor(this.cellsPerSide / 2);
    this.radius = this.half * this.cellSize;
    const total = this.cellsPerSide * this.cellsPerSide * this.perCell;

    // Blade: a tapered, slightly bent strip (5 vertices).
    const g = new THREE.BufferGeometry();
    const w = 0.045;
    const pos = new Float32Array([-w, 0, 0, w, 0, 0, -w * 0.6, 0.45, 0.04, w * 0.6, 0.45, 0.04, 0, 1, 0.14]);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
    g.computeVertexNormals();
    // Point normals upward so blades light like the ground under them.
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0.25);

    this.uniforms = uniforms;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uWind = uniforms.uWind;
      shader.uniforms.uCenter = this.centerUniform = { value: new THREE.Vector3() };
      shader.uniforms.uRadius = { value: this.radius };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform vec3 uCenter;\nuniform float uRadius;\nvarying float vH;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float fade = 1.0 - smoothstep(uRadius * 0.7, uRadius, distance(ip.xz, uCenter.xz));
          transformed *= fade;
          float bend = position.y * position.y;
          float ph = uTime * 2.2 + ip.x * 0.35 + ip.z * 0.27;
          transformed.x += sin(ph) * bend * 0.18 * uWind;
          transformed.z += cos(ph * 0.7) * bend * 0.12 * uWind;
          vH = position.y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(0.38, 0.95, vH);');
    };
    this.mesh = new THREE.InstancedMesh(g, mat, total);
    this.mesh.frustumCulled = false; // follows the player; always around the camera
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'Grass';
    // Per-instance colour (needs an initial write to allocate).
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);

    this.cells = []; // slot → { cx, cz }
    for (let i = 0; i < this.cellsPerSide * this.cellsPerSide; i++) this.cells.push({ cx: null, cz: null });
    this.center = null;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  update(focus, camera) {
    if (this.centerUniform) this.centerUniform.value.copy(camera.position);
    const cx = Math.floor(focus.x / this.cellSize);
    const cz = Math.floor(focus.z / this.cellSize);
    if (this.center && this.center.cx === cx && this.center.cz === cz) return;
    this.center = { cx, cz };

    const wanted = new Set();
    for (let dz = -this.half; dz <= this.half; dz++) for (let dx = -this.half; dx <= this.half; dx++) wanted.add(`${cx + dx},${cz + dz}`);
    const free = [];
    const have = new Set();
    this.cells.forEach((c, slot) => {
      const k = `${c.cx},${c.cz}`;
      if (c.cx !== null && wanted.has(k)) have.add(k);
      else free.push(slot);
    });
    let changed = false;
    for (const k of wanted) {
      if (have.has(k)) continue;
      const slot = free.pop();
      const [x, z] = k.split(',').map(Number);
      this._fillCell(slot, x, z);
      changed = true;
    }
    if (changed) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  _fillCell(slot, cx, cz) {
    this.cells[slot] = { cx, cz };
    const rng = mulberry32((cx * 92837111) ^ (cz * 689287499));
    const start = slot * this.perCell;
    const wl = this.gen.waterLevel;
    for (let i = 0; i < this.perCell; i++) {
      const x = (cx + rng()) * this.cellSize;
      const z = (cz + rng()) * this.cellSize;
      const r1 = rng();
      const r2 = rng();
      const r3 = rng();
      const s = this.gen.sample(x, z);
      const ok = s.height > wl + 0.6 && s.roadMask < 0.3 && s.riverMask === 0 && s.height < 75 && s.poiMask < 0.6 && r1 > s.poiMask;
      if (!ok) {
        this.mesh.setMatrixAt(start + i, this._zero);
        continue;
      }
      this._e.set((r2 - 0.5) * 0.3, r3 * Math.PI * 2, 0);
      this._q.setFromEuler(this._e);
      const h = (0.22 + r1 * 0.38) * (1 - s.forest * 0.35);
      this._p.set(x, s.height - 0.03, z);
      this._s.set(1 + r2 * 0.5, h, 1);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(start + i, this._m);
      const dry = r2 * 0.35 + (s.forest > 0.5 ? -0.15 : 0);
      this._c.setRGB(0.2 + dry * 0.3, 0.36 + dry * 0.1, 0.1 + dry * 0.04);
      // Occasional wildflower tips.
      if (r3 > 0.985) this._c.setRGB(0.9, 0.85, 0.35);
      else if (r3 > 0.975) this._c.setRGB(0.75, 0.45, 0.85);
      this.mesh.setColorAt(start + i, this._c);
    }
  }
}
