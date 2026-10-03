Command: `BENCH_BUILDS=base=http://127.0.0.1:4401,pools=http://127.0.0.1:4402 BENCH_ROUNDS=3 BENCH_FRAMES=300 BENCH_WARMUP=60 BENCH_DPR=2 npm run bench`

- Commit: base aba0e815cae10b6ec2819e2a0e805c35367f4a4c (main, served from an export; the tool recorded the checkout commit for both), pools 215998e8d2f7240b85648d1c57283f3cf747b9fe
- Machine: Apple M4 Pro, 12 cores, 24 GiB, Darwin 27.2.0 arm64
- Browser: chromium 154.0.8037.93 headless; GL ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)
- Viewport 1440×900, devicePixelRatio 2, render pixel ratio 1.75
- Seed 5, terrain visibility 5000 m, 300 frames per vantage after 60 warmup frames, 3 rounds
- GPU timing: available

| build | vantage | calls | triangles | frame p5 | frame p50 | frame p95 | work p50 | GPU p50 | CPU busy | GPU busy |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| base | lake-noon | 300 | 188062 | 16.60 | 16.70 | 16.70 | 2.00 | 6.87 | 12.3% | 33.7% |
| base | confluence-noon | 412 | 245050 | 16.60 | 16.70 | 16.70 | 2.80 | 5.84 | 16.7% | 32.3% |
| base | river-run-golden-hour | 475 | 533342 | 16.60 | 16.70 | 16.70 | 3.30 | 4.82 | 19.8% | 34.5% |
| base | network-noon | 438 | 263446 | 16.60 | 16.70 | 16.70 | 3.00 | 5.96 | 18.0% | 35.1% |
| base | origin-night | 391 | 221244 | 16.60 | 16.70 | 16.70 | 2.50 | 5.67 | 15.3% | 34.0% |
| pools | lake-noon | 173 | 370710 | 16.60 | 16.70 | 16.70 | 1.20 | 6.94 | 7.1% | 37.3% |
| pools | confluence-noon | 182 | 521886 | 16.60 | 16.70 | 16.70 | 1.20 | 6.12 | 7.4% | 31.1% |
| pools | river-run-golden-hour | 170 | 1246626 | 16.60 | 16.70 | 16.70 | 1.20 | 4.72 | 7.5% | 34.6% |
| pools | network-noon | 178 | 513566 | 16.60 | 16.70 | 16.70 | 1.20 | 3.44 | 7.4% | 27.6% |
| pools | origin-night | 179 | 384196 | 16.60 | 16.70 | 16.70 | 1.20 | 5.54 | 7.5% | 31.0% |

Times are milliseconds, each the minimum across rounds. "n/a" means the GPU timer query was unavailable.
