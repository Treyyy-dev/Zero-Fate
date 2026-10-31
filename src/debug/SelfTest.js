import { PlayerController } from '../player/PlayerController.js';

/**
 * Automated movement & collision tests that run the REAL PlayerController
 * against the REAL Rapier engine in small, isolated physics worlds.
 *
 * Runs at startup in the browser (result shown in the debug panel) and from
 * the command line with `npm test` (tests/run-tests.js).
 *
 * Each world: flat ground with its top at y = 0, plus the obstacle under test.
 */

const DT = 1 / 60;
const NO_MOVE = { x: 0, y: 0, magnitude: 0 };
const FORWARD = { x: 0, y: 1, magnitude: 1 };

function createWorld(RAPIER, setup) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0));
  setup?.(world, RAPIER);
  return { world, RAPIER };
}

function box(world, RAPIER, hx, hy, hz, x, y, z) {
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z));
}

function simulate(physics, player, seconds, { move = NO_MOVE, run = false, yaw = 0, jumpAtStep = -1, onStep } = {}) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    if (i === jumpAtStep) player.requestJump();
    player.fixedUpdate(DT, move, run, yaw);
    physics.world.step();
    onStep?.(player, i);
  }
}

/** Spawns a player above the ground and lets it settle. */
function spawnSettled(physics, cfg, x = 0, z = 0) {
  const player = new PlayerController(physics, { x, y: cfg.halfHeight + cfg.radius + 0.6, z }, cfg);
  physics.world.step(); // populate query structures
  simulate(physics, player, 1.5);
  return player;
}

