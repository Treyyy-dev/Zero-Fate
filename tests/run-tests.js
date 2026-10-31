/**
 * Command-line test runner: `npm test`
 * Runs the same movement/collision self-tests the game runs at startup,
 * using the real Rapier engine and the real PlayerController.
 */
import { initRapier } from '../src/physics/rapier.js';
import { runSelfTests } from '../src/debug/SelfTest.js';
import { CONFIG } from '../src/config.js';

const RAPIER = await initRapier();
const report = runSelfTests(RAPIER, CONFIG);

for (const r of report.results) {
  console.log(`${r.pass ? '  PASS' : '  FAIL'}  ${r.name.padEnd(36)} ${r.detail}`);
}
console.log(`\n${report.passed}/${report.total} passed`);
process.exit(report.passed === report.total ? 0 : 1);
