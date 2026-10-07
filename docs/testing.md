# Testing, capture, and deployment

This document owns local setup, developer commands, test modes, evidence capture, and deployment guidance. See the [README](../README.md) for user-facing information and [AGENTS.md](../AGENTS.md) for engine invariants.

## Commands

Use Node.js 20 or newer. Run `npm install` to install dependencies and `npm run dev` to start the local Vite server at `http://127.0.0.1:4173`.

```sh
npm test                       # unit tests
npm run test:watch             # unit tests in watch mode
npm run build                  # TypeScript check and production build
npm run preview                # serve the built app locally; build first
npm run check                  # unit tests, TypeScript check, and production build
npm run test:smoke             # real Chromium render, streaming, and control checks
npm run test:production-smoke  # production bundle smoke check; build first
npm run bench                  # held-vantage performance benchmark
npm run parity                 # development-only finished-picture parity capture
```

The scripts are defined in `package.json`. Playwright smoke tests use `playwright.config.ts`; the performance benchmark uses `playwright.bench.config.ts` and picture parity uses `playwright.parity.config.ts`. Both bench tools are local development tools and do not run in CI. See [performance notes](perf-notes.md) for metric definitions and recorded results.

## Test modes and evidence

The real-browser smoke tests run against the development server in Chromium. The production-bundle smoke test checks `tests/bundle.production.ts` against built `dist` through Vite preview. CI uses software WebGL. Playwright writes timing data, screenshots, traces, and other test evidence under `test-results/`. Failed tests retain traces and screenshots. CI uploads the smoke evidence as the `smoke-evidence` artifact for 14 days.

The development-only `?smoke` URL loads the real scene, shaders, terrain budgets, and controls with a 0.25 pixel ratio and no shadows. It draws the scene once every four animation frames. Simulation, camera easing, and streaming continue on every frame. Only this mode exposes `window.__SOARING__.advanceSimulation(seconds)`, which advances up to 300 seconds in bounded navigation steps. Smoke tests use it for flight assertions instead of waiting on wall time. CI checks bounded progress instead of waiting for a full max-visibility load. Sky captures wait for `snapshot().renderedFrames` to advance.

Terrain streaming uses a 4 ms CPU budget per update, reduced to 2 ms during the start-screen fade. While both have work, ground levels and placement tiles each get half. Partial builds remain invisible. Diagnostics report maximum step/update time and allocated/reused buffer pairs. Coverage checks hold their camera pose so a slow software renderer does not add work faster than this budget can drain it. `playwright.chunk-ci.config.ts` reproduces one-worker SwiftShader rendering on a private port.

Development builds also expose `reviewFlight({ x, y?, z, heading })` to freeze navigation at a repeatable start with the default chase camera. Call `reviewFlight(null)` to resume flight. Use `window.__SOARING__.setTimeScale(n)` in the browser console for accelerated resource and stability checks. The scale is capped at 12×; simulation advances in bounded 0.1-second steps, and slow rendering can reduce effective simulation speed.

Relevant browser checks include:

