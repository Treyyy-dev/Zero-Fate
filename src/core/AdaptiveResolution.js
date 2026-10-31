/**
 * Keeps the frame rate smooth by lowering the render resolution when the GPU
 * struggles and raising it again when there is headroom.
 */
export class AdaptiveResolution {
  constructor(renderer, { lowFps = 48, highFps = 57, window = 1.5, warmup = 3 } = {}) {
    this.renderer = renderer;
    this.lowFps = lowFps;
    this.highFps = highFps;
    this.window = window;
    this.warmup = warmup; // ignore shader-compile hitches at startup
    this.raiseCooldown = 0;
    this._time = 0;
    this._frames = 0;
    this.fps = 60;
  }

  update(dt) {
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this._time += dt;
    this._frames += 1;
    this.raiseCooldown = Math.max(0, this.raiseCooldown - dt);
    if (this._time < this.window) return;

    this.fps = this._frames / this._time;
    this._time = 0;
    this._frames = 0;

    const r = this.renderer;
    if (this.fps < this.lowFps && r.pixelRatio > r.minPixelRatio) {
      r.setPixelRatio(r.pixelRatio - 0.15);
      this.raiseCooldown = 6;
    } else if (this.fps > this.highFps && r.pixelRatio < r.maxPixelRatio && this.raiseCooldown === 0) {
      r.setPixelRatio(r.pixelRatio + 0.1);
    }
  }
}
