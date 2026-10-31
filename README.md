# Fatal Zero

*A third-person open-world fantasy RPG set in the Vale of Brookhollow.*

A third-person open-world fantasy RPG built entirely with **HTML5, CSS3, JavaScript ES modules, Three.js r170, Rapier 3D 0.14 and Vite**. No game engine, no external services, no image or model files required: terrain, buildings, characters, animations, textures and effects are all generated in code.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — also prints a Network URL for your phone
npm test           # movement/collision self-tests in Node with real Rapier
npm run build      # production build into dist/
npm run preview    # serve the production build
```

Requires Node 18+ and a browser with WebGL 2.

## Android app (APK)

Every push to `main` runs `.github/workflows/android.yml` on GitHub Actions, which:

1. runs the movement/collision self-tests against real Rapier (`npm test`),
2. builds the game with Vite,
3. wraps it in a native Android app with Capacitor (`capacitor.config.json`, app id `com.treyyydev.fatalzero`),
4. builds `FatalZero.apk` and attaches it to a GitHub Release named "Fatal Zero build N".

To install: open the repository's **Releases** page on your phone, download `FatalZero.apk`, and allow installs from unknown sources when Android asks. It is a debug-signed build for personal testing; publishing on Google Play needs a release keystore.

To build locally instead you need Android Studio: `npm install`, then `npm run android` (builds, syncs and opens the Android project).

## What's in the game

| Phase | Systems |
|---|---|
| 1 Foundation | Fixed-step Rapier physics, kinematic character controller (walk/run/jump, slopes, auto-step, coyote time, jump buffer), third-person camera with collision, sky + image-based lighting + fog, responsive/adaptive rendering, touch controls |
| 2 Character | Skinned humanoid with a 19-bone skeleton, 19 procedural animation clips, weight-blended animation state machine (idle↔walk↔run blend tree, jump, fall, land, dodge, attacks, block, hit, death, swim, cast, drink, use), rotate-to-movement, camera-relative movement, GLB loader with automatic clip mapping and missing-asset fallback |
| 3 Combat | Modular weapons (sword, longsword, axe types), light 3-hit combos, heavy attacks, blocking with guard break, dodge roll with invulnerability frames, stamina costs, attack cooldowns and cancel windows, swept-blade hitbox detection against capsule hurtboxes, enemy AI (patrol, chase, circle, telegraphed attacks, stagger, leash), hit reactions, poise, knockback, spells |
| 4 World | 2 km region streamed in 128 m chunks with 4 terrain LODs and skirts, collider streaming, per-chunk instanced forests with high/low detail, recycled grass field, river with bridges, lake, village, castle, ruins, bandit camp, cave, roads, dynamic weather (clear/overcast/rain/storm/fog), day/night cycle with moon and stars, torch light pool, distance-based structure streaming |
| 5 RPG | Level/XP, health/stamina/mana, Strength/Defense/Agility/Intelligence, three skill trees, inventory, six equipment slots that change the character's look, weapons, armour, consumables, loot tables and loot drops, chests, five quests with NPC givers, compass quest markers, IndexedDB save/load with autosave |

## Controls

| Action | Desktop | Phone / tablet |
|---|---|---|
| Move / run | WASD · hold Shift | Left thumb joystick (push to the edge to run) |
| Look | Click once to capture the mouse, or drag | Drag on the right half |
| Jump | Space | JUMP |
| Light attack (combo) | Left click | ATTACK |
| Heavy attack | F | HEAVY |
| Block | Hold right click (or Q) | Hold BLOCK |
| Dodge roll | C or Left Alt | ROLL |
| Interact / talk / loot | E | USE |
| Hotbar (potions, spells) | 1 – 4 | Tap the slots |
| Journal | I inventory · U character · K skills · J quests | BAG |
| Save / load | F5 / F9 (also in Journal → System) | Journal → System |
| Zoom | Mouse wheel | — |
| Debug panel | F3 | "i" button |

## File structure — where everything belongs

```
fatal-zero/
├── index.html                      Page shell: canvas mount, loading/error screens, hints
├── package.json                    Dependencies (three, rapier) and npm scripts
├── vite.config.js                  Dev server (LAN for phone testing), build chunks
├── capacitor.config.json           Android app id/name for the Capacitor wrapper
├── .github/workflows/android.yml   CI: self-tests + Android APK build + GitHub Release
├── resources/                      App icon (source + Android sizes)
├── public/assets/characters/       (create it) put hero.glb here to replace the procedural hero
├── tests/run-tests.js              `npm test` — runs src/debug/SelfTest.js with real Rapier
└── src/
    ├── main.js                     Entry: boots Game, loading screen, hints, fatal errors
    ├── config.js                   Tuning: movement, camera, input, lighting, day length, saves
    ├── styles/main.css             All UI styling (HUD, journal, dialogue, touch buttons)
    ├── core/
    │   ├── Game.js                 Composition root + main loop; wires every system together
    │   ├── Renderer.js             WebGLRenderer, tone mapping, shadows, resizing
    │   ├── AdaptiveResolution.js   Lowers/raises resolution to hold frame rate
    │   ├── Input.js                Keyboard, mouse, pointer lock, touch channel, actions
    │   ├── Device.js               Mobile/desktop quality profile (?quality=low|high)
    │   └── Emitter.js              Tiny event emitter
    ├── physics/
    │   ├── rapier.js               Single Rapier import + WASM init
    │   └── PhysicsWorld.js         Rapier world: colliders, dynamic props, ray casts
    ├── player/
    │   ├── PlayerController.js     Kinematic movement: run, jump, swim, dodge/lunge forces, slope guard
    │   └── Player.js               Player = controller + character model + weapon + combat + stats
    ├── character/
    │   ├── HumanoidRig.js          Procedural skinned humanoid (skeleton, outfits, armour parts)
    │   ├── AnimationLibrary.js     19 procedural animation clips + attack timing windows
    │   ├── AnimationStateMachine.js Weight-blended state machine (blend tree + one-shots)
    │   └── CharacterModel.js       GLB loader (clip/bone mapping) with procedural fallback
    ├── camera/ThirdPersonCamera.js Orbit camera, smoothing, shoulder offset, collision
    ├── combat/
    │   ├── CombatSystem.js         Hurtbox registry, swept-blade hit tests, soft lock-on
    │   ├── Weapon.js               Weapon types (sword/longsword/axe), meshes, blade hitboxes
    │   ├── PlayerCombat.js         Player action FSM: combos, heavy, block, dodge, stagger, spells
    │   └── Spells.js               Firebolt/Fireball projectiles, Healing Light
    ├── enemies/
    │   ├── EnemyDefs.js            Bandit, skeleton, bandit chieftain stats
    │   ├── Enemy.js                Enemy AI state machine, attacks, reactions, death
    │   ├── EnemyManager.js         Distance-based spawning, attack tokens, kills, respawns
    │   └── CharacterMotor.js       Rapier capsule motor for AI characters
    ├── npc/NPC.js                  Quest givers and wandering villagers
    ├── rpg/
    │   ├── Stats.js                Level, XP, attributes, derived stats, resources, buffs
    │   ├── ItemDefs.js             Every item: weapons, armour, consumables, quest items
    │   ├── Inventory.js            Stacks, equipment slots, hotbar
    │   ├── SkillTree.js            Warrior / Agility / Arcane trees, spells
    │   ├── Quests.js               Quest definitions and tracking
    │   ├── Loot.js                 Loot tables
    │   └── SaveSystem.js           IndexedDB persistence
    ├── world/
    │   ├── WorldLayout.js          Hand-placed region data: POIs, river, roads, spawns, ore
    │   ├── WorldGen.js             Deterministic height + surface data (hills, mountains, lake, river, roads)
    │   ├── ChunkManager.js         Streamed terrain chunks, LOD, skirts, collider streaming
    │   ├── Vegetation.js           Instanced forests/bushes/boulders per chunk, wind, colliders
    │   ├── GrassField.js           Recycled instanced grass around the player
    │   ├── Water.js                Lake/river surface with animated normals
    │   ├── Environment.js          Sky, sun/moon, IBL refresh, fog, stars, clouds, day/night
    │   ├── Weather.js              Weather state machine, rain, lightning
    │   ├── Interactions.js         Interact registry + torch light pool
    │   ├── TestGrounds.js          Phase 1 training yard at spawn (kept)
    │   ├── ProceduralTextures.js   Runtime detail textures
    │   └── structures/
    │       ├── Builder.js          Geometry/collider builder that merges by material
    │       ├── Sites.js            Village, castle, ruins, cave, bridge, camp, ore builders
    │       └── StructureManager.js Streams sites in/out by distance
    ├── ui/
    │   ├── HUD.js                  Bars, hotbar, compass, quest tracker, notifications, dialogue
    │   ├── Journal.js              Inventory, character, skills, quests, saves
    │   ├── FloatingText.js         Damage/heal numbers
    │   ├── TouchControls.js        Joystick, look, combat buttons
    │   ├── DebugOverlay.js         FPS, state, draw calls, self-test result
    │   └── icons.js                Inline SVG item icons
    ├── effects/Particles.js        Pooled GPU particles (sparks, fire, magic, loot glints)
    ├── debug/
    │   ├── SelfTest.js             Movement/collision tests against real Rapier
    │   └── Diagnostics.js          Sends self-test results to the published page's data store
    └── utils/
        ├── math.js                 clamp, lerp, damping, angles
        └── noise.js                Seeded PRNG, simplex noise, fBm, ridged noise
