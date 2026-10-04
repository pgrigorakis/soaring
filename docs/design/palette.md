# Palette

This file is the source of truth for Soaring's current terrain and foliage colours. Values are sRGB hex. The code keeps them in the biome profiles in `src/biomes/` and in `src/terrain.ts`. The review images are evidence, not colour values to sample. See [the Matched palette captures](biome-palette-evidence/README.md).

## Matched V2 rule

The Matched (V2) ground palette starts from the closest Fly-with-me (FWM) swatch. Convert that swatch to sRGB HSL, keep its hue, add `0.12` to saturation and `0.06` to lightness, then convert back to sRGB hex.

Every V2 terrain and foliage swatch must stay inside FWM's sRGB HSL envelope:

- Saturation: at most `0.62`.
- Lightness: `0.18` to `0.93`, inclusive.

Apply the envelope after the V2 lift. Rock and stone use a smaller saturation lift of `0.02`, because a larger lift makes grey rock look khaki. The Moor heather starts from its V2 value `#a28895`; golden-hour captures showed that swatch was too muted, so its saturation gets a further `0.05` lift to `#a6849a`. The heather remains inside the envelope. Flower flecks use the report's envelope-safe values instead of the lift formula.

The envelope applies to V2 terrain and foliage hex values, including the listed flower accents. Unchanged water, lighting and trunk colours do not use this cap. Existing terrain vertex jitter remains unchanged: hue ±1.5%, saturation ±6%, and lightness ±3%. Jitter can move an individual vertex slightly outside the envelope.

## Biome ground palettes

### Hills

| Role | sRGB hex |
| --- | --- |
| Meadow | `#8cc74a` |
| Fresh pasture | `#afcc71` |
| Hay field | `#b0be5e` |

### Woodland

Ground colours and foliage tints are separate. In `src/biomes/woodland.ts`, `palette` holds the ground colours in this order, and `crowns.species` holds the three Woodland broadleaf crown shades.

| Role | sRGB hex |
| --- | --- |
| Deep ground | `#579b3b` |
| Sunlit ground | `#6dad3f` |
| Glade grass | `#8cc74a` |

### Moor

Sage is the dominant ground look. Heather remains a localized patch accent, with sage and pale sage through the central patch range.

| Role | sRGB hex |
| --- | --- |
| Heather patch | `#a6849a` |
| Moor sage | `#93a76c` |
| Pale sage | `#a4b37f` |
| Bracken | `#bfa35a` |

### Highlands

| Role | sRGB hex |
| --- | --- |
| Valley meadow | `#8cc74a` |
| Conifer ground | `#2c6b49` |
| Granite, shade | `#828070` |
| Granite, sunlit | `#9aa188` |
| Scree | `#9ea59a` |
| Snow | `#e4e9d1` |

Snow remains a warm white. Lighting provides the blue shade on snow; terrain does not paint blue faces.

### Lakeland

| Role | sRGB hex |
| --- | --- |
| Meadow | `#8cc74a` |
| Shore forest ground | `#579b3b` |
| Beach | `#d8ce91` |
| Reeds | `#b0be5e` |
| Lake cliff | `#9aa188` |

## Shared terrain and foliage colours

| Role | sRGB hex | Use |
| --- | --- | --- |
| Hedgerow ground and shrubs | `#518628` | Hills hedges, hill tree tinting, broadleaf fallback and hedge material |
| Woodland crown, dark | `#316e30` | Woodland crown tint selection |
| Woodland crown, mid | `#53973e` | Woodland crown tint selection |
| Woodland crown, light | `#8dbd6a` | Woodland crown tint selection |
| Conifer crown | `#2c6b49` | Conifers, including Highlands |
| Birch crown | `#9bc558` | Birch trees |
| Autumn crown | `#c88a3a` | Common autumn tint |
| Autumn gold crown | `#d1a249` | Sparse autumn tint |
| Buttercup fleck | `#d3b84d` | Hills and glades |
| Poppy fleck | `#d05741` | Hills and glades |
| Gorse fleck | `#d2b149` | Moor |
| Heather glade fleck | `#a6849a` | Woodland glades |
| Granite ground and boulders | `#899b98` | Lowland rock blend, boulders and tors |

## Unchanged water, tree and lighting colours

Water depth colours and the rest of the renderer stay unchanged in this palette pass. Water's on-screen difference from FWM needs a shader change, not a palette change.

The water vertex tint is not the full rendered colour. The shared water shader mixes 65% depth colour with 35% of that tint on every water surface. Depth colour runs from shallow to deep between 0.7 m and 3.2 m. Before that mix, sea-level water in a mountain region tints the vertex colour toward the Highlands water tint by Highlands weight. Lakeland water tints toward the same shallow and deep pair between 2 m and 18 m by Lakeland weight.

The former peat-water tint `#2e4a4a` is retired with elevated peat pools. The ground under sea-level water keeps its dark teal, because the water surface is 78% opaque. A light bed shows through and exposes terrain tile edges in far water.

| Role | sRGB hex |
| --- | --- |
| Shallow water | `#78b4a3` |
| Deep water | `#2b6c73` |
| Water bed | `#2f6e6a` |
| Water vertex tint | `#2a8fa8` |
| Highlands water tint | `#2a7fa0` |
| Sun glint | `#fff1c2` |
| Moon glint | `#dde7f0` |
| Tree trunks | `#6b4a2e` |
| Hemisphere sky | `#cfe3f0` |
| Hemisphere ground | `#5e7a3a` |

This palette pass does not change tone mapping or exposure in `src/main.ts`, and it adds no colour grade. This keeps palette changes local to ground, rock and foliage.
