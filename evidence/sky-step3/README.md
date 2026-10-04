# Sky step 3: warmth follows the sun, a rose belt, sun-lit clouds and a wider sun

## What changed

The shapes follow the FWM sky shader (`main.js:700-780` at `aca247b`). Three new weights come from the sun height, as in FWM (`main.js:3616-3618`):

- `lowSun = exp(−(sunY / 0.14)²)`: the sun sits near the horizon.
- `glowAmount`: the sun-side glow band, from sun −12.7° to +18.7°.
- `venusAmount = exp(−((sunY + 0.03) / 0.09)²)`: the rose belt, strongest at sun −1.7°.

Every azimuth weight uses the world-fixed sun direction, not the camera.

- **C1. Directional warm band.** The old warm band covered the lower sky in every direction at weight 0.62. Its weight is now 0.25 opposite the sun and rises to 0.7 toward it, as `pow(align, 3)`. A thin saturated glow band, `pow(align, 3)·exp(−|y| / 0.07)`, hugs the sun-side horizon. Opposite the sun, a rose belt of Venus sits at 4° over a blue earth shadow.
- **C3. Sun-lit painted clouds.** The clouds take the sun colour toward the sun, the glow colour near a low sun, and rose opposite it. Thin cloud edges near the sun catch a bright rim. The old single salmon tint drops from 0.72 to 0.4.
- **S2. Wider sun and low-sun glow.** The sun disc is now about 3° across (50 px at 1280 × 800). Before, it had a 1.1° core and a rim that turned off at the horizon. It keeps a pale yellow colour, so it reads against the orange glow. The glow is `pow(s, 30)·0.12 + pow(s, 500)·0.6 + pow(s, 4)·lowSun·0.35`. The broad term fades softly below the horizon, so the haze under it shows no edge. The lens flare sizes still match the disc.

Tone mapping stays Neutral, with no global grade. The puff cloud light from step 1 keeps its own warm-to-cool formula.

## Captures

`bash scripts/capture-sky.sh sky-step3 before|after`, with Vite on port 4378. "Before" is step 2 (https://github.com/pgrigorakis/soaring/pull/130). The views are the same as in step 2: seed 1406157560, the default chase camera, 1280 × 800, and the same sun elevation in each pair.

| View | Before | After |
| --- | --- | --- |
| Sun +3° | `before/sun3.png` | `after/sun3.png` |
| Sun −6° | `before/sun-6.png` | `after/sun-6.png` |
| Sun −12° | `before/sun-12.png` | `after/sun-12.png` |
| Sun −52° | `before/sun-52.png` | `after/sun-52.png` |
| Moon, sun −6° | `before/moon-6.png` | `after/moon-6.png` |
| Moon, sun −12° | `before/moon-12.png` | `after/moon-12.png` |
| Moon at midnight | `before/moon-52.png` | `after/moon-52.png` |

At −6° and −12° the sky above the glow is still dark brown. The Preetham model is nearly black there. Step 4 (the painted twilight gradient) addresses this.

## Tests

`tests/sky-dusk.smoke.ts` holds the camera 900 m over the ground at sun +2° and reads the screenshots. Its output is `sky-dusk.json`. The values from step 2 are in brackets.

| Measure | Step 3 | Limit |
| --- | --- | --- |
| Sun disc width on its row | 50 px (37) | at least 45 |
| Warmth (red − blue) at 5°, sun side minus far side | 79 (3) | more than 40 |
| Red 12° above the sun | 235 (183) | more than 215 |
| Blue / red in the belt opposite the sun | 0.68 (0.52) | more than 0.6 |
| Cloud warmth, sun side minus far side | 66 (−3) | more than 30 |

`tests/screen-pixels.ts` is a small shared helper: it decodes a screenshot in the page for these measures. `tests/sky-bodies.smoke.ts` now uses it too.

`tests/highlands.smoke.ts` (one hour through the Highlands) passes: the minimum clearance is 25.8 m, with 0 safety corrections (`highlands-navigation.json`). `npm run check` passes. `npm run test:smoke` passes: 43 of 43 tests.