- `tests/start-screen.smoke.ts` checks that the white start screen holds until a click and nearby terrain is drawn. Streaming runs behind the screen with the eagle held at its starting pose. Readiness covers ground, water and tree placement tiles in a 1,440 m disk around the camera. An 8-second cap after the click bounds the terrain wait. The first world frame's GPU fence and one more browser frame remain mandatory, even at the cap. Normal readiness also waits for the completed near terrain's GPU work and another browser frame. Hidden world draws run once every four frames; streaming continues every frame. Far terrain keeps loading after reveal. Add `?start` to a `?smoke` or `?profile` URL to show the start screen; those dev modes skip it otherwise. Captures and timing evidence go to `test-results/start-screen/`, or `START_SCREEN_OUT` when set.
- `tests/app.smoke.ts` checks rendering, streaming, controls, and app behavior.
- `tests/highlands.smoke.ts` records three one-hour Highlands flights from nearby starts with terrain clearance, climb limits, and behavior-duration checks. A glide may last a dive plus the 300 s cruise. Ridge soaring must occur in at least one flight. Total flap time is recorded, not limited.
- `tests/highlands-cover.smoke.ts` captures noon and golden-hour snow cover from the default chase camera.
- `tests/nudge.smoke.ts` holds arrow keys in simulated time. It checks the course bend, the adopted heading, the hint text, focused sliders, and window blur. It saves screenshots and `evidence.json` in `test-results/nudge/`.
- `tests/cloud-layer.smoke.ts` captures matched below/inside/above views from the default chase camera, checks rendered whiteout, and records two flight cycles that climb through the deck and dive back below it, with no collision-floor jumps. Evidence and baseline failure proof live in `evidence/fwm-cloud-layer/`.
- `tests/cloud-puff-deck.smoke.ts` compares frames with and without puffs. Above the deck, at noon and at night, no puff may show. Below the deck, puffs must show. Evidence lives in `evidence/cumulus-fog-popthrough/`.
- `tests/far-horizon.smoke.ts` checks that a blurred window, capped at 30 fps, keeps its quality step. It also holds a sea view toward land past a 3.5 km fog limit and checks that no flat fog-coloured band shows under the sky. Evidence lives in `test-results/far-horizon/`.
- `tests/continental.smoke.ts` checks hashed continental fields, common sea level, height independent of biome profiles, continuous shelves, and dry trees/thermals. It writes repeatable JSON evidence.
- `tests/lakeland.smoke.ts` checks signed water depths on actual terrain triangles and shared water edges across mesh tiers. Run `node scripts/calibrate-lakeland.mjs` to measure biome territory, or `node scripts/audit-lakeland.mjs` to record a repeatable one-hour sea-level navigation trace. The [earlier Lakeland measurements](diagnostics/issue-59-lakeland.md) describe the retired drainage lakes.
- `tests/minimap.smoke.ts` flies four days through `advanceSimulation`, checks the minimap position, zoom steps and drawn land, and checks that a reload keeps the trail and starts a new line. It exports the biome map PNG and checks that biome changes along fixed lines stay below 2 per 10 km. Captures, the export and `minimap.json` go to `test-results/minimap/`. Run `node scripts/biome-map.mjs <seed>` for a top-down biome map, and add `--ref origin/main` for the same map from another revision.
- `tests/terrain-coverage.smoke.ts` crosses a tile boundary, jumps 24.5 km and crosses again after the render-origin rebase. It saves a frame trace and a before/during/after strip. Drawn land must stay visible, and unbuilt ground must stay hazed. In CI, only the first crossing runs, in smoke mode, so the software renderer is not asked for repeated full 12 km loads. See [ground levels](diagnostics/ground-levels.md).
- `tests/biomes.smoke.ts` checks deterministic biome samples and shared mesh edges. Its `biome-parity.json` artifact excludes timing and app animation state, so exact samples, ground RGB, mesh hashes, and tree placement/tints can be compared between builds. See [data-driven profiles](design/biome-profiles.md). `tests/climate.smoke.ts` checks climate selection, altitude cooling, snow and the tree line. See [current biome measurements and captures](diagnostics/issue-93-biomes/README.md) and the [earlier span decision](diagnostics/issue-58-biome-spans.md).

The product reliability target is one uninterrupted hour without intervention or obvious repetition. Automated navigation tests simulate one hour at 10 Hz in the fixed 50–800 m flight band. Browser validation is shorter and accelerated; it is not a literal one-hour browser soak.

The current generator and matched before/after evidence are in [continental terrain](design/continental-terrain.md). Run `node scripts/capture-terrain-map.mjs after` to reproduce its seed-42 top-down map.

To capture repeatable browser evidence, use the `?smoke` mode and the test's fixed seed, start pose, and default chase camera where specified. Smoke tests save captures and JSON evidence in `test-results/`. Do not replace acceptance captures with an elevated or orbit camera.

## Performance tools

### Held-vantage benchmark

