// LightField.js — the hero engine.
//
// New, simple model (no procedural scene synthesis):
//   Pass 0  BASE   : hero_base.jpg drawn fullscreen (cover-fit). This IS the look.
//   Pass 1  GRAINS : a GPU sand simulation — fine grains drift slowly downhill,
//                    tinted with the local scene colour, confined to sand_mask.png.
//   Post           : a very subtle bloom so the grains catch a soft glow.
//
// The only animated element is the sand. Mouse interaction is live: grains
// within a region of the cursor get excited (extra shimmer) and glow brighter.
// (Nav-button attraction is the next step — the swirl force + attractor stubs
// are already in place for it.)
//
// Lifecycle mirrors the reactbits components: imperative init, single rAF loop,
// pause offscreen/hidden, full WebGL teardown on dispose().

import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { buildPositionShader, buildVelocityShader } from './shaders/sim.js';
import { BASE_VERT, BASE_FRAG, GRAIN_VERT, GRAIN_FRAG } from './shaders/render.js';

const BASE_URL = '/background_new.png';      // the static scene
const MASK_URL = '/particle_area_mask.png';  // white = sand the grains live on
const SPAWN_DIM = 128; // spawn lookup is SPAWN_DIM^2 in-mask points

export const DEFAULTS = {
  // ---- grains ----
  simSize: 179,            // grain count = simSize^2 (179 => ~32k, +25% vs 160)
  driftSpeed: 0.03,        // slow downhill drift (image-UV / sec)
  slopeDir: [0.22, -0.62], // downhill direction in image space (y up, so -y = down)
  baseReturn: 1.1,         // relax velocity back to the drift
  damping: 0.15,
  maxSpeed: 0.32,
  lifeMin: 3.0,
  lifeMax: 8.0,
  bottom: -0.02,           // respawn once a grain falls below this v

  // gentle turbulence so the fall meanders
  curlStrength: 0.06,
  curlScale: 3.2,
  curlSpeed: 0.06,

  // ---- grain look ----
  grainSize: 2.4,          // base max size; excited grains grow ~1.25x (see shader)
  colorBoost: 1.5,         // grains read a touch brighter than the scene
  energyBoost: 2.66,       // extra brightness for excited (mouse-lit) grains
  fadeIn: 0.4,
  fadeOut: 1.0,

  // ---- mouse interaction (live) ----
  interaction: true,
  mouseStrength: 0.5,      // scatter/lift of excited grains
  mouseRadius: 0.108,      // size of the excited region (image-v units, circular)
  mouseLift: 0.7,          // upward kick component
  mouseSmooth: 0.18,
  energyDecay: 2.2,        // how fast the glow relaxes once the cursor leaves

  // ---- post ----
  bloom: true,
  bloomStrength: 0.22,     // VERY subtle — must not wash the photo
  bloomRadius: 0.5,
  bloomThreshold: 0.7,     // only near-white highlights bloom

  // ---- runtime ----
  maxDpr: 2,
  reducedMotion: false
};

const u = (value) => ({ value });

