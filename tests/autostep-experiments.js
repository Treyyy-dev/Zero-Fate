// Temporary diagnostics: which controller settings make the 0.3 m auto-step work?
import { initRapier } from '../src/physics/rapier.js';
import { PlayerController } from '../src/player/PlayerController.js';
import { CONFIG } from '../src/config.js';
const R = await initRapier();
const DT = 1 / 60;
function run(label, { cfgPatch = {}, patch } = {}) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(R.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0));
  world.createCollider(R.ColliderDesc.cuboid(2, 0.15, 4).setTranslation(0, 0.15, -6));
  const cfg = { ...CONFIG.player, ...cfgPatch };
  const p = new PlayerController({ RAPIER: R, world }, { x: 0, y: cfg.halfHeight + cfg.radius + 0.6, z: 0 }, cfg);
  patch?.(p);
  world.step();
  const mv = { x: 0, y: 1, magnitude: 1 };
  for (let i = 0; i < 90; i++) { p.fixedUpdate(DT, { x: 0, y: 0, magnitude: 0 }, false, 0); world.step(); }
  for (let i = 0; i < 150; i++) { p.fixedUpdate(DT, mv, false, 0); world.step(); }
  console.log(label.padEnd(36), `z=${p.position.z.toFixed(2)} y=${p.position.y.toFixed(2)} ${p.position.y > 1.1 ? 'STEPPED' : 'blocked'}`);
  world.free();
}
run('A current');
run('B no slope guard', { patch: (p) => (p._limitSlope = () => {}) });
run('C no stick velocity', { cfgPatch: { groundStickVelocity: 0 } });
run('D snap disabled', { patch: (p) => { p.controller.disableSnapToGround(); p._snapEnabled = false; } });
run('E minWidth 0.05', { cfgPatch: { stepMinWidth: 0.05 } });
run('F offset 0.01', { cfgPatch: { skinWidth: 0.01 } });
run('G offset 0.05', { cfgPatch: { skinWidth: 0.05 } });
run('H step height 0.5', { cfgPatch: { stepHeight: 0.5 } });
run('I include dynamic', { patch: (p) => p.controller.enableAutostep(0.4, 0.15, true) });
run('J slide off', { patch: (p) => p.controller.setSlideEnabled(false) });
run('K run speed', {});
run('L B+C', { cfgPatch: { groundStickVelocity: 0 }, patch: (p) => (p._limitSlope = () => {}) });
run('M B+D', { patch: (p) => { p._limitSlope = () => {}; p.controller.disableSnapToGround(); p._snapEnabled = false; } });
