# Issue 99: resumable terrain streaming

## Implementation

Normal streaming receives 4 ms per update; Low power receives 2 ms. Startup uses the same budget. A generator yields between eight terrain samples/vertices, eight water samples/levels, individual wet water cells, and tree-placement lattice rows. Geometry completion and instance construction remain short indivisible steps. This is a cooperative CPU budget, not a hard real-time guarantee. A slow world sample, garbage collection, or GPU upload can still exceed it.

Only a completed group enters the scene. Its queue entry remains present until publication, so haze cannot cross unfinished terrain. Recenter keeps a started build when its key and detail remain desired, so slow devices do not lose progress at each tile boundary. It cancels obsolete work; clear cancels all work. The generator's `finally` releases detached buffers and instances. An old displayed chunk stays visible during a tier upgrade. Removed/replaced chunks return buffers only after scene removal.

Each buffer pair owns fixed-capacity typed terrain and water arrays, attributes, indices, and geometry for one detail tier. Water uses draw range and active attribute counts without reallocating its arrays. Free lists retain at most 64 pairs per tier, enough for ordinary ring churn without retaining an entire cleared world. Teleports and large tier changes can still allocate. World samples and vegetation objects still allocate; shared species pools are issue 101 and are not included here. Sampling, water levels, palette, triangle winding, skirts, and world-aligned edges remain unchanged.

## Repeatable measurements

Base and fetched main: `40a1791`. No other lane's pixel-cap, sky-order, or fog changes were present. Browser: dedicated `chrome-devtools-axi` sessions, Chrome on this worker's macOS machine. Viewport: **1440×900**, seed **12345**, selected visibility **5000 m**, normal rendering, pixel ratio **1**, shadows enabled, no frame cap, adaptive quality step **0**.

Commands to prepare a measurement against either revision:

```sh
npm run dev -- --host 127.0.0.1 --port 4184
CHROME_DEVTOOLS_AXI_SESSION=chunk-budget chrome-devtools-axi open http://127.0.0.1:4184
CHROME_DEVTOOLS_AXI_SESSION=chunk-budget chrome-devtools-axi resize 1440 900
CHROME_DEVTOOLS_AXI_SESSION=chunk-budget chrome-devtools-axi eval '() => { localStorage.setItem("soaring.world-seed.v1","12345"); localStorage.setItem("soaring.scenic-visit.v1","0"); localStorage.setItem("soaring.settings.v1",JSON.stringify({terrainVisibility:5000,lowPower:false})); location.reload(); }'
```

Wait for reload before setting the pose. Freeze navigation with `reviewFlight({x:720,z:0,heading:0})`. Set the camera with `setViewpoint({x:720,y:500,z:-100,lookX:720,lookY:300,lookZ:200})`. Wait for one processed frame and then `snapshot().pending === 0`. Record a snapshot. Move the camera, without clearing terrain, using `setViewpoint({x:1440,y:500,z:-100,lookX:1440,lookY:300,lookZ:200})`. Record ten seconds of `requestAnimationFrame` gaps and a final snapshot. Keep other browser sessions hidden to avoid competing rendering. Confirm quality step, reach, and viewport before interpreting results. Do not measure during hot reload.

### Retained-terrain recenter

See `evidence/chunk-budget-retained-{before,after}.json`.

- Baseline: **54.3 FPS**, 33.3 ms p95 gap, 199.9 ms maximum gap.
- Resumable: **60.2 FPS**, 16.7 ms p95 gap, 16.8 ms maximum gap.
- Both built **173 chunks** and ended with **605 loaded**, zero pending, full 5000 m haze.
- CPU per chunk for that recenter, calculated from cumulative count × mean deltas: **12.43 ms before**, **12.16 ms after**.
- Lifetime mean/max chunk CPU: **11.81/62.2 ms before**, **13.88/65.0 ms after**. These include different startup histories. They do not measure the longest uninterrupted step.
- After: maximum indivisible step **1.3 ms**, maximum streaming update **4.9 ms**, including recenter and queue maintenance.
- Recenter reused **147** buffer pairs and allocated **26**. Pair allocation is not eliminated during large center jumps. Geometry counts include previously uploaded free buffers, so they are higher than the baseline's immediate disposal counts.

