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

Terrain streaming uses a 4 ms CPU budget per update, or 2 ms in Low power. Partial builds remain invisible. Diagnostics report maximum step/update time and allocated/reused buffer pairs. Coverage checks hold their camera pose so a slow software renderer does not add work faster than this budget can drain it. `playwright.chunk-ci.config.ts` reproduces one-worker SwiftShader rendering on a private port.

Development builds also expose `reviewFlight({ x, z, heading })` to freeze navigation at a repeatable start with the default chase camera. Call `reviewFlight(null)` to resume flight. Use `window.__SOARING__.setTimeScale(n)` in the browser console for accelerated resource and stability checks. The scale is capped at 12×; simulation advances in bounded 0.1-second steps, and slow rendering can reduce effective simulation speed.

Relevant browser checks include:

- `tests/app.smoke.ts` checks rendering, streaming, controls, and app behavior.
- `tests/highlands.smoke.ts` records a one-hour Highlands flight with terrain clearance, climb limits, and behavior-duration checks. Total flap time is recorded, not limited.
- `tests/highlands-cover.smoke.ts` captures noon and golden-hour snow cover from the default chase camera.
- `tests/cloud-sea.smoke.ts` captures morning mist over a lake at dawn, during its fade, and after it, plus the same times over dry ground.
- `tests/continental.smoke.ts` checks hashed continental fields, common sea level, height independent of biome profiles, continuous shelves, and dry trees/thermals. It writes repeatable JSON evidence.
- `tests/lakeland.smoke.ts` checks signed water depths on actual terrain triangles and shared water edges across mesh tiers. Run `node scripts/calibrate-lakeland.mjs` to measure biome territory, or `node scripts/audit-lakeland.mjs` to record a repeatable one-hour sea-level navigation trace. The [earlier Lakeland measurements](diagnostics/issue-59-lakeland.md) describe the retired drainage lakes.
- `tests/biomes.smoke.ts` checks deterministic biome samples and shared mesh edges, and writes a repeatable JSON artifact. `tests/climate.smoke.ts` checks climate selection, altitude cooling, snow and the tree line. See [current biome measurements and captures](diagnostics/issue-93-biomes/README.md) and the [earlier span decision](diagnostics/issue-58-biome-spans.md).

The product reliability target is one uninterrupted hour without intervention or obvious repetition. Automated navigation tests simulate one hour at 10 Hz across several flight-height ranges. Browser validation is shorter and accelerated; it is not a literal one-hour browser soak.

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

The approved-look inventory and its review links are in [approved-looks.md](design/approved-looks.md).

## Deployment

`.github/workflows/deploy-pages.yml` runs `npm run check`, installs Chrome, and runs `npm run test:smoke` for pull requests and pushes to `main`. It uploads smoke evidence for 14 days. A push to `main` also uploads `dist` and deploys it to GitHub Pages using the official Pages actions. The repository's Pages source must be set to GitHub Actions.