```

Phase 1's single 600 m terrain mesh (`Terrain.js`) and the temporary capsule (`PlaceholderAvatar.js`) were replaced by the streamed chunk terrain and the skinned character, as the Phase 2 and Phase 4 specs required. The Phase 1 training yard is still at spawn.

## Using your own character (GLB)

Put a rigged humanoid at `public/assets/characters/hero.glb` (or change `game.heroModel` in `src/config.js`). Requirements: one skinned mesh, roughly human proportions, facing +Z, animations named with common words. Clips are matched by keyword — `idle`, `walk`, `run`, `jump`, `fall`, `land`, `roll`/`dodge`, `attack`/`slash` (1, 2, 3), `heavy`, `block`, `hit`, `death`/`die`, `swim`, `cast`, `drink` — and anything missing falls back to the closest clip. The model is scaled to 1.8 m and the weapon attaches to the right-hand bone. If the file is missing, the console logs `MISSING ASSET` and the procedural humanoid is used.

## The quests

1. **Bandit Trouble** — Elder Maren (village well): defeat 4 bandits on the east road.
2. **The Sunstone Relic** — Elder Maren: retrieve the relic from the Sunken Ruins.
3. **The Smith's Ore** — Hilde (forge): mine 3 iron ore veins along the north road.
4. **Into the Dark** — Captain Roderic (Highwatch Keep): clear the skeletons in the northern cave.
5. **The Chieftain** — Captain Roderic: slay Varga the Chieftain at the bandit camp.

## Testing

- `npm test` and the in-game self-test run the real movement controller against real Rapier (landing, walk/run speed, camera-relative movement, jump height, wall, auto-step, blocked ledge, jumping onto a ledge, slope limit).
- On the published page, the self-test result is also saved to the page's private data store so failures can be diagnosed remotely.
