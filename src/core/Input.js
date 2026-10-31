import { Emitter } from './Emitter.js';

/**
 * Unified input: keyboard, mouse (pointer lock with drag fallback), wheel,
 * plus a touch channel that src/ui/TouchControls.js writes into.
 *
 * Gameplay code only reads the abstract API:
 *   getMovement(), wantsRun(), consumeJump(), consumeLook(), consumeZoom(), consumeKey()
 */
export class Input extends Emitter {
  constructor(element, cfg) {
    super();
    this.element = element;
    this.cfg = cfg;

    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    this.pointerLocked = false;
    this.mouseDragging = false;
    this.pointerLockSupported = 'requestPointerLock' in element;

    this.touchMove = { x: 0, y: 0, magnitude: 0, run: false };
    this.touchJump = false;
    this.actions = new Set(); // one-shot actions queued by touch buttons / mouse
    this.held = new Set(); // held states from touch buttons (block)
    this.mouseButtons = new Set();
    this.enabled = true;

    this._movement = { x: 0, y: 0, magnitude: 0 };

    this._bind();
  }

  _bind() {
    this._onKeyDown = (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => {
      this.keys.clear();
      this.mouseButtons.clear();
      this.held.clear();
      this.mouseDragging = false;
    };
    document.addEventListener('pointerlockerror', () => (this._lockFailed = true));

    this._onMouseDown = (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      if (e.button === 2) this.mouseButtons.add(2);
      // Left click attacks when the cursor is captured (or pointer lock is unavailable).
      if (e.button === 0 && this.enabled && (this.pointerLocked || !this.pointerLockSupported)) this.actions.add('light');
      if (e.button === 0) {
        this._clickStart = { x: e.clientX, y: e.clientY, t: performance.now(), locked: this.pointerLocked };
      }
      this.mouseDragging = true;
      this.element.focus?.({ preventScroll: true });
      this.emit('activate');
      if (this.pointerLockSupported && !this.pointerLocked && e.button === 0) {
        try {
          const result = this.element.requestPointerLock();
          // Some browsers return a promise; embedded frames may reject it.
          if (result && typeof result.catch === 'function') result.catch(() => (this._lockFailed = true));
        } catch {
          /* drag-to-look fallback stays active */
        }
      }
    };
    this._onMouseUp = (e) => {
      this.mouseDragging = false;
      if (e && e.button === 2) this.mouseButtons.delete(2);
      // Without pointer lock (embedded views), a short click without dragging attacks.
      const c = this._clickStart;
      if (e && e.button === 0 && c && !c.locked && this.pointerLockSupported && !this.pointerLocked && this._lockFailed) {
        if (Math.hypot(e.clientX - c.x, e.clientY - c.y) < 6 && performance.now() - c.t < 300) this.actions.add('light');
      }
      this._clickStart = null;
    };
    this._onMouseMove = (e) => {
      if (!this.pointerLocked && !this.mouseDragging) return;
      // Guard against occasional huge spikes some browsers emit on lock.
      const dx = Math.max(-200, Math.min(200, e.movementX || 0));
      const dy = Math.max(-200, Math.min(200, e.movementY || 0));
      this.lookX += dx * this.cfg.mouseSensitivity;
      this.lookY += dy * this.cfg.mouseSensitivity;
    };
    this._onWheel = (e) => {
      e.preventDefault();
      this.zoom += Math.sign(e.deltaY);
    };
    this._onLockChange = () => {
      const locked = document.pointerLockElement === this.element;
      if (locked !== this.pointerLocked) {
        this.pointerLocked = locked;
        this.emit('lockchange', locked);
      }
    };
    this._onContextMenu = (e) => e.preventDefault();

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    this.element.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMouseMove);
    this.element.addEventListener('wheel', this._onWheel, { passive: false });
    this.element.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  /* ---------- touch channel (written by TouchControls) ---------- */

  setTouchMove(x, y, magnitude, run) {
    this.touchMove.x = x;
    this.touchMove.y = y;
    this.touchMove.magnitude = magnitude;
    this.touchMove.run = run;
  }

  addLook(dx, dy) {
    this.lookX += dx;
    this.lookY += dy;
  }

  queueJump() {
    this.touchJump = true;
  }

  queueAction(name) {
    this.actions.add(name);
  }

  setHeld(name, on) {
    if (on) this.held.add(name);
    else this.held.delete(name);
  }

  /** One-shot action (light, heavy, dodge, interact, journal) or matching key press. */
  consumeAction(name) {
    return this.actions.has(name);
  }

  isBlocking() {
    return this.mouseButtons.has(2) || this.held.has('block') || this.keys.has('KeyQ');
  }

  /* ---------- gameplay API ---------- */

  isDown(code) {
    return this.keys.has(code);
  }

  /** Camera-space movement intent: x = right, y = forward, magnitude 0..1. */
  getMovement() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const m = this._movement;

    if (x !== 0 || y !== 0) {
      const len = Math.hypot(x, y);
      m.x = x / len;
      m.y = y / len;
      m.magnitude = 1;
    } else if (this.touchMove.magnitude > 0) {
      m.x = this.touchMove.x;
      m.y = this.touchMove.y;
      m.magnitude = this.touchMove.magnitude;
    } else {
      m.x = 0;
      m.y = 0;
      m.magnitude = 0;
    }
    return m;
  }

  wantsRun() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.touchMove.run;
  }

  consumeJump() {
    const jump = this.pressed.has('Space') || this.touchJump;
    this.touchJump = false;
    return jump;
  }

  consumeKey(code) {
    return this.pressed.has(code);
  }

  consumeLook() {
    const look = { dx: this.lookX, dy: this.lookY };
    this.lookX = 0;
    this.lookY = 0;
    return look;
  }

  consumeZoom() {
    const z = this.zoom;
    this.zoom = 0;
    return z;
  }

  /** Call once at the end of every rendered frame. */
  endFrame() {
    this.pressed.clear();
    this.actions.clear();
  }

  /** Clears held/queued input (e.g. when a menu opens). */
  reset() {
    this.keys.clear();
    this.pressed.clear();
    this.actions.clear();
    this.held.clear();
    this.mouseButtons.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.setTouchMove(0, 0, 0, false);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.element.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.element.removeEventListener('wheel', this._onWheel);
    this.element.removeEventListener('contextmenu', this._onContextMenu);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}
