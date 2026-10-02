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
- Move the pointer to reveal the settings control. The cursor and control hide after 3 seconds without pointer movement.
- Settings provide a fullscreen toggle, overall sound mute, independent ambience (wind and wing flaps) and music volume sliders, terrain visibility, persistent Low power and Show thermal toggles, minimum and maximum flight height above terrain (a smoothed nearby-ground reference in Highlands), camera distance from 10 m to 100 m (lower at closer settings), and a new-world action. Show thermal marks every thermal within 3.5 km of the eagle; the selected thermal stays hotter. Height bounds persist across reloads; the eagle selects its own height and route within them.
- Press `F` to toggle fullscreen. Press `D` to show or hide diagnostics.

Sound is procedural and starts muted on every page load. If sound was previously enabled, a pointer gesture can resume it; pressing Sound to mute instead keeps it muted. If the browser cannot start audio, sound stays muted and the control can retry. Low power caps updates at 30 fps, uses a 1.0 pixel ratio, disables shadows, and builds one terrain chunk per frame. The app also caps at 30 fps while its window is unfocused. If smoothed frame rate stays below 40 fps for 10 seconds, adaptive quality steps pixel ratio from 1.75 to 1.25 to 1.0, then terrain visibility from 5,000 m to 3,500 m. Sixty seconds above 40 fps restores one step. The two volume settings persist independently; existing single-volume preferences initialize both sliders. Settings and the world seed live in `localStorage`. A reload keeps the seed but increments a scenic-visit index, so it starts elsewhere in the same world.

## Terrain visibility

High graphics are the standard presentation. The terrain visibility slider ranges from 720 m to 5,000 m, defaulting to 5,000 m, independently of camera distance. Haze reaches only loaded terrain, even while new tiles stream in. Terrain loading is capped at the reach needed for a 16:9 window; wider windows can show a shorter haze distance than the selected value.

Three mesh levels of detail stream on concentric grids, sized so a coarser tile's edges always land on a finer tile's grid lines, and a downward skirt on every non-nearest tile hides the resulting resolution seam:
- **near** (out to 1,080 m): full-density mesh, individual trees, and rocks.
- **mid** (1,080 m–4,320 m): a lower-density mesh; out to 3,000 m it keeps simplified individual trees, then drops to terrain-color forest only (no per-tree geometry) to avoid pop-in right at the cutoff.
- **far** (4,320 m–5,000 m): a coarser mesh on 4x larger tiles, terrain-color forest only.

A world clock runs a 15-minute day. The sun and a full moon sit on opposite sides of the sky, fixed in world space, and the three.js `Sky` addon (physical Preetham model) follows the sun: blue at noon, golden hour at dawn and dusk, and a dark blue starry night. Whichever body is higher lights the scene and casts shadows within a fixed 600 m range around the camera that fades out near its edge. Both lights are dark on the horizon, so the shadow caster can switch there without a pop. Fog/haze color is sampled from the sky near the horizon. It is light and blue at noon, so distant ridges stay readable, and warmer and a little denser when the sun is low. A subtle `Lensflare` tracks the sun when it is above the horizon and unoccluded by terrain. Moonlight is cool and dim, but bright enough to read the landscape.

## Diagnostics and validation

The hidden panel reports smoothed frame rate, the current frame cap and adaptive quality step, loaded and pending chunks, mean/max chunk build milliseconds, blended biome weights, loaded chunk counts per level of detail, current and selected visibility, draw calls, GPU geometry count, eagle behavior, wind vector, predicted ridge lift, terrain clearance, position, selected thermal, nearby thermal locations, and simulation speed.

For an accelerated resource/stability check, run `window.__SOARING__.setTimeScale(n)` in the browser console. The scale is capped at 12×, and each frame runs bounded 0.1 s simulation substeps. Wall-clock frame deltas are capped at 0.1 s, so slow rendering can reduce the effective simulation speed. `window.__SOARING__.snapshot()` exposes a small smoke-test snapshot. This supports practical traversal and resource checks without waiting one literal hour.

```sh
npm test             # deterministic generation and long-flight navigation
npm run test:smoke  # real Chromium render/stream/control smoke test
npm run check        # unit tests and production type/build check
```

The development-only `?smoke` mode keeps the real scene, shaders, terrain budgets and controls, but uses a 0.25 pixel ratio, no shadows, and one scene draw per four animation frames. Simulation, camera easing and streaming still run on every frame. Only this mode exposes `window.__SOARING__.advanceSimulation(seconds)` (0–300 seconds, in bounded navigation steps); tests use it for flight-state assertions instead of waiting on wall time. Sky screenshots wait for `snapshot().renderedFrames` to advance, not an assumed frame count. Development builds also expose `reviewFlight({ x, z, heading })` to freeze navigation at a repeatable start with the unmodified default chase camera; `reviewFlight(null)` resumes flight. `tests/highlands.smoke.ts` records a one-hour Highlands flight against the retained pre-change energy/clearance budgets, and `tests/highlands-cover.smoke.ts` captures noon and golden-hour snow cover. CI uploads `smoke-evidence` with per-test timings, frame-gap/long-task measurements, screenshots and retained failure traces for 14 days. There are no retries.

`tests/lakeland.smoke.ts` verifies a wooded lake island, dry banks and exact water edges across all mesh tiers in the real browser. `scripts/calibrate-lakeland.mjs` measures territory across three large seed grids; `scripts/audit-lakeland.mjs` records a repeatable one-hour lake-heavy navigation trace. See `docs/diagnostics/issue-59-lakeland.md` for measurements and screenshot poses.

