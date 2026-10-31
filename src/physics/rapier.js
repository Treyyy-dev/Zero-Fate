/**
 * Single import point for Rapier so the rest of the code never cares how
 * the module is packaged (default export in browsers/Vite, namespace in Node).
 */
import * as RapierModule from '@dimforge/rapier3d-compat';

const RAPIER =
  RapierModule.default && typeof RapierModule.default.init === 'function'
    ? RapierModule.default
    : RapierModule;

let initPromise = null;

/** Loads the WebAssembly module once; safe to call repeatedly. */
export function initRapier() {
  if (!initPromise) initPromise = Promise.resolve(RAPIER.init()).then(() => RAPIER);
  return initPromise;
}

export default RAPIER;
