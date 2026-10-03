# Performance notes

This ledger records how Soaring measures render cost and every result. Add new results at the bottom. Do not claim a gain without an interleaved comparison (see Method).

## What the bench measures

`npm run bench` loads the dev build with `?profile`, holds five fixed vantages, and records for each one. `npm run parity` uses those same vantages and controls to capture the finished 8-bit canvas without adding production hooks or capture overhead.

- **Frame interval**: the gap between `requestAnimationFrame` timestamps. This is cadence and latency. It includes idle time, so it is pinned to the display refresh (16.7 ms at 60 Hz) whenever the frame fits the budget.
- **Main-thread work**: time inside the frame callback, including render command submission. It excludes GPU execution and idle waiting. "CPU busy" is the sum of work divided by the sum of frame intervals.
- **GPU time**: `EXT_disjoint_timer_query_webgl2` around `renderer.render`, polled on later frames. Results after a disjoint event or with an invalid value are discarded and counted. If the browser lacks the extension, GPU columns read `n/a`, never zero. "GPU busy" is mean GPU time times rendered frames, divided by the sum of frame intervals.
- **Draw calls and triangles**: `renderer.info.render` read right after the main render. three.js resets these counts after the shadow pass, so they cover the main pass only.

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

## Picture parity

`npm run parity` captures two reads of every fixed vantage, using seed 5, the normal dev renderer, and 60 settling frames. It reports mean absolute RGB level difference, the share of pixels with any changed RGB channel, and the largest channel difference with its pixel coordinates. The repeated same-build comparison is the measured noise floor; it is a measurement, not an acceptance threshold.

Artifacts go to a new timestamped directory under `artifacts/look-parity/`, outside Playwright's disposable `test-results/` folder. Set `PARITY_VANTAGES` to a comma-separated subset of the five bench vantage names for a focused comparison. Each vantage has gzip-compressed RGBA captures and metadata; `parity.json` records the build commit, working-tree state, machine, browser, graphics renderer, viewport, pixel ratios, parameters, and measured differences. The tool fails rather than overwrite an existing artifact directory. To compare a saved capture, set `PARITY_REFERENCE` to its artifact directory. The comparison refuses dimension, browser, graphics renderer, viewport, pixel-ratio, machine, OS, architecture, or headless-mode mismatches. Build commits may differ because the tool is for comparing builds. Use `PARITY_URL`, `PARITY_SEED`, `PARITY_DPR`, `PARITY_REPEATS`, and `PARITY_OUT` to select the build, repeat count, and output path. No visual acceptance threshold is built in.

The approved-look inventory and its review links are in [approved-looks.md](design/approved-looks.md).

### Actual-browser parity run

A two-read local run on 2026-10-03 used Chromium 154.0.8037.93, ANGLE Metal on Apple M4 Pro, 1440×900 CSS viewport, DPR 2, render pixel ratio 1.75, seed 5, and all five bench vantages. The commit was `2870e8f821adec23c357ba3ffddd9d6d67de60d9` with a dirty working tree. The saved output is `artifacts/look-parity/2026-10-03T07-51-50.264Z-2870e8f821ad/` on the capture machine; the directory is ignored and versioned by the tool, not checked into source control.

| vantage | same-build mean (levels) | changed-pixel share | worst channel difference |
| --- | ---: | ---: | ---: |
| lake-noon | 0.2091 | 31.19% | 126 |
| confluence-noon | 0.4442 | 31.89% | 156 |
| river-run-golden-hour | 4.1095 | 37.98% | 191 |
| network-noon | 3.2523 | 45.78% | 223 |
| origin-night | 0.2323 | 13.20% | 100 |

These are measurements, not approval thresholds. Water ripples and the thermal marker pulse still animate during a held view, so the same-build floor can include visible motion. The tool reports that floor beside any reference diff and does not classify a picture as accepted or rejected.
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

## Result 1: shared tree and water pools (#101)

Command: `BENCH_BUILDS=base=…,pools=… BENCH_ROUNDS=3 BENCH_FRAMES=300 BENCH_WARMUP=60 BENCH_DPR=2 npm run bench`, interleaved.

- Base `aba0e81` (main) against the pooled branch, on the Baseline 1 machine, browser, viewport, seed and visibility
- Artifact: `docs/perf/issue-101-pools.json` (all rounds) and `.md`

| vantage | calls before | calls after | triangles before | triangles after | work p50 before | work p50 after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| lake-noon | 300 | 173 | 188062 | 370710 | 2.00 | 1.20 |
| confluence-noon | 412 | 182 | 245050 | 521886 | 2.80 | 1.20 |
| river-run-golden-hour | 475 | 170 | 533342 | 1246626 | 3.30 | 1.20 |
| network-noon | 438 | 178 | 263446 | 513566 | 3.00 | 1.20 |
| origin-night | 391 | 179 | 221244 | 384196 | 2.50 | 1.20 |

Observations:

- Each tree shape and all water draw once for the whole ring. Main-thread work fell by 0.8 to 2.1 ms.
- Triangles rose because a pool cannot be frustum culled: trees outside the view are still submitted.
- GPU p50 did not change consistently. On this machine it is bimodal (about 3.5 ms or about 6 ms) between rounds of the same build, so it cannot resolve a change of this size.
- Step measurements, one round each: mid-tier trees alone gave 262 to 371 calls; adding near-tier trees gave 251 to 288; adding water gave the table above.
- Picture parity against the base build stayed at the same-build noise floor at all five vantages; the changed pixels are water ripples, wing flaps and the thermal marker pulse.
