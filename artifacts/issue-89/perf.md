# Issue #89 sky-cloud performance comparison

## Method

- Ran the held-vantage GPU benchmark against baseline commit `7deb789aa90c0efa1952e6c0c19999314682ab55` and the cloud implementation.
- Used the same seed (5), 5 km visibility, 1440×900 viewport, DPR 2, and 60 warm-up plus 300 measured frames per vantage.
- Interleaved three rounds on Chromium 154 with ANGLE Metal on an Apple M4 Pro. GPU timer queries were available.
- GPU p50 is the render-call time for the whole scene. It is an estimate of the cloud shader's added cost, not an isolated shader measurement.

Command:

```sh
BENCH_BUILDS="baseline=http://127.0.0.1:4198,clouds=http://127.0.0.1:4197" \
BENCH_ROUNDS=3 BENCH_FRAMES=300 BENCH_WARMUP=60 \
BENCH_OUT=test-results/issue-89/paired-clean \
npx playwright test -c playwright.bench.config.ts tests/perf-bench.bench.ts
```

## GPU p50 results

Times are milliseconds. Each cell lists rounds 1, 2, and 3. The delta compares the median of each build's three rounds.

| Vantage | Baseline | Clouds | Median delta |
| --- | --- | --- | ---: |
| Lake, noon | 6.93 / 7.02 / 6.91 | 7.18 / 7.14 / 7.74 | +0.25 |
| Confluence, noon | 6.04 / 6.07 / 6.09 | 6.14 / 6.13 / 5.90 | +0.06 |
| River run, golden hour | 9.11 / 5.60 / 9.09 | 9.51 / 9.47 / 9.34 | +0.38 |
| Network, noon | 6.11 / 6.07 / 5.76 | 6.13 / 5.83 / 5.73 | -0.24 |
| Origin, night | 5.60 / 5.63 / 5.60 | 5.67 / 5.53 / 5.81 | +0.07 |

The median of the five per-vantage median deltas is **+0.07 ms**. The median across all 15 paired round differences is **+0.10 ms**. Frame-interval p50 remained 16.7 ms for both builds.

The golden-hour baseline had a large round-to-round swing (5.60 ms versus 9.09–9.11 ms). Treat the small GPU deltas as an estimate, not a precise isolated shader cost.

## CI timeout diagnosis

The earlier PR run, [37136020081](https://github.com/pgrigorakis/soaring/actions/runs/37136020081), failed when the four-minute test-wide deadline interrupted `runBenchRound` while it waited for terrain work to drain. The individual 120-second streaming deadlines and the benchmark assertions did not change.

A paired one-worker SwiftShader run used the same five-vantage smoke benchmark against current `origin/main` (`700c56f`) and the cloud build (`21bedb5`). It passed in 1.2 minutes without clouds and 1.1 minutes with clouds. Both runs kept 16.7 ms frame-interval p50, and every vantage began and ended with zero pending chunks. GPU timer results varied between rounds and do not support a precise comparison.

The same unchanged baseline took 2.7 and 3.9 minutes on shared CI runners (runs 37125342464 and 37125352898, recorded in the shared-pools PR evidence). This points to runner variance and insufficient test-level headroom, not a repeatable cloud or streaming regression. The repair raises only the overall test timeout from four to six minutes. It leaves every per-vantage deadline and assertion unchanged. The updated validation is on [PR #120](https://github.com/pgrigorakis/soaring/pull/120).

## Artifact note

The Playwright output directory is cleared at the start of a smoke run. This report preserves the benchmark summary. The repeatable screenshot test writes its images and metadata under `test-results/issue-89/`; copies are in `artifacts/issue-89/screenshots/`.
