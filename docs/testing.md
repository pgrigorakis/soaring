# Testing, capture, and deployment

This document owns developer commands, test modes, evidence capture, and deployment guidance. See the [README](../README.md) for user-facing information and [AGENTS.md](../AGENTS.md) for engine invariants.

## Commands

Run `npm install` to install dependencies and `npm run dev` to start the local Vite server at `http://127.0.0.1:4173`.

```sh
npm test             # deterministic generation and navigation tests
npm run check        # unit tests, TypeScript check, and production build
npm run test:smoke   # real Chromium render, streaming, and control checks
npm run bench        # held-vantage performance benchmark
npm run parity       # development-only finished-picture parity capture
```

The scripts are defined in `package.json`. Playwright smoke tests use `playwright.config.ts`; the performance benchmark uses `playwright.bench.config.ts` and picture parity uses `playwright.parity.config.ts`. Both bench tools are local development tools and do not run in CI. See [performance notes](perf-notes.md) for benchmark and parity options, artifact handling, and recorded results.

## Test modes and evidence

The real-browser smoke tests run against the development server in Chromium. CI uses software WebGL. Playwright writes timing data, screenshots, traces, and other test evidence under `test-results/`. Failed tests retain traces and screenshots. CI uploads the smoke evidence as the `smoke-evidence` artifact for 14 days.

The development-only `?smoke` URL loads the real scene, shaders, terrain budgets, and controls with a 0.25 pixel ratio and no shadows. It draws the scene once every four animation frames. Simulation, camera easing, and streaming continue on every frame. Only this mode exposes `window.__SOARING__.advanceSimulation(seconds)`, which advances up to 300 seconds in bounded navigation steps. Smoke tests use it for flight assertions instead of waiting on wall time. CI checks bounded progress instead of waiting for a full max-visibility load. Sky captures wait for `snapshot().renderedFrames` to advance.

Terrain streaming uses a 4 ms CPU budget per update, or 2 ms in Low power. Partial builds remain invisible. Diagnostics report maximum step/update time and allocated/reused buffer pairs. Coverage checks hold their camera pose so a slow software renderer does not add work faster than this budget can drain it. `playwright.chunk-ci.config.ts` reproduces one-worker SwiftShader rendering on a private port.

Development builds also expose `reviewFlight({ x, z, heading })` to freeze navigation at a repeatable start with the default chase camera. Call `reviewFlight(null)` to resume flight. Use `window.__SOARING__.setTimeScale(n)` in the browser console for accelerated resource and stability checks. The scale is capped at 12×; simulation advances in bounded 0.1-second steps, and slow rendering can reduce effective simulation speed.

Relevant browser checks include:

- `tests/app.smoke.ts` checks rendering, streaming, controls, and app behavior.
- `tests/highlands.smoke.ts` records a one-hour Highlands flight with terrain clearance, climb limits, and behavior-duration checks. Total flap time is recorded, not limited.
- `tests/highlands-cover.smoke.ts` captures noon and golden-hour snow cover from the default chase camera.
- `tests/lakeland.smoke.ts` checks a wooded lake island, dry banks, and water edges across mesh tiers. Run `node scripts/calibrate-lakeland.mjs` to measure territory across three large seed grids, or `node scripts/audit-lakeland.mjs` to record a repeatable one-hour lake-heavy navigation trace. See [Lakeland measurements](diagnostics/issue-59-lakeland.md).
- `tests/biomes.smoke.ts` checks deterministic biome samples and shared mesh edges, and writes a repeatable JSON artifact. See [biome measurements](diagnostics/issue-58-biome-spans.md).

The product reliability target is one uninterrupted hour without intervention or obvious repetition. Automated navigation tests simulate one hour at 10 Hz across several flight-height ranges. Browser validation is shorter and accelerated; it is not a literal one-hour browser soak.

To capture repeatable browser evidence, use the `?smoke` mode and the test's fixed seed, start pose, and default chase camera where specified. Smoke tests save captures and JSON evidence in `test-results/`. Do not replace acceptance captures with an elevated or orbit camera.

## Deployment

`.github/workflows/deploy-pages.yml` runs `npm run check`, installs Chrome, and runs `npm run test:smoke` for pull requests and pushes to `main`. It uploads smoke evidence for 14 days. A push to `main` also uploads `dist` and deploys it to GitHub Pages using the official Pages actions. The repository's Pages source must be set to GitHub Actions.
