# Sky step 4: a painted twilight gradient over Preetham

## What changed

- **C2. Stop the dark dusk.** The Preetham model goes dark before sunset: at the horizon it gives 2.6 % of its light. So the upper sky was near black by sun −5°. Now a painted gradient replaces it near sunset. It uses the zenith, upper and horizon colours of FWM's four dusk keys (`main.js:255-273` at `aca247b`), placed by sun elevation:

  | Key | Sun elevation | Zenith | Upper, warm upper | Horizon, warm horizon |
  | --- | --- | --- | --- | --- |
  | Late afternoon | +6° | `#3f7fae` | `#7ca4c2`, `#c4b8a0` | `#a4b4ba`, `#f4c584` |
  | Sunset | +1° | `#2f4a82` | `#6c7aa0`, `#e09a78` | `#9aa0b0`, `#ffa040` |
  | Civil dusk | −5° | `#172850` | `#394272`, `#a06a82` | `#6c6480`, `#f07a3a` |
  | Nautical dusk | −11° | `#060c22` | `#0e1838`, `#101838` | `#243050`, `#3d3452` |

  The keys blend with a smoothstep, as in FWM. Dawn uses the same keys by sun height.
- **Blend.** The gradient's weight rises from 0 at +6° to 1 at +1°, and falls from 1 at −10° to 0 at −12°. The night mix waits for the gradient: it is scaled by `1 − twilightAmount`. The nautical key is close to the night sky, so night takes over without a step.
- **Shape.** As in FWM, the upper sky turns warm toward the sun's azimuth (`pow(align, 3.5)`), and the horizon turns warm by `pow(align, 5)`. All azimuth weights use the world-fixed sun direction. A 20 % warm floor on the far side keeps the single fog colour mauve, not grey, under an orange sky. The sun-side glow band, the rose belt and the sun from step 3 sit on top of the gradient.
- **Fog.** The fog read still samples the sky side-on to the sun, so the fog now takes the painted horizon colour.

Tone mapping stays Neutral, with no global grade.

## Captures

`bash scripts/capture-sky.sh sky-step4 before|after`, with Vite on port 4378. "Before" is step 3 (https://github.com/pgrigorakis/soaring/pull/131). The views are the same as in steps 2 and 3: seed 1406157560, the default chase camera, 1280 × 800, and the same sun elevation in each pair.

| View | Before | After |
| --- | --- | --- |
| Sun +3° | `before/sun3.png` | `after/sun3.png` |
| Sun −6° | `before/sun-6.png` | `after/sun-6.png` |
| Sun −12° | `before/sun-12.png` | `after/sun-12.png` |
| Sun −52° | `before/sun-52.png` | `after/sun-52.png` |
| Moon, sun −6° | `before/moon-6.png` | `after/moon-6.png` |
| Moon, sun −12° | `before/moon-12.png` | `after/moon-12.png` |
| Moon at midnight | `before/moon-52.png` | `after/moon-52.png` |

- At −6° the sky toward the sun is orange under a red-violet upper sky, not brown. Opposite the sun it is mauve, not dark brown.
- At −12° and at midnight the sky is the night sky, as before.

## Tests

`tests/sky-twilight.smoke.ts` reads the gradient weight at seven sun elevations. It holds the camera 900 m over the ground, pitched 20° up, and reads the screenshots. Its output is `sky-twilight.json`. The step 3 values are in brackets.

| Measure | Step 4 | Limit |
| --- | --- | --- |
| Weight at +8°, +6°, −12°, −14° | 0 | 0 |
| Weight at +1°, −5°, −10° | 1 | 1 |
| Sky 25° up toward the sun at −6°, R + G + B | 243 (30) | more than 180 |
| Sky 25° up away from the sun at −6°, R + G + B | 136 (40) | more than 100 |
| Sky toward the sun at −6°, blue − green | 35 | more than 20 |
| Sun-side horizon at −6°, red − blue | 185 (85) | more than 130 |
| Fog target colour at −6°, R + G + B | 295 (155) | more than 220 |
| Largest change per degree, sun +2° to −14° | 51 (90) | less than 60 |

`tests/highlands.smoke.ts` (one hour through the Highlands) passes: the minimum clearance is 25.8 m, with 0 safety corrections (`highlands-navigation.json`). `npm run check` passes. `npm run test:smoke` passes: 44 of 44 tests.
