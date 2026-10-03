# Lowland hills (#86)

## Approved behavior

One shared `gradientFbm` hill shape uses the existing warped coordinates and a 520 m wavelength. Biome weights blend 48 m in Hills and 38 m in Woodland and Moor. Woodland and Moor retain approximately their previous 60/75 amplitude ratio. Lakeland uses its underlying landform weights.

The captain selected drainage option B on 2026-10-03: hills affect rendered ground only. Drainage keeps the existing broad landform. This supersedes the issue's original drainage instruction. Hills fade near banks. The valley-floor clamp applies only where the hill term is nonzero, so hill-free Highlands retain their previous carving.

Peat sites keep the hill's centre height on a smooth local shelf. The existing 2.2 m flatness test, altitude rule, candidate hashes and 1,000 m separation from drainage water remain. The shelf vanishes within 120 m of each centre, inside its 500 m cell.

## Measurements

Baseline: `8af6cab`, after the merged landform change (#85). Seeds match #85: 42, 80231 and 57.

| Seed | Median slope before → after | Median summit drop before → after | Peat pools before → after |
| --- | --- | --- | --- |
| 42 | 4.08° → 5.88° | 1.84 m → 5.12 m | 16 → 16 |
| 80231 | 3.67° → 5.57° | 2.23 m → 6.13 m | 5 → 5 |
| 57 | 3.64° → 5.91° | 2.32 m → 7.27 m | 24 → 24 |

The lowland grid spans −8 km to +8 km on both axes at 160 m intervals. Slopes use central differences over 40 m. Summit candidates exceed sampled neighbors within 480 m. Drops use the median of four cardinal samples 100 m from each candidate. These are sampled local tops, not refined maxima. Peat counts sample every hashed candidate once in a 48 km square. Raw records are `before.json` and `after.json`.

The 520 m term is FWM-scale, not a promise to reproduce FWM's whole-land 11.6–11.8° slope statistic. Soaring's existing broad profiles, valley carving and biome weights remain.

Repeat:

```sh
node scripts/measure-relief.mjs src/world.ts evidence/lowland-hills/after.json
mkdir -p test-results/baseline
# Use the same measurement script with the baseline source.
git archive 8af6cab src | tar -x -C test-results/baseline
node scripts/measure-relief.mjs test-results/baseline/src/world.ts evidence/lowland-hills/before.json
```

## Navigation and validation

`npm run check`: 56 tests pass, TypeScript check and production build pass. `npm run test:smoke`: 34 tests pass after rebasing on the merged pixel cap. Logs are `check.log` and `smoke.log`.

The captain approved a seed-0-only route-progress exception: about 30.1% net displacement instead of the previous 35% minimum. The test permits 30% for seed 0 only. Other seeds retain 35%. Route revisits, cache limits and all clearance assertions remain unchanged. Navigation behavior was not changed.

The browser Highlands flight uses the original seed 57 and start (−84000, 122000). Flapping increases from 258.2 s to 350.8 s over one hour (+92.6 s). Minimum clearance changes from 12.400 m to 12.286 m. Both runs have zero safety corrections and two ridge episodes. Peak vertical speed remains 4 m/s. The navigator has no energy metric. Raw same-vantage records are `highlands-before.json` and `highlands-after.json`.

## Same-seed screenshots

Both sets use seed 5, noon, the default chase camera, 1600×1000, 5 km visibility and full pixel ratio. The capture waits for 60 stable frames with no pending chunks. `before/vantages.json` and `after/vantages.json` record positions and settings. Vertical flight height follows the ground; horizontal coordinates and camera settings are identical.

| Biome | Position (x, z), heading | Before | After |
| --- | --- | --- | --- |
| Hills | (28000, 0), 0 | [Screenshot](before/hills.png) | [Screenshot](after/hills.png) |
| Woodland | (−7800, −7800), 0 | [Screenshot](before/woodland.png) | [Screenshot](after/woodland.png) |
| Moor | (−6900, 4000), 0 | [Screenshot](before/moor.png) | [Screenshot](after/moor.png) |

Run Vite, then repeat with `node scripts/capture-lowland.mjs http://127.0.0.1:4198 <output-directory>`. The script uses `chrome-devtools-axi` in the named `soaring-lowland-hills` session. Compare the baseline in the same checkout, restoring the current source afterward. Browser smoke coverage also checks Lakeland islands, farmland hedgerows, water edges and shared terrain seams.