The benchmark loads the development build with `?profile`, holds five fixed vantages, and records each one. It reuses the dev hooks: `reviewFlight` places the bird and freezes navigation, `setTimeOfDay` freezes the sky, `setVisibility` fixes terrain reach, and `setViewpoint` fixes the camera. `?profile` turns off adaptive quality. Each vantage waits for terrain to finish, the fog colour read to settle, and warmup frames before recording. It then checks that chunk count, sky phase, quality step, and frame cap did not change.

Water ripple time and the thermal marker pulse still advance. They change pixels only, not draw calls or triangles. A held view measures steady render cost. It is not a sustained-flight hitch measurement because terrain streaming, chunk builds, and camera motion are absent. Use the diagnostics panel to check those.

Use seed 5 and the five vantages in `scripts/perf-bench.ts`, with terrain visibility at the product default. Read the 5th and 50th percentile of each round, then take the minimum across rounds. A transient stall then cannot inflate a result. To compare builds, run each in its own checkout on its own dev server and interleave rounds so thermal and background drift affects both:

```sh
BENCH_BUILDS=a=http://127.0.0.1:4401,b=http://127.0.0.1:4402 npm run bench
```

Draw calls and triangles must match between rounds of one build. The report marks a vantage "varies" if they do not. Set `BENCH_ROUNDS`, `BENCH_FRAMES`, `BENCH_WARMUP`, `BENCH_DPR`, or `BENCH_OUT` to change the run. `tests/perf-bench.smoke.ts` checks repeatable counts, held state, unavailable and disjoint GPU handling, query cleanup, and that production builds carry no profiler.

### Picture parity

Picture parity captures two reads of every fixed vantage, using seed 5, the normal development renderer, and 60 settling frames. It reports mean absolute RGB level difference, the share of pixels with any changed RGB channel, and the largest channel difference with its pixel coordinates. The repeated same-build comparison is the measured noise floor, not an acceptance threshold.

Artifacts go to a new timestamped directory under `artifacts/look-parity/`, outside Playwright's disposable `test-results/` folder. Set `PARITY_VANTAGES` to a comma-separated subset of the five bench vantage names for a focused comparison. Each vantage has gzip-compressed RGBA captures and metadata. `parity.json` records the build commit, working-tree state, machine, browser, graphics renderer, viewport, pixel ratios, parameters, and measured differences. The tool fails rather than overwrite an existing artifact directory. To compare a saved capture, set `PARITY_REFERENCE` to its artifact directory. The comparison refuses dimension, browser, graphics renderer, viewport, pixel-ratio, machine, OS, architecture, or headless-mode mismatches. Build commits may differ because the tool is for comparing builds. Use `PARITY_URL`, `PARITY_SEED`, `PARITY_DPR`, `PARITY_REPEATS`, and `PARITY_OUT` to select the build, repeat count, and output path. No visual acceptance threshold is built in.

Set `PARITY_FIXED_CLOCK=1` to compare builds exactly. This mode emulates the page clock and renders the same 160 frames at every vantage, so animation is pinned and streaming finishes within those frames. A reference must use the same clock mode. Repeats of one build are usually byte-identical. A cold first page load can still shift cloud time by a few frames, so check the logged `cloudTime` and rerun a vantage whose repeats differ. Do not use this mode for performance measurement.

The approved-look inventory and its review links are in [approved-looks.md](design/approved-looks.md).

## Deployment

`.github/workflows/deploy-pages.yml` runs for pull requests and pushes to `main`. The `check` job runs `npm run check`, installs Chrome, and runs the production bundle smoke check. Six parallel `smoke` jobs run `npm run test:smoke`. Five run one Playwright shard each (`--shard=N/5`, with `SMOKE_SKIP_PERF_BENCH` set). The sixth runs `tests/perf-bench.smoke.ts` alone because its serial group is the longest. CI sets `fullyParallel` so shards split single tests, while `describe.configure({ mode: 'serial' })` groups stay together. Every job uploads its `test-results` as an artifact (`smoke-evidence-production` and `smoke-evidence-shard-N` and `smoke-evidence-shard-perf-bench`) for 14 days. A push to `main` also uploads `dist`, and the `deploy` job runs only after `check` and all six shards pass. The repository's Pages source must be set to GitHub Actions.
