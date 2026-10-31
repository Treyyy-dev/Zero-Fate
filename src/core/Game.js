import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { detectQuality } from './Device.js';
import { Renderer } from './Renderer.js';
import { Input } from './Input.js';
import { AdaptiveResolution } from './AdaptiveResolution.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { CharacterModel } from '../character/CharacterModel.js';
import { Player } from '../player/Player.js';
import { CombatSystem } from '../combat/CombatSystem.js';
import { Spells } from '../combat/Spells.js';
import { Particles } from '../effects/Particles.js';
import { EnemyManager } from '../enemies/EnemyManager.js';
import { NPC } from '../npc/NPC.js';
import { PlayerStats } from '../rpg/Stats.js';
import { Inventory } from '../rpg/Inventory.js';
import { SkillTree } from '../rpg/SkillTree.js';
import { QuestLog, QUESTS, npcName } from '../rpg/Quests.js';
import { getItem } from '../rpg/ItemDefs.js';
import { rollLoot } from '../rpg/Loot.js';
import { SaveSystem } from '../rpg/SaveSystem.js';
import { WorldGen } from '../world/WorldGen.js';
import { SPAWN_GROUPS, SPAWN_POINT, REST_POINT, ORE_NODES } from '../world/WorldLayout.js';
import { ChunkManager } from '../world/ChunkManager.js';
import { Vegetation } from '../world/Vegetation.js';
import { GrassField } from '../world/GrassField.js';
import { Water } from '../world/Water.js';
import { Environment } from '../world/Environment.js';
import { Weather, WEATHER_TYPES } from '../world/Weather.js';
import { TestGrounds } from '../world/TestGrounds.js';
import { createTextures } from '../world/ProceduralTextures.js';
import { createStructureMaterials } from '../world/structures/Builder.js';
import { StructureManager } from '../world/structures/StructureManager.js';
import { Interactions, TorchLights } from '../world/Interactions.js';
import { TouchControls } from '../ui/TouchControls.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { HUD } from '../ui/HUD.js';
import { Journal } from '../ui/Journal.js';
import { FloatingText } from '../ui/FloatingText.js';
import { runSelfTests } from '../debug/SelfTest.js';
import { reportSelfTest } from '../debug/Diagnostics.js';

/**
 * Composition root: creates every system, wires them together and runs the
 * main loop. Systems receive what they need here instead of importing each
 * other, which keeps them swappable.
 *
 * Frame order:
 *   1. input → camera rotation, intents
 *   2. fixed 60 Hz physics: player + enemies + world.step
 *   3. interpolate, then gameplay (combat, AI, NPCs, spells)
 *   4. world streaming (terrain, vegetation, structures, grass)
 *   5. time of day, weather, lighting
 *   6. UI, render
 */
const NPC_GREETINGS = {
  elder_maren: 'Welcome to Brookhollow, traveller. These are uneasy days.',
  smith_hilde: 'Mind the sparks. Need something forged?',
  captain_roderic: 'Highwatch stands. For now.',
};

export class Game {
  constructor(container) {
    this.container = container;
    this.config = CONFIG;
    this._accumulator = 0;
    this._lastTime = 0;
    this._running = false;
    this.paused = false;
    this._renderPosition = new THREE.Vector3();
    this.npcs = new Map();
    this.worldState = new Set(); // opened chests, mined ore, taken relic…
    this.discovered = new Set();
    this.lootBags = new Map();
    this.fires = new Map();
    this.time = 0;
    this._autosave = 0;
    this._poiTimer = 0;
    this.lastSaveText = '';
  }

  async init(onProgress = () => {}) {
    const cfg = this.config;
    const q = (this.quality = detectQuality());

    onProgress('Loading physics engine…', 0.08);
    this.physics = await PhysicsWorld.create(cfg.physics);

    onProgress('Verifying movement…', 0.14);
    try {
      this.selfTest = runSelfTests(this.physics.RAPIER, cfg);
      console.info(`[self-test] ${this.selfTest.passed}/${this.selfTest.total} passed`);
      const failed = this.selfTest.results.filter((r) => !r.pass);
      if (failed.length) console.table(failed);
      reportSelfTest(this.selfTest, { quality: q.tier });
    } catch (err) {
      console.error('[self-test] could not run', err);
    }
    await nextFrame();

    onProgress('Creating renderer…', 0.2);
    this.renderer = new Renderer(this.container, q, { exposure: cfg.environment.exposure });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, cfg.camera.near, cfg.camera.far);
    this.uniforms = { uTime: { value: 0 }, uWind: { value: 0.6 } };
    this.textures = createTextures();

    onProgress('Lighting the sky…', 0.28);
    this.gen = new WorldGen();
    this.environment = new Environment({ scene: this.scene, renderer: this.renderer, cfg: cfg.environment, quality: q });
    this.weather = new Weather({ scene: this.scene, quality: q });
    this.weather.on('change', ({ label }) => this.hud?.notify(`The weather turns: <b>${label}</b>`, 'world'));
    await nextFrame();

