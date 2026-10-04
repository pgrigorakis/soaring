# Sky step 2: moon halo and face, visible stars, stars with the afterglow

## What changed

- **S1. Moon halo.** A cool two-term glow, `pow(m, 250)·0.35 + pow(m, 30)·0.06`, as in FWM. It reaches about 12° and is scaled by the night amount.
- **B2. Moon falloff.** The disc value drops from a flat 4.5 to about 1.35, so Neutral tone mapping no longer clips it to a flat white. The halo carries the glow. The old thin limb ring is gone.
- **M1. Moon face.** Two noise octaves make fixed maria, and `1 − 0.25·r²` darkens the limb. The disc stays about 3.4° across, with a crisper edge. The face is always full until the phase step (step 5).
- **T1. Visible stars.** A coarse layer (grid 100, 4.5 % of cells, about 1.2–1.9 px across at 1280 × 800) and a fine layer at half strength (grid 220). Brightness runs 0.45–1.7, with a slow twinkle.
- **T2. Star masking.** Moonlight dims stars by up to 45 %. The moon disc and the painted clouds hide them. Stars fade out below 0.08–0.2 sky height, so the fog probe at 0.07 never samples a star.
- **T3. FWM star timing.** `starAmount` rises from sun −2° and is full by −6°. Before, it was full by −6.9° and started at 0°. At −6° the night mix is only about 0.4, so the stars share the sky with the afterglow.

Two dev hooks support the test: `setCloudCoverage(coverage | null)` and the `sunDirection`, `moonDirection` and `starAmount` snapshot fields.

## Captures

`bash scripts/capture-sky.sh sky-step2 before|after`, with Vite on port 4378. "Before" is step 1 (https://github.com/pgrigorakis/soaring/pull/128). Seed 1406157560, the default chase camera (100 m), 1280 × 800 at pixel ratio 1. Each pair uses the same sun elevation. `sun*` shots head the chase camera at the sun, `moon-6` and `moon-12` head it at the moon, and `moon-52` aims the camera at the moon (`lookAtBody('moon')`), because the midnight moon is 52° high.

| View | Before | After |
| --- | --- | --- |
| Sun +3° | `before/sun3.png` | `after/sun3.png` |
| Sun −6° | `before/sun-6.png` | `after/sun-6.png` |
| Sun −12° | `before/sun-12.png` | `after/sun-12.png` |
| Sun −52° | `before/sun-52.png` | `after/sun-52.png` |
| Moon, sun −6° | `before/moon-6.png` | `after/moon-6.png` |
| Moon, sun −12° | `before/moon-12.png` | `after/moon-12.png` |
| Moon at midnight | `before/moon-52.png` | `after/moon-52.png` |

## Tests

- `tests/sky-bodies.smoke.ts` checks the star timing at sun −1°, −2°, −4° and −6°. At midnight it measures the rendered moon: the centre is near white, the face varies across the disc, the halo 60 px out is brighter than the sky 330 px out, and more than 40 stars show as distinct peaks. Its output is `sky-bodies.json`.
- `tests/highlands.smoke.ts` (one hour through the Highlands) passes. Its metrics are in `highlands-navigation.json`: the minimum clearance is 25.8 m, with 0 safety corrections.
- `npm run check` passes. `npm run test:smoke` passes: 42 of 42 tests.
