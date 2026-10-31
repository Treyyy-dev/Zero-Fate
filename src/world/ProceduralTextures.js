import * as THREE from 'three';
import { mulberry32 } from '../utils/noise.js';

/**
 * Small seamless detail textures generated at runtime (no image assets).
 * They modulate vertex/base colours to break up flat surfaces.
 */

function blurWrap(src, size, radius) {
  const tmp = new Float32Array(size * size);
  const out = new Float32Array(size * size);
  const n = radius * 2 + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += src[y * size + ((x + k + size) % size)];
      tmp[y * size + x] = s / n;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += tmp[((y + k + size) % size) * size + x];
      out[y * size + x] = s / n;
    }
  }
  return out;
}

function makeTexture(size, seed, layers, tint) {
  const rand = mulberry32(seed);
  const value = new Float32Array(size * size);
  for (const { radius, weight } of layers) {
    const raw = new Float32Array(size * size);
    for (let i = 0; i < raw.length; i++) raw[i] = rand();
    const b = radius > 0 ? blurWrap(raw, size, radius) : raw;
    // Re-normalise blurred noise to full contrast.
    let min = Infinity;
    let max = -Infinity;
    for (const v of b) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min || 1;
    for (let i = 0; i < value.length; i++) value[i] += ((b[i] - min) / range - 0.5) * weight;
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < value.length; i++) {
    const v = Math.min(1, Math.max(0, 0.86 + value[i]));
    img.data[i * 4] = Math.round(255 * v * tint[0]);
    img.data[i * 4 + 1] = Math.round(255 * v * tint[1]);
    img.data[i * 4 + 2] = Math.round(255 * v * tint[2]);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export function createTextures() {
  return {
    ground: makeTexture(
      256,
      11,
      [
        { radius: 0, weight: 0.16 }, // grain
        { radius: 2, weight: 0.18 }, // clumps
        { radius: 8, weight: 0.14 }, // patches
      ],
      [1, 1, 1],
    ),
    stone: makeTexture(
      256,
      23,
      [
        { radius: 0, weight: 0.1 },
        { radius: 3, weight: 0.2 },
        { radius: 12, weight: 0.22 },
      ],
      [1, 0.98, 0.95],
    ),
    wood: makeTexture(
      128,
      37,
      [
        { radius: 0, weight: 0.12 },
        { radius: 1, weight: 0.12 },
      ],
      [1, 0.96, 0.9],
    ),
  };
}