    onProgress('Shaping the land…', 0.36);
    this.chunks = new ChunkManager({ scene: this.scene, physics: this.physics, worldGen: this.gen, quality: q, texture: this.textures.ground });
    this.vegetation = new Vegetation({ scene: this.scene, physics: this.physics, worldGen: this.gen, chunks: this.chunks, quality: q, uniforms: this.uniforms });
    this.water = new Water({ scene: this.scene, level: this.gen.waterLevel, uniforms: this.uniforms });
    this.grass = new GrassField({ scene: this.scene, worldGen: this.gen, quality: q, uniforms: this.uniforms });

    // --- RPG state ---
    this.stats = new PlayerStats();
    this.inventory = new Inventory(this.stats);
    this.skills = new SkillTree(this.stats);
    this.quests = new QuestLog(this.inventory, this.stats);

    // --- Combat & effects ---
    this.combat = new CombatSystem();
    this.effects = new Particles(this.scene, q.mobile ? 700 : 1400);
    this.floatingText = new FloatingText(this.container, this.camera);
    this.spells = new Spells({ scene: this.scene, physics: this.physics, combat: this.combat, effects: this.effects, stats: this.stats, skills: this.skills, floatingText: this.floatingText });
    this.interactions = new Interactions();
    this.torches = new TorchLights(this.scene, q.torchLights);

    // --- Load the save early so we stream the right part of the world ---
    this.pendingSave = await SaveSystem.load(cfg.game.saveSlot);
    const startPos = this.pendingSave?.player?.position ?? { x: SPAWN_POINT.x, z: SPAWN_POINT.z };

    onProgress('Growing forests…', 0.46);
    this.chunks.update(new THREE.Vector3(startPos.x, 0, startPos.z), { force: true });
    this.chunks.flush();
    await nextFrame();

    onProgress('Building Brookhollow…', 0.6);
    this.structureMaterials = createStructureMaterials(this.textures);
    this.structures = new StructureManager({
      scene: this.scene, physics: this.physics, gen: this.gen, materials: this.structureMaterials,
      worldState: this.worldState, quality: q, handlers: this._structureHandlers(),
    });
    this.testGrounds = new TestGrounds({
      scene: this.scene, physics: this.physics, textures: this.textures, quality: q,
      terrain: {
        getHeightAt: (x, z) => this.gen.heightAt(x, z),
        isClear: (x, z) => {
          const s = this.gen.sample(x, z);
          return s.roadMask < 0.05 && s.riverMask === 0 && s.height > this.gen.waterLevel + 1 && !this.gen.poiAt(x, z, 12);
        },
      },
    });

    onProgress('Raising the hero…', 0.72);
    const heroModel = await CharacterModel.create({ glbUrl: cfg.game.heroModel });
    this.characterSource = heroModel.source === 'glb' ? `GLB (${cfg.game.heroModel})` : `Procedural humanoid (no ${cfg.game.heroModel})`;
    const spawnY = this.gen.heightAt(startPos.x, startPos.z) + cfg.player.halfHeight + cfg.player.radius + 0.4;
    this.player = new Player({
      scene: this.scene, physics: this.physics, combat: this.combat, stats: this.stats, inventory: this.inventory,
      skills: this.skills, spells: this.spells, effects: this.effects, cfg, spawn: { x: startPos.x, y: spawnY, z: startPos.z }, model: heroModel,
    });
    this.player.controller.waterQuery = (x, z) => this.gen.waterAt(x, z);
    this.player.onHitLanded = (results) => this._onHitLanded(results);
    this.player.on('hurt', (e) => this._onPlayerHurt(e));
    this.player.on('dodged', () => this.floatingText.show(this._headOf(this.player.position), 'Dodged', 'blocked'));
    this.player.on('death', () => this._onPlayerDeath());

    // --- Enemies ---
    this.enemies = new EnemyManager({
      scene: this.scene, physics: this.physics, combat: this.combat, effects: this.effects, floatingText: this.floatingText,
      getGroundHeight: (x, z) => this.gen.heightAt(x, z), spawnGroups: SPAWN_GROUPS,
      hasGround: (x, z) => this.chunks.hasColliderAt(x, z),
    });
    this.enemies.on('kill', (e) => this._onKill(e));

    // --- Input, camera, UI ---
    this.input = new Input(this.renderer.domElement, cfg.input);
    this.touch = q.touch ? new TouchControls(this.container, this.input, cfg.input, { showImmediately: q.mobile }) : null;
    this.cameraRig = new ThirdPersonCamera(this.camera, this.physics, cfg.camera);
    this.cameraRig.snapTo(this.player.position);
    this.player.controller.on('respawn', () => this.cameraRig.snapTo(this.player.position));
    this.renderer.onResize((w, h) => {
      this.cameraRig.setAspect(w / h);
      this.effects.setViewportHeight(h);
    });
    this.hud = new HUD(this.container, { touch: q.touch && q.mobile });
    this.hud.onHotbar = (i) => this.useHotbar(i);
    this.journal = new Journal(this.container, this);
    this.journal.onToggle = (open) => {
      this.paused = open;
      this.input.reset();
      if (open && document.pointerLockElement) document.exitPointerLock?.();
    };
    this.debug = new DebugOverlay(this.container, { touch: q.touch });
    this.debug.setSelfTest(this.selfTest);
    this.adaptive = new AdaptiveResolution(this.renderer);
    this._wireRpgEvents();

