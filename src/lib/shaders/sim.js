// GPGPU simulation for the SAND grains (the only animated element).
//
// Grains live in IMAGE-UV space [0,1] (y up) — the same framing as hero_base.jpg
// and sand_mask.png — so confinement + scene-colour are direct texture reads and
// only the final screen mapping uses cover-fit.
//
//   texturePosition : rgba = (u, v, energy, age)      energy = mouse disturbance (0 for now)
//   textureVelocity : rgba = (vx, vy, maxLife, seed)
//
// texturePosition / textureVelocity / resolution are injected by GPUComputationRenderer.

import { SIMPLEX_3D, HELPERS, CURL } from './common.js';

const SIM_UNIFORMS = /* glsl */ `
uniform float uDt;
uniform float uTime;

uniform vec2  uSlopeDir;     // downhill direction in image space (down ~ -y)
uniform float uDriftSpeed;   // slow drift speed
uniform float uBaseReturn;   // relax velocity back to the downhill drift
uniform float uDamping;
uniform float uMaxSpeed;

uniform float uCurlStrength; // gentle turbulence so grains meander
uniform float uCurlScale;
uniform float uCurlSpeed;

uniform sampler2D uSpawnTex; // lookup of in-mask spawn points (RG = image uv)
uniform float uSpawnDim;     // spawn texture is uSpawnDim x uSpawnDim

uniform float uLifeMin;
uniform float uLifeMax;
uniform float uBottom;       // respawn once a grain falls below this v
uniform float uSeed;

// --- mouse interaction (live while uMouseActive == 1) ---
uniform vec2  uMouse;        // image uv
uniform float uMouseActive;
uniform float uMouseStrength;
uniform float uMouseRadius;
uniform float uMouseLift;
uniform float uMouseAspect;  // image aspect, so the excited region is circular
uniform float uEnergyDecay;
`;

const SIM_FUNCS = /* glsl */ `
bool isDead(vec2 pos, float age, float maxLife){
  return age >= maxLife || pos.y < uBottom || pos.x < -0.05 || pos.x > 1.05 || pos.y > 1.05;
}

// pick a random spawn point that is guaranteed to be inside the sand mask
vec2 spawnPoint(){
  float s = floor(uTime * 60.0) + uSeed;
  float r1 = hash12(gl_FragCoord.xy + s);
  float r2 = hash12(gl_FragCoord.xy * 1.7 + s * 3.1);
  vec2 tc = vec2((floor(r1 * uSpawnDim) + 0.5) / uSpawnDim,
                 (floor(r2 * uSpawnDim) + 0.5) / uSpawnDim);
  // small extra jitter so grains sharing a spawn slot don't overlap exactly
  vec2 j = (vec2(hash12(gl_FragCoord.yx + s * 2.3), hash12(gl_FragCoord.xy + s * 9.1)) - 0.5) * 0.01;
  return texture2D(uSpawnTex, tc).xy + j;
}
`;

const POSITION_MAIN = /* glsl */ `
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(texturePosition, uv);
  vec4 V = texture2D(textureVelocity, uv);
  vec2 pos = P.xy;
  float energy = P.z;
  float age = P.w;
  float maxLife = V.z;

  if (isDead(pos, age, maxLife)) {
    pos = spawnPoint();
    age = 0.0;
    energy = 0.0;
  } else {
    pos += V.xy * uDt;
    age += uDt;
    // mouse excitement pumps energy (the glow); it relaxes back once the cursor leaves
    vec2 dm = (pos - uMouse) * vec2(uMouseAspect, 1.0);
    float ex = exp(-dot(dm, dm) / (uMouseRadius * uMouseRadius)) * uMouseActive;
    energy = max(energy, ex);
    energy *= max(0.0, 1.0 - uEnergyDecay * uDt);
  }

  gl_FragColor = vec4(pos, energy, age);
}
`;

const VELOCITY_MAIN = /* glsl */ `
void main(){
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(texturePosition, uv);
  vec4 V = texture2D(textureVelocity, uv);
  vec2 pos = P.xy;
  float age = P.w;
  float maxLife = V.z;
  float seed = V.w;

  vec2 baseVel = normalize(uSlopeDir) * uDriftSpeed;   // slow downhill drift

  if (isDead(pos, age, maxLife)) {
    float s = floor(uTime * 60.0) + uSeed;
    seed = hash12(gl_FragCoord.xy + s * 5.9);
    float newMax = mix(uLifeMin, uLifeMax, hash12(gl_FragCoord.xy + s * 4.7));
    vec2 jit = (hash22(gl_FragCoord.xy + s * 7.3) - 0.5) * baseVel * 0.6;
    gl_FragColor = vec4(baseVel + jit, newMax, seed);
    return;
  }

  // gentle curl turbulence so the fall meanders like real sand
  vec2 acc = curl(pos * uCurlScale, uTime * uCurlSpeed) * uCurlStrength;

  // mouse excitement: grains within uMouseRadius of the cursor shimmer harder
  // and scatter/lift a little. Glow is pumped in the position pass (energy).
  // Aspect-corrected (uMouseAspect) so the excited region reads circular.
  vec2 toM = pos - uMouse;
  vec2 dm = toM * vec2(uMouseAspect, 1.0);
  float fall = exp(-dot(dm, dm) / (uMouseRadius * uMouseRadius)) * uMouseActive;
  // shimmer: faster, finer curl right around the cursor
  acc += curl(pos * uCurlScale * 2.4, uTime * uCurlSpeed * 4.0) * uCurlStrength * fall * 5.0;
  // gentle scatter + upward kick so the field visibly reacts
  vec2 push = (length(toM) > 1e-4 ? normalize(toM) : vec2(0.0, 1.0));
  acc += (push + vec2(0.0, uMouseLift)) * uMouseStrength * fall;

  vec2 nvel = V.xy + acc * uDt;
  nvel += (baseVel - nvel) * uBaseReturn * uDt;          // relax to the drift
  nvel *= clamp(1.0 - uDamping * uDt, 0.0, 1.0);

  float sp = length(nvel);
  if (sp > uMaxSpeed) nvel *= uMaxSpeed / sp;

  gl_FragColor = vec4(nvel, maxLife, seed);
}
`;

export function buildPositionShader() {
  return HELPERS + SIM_UNIFORMS + SIM_FUNCS + POSITION_MAIN;
}

export function buildVelocityShader() {
  return SIMPLEX_3D + HELPERS + CURL + SIM_UNIFORMS + SIM_FUNCS + VELOCITY_MAIN;
}
