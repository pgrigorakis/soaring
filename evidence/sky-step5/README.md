# Sky step 5: real moon phases and the moon's own orbit

## What changed

- **M3. The moon's own orbit.** Before, the moon sat exactly opposite the sun, so it was always full. Now it falls behind the sun by a full turn every 8 game days (`LUNAR_DAYS`). So it rises about 3 game hours later each day, and its phase changes each night. The first dusk of a new game (day 0.75) has a full moon that rises opposite the setting sun. The moon stays on the same world-fixed arc as the sun.
- **M2. Real phases.** The shader lights the moon's near face as a sphere, from the direction of the sun. The lit fraction is `(1 + cos α) / 2`, for the phase angle α. The terminator is soft (a smoothstep across ±0.12 of the face normal), not FWM's `sign()` flip. The dark face keeps 2.5 % of its light, as faint earthshine.
- **Phase angle from the orbit.** The sun and moon arc is not a great circle. So the direct angle between the two directions wobbles through each day: one night's lit fraction swung from 0.28 to 0.84. The phase angle is therefore the orbital lag. The light on the face leans from the moon toward the sun in the sky, at that angle (`moonSunlight` in `src/sky-cycle.ts`). The phase now changes only slowly, by one eighth of a cycle per day.
- **Light follows the phase.** Moonlight, the moon's water glint and its halo scale by the lit fraction. The halo is not drawn over the disc, so the dark part of the face stays dark.
- **Shadow caster.** The rule is now "the sun while it is up, else the moon". The old rule (`sun.y >= moon.y`) was safe only for a moon opposite the sun. Moonlight now waits for the sun to set: it fades in from sun 0° to −5.7°. The sun's light is zero at the horizon. So both lights are dark at the switch, and the AGENTS.md invariant holds without change.
- **Dev hook.** `setTimeOfDay(phase, day = 0)` sets the game day too, so a test or capture can show any phase.

Tone mapping stays Neutral, with no global grade.

## Captures

`SKY_EXTRA_SHOTS='moon-dusk-6:-6:moon:0:dusk phase-crescent:-20:look:5:dusk phase-half:-20:look:6:dusk phase-gibbous:-20:look:7:dusk phase-waning:-20:look:3' bash scripts/capture-sky.sh sky-step5 before|after`, with Vite on port 4378. A shot is `name:sun elevation:view[:day[:dusk]]`. "Before" is step 4 (https://github.com/pgrigorakis/soaring/pull/134). The views are the same as in steps 2 to 4: seed 1406157560, the default chase camera, 1280 × 800, and the same sun elevation in each pair.

| View | Before | After |
| --- | --- | --- |
| Sun +3° | `before/sun3.png` | `after/sun3.png` |
| Sun −6° | `before/sun-6.png` | `after/sun-6.png` |
| Sun −12° | `before/sun-12.png` | `after/sun-12.png` |
| Sun −52° | `before/sun-52.png` | `after/sun-52.png` |
| Moon, sun −6° at dawn | `before/moon-6.png` | `after/moon-6.png` |
| Moon, sun −12° at dawn | `before/moon-12.png` | `after/moon-12.png` |
| Moon at midnight | `before/moon-52.png` | `after/moon-52.png` |
| Moon, sun −6° at the first dusk, full | `before/moon-dusk-6.png` | `after/moon-dusk-6.png` |
| Moon, sun −20° on day 5 at dusk, crescent | `before/phase-crescent.png` | `after/phase-crescent.png` |
| Moon, sun −20° on day 6 at dusk, half | `before/phase-half.png` | `after/phase-half.png` |
| Moon, sun −20° on day 7 at dusk, gibbous | `before/phase-gibbous.png` | `after/phase-gibbous.png` |
| Moon, sun −20° on day 3 before dawn, waning | `before/phase-waning.png` | `after/phase-waning.png` |

- The sun views do not change.
- On the first dusk the full moon rises opposite the sun, as before.
- On days 3, 5, 6 and 7, the moon is waning, a crescent, half and gibbous, in a different place in the sky. Before, it was always full and opposite the sun. Its halo grows with the lit fraction.
- At the first dawn (`moon-6`, `moon-12`) the moon has already set, about 15° below the horizon. So the views toward it show only the twilight sky. Before, the full moon was there, opposite the sun.

## Tests

`tests/moon-phases.smoke.ts` points the camera at the moon with the sun at −20° on four days. It counts the bright pixels on the disc and reads the halo 60 px out. Then it steps the sun through sunset under a half moon. Its output is `moon-phases.json`.

| Phase (day) | Lit fraction | Lit share of the disc | Part-lit pixels | Halo 60 px out | Moonlight |
| --- | --- | --- | --- | --- | --- |
| Full (0) | 0.999 | 1.000 | 0 | 96.4 | 0.559 |
| Crescent (5) | 0.164 | 0.122 | 44 | 28.0 | 0.131 |
| Half (6) | 0.525 | 0.548 | 49 | 58.8 | 0.887 |
| Gibbous (7) | 0.871 | 0.927 | 31 | 85.6 | 1.459 |

- The lit share of the disc is within 0.12 of the lit fraction (limit 0.12). The largest gap is 0.056.
- The half moon has 49 part-lit pixels on a soft terminator (limit: more than 20).
- The halo grows from crescent to half to full, by more than 10 each step.
- Moonlight is the height ramp times the lit fraction, to 3 decimal places. The full moon is low (0.30, about 18° up), so its light is less than the gibbous moon's.

Sunset on day 6, under a half moon about 52° up:

| Sun elevation | +1° | +0.2° | −0.2° | −1° | −3° | −6° |
| --- | --- | --- | --- | --- | --- | --- |
| Shadow caster | sun | sun | moon | moon | moon | moon |
| Moonlight | 0 | 0 | 0.003 | 0.069 | 0.458 | 0.862 |

`tests/sky-cycle.test.ts` checks these points over 8 game days:

- The moon is full at day 0.75, half at 2.75 and 6.75, and new at 4.75.
- The moon rises 0.09 to 0.16 of a day later each day.
- The bodies move smoothly from one second to the next.
- The caster is the sun exactly while the sun is up. There are 16 switches in 8 days, and both lights are below 0.05 at each switch.
- Moonlight is 0 while the sun is up.

`tests/sky-bodies.smoke.ts` and `tests/app.smoke.ts` expected a moon opposite the sun. They now use the first dusk for the horizon moon, and the waxing gibbous moon (93 % lit, about 43° up) at the first midnight.

`tests/highlands.smoke.ts` (one hour through the Highlands) passes: the minimum clearance is 12.4 m, with 0 safety corrections (`highlands-navigation.json`). main gives the same 12.4 m since the terrain change in https://github.com/pgrigorakis/soaring/pull/127, so the sky work does not change it. `npm run check` passes. `npm run test:smoke` passes: 46 of 46 tests.
