import * as THREE from 'three';

/**
 * Floating combat text (damage numbers, heals, "Blocked") projected from
 * world positions onto the screen. Pooled DOM nodes.
 */
const _v = new THREE.Vector3();

export class FloatingText {
  constructor(container, camera) {
    this.camera = camera;
    this.root = document.createElement('div');
    this.root.className = 'float-layer';
    container.appendChild(this.root);
    this.items = [];
    this.pool = [];
  }

  show(worldPos, text, kind = 'damage') {
    const el = this.pool.pop() ?? document.createElement('div');
    el.className = `float-text ${kind}`;
    el.textContent = text;
    this.root.appendChild(el);
    this.items.push({ el, pos: worldPos.clone(), age: 0, drift: (Math.random() - 0.5) * 30 });
  }

  update(dt, width, height) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      if (it.age > 1.1) {
        it.el.remove();
        this.pool.push(it.el);
        this.items.splice(i, 1);
        continue;
      }
      _v.copy(it.pos);
      _v.y += it.age * 0.9;
      _v.project(this.camera);
      if (_v.z > 1) {
        it.el.style.opacity = '0';
        continue;
      }
      const x = (_v.x * 0.5 + 0.5) * width + it.drift * it.age;
      const y = (-_v.y * 0.5 + 0.5) * height;
      it.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.25 - it.age)})`;
      it.el.style.opacity = String(Math.min(1, (1.1 - it.age) * 3));
    }
  }
}
