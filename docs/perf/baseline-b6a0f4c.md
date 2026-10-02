Command: `BENCH_ROUNDS=3 BENCH_FRAMES=300 BENCH_WARMUP=60 BENCH_DPR=2 npm run bench`

- Commit: build b6a0f4c9154299127e3339d676600b45cfc5dc5c
- Machine: Apple M4 Pro, 12 cores, 24 GiB, Darwin 27.2.0 arm64
- Browser: chromium 154.0.8037.93 headless; GL ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)
- Viewport 1440×900, devicePixelRatio 2, render pixel ratio 1.75
- Seed 5, terrain visibility 5000 m, 300 frames per vantage after 60 warmup frames, 3 rounds
- GPU timing: available

| build | vantage | calls | triangles | frame p5 | frame p50 | frame p95 | work p50 | GPU p50 | CPU busy | GPU busy |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| build | lake-noon | 300 | 188062 | 16.60 | 16.70 | 16.70 | 2.00 | 6.95 | 12.2% | 41.8% |
| build | confluence-noon | 412 | 245050 | 16.60 | 16.70 | 16.70 | 2.50 | 5.86 | 15.5% | 33.8% |
| build | river-run-golden-hour | 475 | 533342 ⚠ varies | 16.60 | 16.70 | 16.70 | 2.90 | 5.90 | 18.4% | 31.9% |
| build | network-noon | 438 | 263446 | 16.60 | 16.70 | 16.70 | 2.60 | 5.73 | 15.9% | 33.6% |
| build | origin-night | 391 | 221244 | 16.60 | 16.70 | 16.70 | 2.30 | 5.48 | 14.0% | 33.0% |

Times are milliseconds, each the minimum across rounds. "n/a" means the GPU timer query was unavailable.
