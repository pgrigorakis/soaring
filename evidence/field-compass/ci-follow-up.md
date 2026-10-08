# CI follow-up for the Field compass

PR: https://github.com/pgrigorakis/soaring/pull/163

## What failed

The failed chase-flight capture exhausted its **whole-test** 240-second budget. It did not spend 240 seconds waiting for one fog transition.

The trace from https://github.com/pgrigorakis/soaring/actions/runs/37847122351 shows:

- The three terrain-ready waits took 51.93, 62.14 and 51.50 seconds.
- The five completed fog waits took 10.18, 9.42, 9.42, 9.14 and 7.15 seconds.
- The last golden-hour wait started 238.04 seconds after the test began. About 1.96 seconds remained.

This establishes budget exhaustion. It does not establish that the HUD caused the CI slowdown.

## Local comparison

All comparisons used Chrome with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`. These were macOS runs, not the Ubuntu CI runner.

Before the optimization, the single-worker chase-flight test passed on both the PR branch and unchanged main (`b57f61c`): 48.5 seconds versus 43.8 seconds. The pixel-budget test also passed: 8.7 seconds versus 8.8 seconds.

After the optimization, the complete fifth CI shard passed all 11 checks with two workers on both unchanged main and the PR branch. The chase-flight test took 62.461 seconds on main and 65.965 seconds on the PR branch. No local reproduction of the CI timeout occurred.

## HUD work removed

A real browser measurement found 35,100 DOM mutations for 300 unchanged updates. The regression check first failed with 2,340 mutations over 20 held frames. It now passes with zero.

The HUD now observes viewport width instead of reading layout each frame. It scrolls one SVG track and relabels ticks only at a five-degree crossing or resize. Tiny remaining course differences snap below 0.0001 degrees.

A 300-update moving-course measurement fell from 34,807 mutations to 722. Its measured duration fell from 9.7 ms to 0.5 ms. These are module measurements, not a whole-scene frame-rate guarantee.

Fog code, shaders, terrain code, capture ratios, test timeouts, scene assertions and the number of tests in each shard remain unchanged.

## Repeatable checks

```sh
npm run check
npm run test:smoke -- tests/flight-hud.smoke.ts
SMOKE_SKIP_PERF_BENCH=1 CI=1 npm run test:smoke -- --workers=2 --shard=5/5
npm run test:production-smoke
```

For the software-WebGL comparison, add the three browser arguments above to a local Playwright config, as `playwright.chunk-ci.config.ts` demonstrates. Use a private port through `SMOKE_PORT`.

The HUD E2E saves `held-hud-writes` as JSON and `held-field-compass-resize.png`. It verifies a held instrument without DOM writes, then checks centring after a phone-size resize. Existing checks still cover all eight bearings, north crossing, land/water height, camera orbit and overlay placement.