    // --- Apply save or start a new game ---
    if (this.pendingSave) this._applySave(this.pendingSave);
    else this._newGameSetup();
    this.pendingSave = null;

    onProgress('Compiling shaders…', 0.9);
    this.structures.update(this.player.position, { all: true });
    this.chunks.update(this.player.position, { force: true });
    this.chunks.flush();
    this.physics.step();
    this.cameraRig.update(1 / 60, this.player.position, this.player.controller.body);
    this.environment.update(0, this.player.position, this.camera, this.weather.params);
    this.renderer.three.compile(this.scene, this.camera);
    onProgress('Ready', 1);
  }

  /* ================================================================ setup */

  _newGameSetup() {
    const inv = this.inventory;
    for (const [id, n] of [['rusty_sword', 1], ['padded_tunic', 1], ['wool_trousers', 1], ['health_potion', 3], ['stamina_potion', 1], ['bread', 2]]) inv.add(id, n, { silent: true });
    inv.equip('rusty_sword');
    inv.equip('padded_tunic');
    inv.equip('wool_trousers');
    inv.hotbar = ['health_potion', 'stamina_potion', null, null];
    this.environment.setTime(this.config.environment.startHour);
    setTimeout(() => {
      this.hud.banner('The Vale of Brookhollow', 'Find Elder Maren by the village well');
      this.quests.tracked = null;
    }, 600);
  }

  _structureHandlers() {
    return {
      interactable: (entry, site) => this._spawnInteractable(entry, site),
      npc: (spec) => {
        const npc = new NPC({ spec, scene: this.scene, physics: this.physics, gen: this.gen });
        this.npcs.set(spec.id, npc);
        let removeInteraction = null;
        if (!spec.ambient) {
          removeInteraction = this.interactions.add({
            id: `npc:${spec.id}`,
            position: () => npc.position,
            radius: 3,
            label: `Talk to ${npcName(spec.id)}`,
            action: () => this.talkTo(spec.id),
          });
        }
        return () => {
          removeInteraction?.();
          npc.dispose();
          this.npcs.delete(spec.id);
        };
      },
      torches: (list, site) => this.torches.add(site.id, list),
      fire: (pos, site) => {
        this.fires.set(site.id, pos);
        return () => this.fires.delete(site.id);
      },
    };
  }

  _spawnInteractable(entry, site) {
    const scene = this.scene;
    if (entry.kind === 'chest') {
      const opened = this.worldState.has(entry.id);
      const group = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.8 });
      const band = new THREE.MeshStandardMaterial({ color: 0xc9a54a, roughness: 0.35, metalness: 0.8 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.7), wood);
      base.position.y = 0.28;
      const lidPivot = new THREE.Group();
      lidPivot.position.set(0, 0.55, -0.35);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.2, 0.72), wood);
      lid.position.set(0, 0.1, 0.35);
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.06, 0.74), band);
      b1.position.set(0, 0.1, 0.35);
      lidPivot.add(lid, b1);
      if (opened) lidPivot.rotation.x = -1.9;
      group.add(base, lidPivot);
      group.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const ground = this.gen.heightAt(entry.position.x, entry.position.z);
      group.position.set(entry.position.x, Math.max(ground, entry.position.y), entry.position.z);
      group.rotation.y = entry.rotY ?? 0;
      scene.add(group);
      const collider = this.physics.addStaticCuboid({ x: 0.55, y: 0.35, z: 0.35 }, { x: group.position.x, y: group.position.y + 0.35, z: group.position.z }, group.quaternion);
      const remove = this.interactions.add({
        id: entry.id,
        position: group.position,
        label: 'Open chest',
        available: () => !this.worldState.has(entry.id),
        action: () => {
          this.player.combatState.use(() => {
            this.worldState.add(entry.id);
            lidPivot.rotation.x = -1.9;
            this.effects.burst(group.position.clone().setY(group.position.y + 0.7), 24, { color: 0xffd27a, speed: 2.5, size: 0.14, life: 0.8, gravity: -2 });
            this._grantLoot(rollLoot(entry.loot), 'Chest');
            this.saveGame(false);
          });
        },
      });
      return () => {
        remove();
        this.physics.world.removeCollider(collider, false);
        group.traverse((o) => o.isMesh && o.geometry.dispose());
        group.removeFromParent();
      };
    }
    if (entry.kind === 'relic') {
      if (this.worldState.has('relic_taken')) return null;
      const mat = new THREE.MeshStandardMaterial({ color: 0xffc040, emissive: 0xff9a20, emissiveIntensity: 2.4, roughness: 0.3 });
      const relic = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 1), mat);
      relic.position.copy(entry.position);
      scene.add(relic);
      const tick = (dt) => {
        relic.rotation.y += dt * 1.5;
        relic.position.y = entry.position.y + Math.sin(this.time * 2) * 0.08;
        if (Math.random() < 0.3) this.effects.spawn(relic.position.x, relic.position.y, relic.position.z, (Math.random() - 0.5) * 0.4, 0.6, (Math.random() - 0.5) * 0.4, { size: 0.12, life: 0.9, color: 0xffd060 });
      };
      this._tickers = this._tickers ?? new Set();
      this._tickers.add(tick);
      const remove = this.interactions.add({
        id: 'relic_pedestal',
        position: entry.position,
        radius: 2.6,
        label: 'Take the Sunstone Relic',
        available: () => this.quests.wantsInteract('relic_pedestal'),
        action: () => {
          this.player.combatState.use(() => {
            this.worldState.add('relic_taken');
            this.inventory.add('sunstone_relic', 1);
            this.quests.notify({ type: 'interact', target: 'relic_pedestal' });
            relic.visible = false;
            this._tickers.delete(tick);
            remove();
            this.saveGame(false);
          });
        },
      });
      return () => {
        remove();
        this._tickers.delete(tick);
        relic.geometry.dispose();
        relic.removeFromParent();
      };
    }
    if (entry.kind === 'ore') {
      return this.interactions.add({
        id: entry.id,
        position: entry.position,
        radius: 2.6,
        label: 'Mine iron ore',
        available: () => !this.worldState.has(entry.id),
        action: () => {
          this.player.combatState.use(() => {
            this.worldState.add(entry.id);
            this.effects.sparks(entry.position, 0xffb070, 18);
            this.inventory.add('iron_ore', 1);
            this.structures.unload(site.id);
          });
        },
      });
    }
    return null;
  }

  _wireRpgEvents() {
    const hud = this.hud;
    this.inventory.on('added', ({ item, count }) => hud.notify(`+${count > 1 ? count + ' ' : ''}<b style="color:${rarityColor(item)}">${esc(item.name)}</b>`, 'loot'));
    this.stats.on('levelup', ({ level }) => {
      hud.banner(`Level ${level}`, 'New attribute and skill points — open the Journal');
      this.effects.burst(this.player.position.clone(), 60, { color: 0xffe08a, speed: 4, size: 0.18, life: 1.2, gravity: -1 });
      this.saveGame(false);
    });
    this.stats.on('xp', ({ amount }) => this.floatingText.show(this._headOf(this.player.position).add(new THREE.Vector3(0, 0.3, 0)), `+${amount} XP`, 'xp'));
    this.quests.on('accepted', ({ quest }) => hud.notify(`Quest accepted: <b>${esc(quest.title)}</b>`, 'quest'));
    this.quests.on('updated', ({ objective, progress, need }) => hud.notify(`${esc(objective.label)}${need > 1 ? ` ${progress}/${need}` : ''}`, 'quest'));
    this.quests.on('ready', ({ quest }) => hud.notify(`<b>${esc(quest.title)}</b> — return to ${esc(npcName(quest.turnIn))}`, 'quest'));
    this.quests.on('completed', ({ quest }) => {
      hud.banner('Quest complete', quest.title);
      this.saveGame(false);
    });
  }

  /* ================================================================ loop */

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      const dt = Math.min(0.1, Math.max(0, (now - this._lastTime) / 1000));
      this._lastTime = now;
      this.frame(dt);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
  }

  frame(dt) {
    const { input, player, cameraRig } = this;
    this._handleGlobalKeys();

    if (this.paused) {
      this.renderer.render(this.scene, this.camera);
      input.endFrame();
      return;
    }
    this.time += dt;

    // 1. Input
    const look = input.consumeLook();
    cameraRig.rotate(look.dx, look.dy);
    cameraRig.zoom(input.consumeZoom());
    if (input.consumeJump()) player.controller.requestJump();
    if (input.consumeKey('KeyR')) player.controller.respawn();
    const move = input.getMovement();
    const run = input.wantsRun();
    const intent = {
      move,
      cameraYaw: cameraRig.yaw,
      light: input.consumeAction('light'),
      heavy: input.consumeKey('KeyF') || input.consumeAction('heavy'),
      block: input.isBlocking(),
      dodge: input.consumeKey('KeyC') || input.consumeKey('AltLeft') || input.consumeAction('dodge'),
    };
    if (input.consumeKey('KeyE') || input.consumeAction('interact')) {
      if (this.hud.dialogueOpen && this.hud.dialogueOptions?.length === 1) this.hud.dialogueOptions[0].action();
      else this.interactions.activate();
    }
    for (let i = 0; i < 4; i++) {
      if (!input.consumeKey(`Digit${i + 1}`)) continue;
      if (this.hud.dialogueOpen && this.hud.dialogueOptions?.[i]) this.hud.dialogueOptions[i].action();
      else this.useHotbar(i);
    }

    // 2. Fixed-step simulation
    const step = this.config.physics.fixedStep;
    this._accumulator += dt;
    let steps = 0;
    while (this._accumulator >= step && steps < this.config.physics.maxSubSteps) {
      player.fixedUpdate(step, move, run, cameraRig.yaw);
      this.enemies.fixedUpdate(step);
      this.physics.step();
      this._accumulator -= step;
      steps++;
    }
    if (steps === this.config.physics.maxSubSteps) this._accumulator = 0;

    // 3. Interpolate & gameplay
    const alpha = this._accumulator / step;
    player.controller.getInterpolatedPosition(alpha, this._renderPosition);
    this.enemies.syncVisuals(alpha);
    player.update(dt, this._renderPosition, intent);
    this.enemies.update(dt, player);
    for (const npc of this.npcs.values()) npc.update(dt, player.position);
    this.spells.update(dt);
    this.testGrounds.update();
    if (this._tickers) for (const t of this._tickers) t(dt);
    this._updateFires(dt);
    this.effects.update(dt);
    cameraRig.update(dt, this._renderPosition, player.controller.body);

    // 4. World streaming
    this.chunks.update(player.position);
    this.structures.update(player.position);
    this.grass.update(player.position, this.camera);
    this.water.update(this.camera);

    // 5. Time, weather, lighting
    const env = this.environment;
    env.setTime(env.hours + (dt * 24) / (this.config.environment.dayLengthMinutes * 60));
    const weather = this.weather.update(dt, this.camera);
    this.uniforms.uTime.value += dt;
    this.uniforms.uWind.value = 0.4 + weather.wind * 0.8;
    env.setIndoor(this.structures.indoorAt(player.position));
    env.update(dt, this._renderPosition, this.camera, weather);
    this.torches.update(dt, player.position, env.darkness, env.indoor);
    this.structureMaterials.window.emissiveIntensity = env.darkness * 1.8;

    // 6. Interaction prompt, discovery, UI
    const ia = this.interactions.update(player.position, player.controller.facing);
    this.hud.setPrompt(this.hud.dialogueOpen ? null : ia?.label ?? null);
    if (this.hud.dialogueOpen && this._dialogueNpc) {
      const npc = this.npcs.get(this._dialogueNpc);
      if (!npc || npc.position.distanceTo(player.position) > 5) this.closeDialogue();
    }
    this._checkPOIs(dt);
    this._updateHUD(dt);

    this._autosave += dt;
    if (this._autosave > this.config.game.autosaveSeconds && player.alive && !player.combatState.inCombat) this.saveGame(false);

    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.three.info.render;
    this.debug.update(dt, {
      state: player.combatState.state === 'free' ? player.controller.state : player.combatState.state,
      grounded: player.controller.grounded,
      speed: player.controller.horizontalSpeed,
      position: this._renderPosition,
      pixelRatio: this.renderer.pixelRatio,
      calls: info.calls,
      triangles: info.triangles,
    });
    this.adaptive.update(dt);
    input.endFrame();
  }

  _handleGlobalKeys() {
    const input = this.input;
    if (input.consumeKey('KeyI') || input.consumeKey('Tab') || input.consumeAction('journal')) this.journal.toggle('inventory');
    else if (input.consumeKey('KeyU')) this.journal.toggle('character');
    else if (input.consumeKey('KeyK')) this.journal.toggle('skills');
    else if (input.consumeKey('KeyJ')) this.journal.toggle('quests');
    if (input.consumeKey('Escape')) {
      if (this.journal.isOpen) this.journal.close();
      else if (this.hud.dialogueOpen) this.closeDialogue();
    }
    if (input.consumeKey('F5')) this.saveGame(true);
    if (input.consumeKey('F9')) this.loadGame(true);
  }

  _updateFires(dt) {
    for (const p of this.fires.values()) {
      if (p.distanceToSquared(this.player.position) > 90 * 90) continue;
      for (let i = 0; i < 2; i++) {
        this.effects.spawn(p.x + (Math.random() - 0.5) * 0.6, p.y, p.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.3, 1.2 + Math.random(), (Math.random() - 0.5) * 0.3, {
          size: 0.35, life: 0.6 + Math.random() * 0.4, color: Math.random() < 0.5 ? 0xff7a20 : 0xffc050,
        });
      }
    }
    void dt;
  }

  _updateHUD(dt) {
    const hud = this.hud;
    const w = this.renderer.width;
    const h = this.renderer.height;
    hud.updateBars(this.stats);
    hud.updateHotbar(this.inventory, this.skills, this.player.combatState.spellCooldowns);
    hud.updateQuest(this.quests);
    hud.updateCompass(this.cameraRig.yaw, this.player.position, this._compassMarkers());
    const engaged = this.enemies.engaged();
    hud.updateEnemyBars(engaged, this.camera, w, h);
    hud.setBoss(engaged.find((e) => e.def.boss) ?? null);
    hud.setTime(`${this.timeText} · ${this.weatherLabel}`);
    this.floatingText.update(dt, w, h);
  }

  /* ================================================================ gameplay hooks */

  _headOf(p) {
    return new THREE.Vector3(p.x, p.y + 1.1, p.z);
  }

  _onHitLanded(results) {
    for (const r of results) {
      if (r.killed) continue;
      if (r.hit.heavy) this.cameraRig.pitch += 0.004; // tiny impact nudge
    }
  }

  _onPlayerHurt({ amount, blocked, guardBreak }) {
    const p = this._headOf(this.player.position);
    this.floatingText.show(p, blocked ? `Blocked ${amount}` : guardBreak ? `Guard broken ${amount}` : `-${amount}`, blocked ? 'blocked' : 'hurt');
    if (!blocked) this.effects.blood(this.player.position.clone().setY(this.player.position.y + 0.4), 0x9a1a14, 8);
  }

  _onKill({ enemy }) {
    const def = enemy.def;
    this.stats.addXP(def.xp);
    this.quests.notify({ type: 'kill', enemy: enemy.type });
    const loot = rollLoot(def.loot);
    if (loot.gold) {
      this.stats.gold += loot.gold;
      this.hud.notify(`+${loot.gold} gold`, 'gold');
    }
    if (loot.items.length) this._dropLootBag(enemy.position.clone(), loot.items, def.name);
    if (this.skills.has('battleFury')) {
      this.stats.restoreStamina(25);
      this.stats.heal(this.stats.maxHealth * 0.08);
    }
    if (def.boss) {
      this.hud.banner(`${def.name} defeated`, 'The east road is safe');
      this.saveGame(false);
    }
  }

  _dropLootBag(position, items, sourceName) {
    const id = `loot_${Math.random().toString(36).slice(2, 9)}`;
    const ground = this.gen.heightAt(position.x, position.z);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.9, emissive: 0x3a2a10, emissiveIntensity: 0.6 }));
    mesh.scale.set(1, 0.75, 1);
    mesh.position.set(position.x, Math.max(ground, position.y - 0.9) + 0.22, position.z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const tick = () => {
      if (Math.random() < 0.06) this.effects.spawn(mesh.position.x, mesh.position.y + 0.3, mesh.position.z, 0, 0.8, 0, { size: 0.16, life: 0.8, color: 0xffe08a });
    };
    this._tickers = this._tickers ?? new Set();
    this._tickers.add(tick);
    const cleanup = () => {
      this.interactions.remove(id);
      this._tickers.delete(tick);
      mesh.geometry.dispose();
      mesh.removeFromParent();
      this.lootBags.delete(id);
    };
    this.interactions.add({
      id,
      position: mesh.position,
      radius: 2.4,
      label: `Search ${sourceName}`,
      action: () => {
        this._grantLoot({ gold: 0, items }, sourceName);
        cleanup();
      },
    });
    this.lootBags.set(id, cleanup);
    setTimeout(() => this.lootBags.has(id) && cleanup(), 240000);
  }

  _grantLoot(loot, source) {
    if (loot.gold) {
      this.stats.gold += loot.gold;
      this.hud.notify(`+${loot.gold} gold`, 'gold');
    }
    for (const { id, count } of loot.items) {
      const added = this.inventory.add(id, count);
      if (added < count) this.hud.notify(`Pack full — left ${esc(getItem(id).name)} behind`, 'warn');
    }
    this.stats.emit('change');
    void source;
  }

  _onPlayerDeath() {
    this.hud.showDeath(true);
    this.closeDialogue();
    setTimeout(() => {
      const lost = Math.floor(this.stats.gold * this.config.game.deathGoldPenalty);
      this.stats.gold -= lost;
      const y = this.gen.heightAt(REST_POINT.x, REST_POINT.z) + 1.4;
      this._ensureWorldAt(REST_POINT.x, REST_POINT.z);
      this.player.revive(new THREE.Vector3(REST_POINT.x, y, REST_POINT.z));
      this.player.controller.spawnPoint.set(SPAWN_POINT.x, this.gen.heightAt(SPAWN_POINT.x, SPAWN_POINT.z) + 1.3, SPAWN_POINT.z);
      this.hud.showDeath(false);
      if (lost) this.hud.notify(`You lost ${lost} gold`, 'warn');
    }, 3600);
  }

  /** Makes sure terrain collision exists before teleporting somewhere. */
  _ensureWorldAt(x, z) {
    const p = new THREE.Vector3(x, 0, z);
    this.chunks.update(p, { force: true });
    this.chunks.flush();
    this.structures.update(p, { all: true });
  }

  useItem(id) {
    const item = getItem(id);
    if (item.type !== 'consumable' || !this.inventory.has(id)) return false;
    const apply = () => {
      if (!this.inventory.has(id)) return;
      this.inventory.remove(id, 1);
      const e = item.effect;
      const p = this.player.position;
      if (e.heal) {
        const healed = this.stats.heal(e.heal);
        this.floatingText.show(this._headOf(p), `+${Math.round(healed)}`, 'heal');
      }
      if (e.stamina) this.stats.restoreStamina(e.stamina);
      if (e.mana) this.stats.restoreMana(e.mana);
      if (e.buff) this.stats.addBuff(id, e.buff.stat, e.buff.value, e.buff.time);
      this.stats.emit('change');
      this.effects.burst(p.clone().setY(p.y + 0.3), 16, { color: item.color ? parseInt(item.color.slice(1), 16) : 0xffffff, speed: 1.5, size: 0.14, life: 0.8, gravity: 1 });
    };
    if (this.paused) {
      apply(); // using items from the Journal is instant
      return true;
    }
    if (this.player.combatState.busy) return false;
    return this.player.combatState.drink(apply);
  }

  useHotbar(i) {
    const entry = this.inventory.hotbar[i];
    if (!entry) return;
    if (entry.startsWith('spell:')) {
      const spell = entry.slice(6);
      const yaw = this.cameraRig.yaw;
      const pitch = this.cameraRig.pitch;
      const dir = new THREE.Vector3(-Math.sin(yaw), -Math.sin(pitch) * 0.5 + 0.05, -Math.cos(yaw)).normalize();
      const res = this.player.combatState.castSpell(spell, spell === 'firebolt' ? dir : null);
      if (res === 'mana') this.hud.notify('Not enough mana', 'warn');
      else if (res === 'locked') this.hud.notify('Learn this spell in the Arcane skill tree', 'warn');
      return;
    }
    if (!this.inventory.has(entry)) {
      this.hud.notify(`No ${esc(getItem(entry).name)} left`, 'warn');
      return;
    }
    this.useItem(entry);
  }

  /* ================================================================ dialogue */

  talkTo(npcId) {
    const ql = this.quests;
    const { offers, turnIns, active } = ql.forNpc(npcId);
    const name = npcName(npcId);
    this._dialogueNpc = npcId;
    const bye = { label: 'Farewell', action: () => this.closeDialogue() };
    if (turnIns.length) {
      const id = turnIns[0];
      const q = QUESTS[id];
      this.hud.showDialogue({
        name,
        text: `You've done it — ${q.summary.replace(/\.$/, '').toLowerCase()}. You have my thanks.`,
        options: [
          { label: `Complete "${q.title}"`, primary: true, action: () => {
            const r = ql.turnIn(id);
            if (r) this.hud.notify(`Reward: ${r.xp} XP, ${r.gold ?? 0} gold`, 'quest');
            this.talkTo(npcId);
          } },
          bye,
        ],
      });
      return;
    }
    if (offers.length) {
      const id = offers[0];
      const q = QUESTS[id];
      this.hud.showDialogue({
        name,
        text: q.offer,
        options: [
          { label: `Accept "${q.title}"`, primary: true, action: () => {
            ql.accept(id);
            ql.tracked = id;
            this.closeDialogue();
          } },
          { label: 'Not now', action: () => this.closeDialogue() },
        ],
      });
      return;
    }
    if (active.length) {
      const q = QUESTS[active[0]];
      this.hud.showDialogue({ name, text: `${q.summary} Come back when it's done.`, options: [bye] });
      return;
    }
    this.hud.showDialogue({ name, text: NPC_GREETINGS[npcId] ?? 'Safe travels.', options: [bye] });
  }

  closeDialogue() {
    this.hud.hideDialogue();
    this._dialogueNpc = null;
  }

  /* ================================================================ world info */

  _checkPOIs(dt) {
    this._poiTimer += dt;
    if (this._poiTimer < 0.5) return;
    this._poiTimer = 0;
    const p = this.player.position;
    for (const poi of this.gen.pois) {
      const r = (poi.radius ?? poi.flatten) + 6;
      if (Math.hypot(p.x - poi.x, p.z - poi.z) > r) continue;
      this.quests.notify({ type: 'reach', poi: poi.id });
      if (poi.discover && !this.discovered.has(poi.id)) {
        this.discovered.add(poi.id);
        this.hud.banner(poi.name, 'Discovered');
        this.stats.addXP(25);
      }
    }
  }

  _compassMarkers() {
    const markers = [];
    for (const id of this.discovered) {
      const poi = this.gen.poiById[id];
      if (poi) markers.push({ x: poi.x, z: poi.z, kind: 'poi' });
    }
    const target = this._questTarget();
    if (target) markers.push({ ...target, kind: 'quest' });
    return markers;
  }

  _questTarget() {
    const id = this.quests.tracked;
    const p = this.gen.poiById;
    const npcPos = { elder_maren: [p.village.x - 3, p.village.z + 3], smith_hilde: [p.village.x + 34, p.village.z + 5], captain_roderic: [p.castle.x + 4, p.castle.z + 3] };
    const at = (key) => {
      const live = this.npcs.get(key);
      if (live) return { x: live.position.x, z: live.position.z };
      const [x, z] = npcPos[key];
      return { x, z };
    };
    if (!id) {
      // Guide new players to their first quest giver.
      if (this.quests.status('bandit_trouble') === 'available') return at('elder_maren');
      return null;
    }
    const st = this.quests.status(id);
    const q = QUESTS[id];
    if (st === 'ready') return at(q.turnIn);
    const state = this.quests.state[id];
    const idx = q.objectives.findIndex((o, i) => state.progress[i] < (o.count ?? 1));
    const obj = q.objectives[idx];
    if (!obj) return null;
    if (obj.type === 'reach') return { x: p[obj.poi].x, z: p[obj.poi].z };
    if (obj.type === 'interact') return { x: p.ruins.x, z: p.ruins.z };
    if (obj.type === 'collect') {
      const left = ORE_NODES.map(([x, z], i) => ({ x, z, id: `ore_${i}` })).filter((o) => !this.worldState.has(o.id));
      const pp = this.player.position;
      left.sort((a, b) => Math.hypot(a.x - pp.x, a.z - pp.z) - Math.hypot(b.x - pp.x, b.z - pp.z));
      return left[0] ?? null;
    }
    if (obj.type === 'kill') {
      if (obj.enemy === 'skeleton') return { x: p.cave.x, z: p.cave.z };
      return { x: p.bandit_camp.x, z: p.bandit_camp.z };
    }
    return null;
  }

  get timeText() {
    const h = this.environment.hours;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  get weatherLabel() {
    return WEATHER_TYPES[this.weather.type]?.label ?? '';
  }

  /* ================================================================ saving */

  collectSaveData() {
    const p = this.player.position;
    return {
      player: { position: { x: p.x, y: p.y, z: p.z }, facing: this.player.controller.facing },
      stats: this.stats.toJSON(),
      inventory: this.inventory.toJSON(),
      skills: this.skills.toJSON(),
      quests: this.quests.toJSON(),
      world: {
        hours: this.environment.hours,
        weather: this.weather.toJSON(),
        state: [...this.worldState],
        discovered: [...this.discovered],
        enemies: this.enemies.toJSON(),
      },
    };
  }

  async saveGame(announce) {
    if (!this.player.alive) return false;
    this._autosave = 0;
    const ok = await SaveSystem.save(this.config.game.saveSlot, this.collectSaveData());
    this.lastSaveText = ok ? `Saved at ${new Date().toLocaleTimeString()}` : 'Saving is unavailable in this browser.';
    if (announce) this.hud.notify(ok ? 'Game saved' : 'Could not save in this browser', ok ? 'info' : 'warn');
    if (this.journal?.isOpen && this.journal.tab === 'system') this.journal.render();
    return ok;
  }

  async loadGame(announce) {
    const data = await SaveSystem.load(this.config.game.saveSlot);
    if (!data) {
      if (announce) this.hud.notify('No saved game found', 'warn');
      return false;
    }
    this._applySave(data);
    if (announce) this.hud.notify('Game loaded', 'info');
    return true;
  }

  _applySave(data) {
    this.worldState = new Set(data.world?.state ?? []);
    this.structures.worldState = this.worldState;
    this.discovered = new Set(data.world?.discovered ?? []);
    this.stats.fromJSON(data.stats);
    this.skills.fromJSON(data.skills);
    this.inventory.fromJSON(data.inventory);
    this.quests.fromJSON(data.quests);
    this.enemies.fromJSON(data.world?.enemies);
    this.weather.fromJSON(data.world?.weather);
    this.environment.setTime(data.world?.hours ?? this.config.environment.startHour);
    const pos = data.player?.position;
    if (pos) {
      this._ensureWorldAt(pos.x, pos.z);
      const y = Math.max(pos.y, this.gen.heightAt(pos.x, pos.z) + 1.0);
      this.player.controller.position.set(pos.x, y, pos.z);
      this.player.controller.prevPosition.copy(this.player.controller.position);
      this.player.controller.body.setTranslation(this.player.controller.position, true);
      this.player.controller.velocity.set(0, 0, 0);
      this.player.controller.facing = data.player.facing ?? 0;
      this.cameraRig?.snapTo(this.player.controller.position);
    }
    // Re-open structures so chests/ore reflect the loaded state.
    for (const id of [...this.structures.built.keys()]) this.structures.unload(id);
    this.structures.update(this.player.position, { all: true });
    this.lastSaveText = data.savedAt ? `Loaded save from ${new Date(data.savedAt).toLocaleString()}` : '';
    if (this.player.alive === false) this.player.revive();
  }

  async newGame() {
    await SaveSystem.remove(this.config.game.saveSlot);
    window.location.reload();
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function rarityColor(item) {
  return { common: '#c9c3b5', uncommon: '#7fc46a', rare: '#5aa6f0', epic: '#b57af0', legendary: '#f0a43c' }[item.rarity] ?? '#fff';
}