`tests/biomes.smoke.ts` verifies deterministic biome samples and exact shared mesh edges in the real browser, with a repeatable JSON artifact. Field coverage, span and build-time measurements are documented in `docs/diagnostics/issue-58-biome-spans.md`.

The product reliability target is one uninterrupted hour without intervention or obvious repetition. The automated navigation test simulates one hour at 10 Hz across several flight-height ranges. Browser validation is intentionally shorter and accelerated; it does not claim a literal one-hour browser soak.

## Deployment

`.github/workflows/deploy-pages.yml` validates pull requests without deploying them. A push to `main` runs the same unit, production build, and browser smoke checks, then deploys `dist` to GitHub Pages with the official Pages actions. The repository's Pages source must be set to GitHub Actions.

## Architecture

- `src/world.ts` is the pure seed-based world model. A 500 m drainage lattice is computed lazily per region and cached: each node drains to its lowest neighbor, so rivers run downhill, merge, and end in a lake or continue out of the queried area. The rendered hills are then shaped from that network — valley sides rise from each channel — instead of cutting rivers into an unrelated height field. Channels are wide enough to stay on the 90 m far mesh. Lakes fill lattice basins, with smaller cirque lakes in Highlands. Highlands cores use 380 m ridges, broad U-shaped channel valleys, a 280–320 m conifer treeline, alpine meadow and scree, and white snow patches from 380 m (full above 420 m) on slopes below 40°. Biome weights crossfade Highlands into Rolling Hills, Woodland, Heath & Moorland and Lakeland. Lakeland uses a high 7 km lake field where relief is below 0.4, without changing the accepted drainage elevations or Hills height. Its basin lakes expand to a 1,400 m major radius along the lowest potential spill direction, deepen with size, and gain wooded islands. Lake masks leave gentle clearance around higher tributaries. Gentle shores have sand at 0–3 m above water and a reed-colour margin at 3–5 m; steep shores use lake-cliff rock. Water blends from turquoise shallows to deep blue. `src/biome.ts` holds the selection settings and land profiles. Climate and independent Hills fields span 16 km; relief spans 18 km. Blended profile heights enter the drainage lattice before river carving. Hills use a 150 ±75 m profile, varied polygonal fields around 300 m and physical shrub hedgerows with occasional oaks; Woodland has a varied mixed canopy and separate glades with sparse flower colours; Moor has heather/bracken patches, sparse trees, granite tors and small dark pools on flat tops. All placement and palette choices use world coordinates, so chunk boundaries do not restart them. The model also scores terrain interest (relief, water, rock, forest edges), which drives scenic starts and the eagle's scenic targets, and places thermals deterministically on dry, open, sun-facing ground (never water). Thermal sun-facing uses a fixed placement azimuth so thermals do not drift as the sky sun moves.
- `src/terrain.ts` turns the world model into recyclable Three.js chunks across three mesh levels of detail (see Terrain visibility above). Missing chunks are queued nearest first and built two per frame (one in Low power mode) to avoid stalls. Shared materials and instanced vegetation keep GPU use bounded; distant chunks are disposed.
- `src/eagle.ts` separates the explicit navigation state machine from the visual model. The eagle glides toward interesting places, sinking as it goes, and flaps in short bursts only to climb: near the soft minimum-height floor, when terrain rises ahead, or while thermal-seeking. It never flaps while thermal-riding: it circles at 30–60 m, banked 20–35° toward the thermal, climbing 3–4 m/s as the circle drifts with the thermal, and leaves at maximum flight height or when the thermal weakens. On a windward face of at least 18° in Highlands or a lake-bowl wall, it ridge-soars: it beats along a crest of at least 700 m, 100 m upwind of it, climbing up to 2 m/s without flapping inside the windward lift band (up to 120 m above the crest), turns into the wind at each end, and leaves before four minutes. `src/wind.ts` supplies one deterministic global wind (5.8–8.6 m/s, slow ±20° drift on simulation time); it chooses the face and the lift and gives the bird a visual crab, but never moves it, and it has no clouds. In Highlands, height uses the highest sampled ground within 250 m, eased over 5 seconds; look-ahead grows with uphill slope. Scenic targets favor valley floors and the lowest col on the route while keeping the persistent route compass. Near a lake shore, some targets trace up to half the shoreline. Biome profiles add scenic weight for Woodland glade edges and Moorland tors. No behaviour runs four minutes. Falling terrain never teleports the bird down to a thermal ceiling.
- `src/main.ts` owns rendering, camera input, lighting/haze, persistence, controls, diagnostics, and lifecycle wiring. During thermal-riding the chase camera follows more loosely and yaws slower than the eagle so the bird moves around the frame; entry and exit ease rather than jerk.
- `src/thermal-marker.ts` owns one pooled instanced column for every thermal within 3.5 km of the eagle. The selected thermal stays hotter. Columns fade at the range edge instead of popping.
- `src/audio.ts` creates biome-weighted wind, leaf rustle, shore lapping, highland reverb and a Moor drone with the Web Audio API. Wing flaps follow the eagle's actual flapping, and the original musical bed shifts tempo, register and voicing with biome weights and flight behavior (the arpeggio rises an octave while thermal-riding and a fifth while ridge-soaring). Ambience and music use separate level buses under the shared mute. It uses no downloaded media.

The world is deterministic for a seed, but the generated audio noise is not part of world simulation. There are no remote runtime assets.
