import * as THREE from 'three';

/**
 * Owns the WebGLRenderer: colour management, tone mapping, shadows,
 * pixel-ratio policy and responsive resizing.
 */
export class Renderer {
  constructor(container, quality, { exposure = 0.6 } = {}) {
    this.container = container;
    this.quality = quality;
    this._resizeListeners = [];

    const renderer = new THREE.WebGLRenderer({
      antialias: quality.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.three = renderer;

    this.maxPixelRatio = Math.min(quality.devicePixelRatio, quality.maxPixelRatio);
    this.minPixelRatio = Math.min(this.maxPixelRatio, quality.minPixelRatio);
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);

    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('tabindex', '0');

    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });

    this._onResize = () => this.resize();
    if ('ResizeObserver' in window) {
      this._observer = new ResizeObserver(this._onResize);
      this._observer.observe(container);
    }
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    this.resize();
  }

  get domElement() {
    return this.three.domElement;
  }

  get width() {
    return this._width;
  }

  get height() {
    return this._height;
  }

  onResize(fn) {
    this._resizeListeners.push(fn);
    fn(this._width, this._height);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    if (w === this._width && h === this._height) return;
    this._width = w;
    this._height = h;
    this.three.setSize(w, h, false);
    for (const fn of this._resizeListeners) fn(w, h);
  }

  setPixelRatio(ratio) {
    const clamped = Math.min(this.maxPixelRatio, Math.max(this.minPixelRatio, ratio));
    if (Math.abs(clamped - this.pixelRatio) < 0.01) return;
    this.pixelRatio = clamped;
    this.three.setPixelRatio(clamped);
    this.three.setSize(this._width, this._height, false);
  }

  render(scene, camera) {
    this.three.render(scene, camera);
  }

  dispose() {
    this._observer?.disconnect();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    this.three.dispose();
  }
}
