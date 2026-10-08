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

The first optimization observed viewport width instead of reading layout each frame. It scrolled one SVG track and relabelled ticks only at a five-degree crossing or resize. Tiny remaining course differences snap below 0.0001 degrees.

A 300-update moving-course measurement fell from 34,807 mutations to 722. Its measured duration fell from 9.7 ms to 0.5 ms. These are module measurements, not a whole-scene frame-rate guarantee.

For the puff-deck follow-up, fog code, shaders, terrain code, capture ratios, test timeouts, scene assertions and the number of tests in each shard were unchanged.

## Repeatable checks

```sh
npm run check
npm run test:smoke -- tests/flight-hud.smoke.ts
SMOKE_SKIP_PERF_BENCH=1 CI=1 npm run test:smoke -- --workers=2 --shard=5/5
npm run test:production-smoke
```

For the software-WebGL comparison, add the three browser arguments above to a local Playwright config, as `playwright.chunk-ci.config.ts` demonstrates. Use a private port through `SMOKE_PORT`.

The HUD E2E saves `held-hud-writes` and `hud-resize-writes` as JSON and `held-field-compass-resize.png`. It verifies a held instrument without DOM writes, then checks centring after a phone-size resize. Existing checks still cover all eight bearings, north crossing, land/water height, camera orbit and overlay placement.

## Pixel-cap follow-up (steering 007)

Firstmate reported three consecutive pixel-cap failures at the 45-second body timeout. The reported test durations were 53.4–53.7 seconds. Main had passed with reported durations of 47.9 and 51.4 seconds. These reported durations include fixture/cleanup work and are not identical to the body timeout.

The resize audit first failed with **590 HUD DOM mutations** during six viewport/DPR changes. The compass now uses native SVG/CSS percentages and a named size container. Tick spacing stays 2.2 px per degree below 240 px of HUD width, and width/120 at or above that boundary. Font sizes, appearance and opacity stay unchanged. The module has no resize observer, geometry reads or resize-driven drawing/relabel path. Non-inherited numeric CSS properties isolate the course update from the tick styles.

The E2E audit now passes with **zero mutations**. It also checks centring and tick spacing at the pixel-cap test's sizes/DPRs, phone width, and both sides of the 240 px HUD boundary.

All timing comparisons below used the same two-worker SwiftShader shard-1 load, with unchanged main at `b57f61c`. Baseline pixel-cap times were 10.436s on main and 12.573s on the previous PR head. Two post-change comparisons, with reversed source order, gave:

- Main: 12.611s and 12.936s, mean 12.774s.
- Optimized branch: 12.248s and 13.061s, mean 12.655s.

The branch mean falls within main's measured range. The highest branch result exceeds main's highest result by 0.125s, about 1%. These local macOS timings do not reproduce Ubuntu's absolute cost or prove zero overhead.

Every pixel-cap measurement passed with its original 45-second timeout. Two full-shard runs exposed other timing-sensitive assertions: a focus-distance assertion on unchanged main and a render-count assertion on the branch. Neither test was changed; their failures are preserved in the comparison artifacts.

After removing resize work, only `test.setTimeout(45_000)` in the normal two-million-pixel test becomes `test.setTimeout(90_000)`. This gives clear headroom for the documented slow CI runner. All assertions, CDP steps, ratios, pixel limits and other test timeouts remain unchanged.
