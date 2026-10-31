/**
 * Developer overlay: FPS, player state, physics/render stats and the result
 * of the built-in movement self-test.
 *
 * Modes cycle with F3 (desktop) or the "i" button (touch):
 *   compact → full → hidden → compact
 * Phones start in compact mode (FPS + self-test only), desktop starts full.
 */
const MODES = ['compact', 'full', 'hidden'];

export class DebugOverlay {
  constructor(container, { touch = false } = {}) {
    this.el = document.createElement('pre');
    this.el.id = 'debug-panel';
    container.appendChild(this.el);
    this.mode = touch ? 'compact' : 'full';
    this._timer = 0;
    this._frames = 0;
    this._elapsed = 0;
    this._last = null;
    this.fps = 0;
    this.selfTestLine = 'Self-test: not run';
    this.selfTestClass = '';
    this.failures = [];

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.cycle();
      }
    });

    if (touch) {
      this.button = document.createElement('button');
      this.button.id = 'debug-toggle';
      this.button.type = 'button';
      this.button.textContent = 'i';
      this.button.setAttribute('aria-label', 'Cycle debug info');
      this.button.addEventListener('click', () => this.cycle());
      container.appendChild(this.button);
    }
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.el.classList.toggle('hidden', this.mode === 'hidden');
    if (this._last) this._render(this._last);
  }

  setSelfTest(report) {
    if (!report) return;
    const ok = report.passed === report.total;
    this.selfTestLine = `Self-test ${report.passed}/${report.total} ${ok ? '✓ passed' : '✗ FAILED'}`;
    this.selfTestClass = ok ? 'ok' : 'fail';
    this.failures = report.results.filter((r) => !r.pass).map((r) => `  ✗ ${r.name}: ${r.detail}`);
  }

  update(dt, stats) {
    this._frames += 1;
    this._elapsed += dt;
    this._timer += dt;
    if (this._timer < 0.25) return;
    this.fps = this._frames / this._elapsed;
    this._frames = 0;
    this._elapsed = 0;
    this._timer = 0;
    this._last = stats;
    if (this.mode !== 'hidden') this._render(stats);
  }

  _render(s) {
    const p = s.position;
    const lines =
      this.mode === 'compact'
        ? [`FPS ${this.fps.toFixed(0)} · ${s.state} · ${s.speed.toFixed(1)} m/s`]
        : [
            `FPS ${this.fps.toFixed(0).padStart(3)}   res ×${s.pixelRatio.toFixed(2)}`,
            `state ${s.state.padEnd(5)}  ${s.grounded ? 'grounded' : 'airborne'}`,
            `speed ${s.speed.toFixed(2)} m/s`,
            `pos ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`,
            `draw calls ${s.calls}  tris ${(s.triangles / 1000).toFixed(0)}k`,
          ];
    const details = this.mode === 'full' && this.failures.length ? `\n${this.failures.join('\n')}` : '';
    this.el.textContent = lines.join('\n') + '\n';
    const st = document.createElement('span');
    st.className = this.selfTestClass;
    st.textContent = this.selfTestLine + details;
    this.el.append(st);
  }
}
