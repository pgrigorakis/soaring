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
- Settings provide an overall sound mute, independent ambience (wind and wing flaps) and music volume sliders, terrain visibility, minimum and maximum flight height above local terrain, camera distance, a persistent Show thermal toggle, and a new-world action. Height bounds persist across reloads; the eagle selects its own height and route within them.
- Press `D` to show or hide diagnostics.

Sound is procedural and starts muted on every page load. If sound was previously enabled, a pointer gesture can resume it; pressing Sound to mute instead keeps it muted. If the browser cannot start audio, sound stays muted and the control can retry. The two volume settings persist independently; existing single-volume preferences initialize both sliders. Settings and the world seed live in `localStorage`. A reload keeps the seed but increments a scenic-visit index, so it starts elsewhere in the same world.

## Terrain visibility

High graphics are the standard presentation. The terrain visibility slider ranges from 720 m to 3,600 m (five times the original default), independently of camera distance. Haze reaches only loaded terrain, even while new tiles stream in. Terrain loading is capped at the reach needed for a 16:9 window; wider windows can show a shorter haze distance than the selected value. Nearby terrain has detailed meshes, trees, and rocks; distant terrain uses simpler meshes and trees at the same positions. A fixed mid-afternoon sun (three.js `Sky` addon, physical Preetham model) casts shadows from terrain and trees, within a fixed 600 m range around the camera that fades out near its edge. Fog/haze color is sampled from the sky near the horizon rather than fixed, and a subtle `Lensflare` tracks the sun when it is on screen and unoccluded by terrain. Old High-preset settings start at 1,080 m; other old presets start at 720 m.

## Diagnostics and validation

The hidden panel reports smoothed frame rate, loaded and pending chunks, current and selected visibility, draw calls, GPU geometry count, eagle behavior, terrain clearance, position, selected thermal, nearby thermal locations, and simulation speed.

For an accelerated resource/stability check, run `window.__SOARING__.setTimeScale(n)` in the browser console. The scale is capped at 12×, and each frame runs bounded 0.1 s simulation substeps so the reported scale is the real one. `window.__SOARING__.snapshot()` exposes a small smoke-test snapshot. This supports practical traversal and resource checks without waiting one literal hour.

```sh
npm test             # deterministic generation and long-flight navigation
npm run test:smoke  # real Chromium render/stream/control smoke test
npm run check        # unit tests and production type/build check
```

The product reliability target is one uninterrupted hour without intervention or obvious repetition. The automated navigation test simulates one hour at 10 Hz across several flight-height ranges. Browser validation is intentionally shorter and accelerated; it does not claim a literal one-hour browser soak.

## Deployment

`.github/workflows/deploy-pages.yml` validates pull requests without deploying them. A push to `main` runs the same unit, production build, and browser smoke checks, then deploys `dist` to GitHub Pages with the official Pages actions. The repository's Pages source must be set to GitHub Actions.

## Architecture

- `src/world.ts` is the pure seed-based world model. Global-coordinate layered noise creates gradual hills, mountain regions, valleys, lake basins, and a sparse connected river network whose valley width and depth scale with the surrounding land. A separate broad woodland field with grove-scale detail and a world-space tree grid make forests, meadows, and isolated trees continuous across chunk boundaries. It also scores terrain interest (relief, water, rock, forest edges), which drives scenic starts and the eagle's scenic targets, and owns deterministic thermal placement.
- `src/terrain.ts` turns the world model into recyclable Three.js chunks. Missing chunks are queued nearest first and built two per frame to avoid stalls. Shared materials and instanced vegetation keep GPU use bounded; distant chunks are disposed.
- `src/eagle.ts` separates the explicit navigation state machine from the visual model. The eagle glides toward interesting places, sinking as it goes, and flaps in short bursts only to climb: near the soft minimum-height floor, when terrain rises ahead, or while thermal-seeking. It never flaps while thermal-riding, where it circles a thermal to climb toward the selected maximum height.
- `src/thermal-marker.ts` owns the reusable translucent marker for the eagle's active thermal.
- `src/main.ts` owns rendering, camera input, lighting/haze, persistence, controls, diagnostics, and lifecycle wiring.
- `src/audio.ts` creates wind, wing flaps that follow the eagle's actual flapping, and a continuous original musical bed with the Web Audio API. The music adapts to the eagle's behavior; ambience and music use separate level buses under the shared mute. It uses no downloaded media.

The world is deterministic for a seed, but the generated audio noise is not part of world simulation. There are no remote runtime assets.
