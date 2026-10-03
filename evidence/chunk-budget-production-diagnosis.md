# Production render check: failure inventory before repair

CI run 37108196457 passed all development coverage/fog tests, then timed out in the production test's 64×64 bottom-left `readPixels` poll. Its retained failure screenshot shows a correctly rendered eagle over temporarily fog-limited terrain, not a blank renderer.

A dedicated ANGLE SwiftShader Chrome at 1440×900 with 4× CPU throttling reproduced one-color reads outside the draw callback, even while screenshots showed rendered content. The default framebuffer is not preserved after browser composition. A bottom-left terrain patch can also legitimately remain uniform haze during time-budgeted loading.

Failure modes to preserve:
- A truly blank or broken renderer must fail the existing >8-color threshold.
- Sampling after browser composition must not mistake a discarded framebuffer for a blank scene.
- Sampling offscreen shadow/fog targets must not count as visible rendering.
- Pixel coordinates must use the real drawing-buffer size, including device-pixel scaling.
- The foreground eagle must render even while haze masks unfinished terrain. Full terrain coverage remains checked in the development E2E tests.
- Production must still serve from /soaring/, preserve the zero seed, expose no development hooks, keep diagnostics hidden, and report no page errors.

Repair target: latch a real visible-frame pixel sample synchronously after an actual default-framebuffer draw, then poll the latched result. Keep the same color-diversity assertion and the unmodified production bundle. Do not increase product budgets, disable graphics features, or depend on development APIs.
