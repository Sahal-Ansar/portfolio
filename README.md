# Portfolio Hero — Backlit Sand

A full-viewport hero that is a **near-static cinematic photo** with exactly **one**
animated element: fine **sand grains** that drift slowly downhill on the lit sand,
tinted to match the scene and confined to a painted mask. No procedural light, no
silhouette synthesis — the photo *is* the look.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build && npm run preview
```

## Pipeline

```
Hero
└─ full-viewport <canvas> (Three.js)
   ├─ Pass 0  BASE   : background_new.png drawn fullscreen (cover-fit). The look.
   ├─ Pass 1  GRAINS : GPU sand sim — grains drift downhill, coloured from the
   │                   scene, confined to particle_area_mask.png, drawn additively.
   └─ Post           : a very subtle bloom so grains catch a soft glow.
```

The DOM overlay (nav + hero text) and the mouse interaction are wired but currently
disabled (`SHOW_OVERLAY` / `INTERACTION` in `Hero.jsx`, `config.interaction` in the
engine) while we dial in the look.

## Assets (`/public`, swap freely)

| File | Role |
| --- | --- |
| `background_new.png` | the static scene (golden light + silhouette + sand). Pass 0 displays it cover-fit. |
| `particle_area_mask.png` | **white** = sand the grains live on; **black** = figure + sky. Grains fade out off-white and respawn inside white. |

Both share the same framing/aspect. Replacing either is a file swap — no code change.

## How the sand works

Grains live in **image-UV space** (same framing as both assets), so confinement and
colour are direct texture reads; only the final screen mapping uses cover-fit, which
keeps it resize-robust.

- **Spawn** — at load, the mask is read on the CPU and every white pixel (jittered
  sub-pixel so spawns are continuous, not a grid) goes into a lookup texture. Grains
  spawn/respawn from that lookup, guaranteed inside the sand.
- **Motion** — a slow downhill drift (`slopeDir`) plus gentle curl-noise turbulence
  so the fall meanders. GPGPU ping-pong (`GPUComputationRenderer`), never on the CPU.
- **Colour** — each grain samples `background_new.png` at its position and tints
  itself with that local colour (gold in light, dark in shadow), so it blends into
  the photo. Strong per-grain brightness variation → scattered sparkle, not a screen.
- **Confinement** — alpha is multiplied by the mask; grains off the sand fade out.
- **Respawn** — when a grain falls past the bottom or its life ends, it respawns
  inside the mask with fresh life.

## File map

| File | Role |
| --- | --- |
| `src/components/Hero.jsx` / `Hero.css` | canvas wrapper, env detection, lifecycle, (hidden) overlay |
| `src/lib/LightField.js` | engine: load assets, build spawn texture, Pass 0/1, post, resize, cleanup |
| `src/lib/shaders/sim.js` | GPGPU position + velocity (drift + curl + mask-spawn; mouse stub) |
| `src/lib/shaders/render.js` | base photo pass + scene-coloured grain pass |
| `src/lib/shaders/common.js` | shared GLSL (simplex/curl noise, hashing) |

## Tunables

All on the `config` passed to `LightField` (defaults + an annotated list at the top
and bottom of `src/lib/LightField.js`). Highlights:

- **Grains** — `simSize` (count = simSize²), `driftSpeed`, `slopeDir [x,y]`
  (downhill; image space, −y is down), `curlStrength/Scale/Speed`, `lifeMin/Max`.
- **Look** — `grainSize`, `colorBoost`, `fadeIn/fadeOut`.
- **Mouse (inert)** — `interaction`, `mouseStrength`, `mouseRadius`, `mouseLift`,
  `energyDecay`.
- **Post** — `bloom`, `bloomStrength`, `bloomThreshold` (kept high so the photo
  isn't washed).
- **Runtime** — `maxDpr`, `reducedMotion`.

## Robustness

DPR clamp; pause when offscreen (`IntersectionObserver`) / tab hidden; mobile
down-scaling; reduced-motion freezes to a static frame; no-WebGL → the photo as a
CSS poster; full WebGL teardown on unmount.

## Next

Mouse disturbance (brush over the sand to push grains away + a slight upward kick +
brief brightness boost, then settle back into the drift) — the force is already in
the velocity shader, gated behind `config.interaction`.
