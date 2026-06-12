// Render shaders.
//
//   Pass 0 (BASE)  : draw hero_base.jpg on a fullscreen quad, cover-fit. This IS
//                    the look — golden light, silhouette, sand. Nothing procedural.
//   Pass 1 (GRAINS): the animated sand. Each grain is a tiny soft additive sprite,
//                    tinted with the local scene colour (sampled from hero_base.jpg)
//                    and confined to the white area of sand_mask.png.
//
// Grains live in image-UV space; screen position is the inverse cover-fit:
//   ndc = (imgUv - 0.5) * 2 / uImgUvScale

// ---------------------------------------------------------------------------
// PASS 0 — base photo
// ---------------------------------------------------------------------------
export const BASE_VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = position.xy * 0.5 + 0.5;     // clip (-1..1) -> field UV (0..1, y up)
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BASE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uBaseTex;
uniform vec2 uImgUvScale;     // cover-fit scale (field UV -> image UV)
void main(){
  vec2 imgUv = (vUv - 0.5) * uImgUvScale + 0.5;
  gl_FragColor = vec4(texture2D(uBaseTex, imgUv).rgb, 1.0);
}
`;

// ---------------------------------------------------------------------------
// PASS 1 — sand grains
// ---------------------------------------------------------------------------
export const GRAIN_VERT = /* glsl */ `
attribute vec2 reference;       // this grain's texel in the sim textures

uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform sampler2D uBaseTex;     // for scene-matched colour
uniform sampler2D uMaskTex;     // for confinement
uniform vec2  uImgUvScale;      // cover-fit -> screen mapping
uniform float uDpr;
uniform float uGrainSize;
uniform float uColorBoost;      // how much brighter than the scene the grains read
uniform float uEnergyBoost;     // extra brightness for mouse-disturbed grains
uniform float uFadeIn;
uniform float uFadeOut;

varying vec3  vColor;
varying float vAlpha;

void main(){
  vec4 P = texture2D(texturePosition, reference);
  vec4 V = texture2D(textureVelocity, reference);
  vec2 pos = P.xy;                // image UV
  float energy = P.z;
  float age = P.w;
  float maxLife = V.z;
  float seed = V.w;

  // image UV -> screen clip (inverse cover-fit)
  vec2 ndc = (pos - 0.5) * 2.0 / uImgUvScale;
  gl_Position = vec4(ndc, 0.0, 1.0);

  float life = smoothstep(0.0, uFadeIn, age) * smoothstep(0.0, uFadeOut, maxLife - age);

  // confine to the sand: fade out anywhere the mask isn't white
  float m = texture2D(uMaskTex, pos).r;
  float mask = smoothstep(0.25, 0.6, m);

  // strong per-grain variation so the field reads as scattered sparkle, not an
  // even dot-screen: most grains are dim, a sparse few catch the light brightly.
  float r1 = fract(seed * 91.7);
  float r2 = fract(seed * 47.3 + 0.37);
  float spark = pow(r1, 2.6);                 // mostly small -> few bright grains

  // colour the grain with the local scene colour so it blends into the photo
  vec3 scene = texture2D(uBaseTex, pos).rgb;
  vColor = scene * uColorBoost * (0.18 + spark * 1.7) * (1.0 + energy * uEnergyBoost);

  gl_PointSize = uGrainSize * (0.35 + spark * 1.2 + r2 * 0.4) * uDpr * life;
  vAlpha = life * mask;
}
`;

export const GRAIN_FRAG = /* glsl */ `
precision highp float;
varying vec3  vColor;
varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = pow(a, 1.6);                       // soft round grain, no hard edge
  float al = a * vAlpha;
  if (al <= 0.002) discard;
  gl_FragColor = vec4(vColor * al, al);  // premultiplied, additive
}
`;
