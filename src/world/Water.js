import * as THREE from 'three';
import { mulberry32 } from '../utils/noise.js';

/**
 * One water surface at sea level that follows the camera. Wherever the
 * terrain dips below it (the lake, the river channel, ponds) you see water.
 * PBR material: reflections come from the sky environment map; two scrolling
 * procedural normal layers make it ripple.
 */
function makeNormalMap(size = 256, seed = 5) {
  const rng = mulberry32(seed);
  const h = new Float32Array(size * size);
  // Sum of random periodic waves → seamless height field.
  for (let k = 0; k < 24; k++) {
    const fx = Math.round((rng() - 0.5) * 12) || 1;
    const fy = Math.round((rng() - 0.5) * 12);
    const ph = rng() * Math.PI * 2;
    const a = 1 / (1 + Math.hypot(fx, fy));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        h[y * size + x] += a * Math.sin(((fx * x + fy * y) / size) * Math.PI * 2 + ph);
      }
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      const nx = (l - r) * 1.6;
      const ny = (u - d) * 1.6;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export class Water {
  constructor({ scene, level, uniforms, size = 1600 }) {
    this.level = level;
    this.size = size;
    this.uniforms = uniforms;
    const normalMap = makeNormalMap();
    normalMap.repeat.set(size / 14, size / 14);
    this.material = new THREE.MeshStandardMaterial({
      color: 0x1d4a5a,
      roughness: 0.08,
      metalness: 0.0,
      normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true,
      opacity: 0.86,
      envMapIntensity: 1.2,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <normal_fragment_maps>',
          `vec3 mapN = texture2D( normalMap, vNormalMapUv + vec2(uTime * 0.012, uTime * 0.007) ).xyz * 2.0 - 1.0;
           vec3 mapN2 = texture2D( normalMap, vNormalMapUv * 0.37 - vec2(uTime * 0.006, -uTime * 0.01) ).xyz * 2.0 - 1.0;
           mapN = normalize(vec3((mapN.xy + mapN2.xy) * normalScale, mapN.z * mapN2.z));
           normal = normalize( tbn * mapN );`,
        );
    };
    const geom = new THREE.PlaneGeometry(size, size, 1, 1);
    geom.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.position.y = level;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'Water';
    scene.add(this.mesh);
  }

  update(camera) {
    // Follow the camera in whole texture tiles so the ripples don't slide.
    const tile = 14;
    this.mesh.position.x = Math.round(camera.position.x / tile) * tile;
    this.mesh.position.z = Math.round(camera.position.z / tile) * tile;
  }
}
