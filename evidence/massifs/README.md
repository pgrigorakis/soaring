# Highlands massifs (#87)

## What changed

The Highlands ridge in `relief()` is now a warped ridged multifractal. Drainage reads that term, so rivers and U-shaped valleys follow the new crests. The 520 m lowland hills stay ground-only.

The shape follows fly-with-me `ridgedMulti`: four octaves at 1.6 km. Each finer octave sharpens only where the coarser ridge already stands, and each finer octave has a rounder crest. Coordinates already have the 700 m continental warp. A second warp adds 260 m at a 900 m scale. The existing mountain-region mask keeps the massif on Highlands.

Fly-with-me's massif is 640 m and its pyramid summits make up the rest of the 1,050 m top. Those summits are #88, so this amplitude is 1,600 m. Rendered crests then land near the approved top.

Snow follows the merged temperature rule (#93). At a mean climate the line still sits near the old 380–420 m. A cold crest is white. A warm peak can stay bare. Steep faces stay bare.

## Crests and far-grid loss

`node scripts/measure-massif.mjs`. The search is a 48 km window at 400 m, then a 20 m climb to each local crest. Far loss is the analytic crest height minus the height of the 90 m far-grid triangles. Near loss uses the 9 m grid. Raw records are `measures.json`.

| Seed | Highest rendered crest | Median far loss | Maximum far loss | Median near loss |
| --- | --- | --- | --- | --- |
| 57 | 1,065 m | 34 m | 83 m | 0.9 m |
| 42 | 1,078 m | 30 m | 110 m | 0.4 m |
| 80231 | 1,113 m | 30 m | 98 m | 0.4 m |

The old 90 m mesh cut a median 9–10 m and up to 45 m. Sharper crests lose more, as the issue expected. The near grid loses less than 1 m.

The far crest does not visibly flatten. `after/ridge-near.png` and `after/ridge-far.png` are the same seed 57 crest (−7880, 3960), at 700 m and 4.7 km. The far skyline is still a peaked snowy ridge, not a flat top. The far grid stays at 16 segments (90 m). Doubling it would multiply far-tile vertices by four, and the picture does not warrant that cost.

## Ridge soaring

The old detector joined a crest only after 700 m of straight ridge. That matched the broad ridge this massif replaces. On the seed-57 hour, the other gates still pass on a windward face, but the aligned arête is 320 m. `RIDGE.minSegment` is 320 m, one station above a two-station spur. Slope, wind, the 40 m crest drop, clearance, and valley routing are unchanged. A 400 m and a 480 m minimum still produced no ridge episode. 320 m produced one, with 12.2 m clearance and no safety correction.

## Same-seed screenshots

Seed 57, 1600×1000. Chase shots use the default chase camera, noon or golden hour, and 1.8 km visibility. Ridge shots hide puff clouds and clear the haze so the crest shape is readable. Positions are in `before/vantages.json` and `after/vantages.json`.

| View | Before | After |
| --- | --- | --- |
| Chase, noon | [before](before/chase-noon.png) | [after](after/chase-noon.png) |
| Chase, golden hour | [before](before/chase-golden.png) | [after](after/chase-golden.png) |
| Crest at 700 m | [before](before/ridge-near.png) | [after](after/ridge-near.png) |
| Same crest at 4.7 km | [before](before/ridge-far.png) | [after](after/ridge-far.png) |

Repeat with Vite running: `node scripts/capture-massif.mjs http://127.0.0.1:4217 evidence/massifs/after`.
