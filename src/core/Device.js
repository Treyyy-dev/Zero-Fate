/**
 * Detects device class and picks a quality profile.
 * Override from the URL with ?quality=low or ?quality=high.
 */
export function detectQuality() {
  const ua = navigator.userAgent || '';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua);
  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  const dpr = window.devicePixelRatio || 1;

  const params = new URLSearchParams(window.location.search);
  const forced = params.get('quality');
  const low = forced ? forced === 'low' : coarse || mobileUA;

  return {
    tier: low ? 'low' : 'high',
    mobile: coarse || mobileUA,
    touch,
    devicePixelRatio: dpr,
    maxPixelRatio: low ? 1.5 : 2,
    minPixelRatio: low ? 0.6 : 0.75,
    antialias: !low || dpr < 2,
    shadowMapSize: low ? 1024 : 2048,
    shadowArea: low ? 36 : 50,
    rockCount: low ? 30 : 60,
    viewRing: low ? 3 : 5, // terrain chunks (128 m) loaded around the player
    colliderRing: low ? 1 : 2, // chunks with physics collision
    vegetationRing: low ? 2 : 3,
    treeDensity: low ? 0.6 : 1,
    grassCells: low ? 9 : 11,
    grassPerCell: low ? 90 : 190,
    fogDensity: low ? 0.0042 : 0.0026,
    envRefresh: low ? 10 : 5,
    torchLights: low ? 2 : 4,
  };
}

export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}
