/**
 * Central tuning values for the foundation.
 * Every gameplay "feel" number lives here so it can be tuned without
 * touching system code. Units: meters, seconds, radians unless noted.
 */
export const CONFIG = {
  physics: {
    gravity: -9.81, // world gravity for dynamic props (player uses its own below)
    fixedStep: 1 / 60, // physics tick
    maxSubSteps: 5, // safety cap after long frames / tab switches
  },

  player: {
    // Capsule: total height = 2 * (halfHeight + radius) = 1.8 m
    radius: 0.35,
    halfHeight: 0.55,
    mass: 75,
    skinWidth: 0.02, // character controller offset

    walkSpeed: 2.6,
    runSpeed: 6.2,
    groundAccel: 12, // how quickly we reach target speed
    groundDecel: 16, // how quickly we stop
    airAccel: 2.5, // limited air control

    jumpVelocity: 6.6, // apex ≈ v² / (2·|gravity|) ≈ 0.99 m
    gravity: -22, // stylised, snappier than real 9.81
    fallGravityMultiplier: 1.6, // heavier on the way down
    maxFallSpeed: 45,
    groundProbe: 0.06, // downward settle distance per tick while grounded (see PlayerController pass 2)
    coyoteTime: 0.12, // still allowed to jump shortly after leaving a ledge
    jumpBuffer: 0.15, // a jump pressed slightly early still fires on landing
    jumpLockTime: 0.12, // ignore "grounded" right after take-off

    stepHeight: 0.4, // auto-step up ledges this tall
    stepMinWidth: 0.15,
    snapDistance: 0.35, // stay on the ground walking down slopes / stairs
    maxSlopeDeg: 48, // steeper than this cannot be climbed
    slideSlopeDeg: 52, // steeper than this slides you down

    turnSpeed: 12, // how fast the character turns to face movement
    initialFacing: Math.PI, // facing -Z, away from the camera
    killY: -60, // respawn if we fall below this

    swimDepth: 1.35, // water deeper than this (above the feet) → swim
    swimExitDepth: 1.1,
    swimSpeed: 2.0,
    swimSprintSpeed: 3.2,
    swimFloatDepth: 0.62, // capsule centre below the surface while swimming
    wadeSpeedMul: 0.7,

    // Dodge roll
    dodgeSpeed: 7.5,
    dodgeDuration: 0.55,
    dodgeIFrames: [0.04, 0.4], // seconds of invulnerability within the roll
  },

  camera: {
    fov: 60,
    portraitFov: 72, // wider on tall phone screens
    near: 0.1,
    far: 2000,
    distance: 4.6,
    minDistance: 1.6,
    maxDistance: 9,
    zoomStep: 0.6,
    pivotHeight: 0.55, // above capsule centre ≈ head height (1.45 m above feet)
    shoulderOffset: 0.4, // over-the-shoulder framing
    initialYaw: 0, // camera behind player looking toward -Z
    initialPitch: 0.3,
    pitchMin: -0.45, // looking up
    pitchMax: 1.2, // looking down
    followSharpness: 22,
    followSharpnessY: 9, // softer vertical follow smooths steps and landings
    collisionPadding: 0.25,
    minCollisionDistance: 0.5,
    recoverSharpness: 6, // how fast the camera eases back out after a collision
  },

  input: {
    mouseSensitivity: 0.0022, // radians per pixel
    touchLookSensitivity: 0.0055,
    joystickRadius: 56, // px
    joystickDeadZone: 0.12,
    joystickRunThreshold: 0.85, // push past this to run
  },

  // World layout (POIs, roads, river, spawns) lives in src/world/WorldLayout.js.

  game: {
    autosaveSeconds: 60,
    saveSlot: 'slot1',
    heroModel: 'assets/characters/hero.glb', // optional rigged GLB; procedural humanoid if missing
    deathGoldPenalty: 0.1,
  },

  environment: {
    startHour: 9.5,
    dayLengthMinutes: 24, // one full day/night cycle in real minutes
    maxSunElevation: 62,
    sunIntensity: 3.4,
    moonIntensity: 0.6,
    nightExposure: 0.95,
    sunColor: 0xfff1de,
    hemiSky: 0xbcd4f0,
    hemiGround: 0x4b4232,
    hemiIntensity: 0.35,
    environmentIntensity: 0.55,
    exposure: 0.68,
    fogColor: 0xb3c4d4,
    fogDensity: 0.0052,
    sky: {
      turbidity: 4.5,
      rayleigh: 1.35,
      mieCoefficient: 0.004,
      mieDirectionalG: 0.82,
    },
  },
};