export default class LightField {
  constructor(container, options = {}) {
    this.container = container;
    this.cfg = { ...DEFAULTS, ...(options.config || {}) };
    this.onError = options.onError || (() => {});

    this.running = false;
    this.rafId = 0;
    this.clock = new THREE.Clock();
    this.imageAspect = 2411 / 1104; // refined from the loaded base image
    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;

    // pointer state (image UV); used once interaction is enabled
    this.target = new THREE.Vector2(0.5, 0.5);
    this.smooth = new THREE.Vector2(0.5, 0.5);
    this.pointerInside = false;

    this._boundResize = this._onResize.bind(this);

    try {
      this._initRenderer();
      this._initTextures(() => {
        if (this.disposed) return;
        this._buildSpawnTexture();
        this._initScene();
        this._initSim();
        this._initPost();
        this._onResize();
        this.ready = true;
        if (this._wantStart) this.start();
      });
    } catch (err) {
      this.onError(err);
    }
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.cfg.maxDpr));
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0x000000, 1);

    const gl = this.renderer.getContext();
    this.canvas = this.renderer.domElement;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.container.appendChild(this.canvas);
    window.addEventListener('resize', this._boundResize);

    this.floatType =
      this.renderer.capabilities.isWebGL2 && gl.getExtension('EXT_color_buffer_float')
        ? THREE.FloatType
        : THREE.HalfFloatType;

    this.camera = new THREE.Camera(); // identity; shaders write clip-space directly
    this.scene = new THREE.Scene();
  }

  _initTextures(done) {
    const loader = new THREE.TextureLoader();
    let pending = 2;
    const onOne = () => { if (--pending === 0) done(); };

    this.baseTex = loader.load(BASE_URL, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;          // it's a photo -> sRGB
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      if (t.image) this.imageAspect = t.image.width / t.image.height;
      onOne();
    }, undefined, (e) => this.onError(e));

    this.maskTex = loader.load(MASK_URL, (t) => {
      t.colorSpace = THREE.NoColorSpace;            // raw mask values
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      this._maskImage = t.image;
      onOne();
    }, undefined, (e) => this.onError(e));
  }

  // Read the mask once on the CPU and collect points inside the white (sand)
  // region, so grains can be respawned guaranteed-inside-the-mask on the GPU.
  _buildSpawnTexture() {
    const img = this._maskImage;
    const pts = [];
    try {
      const w = 220;
      const h = Math.max(2, Math.round(220 * img.height / img.width));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (d[(y * w + x) * 4] > 128) {           // white -> sand
            // jitter within the source pixel so spawns are continuous, not a grid
            pts.push((x + Math.random()) / w, 1 - (y + Math.random()) / h);
          }
        }
      }
    } catch (e) {
      // canvas read failed (shouldn't for a same-origin asset) — fall through
    }

    const data = new Float32Array(SPAWN_DIM * SPAWN_DIM * 4);
    const n = pts.length / 2;
    for (let i = 0; i < SPAWN_DIM * SPAWN_DIM; i++) {
      let ux, vy;
      if (n > 0) {
        const k = (Math.random() * n) | 0;
        ux = pts[k * 2]; vy = pts[k * 2 + 1];
      } else {
        // fallback band (lower-centre) if no mask points were found
        ux = 0.25 + Math.random() * 0.5;
        vy = 0.1 + Math.random() * 0.5;
      }
      data[i * 4] = ux; data[i * 4 + 1] = vy;
    }
    this.spawnTex = new THREE.DataTexture(data, SPAWN_DIM, SPAWN_DIM, THREE.RGBAFormat, THREE.FloatType);
    this.spawnTex.minFilter = THREE.NearestFilter;
    this.spawnTex.magFilter = THREE.NearestFilter;
    this.spawnTex.needsUpdate = true;
  }

  _initScene() {
    // shared cover-fit scale (field UV -> image UV), updated on resize
    this.uImgUvScale = u(new THREE.Vector2(1, 1));
    this.uDpr = u(this.renderer.getPixelRatio());
    const plane = new THREE.PlaneGeometry(2, 2);
    this.planeGeo = plane;

    // --- Pass 0: base photo ---
    this.baseMat = new THREE.ShaderMaterial({
      vertexShader: BASE_VERT,
      fragmentShader: BASE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: { uBaseTex: u(this.baseTex), uImgUvScale: this.uImgUvScale }
    });
    const baseMesh = new THREE.Mesh(plane, this.baseMat);
    baseMesh.frustumCulled = false;
    baseMesh.renderOrder = 0;
    this.scene.add(baseMesh);
  }

  _initSim() {
    const c = this.cfg;
    const SIM = c.simSize;
    this.count = SIM * SIM;

    const gpu = new GPUComputationRenderer(SIM, SIM, this.renderer);
    gpu.setDataType(this.floatType);
    this.gpu = gpu;

    const pos0 = gpu.createTexture();
    const vel0 = gpu.createTexture();
    this._seedTextures(pos0, vel0);

    this.posVar = gpu.addVariable('texturePosition', buildPositionShader(), pos0);
    this.velVar = gpu.addVariable('textureVelocity', buildVelocityShader(), vel0);
    gpu.setVariableDependencies(this.posVar, [this.posVar, this.velVar]);
    gpu.setVariableDependencies(this.velVar, [this.posVar, this.velVar]);

    this.simUniforms = {
      uDt: u(0), uTime: u(0),
      uSlopeDir: u(new THREE.Vector2(c.slopeDir[0], c.slopeDir[1])),
      uDriftSpeed: u(c.driftSpeed), uBaseReturn: u(c.baseReturn),
      uDamping: u(c.damping), uMaxSpeed: u(c.maxSpeed),
      uCurlStrength: u(c.curlStrength), uCurlScale: u(c.curlScale), uCurlSpeed: u(c.curlSpeed),
      uSpawnTex: u(this.spawnTex), uSpawnDim: u(SPAWN_DIM),
      uLifeMin: u(c.lifeMin), uLifeMax: u(c.lifeMax),
      uBottom: u(c.bottom), uSeed: u(Math.random() * 1000),
      uMouse: u(new THREE.Vector2(0.5, 0.5)), uMouseActive: u(0),
      uMouseStrength: u(c.mouseStrength), uMouseRadius: u(c.mouseRadius),
      uMouseLift: u(c.mouseLift), uEnergyDecay: u(c.energyDecay),
      uMouseAspect: u(this.imageAspect) // make the excited region circular on screen
    };
    Object.assign(this.posVar.material.uniforms, this.simUniforms);
    Object.assign(this.velVar.material.uniforms, this.simUniforms);

    const err = gpu.init();
    if (err) { this.onError(new Error('GPUComputationRenderer: ' + err)); return; }

    // --- Pass 1: grain points ---
    const refs = new Float32Array(this.count * 2);
    const dummy = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      refs[i * 2] = ((i % SIM) + 0.5) / SIM;
      refs[i * 2 + 1] = (Math.floor(i / SIM) + 0.5) / SIM;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(dummy, 3));
    geo.setAttribute('reference', new THREE.BufferAttribute(refs, 2));
    this.grainGeo = geo;

    this.grainMat = new THREE.ShaderMaterial({
      vertexShader: GRAIN_VERT,
      fragmentShader: GRAIN_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        texturePosition: u(null), textureVelocity: u(null),
        uBaseTex: u(this.baseTex), uMaskTex: u(this.maskTex),
        uImgUvScale: this.uImgUvScale, uDpr: this.uDpr,
        uGrainSize: u(c.grainSize), uColorBoost: u(c.colorBoost),
        uEnergyBoost: u(c.energyBoost), uFadeIn: u(c.fadeIn), uFadeOut: u(c.fadeOut)
      }
    });
    const grains = new THREE.Points(geo, this.grainMat);
    grains.frustumCulled = false;
    grains.renderOrder = 1;
    this.scene.add(grains);

    if (c.reducedMotion) for (let i = 0; i < 20; i++) gpu.compute();
  }

  _seedTextures(posTex, velTex) {
    const c = this.cfg;
    const p = posTex.image.data;
    const v = velTex.image.data;
    const sx = c.slopeDir[0], sy = c.slopeDir[1];
    const sl = Math.hypot(sx, sy) || 1;
    const vx = (sx / sl) * c.driftSpeed, vy = (sy / sl) * c.driftSpeed;
    const pts = this.spawnTex.image.data; // reuse in-mask spawn points
    const n = SPAWN_DIM * SPAWN_DIM;
    for (let i = 0; i < this.count; i++) {
      const j = i * 4;
      const k = ((Math.random() * n) | 0) * 4;
      const maxLife = c.lifeMin + Math.random() * (c.lifeMax - c.lifeMin);
      p[j] = pts[k]; p[j + 1] = pts[k + 1];   // start inside the mask
      p[j + 2] = 0;                           // energy
      p[j + 3] = Math.random() * maxLife;     // staggered age
      v[j] = vx; v[j + 1] = vy;
      v[j + 2] = maxLife;
      v[j + 3] = Math.random();
    }
  }

  _initPost() {
    const c = this.cfg;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (c.bloom) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(this.width, this.height),
        c.bloomStrength, c.bloomRadius, c.bloomThreshold
      );
      this.composer.addPass(this.bloomPass);
    }
  }

  _onResize() {
    if (!this.renderer) return;
    this.width = this.container.clientWidth || window.innerWidth;
    this.height = this.container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.cfg.maxDpr);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height);
    if (this.composer) this.composer.setSize(this.width, this.height);
    if (this.bloomPass) this.bloomPass.setSize(this.width, this.height);

    if (!this.uImgUvScale) return;
    this.uDpr.value = dpr;
    // cover-fit (CSS "background-size: cover"): field UV -> image UV
    const ca = this.width / this.height;
    const ia = this.imageAspect;
    let sx, sy;
    if (ca > ia) { sx = 1; sy = ia / ca; } else { sy = 1; sx = ca / ia; }
    this.uImgUvScale.value.set(sx, sy);
  }

  // ---- pointer (image UV); used once interaction is enabled ----
  setPointer(uvX, uvY, inside) {
    // screen field UV -> image UV via cover-fit
    const s = this.uImgUvScale ? this.uImgUvScale.value : { x: 1, y: 1 };
    this.target.set((uvX - 0.5) * s.x + 0.5, (uvY - 0.5) * s.y + 0.5);
    this.pointerInside = inside;
  }
  setPointerInside(inside) { this.pointerInside = inside; }

  start() {
    if (!this.ready) { this._wantStart = true; return; }
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  _loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this._loop);

    const dt = Math.min(this.clock.getDelta(), 1 / 30);
    const c = this.cfg;
    const su = this.simUniforms;

    if (c.interaction) {
      this.smooth.lerp(this.target, c.mouseSmooth);
      su.uMouse.value.copy(this.smooth);
      su.uMouseActive.value = this.pointerInside ? 1 : 0;
    } else {
      su.uMouseActive.value = 0;
    }

    if (!c.reducedMotion) {
      su.uTime.value += dt;
      su.uDt.value = dt;
      this.gpu.compute();
    }

    this.grainMat.uniforms.texturePosition.value =
      this.gpu.getCurrentRenderTarget(this.posVar).texture;
    this.grainMat.uniforms.textureVelocity.value =
      this.gpu.getCurrentRenderTarget(this.velVar).texture;

    this.composer.render();
  };

  dispose() {
    this.disposed = true;
    this.stop();
    window.removeEventListener('resize', this._boundResize);

    this.planeGeo?.dispose();
    this.grainGeo?.dispose();
    this.baseMat?.dispose();
    this.grainMat?.dispose();
    this.baseTex?.dispose();
    this.maskTex?.dispose();
    this.spawnTex?.dispose();
    this.gpu?.dispose?.();
    this.bloomPass?.dispose?.();
    this.composer?.dispose?.();

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss?.();
      const gl = this.renderer.getContext();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (this.canvas?.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
    this.renderer = null;
  }
}

/*
README — tunables (config passed to LightField / DEFAULTS):

  ASSETS (in /public, swap freely): background_new.png (the scene),
    particle_area_mask.png (white = sand the grains live on; black = figure + sky).

  GRAINS
    simSize ...... grain count = simSize^2 (160 => ~25.6k)
    driftSpeed ... slow downhill drift speed
    slopeDir ..... downhill direction in image space [x,y] (y up, so -y is down)
    baseReturn, damping, maxSpeed, lifeMin, lifeMax, bottom (respawn line)
    curlStrength/Scale/Speed ... gentle meander turbulence

  GRAIN LOOK
    grainSize, colorBoost (vs the scene), energyBoost (mouse-disturbed),
    fadeIn, fadeOut

  MOUSE INTERACTION (live; cfg.interaction = true)
    grains near the cursor shimmer + glow. mouseStrength (scatter/lift),
    mouseRadius (region size, aspect-corrected), mouseLift (upward kick),
    mouseSmooth (cursor follow), energyDecay (glow relax), energyBoost (glow amount)

  POST
    bloom, bloomStrength, bloomRadius, bloomThreshold (kept high + subtle so the
    photo is not washed)

  RUNTIME
    maxDpr (DPR clamp), reducedMotion
*/
