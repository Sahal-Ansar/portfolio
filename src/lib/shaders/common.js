// Shared GLSL chunks used across the simulation + render shaders.
// Kept in one place so the curl-noise / hashing math is defined once.

// Ashima 3D simplex noise (public domain / MIT). Returns ~[-1, 1].
// We use the 3rd dimension as an animation axis so the flow field evolves.
export const SIMPLEX_3D = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// Hashing + small helpers. perp() returns the 90deg rotation used everywhere
// for "swirl around a point" (vortex, mouse, attractors). No snoise dependency,
// so this chunk is safe to include in the lightweight position shader.
export const HELPERS = /* glsl */ `
float hash11(float n){ return fract(sin(n) * 43758.5453123); }
float hash12(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }
vec2  hash22(vec2 p){
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453123);
}
vec2 perp(vec2 v){ return vec2(-v.y, v.x); }
`;

// Divergence-free 2D curl of a scalar simplex potential. (Depends on snoise, so
// only the velocity shader pulls this in.) This is what makes the streams meander
// organically instead of going straight.
export const CURL = /* glsl */ `
vec2 curl(vec2 p, float t){
  const float e = 0.12;
  vec3 P = vec3(p, t);
  float dpdx = (snoise(P + vec3(e, 0.0, 0.0)) - snoise(P - vec3(e, 0.0, 0.0))) / (2.0 * e);
  float dpdy = (snoise(P + vec3(0.0, e, 0.0)) - snoise(P - vec3(0.0, e, 0.0))) / (2.0 * e);
  return vec2(dpdy, -dpdx);
}
`;

// "Swirl around a point" force, reused by the mouse and (Phase 2) nav attractors.
// Mostly tangential (orbit), plus a tunable radial pull, with a gaussian falloff.
// All coords are in aspect-corrected space so the orbit reads as circular on screen.
export const SWIRL = /* glsl */ `
vec2 swirlAround(vec2 pa, vec2 ca, float strength, float radius, float radial){
  vec2 r = pa - ca;
  float d = length(r);
  if (d < 1e-4 || strength <= 0.0) return vec2(0.0);
  float fall = exp(-(d * d) / (radius * radius));     // gaussian by distance
  vec2 tang = perp(r) / d;                             // unit tangential (orbit)
  vec2 rad  = -r / d;                                  // unit radial (toward centre)
  return (tang + rad * radial) * strength * fall;
}
`;
