# Highlands acceptance evidence

Issue #57, part of #45.

- `navigation.json`: one simulated hour at 10 Hz through the real world model and navigator in Chrome. Seed 57, start `(-24000, 3750)`, heading 0. The baseline uses the same seed, start, cache-trim cadence and timestep on commit `184df89de4f05087194fdc25e36ddd83a7ba0181`.
- Minimum clearance: **12.34 m**, above the 6 m safety margin. No safety-floor corrections.
- Peak vertical speed: **4 m/s**, versus **511.64 m/s** before this change (the old thermal ceiling could jump down over falling ground).
- Flapping: **120 s**, versus **164.8 s** before this change, a 27% decrease.
- Highlands exposure: **1835.5 s** of the 3600 s flight. The same baseline start spent 2317.4 s in mountain regions.

This is an accelerated navigation test, not a literal one-hour rendered browser soak. Run `npm run test:smoke -- tests/highlands.smoke.ts` to reproduce the JSON artifact. Existing seed-448122 route-persistence and flapping-limit assertions remain unchanged and pass.

## Real-app captures

`noon.png` and `golden-hour.png` show the default 100 m chase camera, not an orbit or altitude camera. Captured from the normal running development app at 1440×900, pixel ratio 1, shadows enabled, full 5 km terrain loaded. The smoke-mode test captures separate lower-resolution CI images.

To reproduce:

1. Run `npm run dev` and open the normal app (without `?smoke`).
2. Set `localStorage.setItem('soaring.world-seed.v1', '57')`, remove `soaring.settings.v1`, and reload.
3. Call `window.__SOARING__.reviewFlight({ x: -24750, z: 3000, heading: 0 })`. This freezes navigation only; the normal chase camera, lighting and terrain stream keep running.
4. Hide the intro and controls for capture. Wait until `snapshot().pending === 0` and `snapshot().visibleDistance === 5000`.
5. Call `setTimeOfDay(0.5)` for noon and `setTimeOfDay(0.72)` for golden hour. Wait for a new rendered frame before each screenshot. Snow is white `#F2F4F7`; no face receives the board's blue shadow colour.

`tests/highlands-cover.smoke.ts` also verifies full snow above 420 m, bare faces above 40°, no snow below 380 m, and a small headwater cirque lake feeding a downhill river.
