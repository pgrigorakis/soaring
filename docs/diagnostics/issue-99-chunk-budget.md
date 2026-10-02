# Issue 99: resumable terrain streaming

## Implementation

Normal streaming receives 4 ms per update; Low power receives 2 ms. Startup uses the same budget. A generator yields between eight terrain samples/vertices, eight water samples/levels, individual wet water cells, and tree-placement lattice rows. Geometry completion and instance construction remain short indivisible steps. This is a cooperative CPU budget, not a hard real-time guarantee. A slow world sample, garbage collection, or GPU upload can still exceed it.

Only a completed group enters the scene. Its queue entry remains present until publication, so haze cannot cross unfinished terrain. Recenter and clear cancel the generator before replacing the queue. Its `finally` releases detached buffers and instances. An old displayed chunk stays visible during a tier upgrade. Removed/replaced chunks return buffers only after scene removal.

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

## Validation

Before implementation, failure modes were recorded in `evidence/chunk-budget-failure-modes.md` and the recenter/cancellation E2E test was written in `tests/chunk-budget.smoke.ts`. That test runs real streaming in Low power, cancels partial builds, changes center again, then checks normal mode, complete coverage, reuse, and GPU geometry bounds. It attaches JSON records and a screenshot. Existing unit tests were adapted to millisecond budgets, not expanded after implementation.

Run:

```sh
npm run check
npm run test:smoke
```

The existing biome test verifies exactly equal terrain positions, normals, and colors across shared edges. The lake test verifies exact water edges across all tiers and dry-bank clearance. Software WebGL traversal needs a generous total deadline because Low power receives only 2 ms at 30 updates per second; there are no retries.
