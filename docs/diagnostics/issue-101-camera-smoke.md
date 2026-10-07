# Camera smoke timing after shared pooling

CI run `37136698053` passed 29 smoke tests, skipped the unavailable GPU-timer check, and failed the camera drag test. The held yaw changed from `-1` to approximately `-0.00248`, which means the double-click started a reset.

The test took a browser snapshot between the drag release and the click pair. The product intentionally ignores double-clicks only within 600 ms of a completed drag. The puff-clouds worker reported an 847 ms snapshot round trip in its CI trace. No camera product code changes are required.

## Counterfactual and disconfirming results

- The original test with an explicit 847 ms wait after its snapshot failed under one-worker SwiftShader at the same held-yaw assertion. This reproduces the timing artifact without changing pooling or camera code.
- A 6× CPU-throttled diagnostic also failed after moving the snapshot into a release listener. Removing the browser round trip alone is not sufficient under arbitrary CPU throttling.
- A rejected synthetic click pair in that listener also failed under 6× throttling. That listener still took a snapshot before the clicks. This is not evidence that the real input sequence is broken.
- The accepted test reuses the puff-clouds worker's real-input approach. It sends the double-click directly after release and calculates the expected yaw and pitch from the commanded drag. It still checks that the view holds and that a later real double-click resets smoothly.

The artificial 6× throttle is diagnostic, not an acceptance requirement. No synthetic inputs or temporary scratch tests are included in the delivered test.

## Verification

```sh
npx playwright test -c playwright.chunk-ci.config.ts tests/app.smoke.ts \
  -g 'a dragged camera' --repeat-each=5
npm run check
npm run test:smoke -- -c playwright.chunk-ci.config.ts
```

Results: all five focused repetitions passed; all 113 tests and the production build passed; all 31 smoke tests passed in 7.4 minutes. The smoke setup uses one worker, a 1440×900 viewport, and SwiftShader, matching CI's software-WebGL path.

The local diagnostic artifacts under `evidence/issue-101-camera/`, the initial throttle logs at `evidence/shared-pools-drag-{repro,fixed}.log`, and the visual evidence in `docs/pr-101-screenshots/` are no longer in the tree. They remain in git history at commit `5da4b07`. The pool benchmark remains in `docs/perf/issue-101-pools.{md,json}`.
