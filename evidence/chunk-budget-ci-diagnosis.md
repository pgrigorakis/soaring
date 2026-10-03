# CI repair: evidence and failure modes before the fix

The failed run used one worker, not six. All five failures waited for streamed coverage: initial/full pending drain, or the first far tile. The new Low power test waited while navigation kept moving.

A dedicated Chrome browser using ANGLE SwiftShader, 1440x900, seed 12345, 720 m visibility and Low power reproduced insufficient streaming throughput with 4x CPU throttling. Chunk CPU averaged 100–111 ms, and only 1–2 chunks finished per five seconds. Moving flight kept adding work. A frozen camera drained the queue monotonically, but required much longer than the hardware-GPU run. Smoke reach loads 45 chunks for this viewport, not the isolated stream's 25.

Ranked hypotheses:
1. Cancelling valid partial builds on every center change wastes CPU and can starve long builds. Prediction: retaining the same desired key/descriptor preserves progress across a tile boundary.
2. Existing coverage tests implicitly depend on fixed-count throughput. Prediction: stable measurement poses plus deadlines appropriate to the unchanged 4/2 ms budgets preserve coverage checks on software WebGL.
3. Synchronous fog readback amplifies low update rate. Latest main removes that stall; it does not remove the first two failure modes.

New failure cases to lock down before changing the implementation:
- An active chunk that remains desired must survive recenter without losing CPU progress.
- An obsolete active chunk must still be cancelled and must not publish.
- A retained active chunk must remain in the missing-terrain coverage calculation.
- Pending queue removal must use the active chunk's key, not the newly sorted queue head.
- Coverage tests must freeze the measurement pose, but still exercise actual flight advancement and camera controls.
- Software-WebGL timing must not be confused with normal GPU performance. Do not change production budgets or reduce coverage assertions to make CI pass.
