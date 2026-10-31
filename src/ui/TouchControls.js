/**
 * On-screen touch controls for phones and tablets.
 *  - Left side: floating joystick (appears where the thumb lands).
 *    Push past the run threshold to run.
 *  - Right side: drag to look.
 *  - Action buttons bottom-right: attack, heavy, block (hold), roll, jump,
 *    use/interact; bag button opens the journal.
 * Writes into the shared Input instance; gameplay code never sees touches.
 * On phones/tablets it shows at once; on touch laptops it waits for the first touch.
 */
export class TouchControls {
  constructor(container, input, cfg, { showImmediately = false } = {}) {
    this.input = input;
    this.cfg = cfg;
    this.target = input.element;
    this.visible = false;
    this.movePointer = null;
    this.lookPointer = null;
    this.origin = { x: 0, y: 0 };
    this.lastLook = { x: 0, y: 0 };

    this.root = document.createElement('div');
    this.root.className = 'touch-ui hidden';

    this.idleHint = document.createElement('div');
    this.idleHint.className = 'joystick-idle-hint';
    this.base = document.createElement('div');
    this.base.className = 'joystick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    this.base.appendChild(this.knob);

    this.jumpBtn = document.createElement('button');
    this.jumpBtn.className = 'touch-btn jump';
    this.jumpBtn.type = 'button';
    this.jumpBtn.textContent = 'JUMP';
    this.jumpBtn.setAttribute('aria-label', 'Jump');

    this.root.append(this.idleHint, this.base, this.jumpBtn);
    // Combat & interaction buttons write one-shot actions / held states into Input.
    this._button('atk', 'ATTACK', () => input.queueAction('light'));
    this._button('heavy', 'HEAVY', () => input.queueAction('heavy'));
    this._button('block', 'BLOCK', () => input.setHeld('block', true), () => input.setHeld('block', false));
    this._button('roll', 'ROLL', () => input.queueAction('dodge'));
    this._button('use', 'USE', () => input.queueAction('interact'));
    this._button('bag', 'BAG', () => input.queueAction('journal'));
    container.appendChild(this.root);

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this.target.addEventListener('pointerdown', this._onDown, { passive: false });
    this.target.addEventListener('pointermove', this._onMove, { passive: false });
    this.target.addEventListener('pointerup', this._onUp);
    this.target.addEventListener('pointercancel', this._onUp);

    this.jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.input.queueJump();
      this.jumpBtn.classList.add('pressed');
    });
    const release = () => this.jumpBtn.classList.remove('pressed');
    this.jumpBtn.addEventListener('pointerup', release);
    this.jumpBtn.addEventListener('pointercancel', release);
    this.jumpBtn.addEventListener('pointerleave', release);

    if (showImmediately) this._show();
  }

  _button(cls, label, onDown, onUp) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `touch-btn ${cls}`;
    b.textContent = label;
    b.setAttribute('aria-label', label.toLowerCase());
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.add('pressed');
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onDown();
    });
    const release = () => {
      if (!b.classList.contains('pressed')) return;
      b.classList.remove('pressed');
      onUp?.();
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    this.root.appendChild(b);
    return b;
  }

  _show() {
    if (this.visible) return;
    this.visible = true;
    this.root.classList.remove('hidden');
    this.onFirstTouch?.();
  }

  _onDown(e) {
    if (e.pointerType !== 'touch') return;
    e.preventDefault(); // also suppresses emulated mouse events
    this._show();
    const rect = this.target.getBoundingClientRect();
    const localX = e.clientX - rect.left;

    if (localX < rect.width * 0.45 && this.movePointer === null) {
      this.movePointer = e.pointerId;
      this.origin.x = e.clientX;
      this.origin.y = e.clientY;
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(0px, 0px)';
      this.base.classList.add('active');
      this.idleHint.classList.add('gone');
    } else if (this.lookPointer === null) {
      this.lookPointer = e.pointerId;
      this.lastLook.x = e.clientX;
      this.lastLook.y = e.clientY;
    } else {
      return;
    }
    try {
      this.target.setPointerCapture(e.pointerId);
    } catch {
      /* not critical */
    }
  }

  _onMove(e) {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === this.movePointer) {
      e.preventDefault();
      const R = this.cfg.joystickRadius;
      let dx = e.clientX - this.origin.x;
      let dy = e.clientY - this.origin.y;
      const dist = Math.hypot(dx, dy);
      if (dist > R) {
        dx = (dx / dist) * R;
        dy = (dy / dist) * R;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;

      const mag = Math.min(1, dist / R);
      const dead = this.cfg.joystickDeadZone;
      const runAt = this.cfg.joystickRunThreshold;
      if (mag < dead) {
        this.input.setTouchMove(0, 0, 0, false);
        this.knob.classList.remove('running');
        return;
      }
      const run = mag >= runAt;
      const magnitude = run ? 1 : (mag - dead) / (runAt - dead);
      const len = Math.hypot(dx, dy) || 1;
      // Screen up = forward.
      this.input.setTouchMove(dx / len, -dy / len, Math.max(0.15, magnitude), run);
      this.knob.classList.toggle('running', run);
    } else if (e.pointerId === this.lookPointer) {
      e.preventDefault();
      const s = this.cfg.touchLookSensitivity;
      this.input.addLook((e.clientX - this.lastLook.x) * s, (e.clientY - this.lastLook.y) * s);
      this.lastLook.x = e.clientX;
      this.lastLook.y = e.clientY;
    }
  }

  _onUp(e) {
    if (e.pointerId === this.movePointer) {
      this.movePointer = null;
      this.input.setTouchMove(0, 0, 0, false);
      this.base.classList.remove('active');
      this.knob.classList.remove('running');
    } else if (e.pointerId === this.lookPointer) {
      this.lookPointer = null;
    }
  }

  dispose() {
    this.target.removeEventListener('pointerdown', this._onDown);
    this.target.removeEventListener('pointermove', this._onMove);
    this.target.removeEventListener('pointerup', this._onUp);
    this.target.removeEventListener('pointercancel', this._onUp);
    this.root.remove();
  }
}
