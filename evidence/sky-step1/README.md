# Sky step 1: puff clouds lit by the sky, darker night exposure

## What changed

- **C4. Puff cloud tops follow the sky light.** Before, the puff shader mixed the horizon colour with a fixed white `(0.86–1.0)`. So the puffs stayed white at dusk and at night. Now the upward faces take a sky-light colour. It uses the warm-to-cool formula of the painted cloud layer: `(1, 0.49 + 0.49·high, 0.25 + 0.75·high)`. It then blends to a moonlit grey-blue `(0.16, 0.2, 0.3)` by the night amount.
- **B1. Night exposure goes down, not up.** Tone-mapping exposure is now `1.0 − 0.2·night`. Before, it was `1.0 + 0.12·night`. The hemisphere light is now `0.65 + 1.55·day`. Before, it was `1.15 + 1.05·day`. Full day is unchanged at 2.2, and full night drops from 1.15 to 0.65, so the land reads as night.

Tone mapping stays Neutral. No global grade is added, so the later grade step (B3 bloom and C5) can follow without counting twice.

## Captures

`bash scripts/capture-sky-step1.sh before|after`, with Vite on port 4378. Seed 1406157560, the default chase camera (100 m), 1280 × 800 at pixel ratio 1. Each pair uses the same sun elevation. The phase is the exact inverse of the Soaring arc in the scout's `tools/phases.mjs`. Each `.txt` file holds the snapshot for its image.

| Sun elevation | Before | After |
| --- | --- | --- |
| +3° | `before/sun3.png` | `after/sun3.png` |
| −6° | `before/sun-6.png` | `after/sun-6.png` |
| −12° | `before/sun-12.png` | `after/sun-12.png` |
| −52° (midnight) | `before/sun-52.png` | `after/sun-52.png` |

- At +3° and −6°, the puffs are warm, not white.
- At −12° and at midnight, the puffs are dim grey-blue, and the land and sky are darker.

## Tests

- `tests/sky-lighting.smoke.ts` reads the renderer exposure, the hemisphere intensity and the puff shader uniform at sun +52°, +3°, −6°, −12° and −52°. Its output is `sky-lighting.json`.
- `tests/highlands.smoke.ts` (one hour through the Highlands) passes. Its metrics are in `highlands-navigation.json`: the minimum clearance is 25.8 m, with 0 safety corrections.
- `npm run check` passes. `npm run test:smoke` passes: 41 of 41 tests.
