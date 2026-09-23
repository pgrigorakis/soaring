# Soaring

A small ambient Three.js prototype. A modeled golden eagle flies itself over a deterministic, continuously streamed temperate wilderness. There are no objectives, scores, or online services.

Play it at [pgrigorakis.github.io/soaring](https://pgrigorakis.github.io/soaring/).

## Run locally

Requires Node.js 20 or newer and a current desktop Chrome, Edge, or Firefox.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4173`. Production output is created with `npm run build`.

## Controls

- Drag on the landscape to orbit the camera. Release to let it return slowly to the trailing view.
- Move the pointer to reveal the settings control.
- Settings provide sound mute and volume, Low/Medium/High graphics, camera distance, and a new-world action.
- Press `D` to show or hide diagnostics.

Sound is procedural and starts muted on every page load. If sound was previously enabled, it resumes only after the next pointer gesture; otherwise the mute preference remains. Settings and the world seed live in `localStorage`. A reload keeps the seed but increments a scenic-visit index, so it starts elsewhere in the same world.

## Quality settings

Quality changes terrain tessellation, vegetation density, stream radius, pixel ratio, and shadows. Medium is the default for modern integrated laptop graphics at 1080p. A low afternoon sun casts long soft shadows from terrain and trees; the shadow area follows the view out to the full haze distance, so it has no visible edge. Low reduces pixel ratio and disables shadows. High extends the visible terrain ring and increases vegetation.

## Diagnostics and validation

The hidden panel reports smoothed frame rate, loaded chunks, draw calls, GPU geometry count, eagle behavior, terrain clearance, position, selected thermal, nearby thermal locations, and simulation speed.

For an accelerated resource/stability check, run `window.__SOARING__.setTimeScale(n)` in the browser console. The scale is capped at 12×, and each frame runs bounded 0.1 s simulation substeps so the reported scale is the real one. `window.__SOARING__.snapshot()` exposes a small smoke-test snapshot. This supports practical traversal and resource checks without waiting one literal hour.

```sh
npm test             # deterministic generation and long-flight navigation
npm run test:smoke  # real Chromium render/stream/control smoke test
npm run check        # unit tests and production type/build check
```

The product reliability target is one uninterrupted hour without intervention or obvious repetition. The automated navigation test simulates one hour at 10 Hz. Browser validation is intentionally shorter and accelerated; it does not claim a literal one-hour browser soak.

## Deployment

`.github/workflows/deploy-pages.yml` validates pull requests without deploying them. A push to `main` runs the same unit, production build, and browser smoke checks, then deploys `dist` to GitHub Pages with the official Pages actions. The repository's Pages source must be set to GitHub Actions.

## Architecture

- `src/world.ts` is the pure seed-based world model. Global-coordinate layered noise creates gradual hills, mountain regions, valleys, lake basins, and a sparse connected river network whose valley width and depth scale with the surrounding land. A separate broad woodland field with grove-scale detail and a world-space tree grid make forests, meadows, and isolated trees continuous across chunk boundaries. It also scores terrain interest (relief, water, rock, forest edges), which drives scenic starts and the eagle's scenic targets, and owns deterministic thermal placement.
- `src/terrain.ts` turns the world model into recyclable Three.js chunks. Missing chunks are queued nearest first and built two per frame to avoid stalls. Shared materials and instanced conifer, broadleaf, and columnar tree forms keep GPU use bounded; distant chunk geometry is disposed. Fog ends at the guaranteed loaded distance, so the terrain edge is never visible.
- `src/eagle.ts` separates the explicit navigation state machine from the visual model. The eagle alternates scenic glides and panoramic flight, seeks deterministic thermals, circles to climb, and maintains terrain clearance.
- `src/main.ts` owns rendering, camera input, lighting/haze, persistence, controls, diagnostics, and lifecycle wiring.
- `src/audio.ts` creates wind and sparse adaptive music: short pentatonic phrases separated by long rests, with register, pacing, and contour following the eagle's behavior with the Web Audio API. It uses no downloaded media.

The world is deterministic for a seed, but the generated audio noise is not part of world simulation. There are no remote runtime assets.
