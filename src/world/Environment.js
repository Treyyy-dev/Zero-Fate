import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp, smoothstep } from '../utils/math.js';

const _up = new THREE.Vector3(0, 1, 0);
const _lsRight = new THREE.Vector3();
const _lsUp = new THREE.Vector3();
const _snapped = new THREE.Vector3();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

const FOG_DAY = new THREE.Color(0xb3c4d4);
const FOG_SUNSET = new THREE.Color(0xd8a886);
const FOG_NIGHT = new THREE.Color(0x0c1424);
const FOG_STORM = new THREE.Color(0x6a737e);
const SUN_LOW = new THREE.Color(0xffa860);
const SUN_HIGH = new THREE.Color(0xfff1de);
const MOON = new THREE.Color(0x9fb6ff);

/**
 * Sky, sun & moon, image-based lighting, fog, stars and clouds, driven by the
 * time of day and the current weather.
 *
 * Realistic lighting comes from three parts working together:
 *  1. Physical sky (Rayleigh/Mie scattering shader)
 *  2. Image-based lighting: the same sky is pre-filtered into an environment
 *     map (PMREM) and refreshed periodically as the sun moves
 *  3. ONE shadow-casting directional light (sun by day, moon by night)
 * Fog follows the horizon colour so distant terrain melts into the sky.
 */
export class Environment {
  constructor({ scene, renderer, cfg, quality }) {
    this.scene = scene;
    this.renderer = renderer;
    this.cfg = cfg;
    this.quality = quality;
    this.hours = cfg.startHour ?? 9;
    this.sunDirection = new THREE.Vector3();
    this.moonDirection = new THREE.Vector3();
    this.dayFactor = 1;
    this.nightFactor = 0;
    this.indoor = 0; // 0 outside … 1 deep in a cave
    this._indoorTarget = 0;
    this.weather = { cloud: 0.15, rain: 0, fog: 1, light: 1, wind: 0.6, flash: 0 };
    this.baseFogDensity = quality.fogDensity ?? cfg.fogDensity;

    // --- Sky dome ---
    this.sky = this._createSky();
    this.sky.scale.setScalar(1800);
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    // --- Stars, moon, clouds ---
    this.stars = this._createStars();
    scene.add(this.stars);
    this.moon = new THREE.Mesh(
      new THREE.CircleGeometry(38, 24),
      new THREE.MeshBasicMaterial({ color: 0xe9eef8, fog: false, transparent: true, depthWrite: false }),
    );
    this.moon.renderOrder = -1;
    scene.add(this.moon);
    this.clouds = this._createClouds();
    scene.add(this.clouds);

    // --- Fog ---
    scene.fog = new THREE.FogExp2(FOG_DAY.getHex(), this.baseFogDensity);
    scene.background = FOG_DAY.clone();

    // --- One shadow-casting light (sun / moon) ---
    const sun = new THREE.DirectionalLight(cfg.sunColor, cfg.sunIntensity);
    sun.castShadow = true;
    const area = quality.shadowArea;
    Object.assign(sun.shadow.camera, { left: -area / 2, right: area / 2, top: area / 2, bottom: -area / 2, near: 1, far: 260 });
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2;
    this.sun = sun;
    this._shadowTexel = area / quality.shadowMapSize;
    scene.add(sun, sun.target);

    this.hemi = new THREE.HemisphereLight(cfg.hemiSky, cfg.hemiGround, cfg.hemiIntensity);
    scene.add(this.hemi);

    // --- Image-based lighting ---
    this.pmrem = new THREE.PMREMGenerator(renderer.three);
    this.envScene = new THREE.Scene();
    this.envSky = this._createSky();
    this.envSky.scale.setScalar(900);
    this.envScene.add(this.envSky);
    this._envTimer = 0;
    this._lastEnvKey = '';
    this.setTime(this.hours);
    this._refreshEnvironment();
  }

  _createSky() {
    const sky = new Sky();
    const u = sky.material.uniforms;
    u.turbidity.value = this.cfg.sky.turbidity;
    u.rayleigh.value = this.cfg.sky.rayleigh;
    u.mieCoefficient.value = this.cfg.sky.mieCoefficient;
    u.mieDirectionalG.value = this.cfg.sky.mieDirectionalG;
    return sky;
  }

