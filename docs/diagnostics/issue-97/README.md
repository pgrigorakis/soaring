# Issue 97: asynchronous fog-colour sampling

## Failure modes to handle

1. The probe render or asynchronous read can fail. Restore state, keep the last valid colour or initial fallback, and handle rejected reads.
2. Reads can overlap. Allow one readback at a time and do not overwrite its shared pixel buffer.
3. A read can finish after an explicit time change. Discard results from an older time generation.
4. The target can be rendered into again or disposed before a read finishes. Do not reuse it while a read is pending, and ignore completion after disposal.
5. No result exists on the first frame. Start with a valid fog colour and keep terrain visibility and fog distances independent of sampling.
6. The offscreen probe can alter renderer state. Restore the active render target, viewport, scissor and scissor-test state after drawing it.

## Before-change capture

The original synchronous path produced 10 synchronous pixel reads over 180 animation frames. It produced no asynchronous reads. The measured mean frame gap was 17.85 ms, with a 66.8 ms maximum. After the change, the same browser setup produced zero synchronous reads and nine asynchronous reads. The measured mean was 17.85 ms, with a 66.7 ms maximum. The 60 Hz frame cadence hides any improvement in this short timing sample. The key verified change is that synchronous pixel reads no longer occur. See `before-timing.json` and `after-timing.json`.

The before screenshots use seed 5, vantage `(0, 0, heading 0)`, 2,400 m visibility, a 1440 × 900 viewport, and the development `?smoke` renderer. They show noon (`0.5`), golden hour (`0.72`), and night (`0`). The smoke renderer uses pixel ratio 0.25 and disables shadows.

## Repeatable validation

Run the real-browser regression with:

```sh
npm run test:smoke -- tests/fog-readback.smoke.ts
```

The test checks WebGL2 readback calls, horizon/fog colour agreement at all three phases, a time change during a pending read, browser errors, and animation-frame timing. It holds visibility at 2,400 m and writes its run record and screenshots under `test-results/issue-97/`. Committed screenshots and the concise browser measurements are in this directory: `before-*.png`, `after-*.png`, and `after-phases.json`.

For the full required checks, run `npm run check` and `npm run test:smoke`.
