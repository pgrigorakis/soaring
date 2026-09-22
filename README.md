# Soaring

A small ambient Three.js prototype. A modeled golden eagle flies itself over a deterministic, continuously streamed temperate wilderness. There are no objectives, scores, or online services.

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

Quality changes terrain tessellation, vegetation density, stream radius, pixel ratio, and shadows. Medium is the default for modern integrated laptop graphics at 1080p. Low reduces pixel ratio and disables shadows. High extends the visible terrain ring and increases vegetation.

## Diagnostics and validation

The hidden panel reports smoothed frame rate, loaded chunks, draw calls, GPU geometry count, eagle behavior, terrain clearance, position, selected thermal, nearby thermal locations, and simulation speed.

For an accelerated resource/stability check, use:

```text
http://127.0.0.1:4173/?diagnostics=1&speed=8
```

The speed parameter is capped at 12×. `window.__SOARING__.snapshot()` exposes a small smoke-test snapshot, and `window.__SOARING__.setTimeScale(n)` changes acceleration. This supports practical traversal and resource checks without waiting one literal hour.

```sh
npm test             # deterministic generation and long-flight navigation
npm run test:smoke  # real Chromium render/stream/control smoke test
npm run check        # unit tests and production type/build check
```

The product reliability target is one uninterrupted hour without intervention or obvious repetition. The automated navigation test simulates one hour at 10 Hz. Browser validation is intentionally shorter and accelerated; it does not claim a literal one-hour browser soak.

## Architecture

- `src/world.ts` is the pure seed-based world model. Global-coordinate layered noise creates gradual hills, mountain regions, valleys, lake basins, and a sparse connected river network. It also owns deterministic thermal and scenic-start placement.
- `src/terrain.ts` turns the world model into recyclable Three.js chunks. Shared materials and instanced vegetation keep GPU use bounded; distant chunk geometry is disposed.
- `src/eagle.ts` separates the explicit navigation state machine from the visual model. The eagle alternates scenic glides and panoramic flight, seeks deterministic thermals, circles to climb, and maintains terrain clearance.
- `src/main.ts` owns rendering, camera input, lighting/haze, persistence, controls, diagnostics, and lifecycle wiring.
- `src/audio.ts` creates wind and sparse adaptive tones with the Web Audio API. It uses no downloaded media.

The world is deterministic for a seed, but the generated audio noise is not part of world simulation. There are no remote runtime assets.