export function runSelfTests(RAPIER, CONFIG) {
  const cfg = CONFIG.player;
  const feet = cfg.halfHeight + cfg.radius;
  const results = [];

  const test = (name, fn) => {
    let physics = null;
    try {
      const out = fn((setup) => (physics = createWorld(RAPIER, setup)));
      results.push({ name, pass: !!out.pass, detail: out.detail });
    } catch (err) {
      results.push({ name, pass: false, detail: `threw: ${err?.message ?? err}` });
    } finally {
      try {
        physics?.world.free();
      } catch {
        /* ignore */
      }
    }
  };

  test('Lands and rests on ground', (make) => {
    const physics = make();
    const p = spawnSettled(physics, cfg);
    const y = p.position.y;
    const ok = p.grounded && y > feet - 0.05 && y < feet + 0.1;
    return { pass: ok, detail: `grounded=${p.grounded} centreY=${y.toFixed(3)} expected≈${feet.toFixed(2)}` };
  });

  test('Walk speed', (make) => {
    const physics = make();
    const p = spawnSettled(physics, cfg);
    simulate(physics, p, 0.8, { move: FORWARD });
    const z0 = p.position.z;
    simulate(physics, p, 1, { move: FORWARD });
    const speed = z0 - p.position.z;
    const ok = Math.abs(speed - cfg.walkSpeed) < cfg.walkSpeed * 0.12 && p.state === 'walk';
    return { pass: ok, detail: `${speed.toFixed(2)} m/s (target ${cfg.walkSpeed}), state=${p.state}` };
  });

  test('Run speed', (make) => {
    const physics = make();
    const p = spawnSettled(physics, cfg);
    simulate(physics, p, 0.8, { move: FORWARD, run: true });
    const z0 = p.position.z;
    simulate(physics, p, 1, { move: FORWARD, run: true });
    const speed = z0 - p.position.z;
    const ok = Math.abs(speed - cfg.runSpeed) < cfg.runSpeed * 0.12 && p.state === 'run';
    return { pass: ok, detail: `${speed.toFixed(2)} m/s (target ${cfg.runSpeed}), state=${p.state}` };
  });

  test('Movement follows camera yaw', (make) => {
    const physics = make();
    const p = spawnSettled(physics, cfg);
    const x0 = p.position.x;
    const z0 = p.position.z;
    // Camera yawed 90°: "forward" is world −X.
    simulate(physics, p, 1.2, { move: FORWARD, yaw: Math.PI / 2 });
    const dx = p.position.x - x0;
    const dz = p.position.z - z0;
    const facingOk = Math.abs(Math.abs(p.facing) - Math.PI / 2) < 0.15;
    const ok = dx < -2 && Math.abs(dz) < 0.1 && facingOk;
    return { pass: ok, detail: `dx=${dx.toFixed(2)} dz=${dz.toFixed(2)} facing=${p.facing.toFixed(2)}` };
  });

  test('Jump height and landing', (make) => {
    const physics = make();
    const p = spawnSettled(physics, cfg);
    const groundY = p.position.y;
    let maxY = groundY;
    let left = false;
    let landed = false;
    p.on('jump', () => (left = true));
    p.on('land', () => (landed = true));
    simulate(physics, p, 2, { jumpAtStep: 0, onStep: (pl) => (maxY = Math.max(maxY, pl.position.y)) });
    const height = maxY - groundY;
    const expected = (cfg.jumpVelocity * cfg.jumpVelocity) / (2 * Math.abs(cfg.gravity));
    const ok = left && landed && p.grounded && Math.abs(height - expected) < expected * 0.2;
    return { pass: ok, detail: `apex ${height.toFixed(2)} m (expected ≈${expected.toFixed(2)}), landed=${landed}` };
  });

  test('Wall blocks movement', (make) => {
    // Wall front face at z = −3.
    const physics = make((w, R) => box(w, R, 4, 2, 0.3, 0, 2, -3.3));
    const p = spawnSettled(physics, cfg);
    simulate(physics, p, 3, { move: FORWARD, run: true });
    const limit = -3 + cfg.radius - 0.05;
    const ok = p.position.z > limit && p.position.z < -2;
    return { pass: ok, detail: `stopped at z=${p.position.z.toFixed(3)} (wall face −3, limit ${limit.toFixed(2)})` };
  });

  test('Auto-steps 0.3 m ledge', (make) => {
    const physics = make((w, R) => box(w, R, 2, 0.15, 4, 0, 0.15, -6)); // front face z = −2
    const p = spawnSettled(physics, cfg);
    simulate(physics, p, 2.5, { move: FORWARD });
    const onTop = p.position.y > 0.3 + feet - 0.06 && p.position.z < -2.5;
    return { pass: onTop, detail: `z=${p.position.z.toFixed(2)} y=${p.position.y.toFixed(2)}` };
  });

  test('Cannot walk up 1.2 m ledge', (make) => {
    const physics = make((w, R) => box(w, R, 2, 0.6, 2, 0, 0.6, -4)); // front face z = −2
    const p = spawnSettled(physics, cfg);
    simulate(physics, p, 2.5, { move: FORWARD });
    const blocked = p.position.z > -2 + cfg.radius - 0.05 && p.position.y < feet + 0.1;
    return { pass: blocked, detail: `z=${p.position.z.toFixed(2)} y=${p.position.y.toFixed(2)}` };
  });

  test('Jumps onto 0.7 m ledge', (make) => {
    const physics = make((w, R) => box(w, R, 2, 0.35, 4, 0, 0.35, -6)); // front face z = −2
    const p = spawnSettled(physics, cfg);
    // Walk toward it and jump about 1 m before the edge.
    let jumped = false;
    simulate(physics, p, 2.5, {
      move: FORWARD,
      onStep: (pl) => {
        if (!jumped && pl.position.z < -0.9) {
          pl.requestJump();
          jumped = true;
        }
      },
    });
    const onTop = p.grounded && p.position.y > 0.7 + feet - 0.06;
    return { pass: onTop, detail: `z=${p.position.z.toFixed(2)} y=${p.position.y.toFixed(2)} grounded=${p.grounded}` };
  });

  test('Too-steep slope is not climbable', (make) => {
    const physics = make((w, R) => {
      const a = (62 * Math.PI) / 180;
      const len = 6;
      const q = { x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) };
      w.createCollider(
        R.ColliderDesc.cuboid(3, 0.2, len / 2)
          .setTranslation(0, (len / 2) * Math.sin(a) - 0.2 * Math.cos(a), -2 - (len / 2) * Math.cos(a))
          .setRotation(q),
      );
    });
    const p = spawnSettled(physics, cfg);
    simulate(physics, p, 3, { move: FORWARD, run: true });
    const ok = p.position.y < feet + 0.8;
    return { pass: ok, detail: `y=${p.position.y.toFixed(2)} after 3 s pushing uphill` };
  });

  const passed = results.filter((r) => r.pass).length;
  return { passed, total: results.length, results };
}