  _createStars() {
    const count = this.quality.mobile ? 900 : 1800;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const y = Math.abs(u) * 0.95 + 0.05;
      pos.set([r * Math.cos(t) * 1500, y * 1500, r * Math.sin(t) * 1500], i * 3);
      size[i] = 1 + Math.random() * 2.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: `attribute float aSize; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uOpacity; void main(){ float d = length(gl_PointCoord-0.5); if(d>0.5) discard; gl_FragColor = vec4(vec3(1.0), uOpacity * smoothstep(0.5,0.0,d)); }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = -2;
    return p;
  }

  _createClouds() {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCover: { value: 0.2 },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uShade: { value: new THREE.Color(0.6, 0.65, 0.72) },
        uOffset: { value: new THREE.Vector2() },
      },
      vertexShader: `varying vec2 vUv; varying float vEdge; void main(){ vUv = uv; vEdge = length(uv-0.5)*2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform float uCover; uniform vec3 uSunColor; uniform vec3 uShade; uniform vec2 uOffset;
        varying vec2 vUv; varying float vEdge;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
        void main(){
          vec2 p = vUv * 9.0 + uOffset + vec2(uTime*0.004, uTime*0.0015);
          float n = fbm(p);
          float c = smoothstep(1.0 - uCover - 0.05, 1.05 - uCover * 0.55, n);
          float shade = fbm(p * 1.7 + 4.0);
          vec3 col = mix(uSunColor, uShade, clamp(shade * 1.2 * c, 0.0, 1.0));
          float alpha = c * (1.0 - smoothstep(0.55, 1.0, vEdge)) * 0.92;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(col, alpha);
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    const geom = new THREE.PlaneGeometry(5200, 5200, 1, 1);
    geom.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geom, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    return mesh;
  }

  /** Sets the time of day in hours (0–24). */
  setTime(hours) {
    this.hours = ((hours % 24) + 24) % 24;
    // Sun up from 05:00 to 20:00; below the horizon the rest of the night.
    const h = this.hours;
    const dayPhase = h >= 5 && h <= 20 ? (h - 5) / 15 : h > 20 ? 1 + (h - 20) / 9 : 1 + (h + 4) / 9;
    const elevation = dayPhase <= 1 ? Math.sin(dayPhase * Math.PI) * this.cfg.maxSunElevation : -Math.sin((dayPhase - 1) * Math.PI) * 40;
    const azimuth = 90 - 180 * dayPhase;
    this.sunElevation = elevation;
    this.sunDirection.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
    this.moonDirection.copy(this.sunDirection).negate();
    this.moonDirection.y = Math.max(0.15, this.moonDirection.y);
    this.moonDirection.normalize();
    this.dayFactor = smoothstep(-6, 8, elevation);
    this.nightFactor = 1 - smoothstep(-12, 2, elevation);
  }

  setIndoor(target) {
    this._indoorTarget = target;
  }

  /** Per-frame update. */
  update(dt, focus, camera, weather) {
    if (weather) this.weather = weather;
    const w = this.weather;
    this.indoor += (this._indoorTarget - this.indoor) * Math.min(1, dt * 2);
    const outdoor = 1 - this.indoor * 0.85;

    // Sky uniforms
    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(this.sunDirection);
    su.turbidity.value = lerp(this.cfg.sky.turbidity, 11, w.cloud * 0.8);
    su.rayleigh.value = lerp(this.cfg.sky.rayleigh, 0.5, w.cloud * 0.7);
    su.mieCoefficient.value = lerp(this.cfg.sky.mieCoefficient, 0.012, w.cloud);
    this.sky.position.copy(camera.position);

    // Light: sun by day, moon by night.
    const elev = this.sunElevation;
    const sunUp = elev > -3;
    const lightDir = sunUp ? this.sunDirection : this.moonDirection;
    const flash = w.flash ?? 0;
    if (sunUp) {
      _c1.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0, 28, elev));
      this.sun.color.copy(_c1);
      this.sun.intensity = this.cfg.sunIntensity * smoothstep(-3, 10, elev) * w.light * outdoor;
    } else {
      this.sun.color.copy(MOON);
      this.sun.intensity = this.cfg.moonIntensity * this.nightFactor * lerp(1, 0.35, w.cloud) * outdoor;
    }
    this.sun.intensity += flash * 6;

    this.hemi.color.set(this.cfg.hemiSky).lerp(_c2.set(0x2a3c5e), this.nightFactor);
    this.hemi.intensity = lerp(this.cfg.hemiIntensity, 0.5, this.nightFactor) * lerp(1, 1.25, w.cloud) * (1 - this.indoor * 0.6) + flash * 2;
    this.scene.environmentIntensity = this.cfg.environmentIntensity * (0.06 + 0.94 * this.dayFactor) * lerp(1, 0.7, w.cloud) * (1 - this.indoor * 0.75);

    // Fog colour/density
    _c1.copy(FOG_DAY).lerp(FOG_SUNSET, (1 - smoothstep(4, 18, elev)) * this.dayFactor * 0.8);
    _c1.lerp(FOG_STORM, w.cloud * 0.55 * this.dayFactor);
    _c1.lerp(FOG_NIGHT, this.nightFactor);
    if (flash > 0) _c1.lerp(_c2.set(0xdde6ff), flash * 0.6);
    this.scene.fog.color.copy(_c1);
    this.scene.background.copy(_c1);
    this.scene.fog.density = this.baseFogDensity * w.fog * (1 + this.indoor * 1.5);

    // Exposure: a little eye adaptation at night.
    this.renderer.three.toneMappingExposure = lerp(this.cfg.exposure, this.cfg.nightExposure, this.nightFactor);

    // Stars & moon
    this.stars.position.copy(camera.position);
    this.stars.material.uniforms.uOpacity.value = this.nightFactor * (1 - w.cloud * 0.9);
    this.moon.position.copy(camera.position).addScaledVector(this.moonDirection, 1400);
    this.moon.lookAt(camera.position);
    this.moon.material.opacity = this.nightFactor * (1 - w.cloud * 0.85);
    this.moon.visible = this.moon.material.opacity > 0.01;

    // Clouds
    const cu = this.clouds.material.uniforms;
    cu.uTime.value += dt * (1 + w.wind);
    cu.uCover.value = w.cloud;
    _c1.copy(this.sun.color).multiplyScalar(lerp(0.12, 1.0, this.dayFactor) * lerp(1, 0.55, w.cloud));
    cu.uSunColor.value.copy(_c1).lerp(_c2.set(0xffffff), 0.35 * this.dayFactor);
    cu.uShade.value.copy(_c1).multiplyScalar(0.55);
    this.clouds.position.set(camera.position.x, camera.position.y + 520, camera.position.z);
    cu.uOffset.value.set(camera.position.x / 5200 * 9, camera.position.z / 5200 * 9);

    // Shadow frustum follows the player, snapped to texels to avoid shimmer.
    _lsRight.crossVectors(_up, lightDir).normalize();
    _lsUp.crossVectors(lightDir, _lsRight).normalize();
    const texel = this._shadowTexel;
    const r = Math.round(focus.dot(_lsRight) / texel) * texel;
    const u = Math.round(focus.dot(_lsUp) / texel) * texel;
    const f = focus.dot(lightDir);
    _snapped.copy(_lsRight).multiplyScalar(r).addScaledVector(_lsUp, u).addScaledVector(lightDir, f);
    this.sun.target.position.copy(_snapped);
    this.sun.position.copy(_snapped).addScaledVector(lightDir, 120);
    this.sun.target.updateMatrixWorld();

    // Refresh image-based lighting when the sky has changed enough.
    this._envTimer += dt;
    if (this._envTimer >= (this.quality.envRefresh ?? 5)) {
      this._envTimer = 0;
      const key = `${Math.round(this.hours * 6)}|${Math.round(w.cloud * 10)}`;
      if (key !== this._lastEnvKey) this._refreshEnvironment(key);
    }
  }

  _refreshEnvironment(key = '') {
    const u = this.envSky.material.uniforms;
    const su = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDirection);
    u.turbidity.value = su.turbidity.value;
    u.rayleigh.value = su.rayleigh.value;
    u.mieCoefficient.value = su.mieCoefficient.value;
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.envTarget.texture;
    old?.dispose();
    this._lastEnvKey = key;
  }

  /** Light level 0..1 (used by window glow, torches, AI senses). */
  get darkness() {
    return clamp(this.nightFactor + this.weather.cloud * 0.25 * this.dayFactor, 0, 1);
  }

  dispose() {
    this.envTarget?.dispose();
    this.pmrem.dispose();
  }
}
