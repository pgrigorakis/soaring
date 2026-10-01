# Browser smoke reliability: issue 70

## Cause and reproduction

Software WebGL limits browser frame delivery and frame-dependent automation. CI uses `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`. This is not the local hardware-rendered environment. Full scene draws on every animation frame leave too few responsive frames for repeated clicks, reloads, camera easing and terrain streaming within a test's existing 30-second budget.

The thermal wait has an additional clock error: `frame()` caps wall delta at 0.1 seconds before applying time scale. A 300 ms frame advances only 1.2 simulated seconds at scale 12, not 3.6. Thermal selection happens after at least 34 simulated seconds and depends on the seed, terrain and scenic start. A 25-second real-time wait therefore does not provide the assumed 300 simulated seconds on CI.

Trigger: repeated scene draws on SwiftShader, especially large visibility settings and reloads. Legacy audio records lacking terrain visibility also load the normal 5 km default; this was not removed or bypassed. Masking conditions: local GPU speed, favorable seeds/scenic starts and a faster CI runner. Symptoms: a shared test deadline expires at whichever click, evaluation or state wait is next. The final action in the timeout is not necessarily the slowest action or a broken interaction.

Before any runtime change, added full Playwright traces, failure screenshots and a JSON timing report, then reproduced three timeouts in [run 36895883835](https://github.com/pgrigorakis/soaring/actions/runs/36895883835): camera/visibility, volume migration and pending audio start. The suite took 360.1 seconds. Traces show ordinary gear/mute clicks taking 3–5 seconds. The volume failure screenshot shows the settings panel open and the gear visible; it is not the earlier idle-hidden-gear bug. The migration trace spends its budget across several successful actions, then expires at the final mute assertion.

A second unchanged-runtime reproduction, [run 36896031076](https://github.com/pgrigorakis/soaring/actions/runs/36896031076), took 456.5 seconds and failed five tests. Frame-gap medians were 250–333 ms for the recurring problem tests, with initial gaps up to 2 seconds. The first test failed despite only 720 m visibility and no pending terrain work. Thus 5 km streaming amplifies the problem but is not necessary to trigger it.

Historical comparison: [failing main run 36894637349](https://github.com/pgrigorakis/soaring/actions/runs/36894637349) took 5.4 minutes and failed the thermal wait, camera/visibility and volume migration. [Passing aurora run 36893726034](https://github.com/pgrigorakis/soaring/actions/runs/36893726034) took 4.0 minutes. Historical runs uploaded no traces/screenshots, so those cannot be recovered. New reproductions above captured both.

## Counterfactuals and disconfirming evidence

Ranked hypotheses were software drawing/frame starvation, procedural terrain work, and seed-dependent simulated-time progress; hidden controls were checked as an alternative interaction cause.

Changed only smoke pixel ratio from 0.75 to 0.25. [Run 36897916494](https://github.com/pgrigorakis/soaring/actions/runs/36897916494) improved to 297.8 seconds, but still failed camera/visibility. Median frame gaps fell to about 83–133 ms for the recurring tests. This confirms pixel rendering contributes, but rejects fewer pixels alone as a sufficient fix. This run also rebased onto the fullscreen-control merge and ran 13 rather than 12 tests; the comparison is not a controlled same-base benchmark.

[Passing pixel-only run 36899020252](https://github.com/pgrigorakis/soaring/actions/runs/36899020252) took 285.7 seconds. Camera/visibility used 25.8 of its 30 seconds; volume migration used 26.2 seconds. This explains why reruns sometimes pass without fixing the underlying budget margin. Phase instrumentation separates terrain building from scene command submission and daylight/fog sampling. In the camera test's final document, 52 frames spent 1,172 ms in terrain, 353 ms submitting scene renders, and 73 ms in daylight/fog sampling, while median frame gaps remained 117 ms. The browser's software draw/compositing pipeline, not just synchronous `renderer.render()` JavaScript time or fog readback, delays frame delivery. Terrain remains real work, but cannot alone explain the elapsed time. Temporary phase instrumentation was removed after capture.

## Fix and coverage

- Development-only `?smoke` uses 0.25 pixel ratio and draws the real scene once per four animation frames. Navigation, camera easing, terrain streaming and input still run on every animation frame. Production rendering is unchanged.
- Development-only smoke `advanceSimulation(seconds)` runs the real navigator and flight/marker/audio updates in bounded 0.1-second steps. Thermal tests advance until the real active thermal exists, within the original 300-simulated-second budget. They still check every in-range marker, active marker identity, out-of-range exclusion, persistence and re-enabling. No thermal state is injected.
- The flight movement check advances the original 12-simulated-second interval instead of sleeping 1.5 real seconds at scale 8.
- Sky screenshots wait for an actual completed scene draw after changing sky/camera state, rather than assuming three animation frames include a draw.
- All existing tests and outcome assertions remain. The hidden/visible lifecycle test still checks real animation-frame timing and bounded first-visible simulation/streaming work; it does not use fast-forward.
- CI retains failure traces/screenshots and per-test/frame timings for 14 days. No retries or increased timeouts were added. `workflow_dispatch` allows independent repeat validation of a branch without empty commits.

First fixed [run 36899852963](https://github.com/pgrigorakis/soaring/actions/runs/36899852963) passed all 13 tests in 122.1 seconds: 66% less than the 360.1-second captured baseline, 73% less than the 456.5-second instrumented baseline, and 58% less than the passing pixel-only run. Camera/visibility dropped to 15.3 seconds, volume migration to 12.1 seconds, pending audio start to 9.8 seconds, and thermal tracking to 11.8 seconds. These are suite times, excluding dependency/browser installation. The fixed run retained full traces, so the improvement is not from disabling trace recording.

Local validation: all 50 existing unit tests, type checking and production build passed; all 13 browser smoke tests passed in 37.7 seconds. The thermal regression was run red before implementing the hook, then green using the real navigator. CI screenshots were inspected: the expected sky, eagle and terrain still render; smoke's reduced resolution is deliberately not a production visual-quality benchmark.

## Evidence and repeatability

`issue-70-ci.json` preserves per-test durations, frame-gap summaries, final state/seed, WebGL renderer, phase measurements where available, and trace SHA-256 hashes from the five diagnostic runs. Full trace ZIPs and screenshots were downloaded and inspected from each run's `smoke-evidence` artifact. Use `gh-axi run download <run-id> --name smoke-evidence --dir <directory>` while the artifacts remain available.

Run `npm run check` and `npm run test:smoke`. Dispatch `deploy-pages.yml` against the PR branch to repeat the same checks on a fresh Ubuntu CI runner. Each run uses fresh browser contexts and random world seeds, with no retries. Consecutive final-branch validation results are recorded in the PR description after completion.
