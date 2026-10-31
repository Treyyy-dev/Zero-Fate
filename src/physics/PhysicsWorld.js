import RAPIER, { initRapier } from './rapier.js';

/**
 * Thin wrapper around a Rapier world.
 * - Static colliders for terrain and props
 * - Dynamic bodies linked to meshes (synced after each step)
 * - Ray queries (used by the camera)
 */
export class PhysicsWorld {
  static async create(config) {
    await initRapier();
    return new PhysicsWorld(config);
  }

  constructor(config) {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: config.gravity, z: 0 });
    this.world.timestep = config.fixedStep;
    this.links = []; // { body, mesh } pairs for dynamic props
  }

  step() {
    this.world.step();
  }

  addStaticTrimesh(vertices, indices, { friction = 0.9 } = {}) {
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(friction);
    return this.world.createCollider(desc);
  }

  addStaticCuboid(halfExtents, position, quaternion, { friction = 0.8 } = {}) {
    const desc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setTranslation(position.x, position.y, position.z)
      .setFriction(friction);
    if (quaternion) desc.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
    return this.world.createCollider(desc);
  }

  addStaticCylinder(halfHeight, radius, position, quaternion) {
    const desc = RAPIER.ColliderDesc.cylinder(halfHeight, radius).setTranslation(position.x, position.y, position.z);
    if (quaternion) desc.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w });
    return this.world.createCollider(desc);
  }

  /** points: Float32Array of xyz relative to `position`. Returns null for degenerate input. */
  addStaticConvexHull(points, position) {
    const desc = RAPIER.ColliderDesc.convexHull(points);
    if (!desc) return null;
    desc.setTranslation(position.x, position.y, position.z).setFriction(0.9);
    return this.world.createCollider(desc);
  }

  /** Creates a dynamic box whose transform drives `mesh`. */
  addDynamicCuboid(mesh, halfExtents, position, { density = 60, friction = 0.7 } = {}) {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(0.2)
      .setAngularDamping(0.4);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setDensity(density)
      .setFriction(friction);
    this.world.createCollider(colliderDesc, body);
    this.links.push({ body, mesh });
    return body;
  }

  /** Copies dynamic body transforms onto their meshes. */
  syncDynamic() {
    for (const { body, mesh } of this.links) {
      if (body.isSleeping()) continue;
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  /**
   * Casts a ray and returns the hit distance, or null.
   * `direction` must be normalised. `excludeBody` is skipped (e.g. the player).
   */
  castRay(origin, direction, maxDistance, excludeBody) {
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: direction.x, y: direction.y, z: direction.z },
    );
    const hit = this.world.castRay(ray, maxDistance, true, undefined, undefined, undefined, excludeBody);
    if (!hit) return null;
    return hit.timeOfImpact ?? hit.toi;
  }

  dispose() {
    this.world.free();
  }
}
