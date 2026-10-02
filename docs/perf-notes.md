# Performance notes

This ledger records how Soaring measures render cost and every result. Add new results at the bottom. Do not claim a gain without an interleaved comparison (see Method).

## What the bench measures

`npm run bench` loads the dev build with `?profile`, holds five fixed vantages, and records for each one:

- **Frame interval**: the gap between `requestAnimationFrame` timestamps. This is cadence and latency. It includes idle time, so it is pinned to the display refresh (16.7 ms at 60 Hz) whenever the frame fits the budget.
- **Main-thread work**: time inside the frame callback, including render command submission. It excludes GPU execution and idle waiting. "CPU busy" is the sum of work divided by the sum of frame intervals.
- **GPU time**: `EXT_disjoint_timer_query_webgl2` around `renderer.render`, polled on later frames. Results after a disjoint event or with an invalid value are discarded and counted. If the browser lacks the extension, GPU columns read `n/a`, never zero. "GPU busy" is mean GPU time times rendered frames, divided by the sum of frame intervals.
- **Draw calls and triangles**: `renderer.info.render` read right after the main render, so shadow passes are included.

Because the frame interval is vsync-bound, read headroom from work and GPU time, not from frame-interval percentiles. A frame interval above the refresh period means a missed frame.

## What is held

The bench reuses the existing dev hooks: `reviewFlight` places the bird and freezes navigation, `setTimeOfDay` freezes the sky, `setVisibility` fixes terrain reach, and `setViewpoint` fixes the camera. `?profile` also turns off adaptive quality. Each vantage waits for terrain to finish, for the fog colour read to settle, and for warmup frames before recording. It then checks that chunk count, sky phase, quality step and frame cap did not change.

Water ripple time and the thermal marker pulse still advance. They change pixels only, not draw calls or triangles.

A held view measures steady render cost. It is **not** a sustained-flight hitch measurement: terrain streaming, chunk builds and camera motion are absent. Use the diagnostics panel for those.

## Method

- Seed 5, five vantages (`scripts/perf-bench.ts`), terrain visibility at the product default.
- Read the 5th and 50th percentile of each round, then take the minimum across rounds. A transient stall then cannot inflate a result.
- To compare builds, run each in its own checkout on its own dev server and interleave rounds so thermal and background drift hits both:
  `BENCH_BUILDS=a=http://127.0.0.1:4401,b=http://127.0.0.1:4402 npm run bench`
- Draw calls and triangles must match between rounds of one build. The report marks a vantage "varies" if they do not.
- Other options: `BENCH_ROUNDS`, `BENCH_FRAMES`, `BENCH_WARMUP`, `BENCH_DPR`, `BENCH_OUT`.
- `npm run test:smoke` runs `tests/perf-bench.smoke.ts`. It checks repeatable counts, held state, unavailable and disjoint GPU handling, query cleanup, and that production builds carry no profiler.

## Baseline 1: b6a0f4c (includes async fog #105)

Command: `BENCH_ROUNDS=3 BENCH_FRAMES=300 BENCH_WARMUP=60 BENCH_DPR=2 npm run bench`

- Commit `b6a0f4c9154299127e3339d676600b45cfc5dc5c`, clean tree
- Machine: Apple M4 Pro, 12 cores, 24 GiB, Darwin 27.2.0 arm64
- Browser: Chromium 154.0.8037.93 (Chrome channel), headless; GL ANGLE Metal, Apple M4 Pro
- Viewport 1440×900, devicePixelRatio 2, render pixel ratio 1.75
- Seed 5, terrain visibility 5000 m, 300 frames per vantage after 60 warmup frames, 3 rounds
- Artifact: `docs/perf/baseline-b6a0f4c.json` (all rounds) and `.md`

| build | vantage | calls | triangles | frame p5 | frame p50 | frame p95 | work p50 | GPU p50 | CPU busy | GPU busy |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| build | lake-noon | 300 | 188062 | 16.60 | 16.70 | 16.70 | 2.00 | 6.95 | 12.2% | 41.8% |
| build | confluence-noon | 412 | 245050 | 16.60 | 16.70 | 16.70 | 2.50 | 5.86 | 15.5% | 33.8% |
| build | river-run-golden-hour | 475 | 533342 ⚠ varies | 16.60 | 16.70 | 16.70 | 2.90 | 5.90 | 18.4% | 31.9% |
| build | network-noon | 438 | 263446 | 16.60 | 16.70 | 16.70 | 2.60 | 5.73 | 15.9% | 33.6% |
| build | origin-night | 391 | 221244 | 16.60 | 16.70 | 16.70 | 2.30 | 5.48 | 14.0% | 33.0% |

Times are milliseconds, each the minimum across rounds.

Observations:

- Draw calls and triangles were identical in all three rounds, and identical in a second full session on the same commit.
- Frame intervals sit at the 60 Hz refresh at every vantage. GPU time (about 5.5 to 9 ms) is the larger share of the frame budget, ahead of main-thread work (about 2.5 to 3.6 ms).
- The river run at golden hour is the heaviest view: 533k triangles and the highest GPU time.
- This is one machine. Treat the numbers as a reference for this machine only.
