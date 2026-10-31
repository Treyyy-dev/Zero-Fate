import { Builder } from './Builder.js';
import { buildVillage, buildCastle, buildRuins, buildCave, buildBridge, buildCamp, buildOreNode, oreNodeSpecs } from './Sites.js';

/**
 * Streams every hand-placed site (village, castle, ruins, cave, camp,
 * bridges, ore veins) in and out by distance. Building a site merges its
 * geometry, creates its colliders and hands its interactables, torches and
 * NPCs to the systems that own them; unloading reverses all of it.
 *
 * At most one site is built per frame, so streaming never causes a long stall.
 */
export class StructureManager {
  constructor({ scene, physics, gen, materials, handlers, worldState, quality }) {
    this.scene = scene;
    this.physics = physics;
    this.gen = gen;
    this.materials = materials;
    this.handlers = handlers; // { interactable(entry, site) → disposer, npc(spec) → disposer, torches(list) → disposer }
    this.worldState = worldState;
    this.buildRadius = quality.mobile ? 320 : 420;
    this.unloadRadius = this.buildRadius + 140;
    const p = gen.poiById;
    this.sites = [
      { id: 'village', x: p.village.x, z: p.village.z, build: (b) => buildVillage(b, gen, p.village) },
      { id: 'castle', x: p.castle.x, z: p.castle.z, build: (b) => buildCastle(b, gen, p.castle) },
      { id: 'ruins', x: p.ruins.x, z: p.ruins.z, build: (b) => buildRuins(b, gen, p.ruins) },
      { id: 'cave', x: p.cave.x, z: p.cave.z, build: (b) => buildCave(b, gen, p.cave) },
      { id: 'bandit_camp', x: p.bandit_camp.x, z: p.bandit_camp.z, build: (b) => buildCamp(b, gen, p.bandit_camp) },
      ...gen.bridges.map((br, i) => ({ id: `bridge_${i}`, x: br.x, z: br.z, build: (b) => buildBridge(b, gen, br) })),
      ...oreNodeSpecs().map((o) => ({ id: o.id, x: o.x, z: o.z, small: true, skip: () => worldState.has(o.id), build: (b) => buildOreNode(b, gen, o) })),
    ];
    this.built = new Map(); // id → { group, colliders, disposers, spec }
  }

  update(focus, { all = false } = {}) {
    let builtThisFrame = 0;
    for (const site of this.sites) {
      const d = Math.hypot(focus.x - site.x, focus.z - site.z);
      const radius = site.small ? 160 : this.buildRadius;
      const isBuilt = this.built.has(site.id);
      if (!isBuilt && d < radius && !(site.skip && site.skip())) {
        if (!all && builtThisFrame >= 1) continue;
        this._build(site);
        builtThisFrame++;
      } else if (isBuilt && d > radius + 140) {
        this.unload(site.id);
      }
    }
  }

  _build(site) {
    const b = new Builder();
    const spec = site.build(b);
    const { group, colliders } = b.finish(this.materials, this.physics);
    group.name = `site_${site.id}`;
    this.scene.add(group);
    const disposers = [];
    for (const entry of spec.interactables) {
      const d = this.handlers.interactable?.(entry, site, group);
      if (d) disposers.push(d);
    }
    for (const npc of spec.npcs) {
      const d = this.handlers.npc?.(npc, site);
      if (d) disposers.push(d);
    }
    if (spec.torches.length) {
      const d = this.handlers.torches?.(spec.torches, site);
      if (d) disposers.push(d);
    }
    if (spec.fire) {
      const d = this.handlers.fire?.(spec.fire, site);
      if (d) disposers.push(d);
    }
    this.built.set(site.id, { group, colliders, disposers, spec });
  }

  unload(id) {
    const s = this.built.get(id);
    if (!s) return;
    for (const d of s.disposers) d();
    for (const c of s.colliders) this.physics.world.removeCollider(c, false);
    s.group.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    s.group.removeFromParent();
    this.built.delete(id);
  }

  /** 0 (outdoors) … 1 (deep indoors), e.g. inside the cave. */
  indoorAt(p) {
    let v = 0;
    for (const s of this.built.values()) if (s.spec.indoor) v = Math.max(v, s.spec.indoor(p));
    return v;
  }

  isBuilt(id) {
    return this.built.has(id);
  }
}
