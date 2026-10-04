# Palette

These hex values are the source of truth for the colour pass and the biome work. The board images in `boards/` are flat 2D mood references: implement these values, never colours sampled from the PNGs.

All values are sRGB hex, the same convention `THREE.Color` already uses in `src/terrain.ts` and `src/main.ts`.

## Colour pass

Today's terrain and lighting colours, and what they become. Board: `boards/00-colour-pass.png`.

| Target | Location (today) | Now | New |
| --- | --- | --- | --- |
| Meadow, moist | terrain.ts:281 | `#718258` | `#6FA03C` |
| Meadow, dry | terrain.ts:281 | `#8C925F` | `#B3B04A` |
| Forest floor | terrain.ts:280 | `#456345` | `#2F6B3A` |
| River bed | terrain.ts:278 | `#586957` | `#2F6E6A` |
| Rock ground | terrain.ts:279 | `#77766C` | `#8A8174` |
| Rock, high | terrain.ts:279 | `#8A8374` | `#AFA28A` |
| Water surface | terrain.ts:40 | `#477D8B` | `#2A8FA8` |
| Trunks | terrain.ts:48 | `#584634` | `#6B4A2E` |
| Canopy, dark | terrain.ts:50 | `#31563B` | `#1F5A34` |
| Canopy, mid | terrain.ts:51 | `#426846` | `#2E7A3E` |
| Canopy, light | terrain.ts:52 | `#56734A` | `#5C9443` |
| Boulders | terrain.ts:54 | `#77776D` | `#857E72` |
| Hemisphere sky | main.ts:89 | `#D9E6E1` | `#CFE3F0` |
| Hemisphere ground | main.ts:89 | `#596448` | `#5E7A3A` |

Renderer settings that go with it:

| Setting | Location (today) | Now | New |
| --- | --- | --- | --- |
| Tone mapping | main.ts:82 | `ACESFilmicToneMapping` | `NeutralToneMapping` |
| Exposure | main.ts:83 | 1.08 | 1.00 |
| Haze tone map | main.ts:178, `sampleHorizonColor()` | hand-written ACES | matching Neutral function |
| Per-vertex jitter | terrain.ts:282 | lightness ±2.75% | hue ±1.5%, saturation ±6%, lightness ±3% |

The noon haze on the board (`#8FAEB8` → `#9CC3DA`) is the expected result of these changes, not a constant to set: the haze is sampled from the sky every 0.35 s.

Water surface `#2A8FA8` is the vertex tint, not the full rendered colour. The shared water shader mixes 65% depth colour with 35% of that tint on every water surface. Depth colour runs from shallow `#78B4A3` to deep `#2B6C73` between 0.7 m and 3.2 m. Before that mix, sea-level water in a mountain region tints the vertex colour toward `#2A7FA0` by Highlands weight, and toward the same shallow/deep pair between 2 m and 18 m by Lakeland weight. The former peat-water tint `#2E4A4A` is retired with elevated peat pools. Sun and moon glint colours are in the Lakeland table and apply to all water.

The time-of-day strip on the colour-pass board is illustrative. The real sky comes from the Preetham `Sky` addon and the day cycle in `src/main.ts`.

## Biome palettes

Each biome's terrain colour is a weighted blend of its palette (see the biome weight system issue). Boards: `boards/biome-0*.png`.

### Rolling Hills (`boards/biome-01-rolling-hills.png`)

| Role | Hex |
| --- | --- |
| Meadow | `#6FA03C` |
| Fresh pasture | `#86B83F` |
| Hay field | `#B3B04A` |
| Hedgerow | `#2E6B34` |
| Chalk track | `#E3D9B8` |
| Buttercup fleck | `#E6C43A` |
| Poppy fleck (sparse) | `#D2553F` |

### Woodland (`boards/biome-02-woodland.png`)

| Role | Hex |
| --- | --- |
| Canopy, deep | `#1F5A34` |
| Canopy, mid | `#2E7A3E` |
| Canopy, sunlit | `#5C9443` |
| Birch | `#9DBF4E` |
| Glade grass | `#7FAE45` |
| Autumn accent | `#C9772E` |
| Autumn gold (sparse) | `#D9A441` |

### Lakeland (`boards/biome-03-lakeland.png`)

| Role | Hex |
| --- | --- |
| Deep water | `#2B6C73` |
| Shallows | `#78B4A3` |
| Beach | `#E3CD8B` |
| Reeds | `#9FB65A` |
| Lake cliff | `#8A8174` |
| Sun glint | `#FFF1C2` |
| Moon glint | `#DDE7F0` |

### Highlands (`boards/biome-04-highlands.png`)

| Role | Hex |
| --- | --- |
| Granite, shade | `#6E685E` |
| Granite, sunlit | `#AFA28A` |
| Snow cap | `#F2F4F7` |
| Snow shadow | `#B9CDE3` |
| Scree | `#9A9489` |
| Valley meadow | `#7DA548` |
| Conifer | `#1E4E3A` |
| Cirque lake | `#2A7FA0` |

Snow shadow is the look to aim for on shaded snow; it should come from the hemisphere sky light on `#F2F4F7`, not from painting faces blue.

### Heath & Moorland (`boards/biome-05-heath-moorland.png`)

| Role | Hex |
| --- | --- |
| Heather | `#8A5A8C` |
| Heather bloom | `#B06FA6` |
| Bracken | `#B0763A` |
| Moor grass | `#A6A25A` |
| Gorse | `#E1B93A` |
| Peat pool | `#2E4A4A` |
| Tor granite | `#857E72` |
