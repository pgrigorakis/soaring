# Issue 99 test-first inventory

Before implementation:
- Seam disagreement: retain world coordinates, halo normals, exact existing indices and skirt winding. Run biome and water browser edge checks.
- Stale work after recenter: cancel active generator before queue replacement; never publish cancelled work.
- Displayed buffers reused: release only after removing old group; pool owns only detached geometry.
- Partial publication: keep group detached until generator completes; keep active tile in pending coverage calculations.
- Missing terrain behind haze: include active work in pending; preserve coveredDistance and old chunks during upgrades.
- Disposal leaks: cancellation must release acquired geometry and all attached instances; dispose pool on shutdown.
- Low power starvation: positive 2 ms budget always advances at least one bounded step.
- Near-first order: keep sorted queue head until complete; cancel on changed center.
- Long-flight memory growth: cap free buffers per tier; retain scratch capacity, not world sample references after cancellation.

Repeatable browser measurement: Chrome session chunk-budget, dev port 4184, viewport 1440x900, normal rendering (no smoke), seed 12345, visibility 5000, frozen reviewFlight poses x=0,z=0,heading=0 then x=720,z=0,heading=0. Record 10 seconds RAF gaps after each recenter plus snapshot build timings. These are cumulative CPU build timings, not GPU upload timings. Compare same device/browser and pose; report cache and rendering limitations.