The original full-clear/chase-camera reproduction also measured **36.1 FPS**, **12.89 ms mean**, and **68.6 ms maximum chunk CPU**. Its resumable counterpart reached 60.1 FPS but loaded only 68 chunks after ten seconds. That comparison includes fewer rendered chunks and must not be presented as equal-throughput evidence. The retained-terrain comparison above avoids that confound. Smaller budgets trade initial load speed for responsive frames.

### Accelerated real flight

See `evidence/chunk-budget-flight.json` and `evidence/chunk-budget-after.png`. Resume navigation and clear the held viewpoint, set simulation scale to 8, then sample every five seconds for thirty seconds. Restore scale to 1 afterward.

- **60.07 FPS**, 16.8 ms maximum and p95 frame gaps.
- Buffer counters increased by **51 allocations** and **369 reuses**, including cancelled attempts.
- GPU geometry snapshots remained between **432 and 723**; final count **715**.
- Haze shortened to loaded terrain, ending at **1659 m**, with **328 pending** at 8× flight speed.

This is four simulated minutes, not an hour-long browser soak. It demonstrates reuse and bounded retained free lists, not zero lifetime allocation or full 5 km coverage at accelerated speed. No changes to world-cache limits or navigation were made.

## CI repair and final reconciliation

The first CI run failed five coverage waits under one-worker software WebGL. A SwiftShader browser with 4× CPU throttling reproduced moving queues that added work faster than the fixed CPU budget could drain them. A new browser regression first failed on valid-build cancellation across a center change. The repair retains that active generator if its key and descriptor still match the desired queue. New work remains nearest first; completed work is removed by key rather than by queue position.

Coverage tests now hold their measurement poses, retain every coverage/resource assertion, and allow software-WebGL deadlines appropriate to the unchanged 4/2 ms budgets. The flight/control test still advances the real navigator before checking the new pose. The thermal fixture uses seed 80231 and visit 0 on both loads instead of depending on a random route reaching a thermal within 300 simulated seconds.

The upstream fog test also raced a continuous sampler: a new read can start before a poll observes `readPending === false`. A development-only completion record captures revision, phase, count, target/color and failures at actual successful completion. The test checks current-revision completion and visible color convergence separately. Its rapid-change case holds a real GPU fence until the revision changes, then verifies the obsolete read was discarded. Zero synchronous reads, actual async reads, no failures and color differences remain asserted. Production sampling behavior is unchanged. The reusable fog repair is commit `2b934bd52c51740bbe9ace0adfc4b3961d36918e`.

The final validation reconciled main `4947104`, including async fog, sky order, profiling tools, documentation restructuring and unsigned edge-seed checks. All **27 smoke tests passed** in a one-worker SwiftShader browser using `playwright.chunk-ci.config.ts` on private port 4186. `npm run check` also passed. The earlier five failed coverage tests and the new retained-work regression all passed. The software renderer reported `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)`.

Final normal-rendering measurements used the same 1440×900 viewport, seed 12345, held 720→1440 m camera move, 5 km setting, pixel ratio 1 and quality step 0. See `evidence/chunk-budget-reconciled-after.json`. They recorded **60.2 FPS**, 16.8 ms maximum/p95 gap, **14.36/66.8 ms** lifetime mean/max chunk CPU, **1.0 ms** maximum step and **4.7 ms** maximum update. At ten seconds, 172 builds had completed and one remained pending; haze was correctly limited to 4853 m. The remaining build then completed and restored 605 loaded chunks and full 5000 m coverage. The final run includes upstream rendering improvements, so it must not be attributed to terrain streaming alone. The earlier controlled comparison remains the terrain-only evidence.

## Validation

Before implementation, failure modes were recorded in `evidence/chunk-budget-failure-modes.md` and the recenter/cancellation E2E test was written in `tests/chunk-budget.smoke.ts`. That test runs real streaming in Low power, cancels partial builds, changes center again, then checks normal mode, complete coverage, reuse, and GPU geometry bounds. It attaches JSON records and a screenshot. Existing unit tests were adapted to millisecond budgets, not expanded after implementation.

Run:

```sh
npm run check
npm run test:smoke
```

The existing biome test verifies exactly equal terrain positions, normals, and colors across shared edges. The lake test verifies exact water edges across all tiers and dry-bank clearance. Software WebGL traversal needs a generous total deadline because Low power receives only 2 ms at 30 updates per second; there are no retries.
