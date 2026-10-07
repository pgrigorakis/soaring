# Performance notes

This ledger records measured render costs and results. Add new results at the bottom. Do not claim a gain without an interleaved comparison; see [performance procedures](testing.md#performance-tools).

## Render resolution

Normal rendering caps its pixel ratio at the lower of the device ratio, 1.5, and the value needed to stay within a 2-million-pixel budget. Adaptive quality can lower the normal ratio through steps of 1.5, 1.25, and 1.0, and the ratio updates when the viewport or device-pixel ratio changes.

## What the bench measures

See [performance procedures](testing.md#performance-tools) for the benchmark and picture parity setup.

- **Frame interval**: the gap between `requestAnimationFrame` timestamps. This is cadence and latency. It includes idle time, so it is pinned to the display refresh (16.7 ms at 60 Hz) whenever the frame fits the budget.
- **Main-thread work**: time inside the frame callback, including render command submission. It excludes GPU execution and idle waiting. "CPU busy" is the sum of work divided by the sum of frame intervals.
- **GPU time**: `EXT_disjoint_timer_query_webgl2` around `renderer.render`, polled on later frames. Results after a disjoint event or with an invalid value are discarded and counted. If the browser lacks the extension, GPU columns read `n/a`, never zero. "GPU busy" is mean GPU time times rendered frames, divided by the sum of frame intervals.
- **Draw calls and triangles**: `renderer.info.render` read right after the main render. three.js resets these counts after the shadow pass, so they cover the main pass only.

Because the frame interval is vsync-bound, read headroom from work and GPU time, not from frame-interval percentiles. A frame interval above the refresh period means a missed frame.

The results below predate the continental terrain (#127). They used the drainage-era vantages `lake-noon`, `confluence-noon`, `river-run-golden-hour`, `network-noon` and `origin-night`. The current five vantages are defined in `scripts/perf-bench.ts`. Do not compare results across that change.

## Actual-browser parity run

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

See the [full baseline capture](perf/baseline-b6a0f4c.md) and [all-round data](perf/baseline-b6a0f4c.json) for run details and per-vantage results.

Observations:

- Draw calls and triangles were identical in all three rounds, and identical in a second full session on the same commit.
- Frame intervals sit at the 60 Hz refresh at every vantage. GPU time (about 5.5 to 9 ms) is the larger share of the frame budget, ahead of main-thread work (about 2.5 to 3.6 ms).
- The river run at golden hour is the heaviest view and has the highest GPU time.
- This is one machine. Treat the numbers as a reference for this machine only.

## Result 1: shared tree and water pools (#101)

See the [full comparison report](perf/issue-101-pools.md) and [all-round data](perf/issue-101-pools.json) for run details and per-vantage results.

Observations:

- Each tree shape and all water draw once for the whole ring. Main-thread work fell by 0.8 to 2.1 ms.
- Triangles rose because a pool cannot be frustum culled: trees outside the view are still submitted.
- GPU p50 did not change consistently. On this machine it is bimodal (about 3.5 ms or about 6 ms) between rounds of the same build, so it cannot resolve a change of this size.
- Step measurements, one round each: mid-tier trees alone gave 262 to 371 calls; adding near-tier trees gave 251 to 288; adding water produced the full results in the [comparison report](perf/issue-101-pools.md).
- Picture parity against the base build stayed at the same-build noise floor at all five vantages; the changed pixels are water ripples, wing flaps and the thermal marker pulse.
