# Design reference

Visual reference for the colour, biome and flight work tracked in GitHub issues. Hex values live in [`palette.md`](palette.md); the images below are flat 2D mood boards, not render targets, so implement the numbers in `palette.md` and the issue text, never colours or proportions measured from the pictures.

The boards are exports of a design canvas. If an issue and a board disagree, the issue wins.

The current land-and-water generator is [continental terrain](continental-terrain.md). The boards' river valleys, elevated cirques, explicit lake islands and peat pools are historical references, not current geometry requirements.

| Board | What it shows | Used by |
| --- | --- | --- |
| [00-colour-pass](boards/00-colour-pass.png) | The same valley in today's palette and the saturated one; old → new swatches; renderer settings; the saturated palette across the day | Colour pass |
| [01-biome-selection](boards/01-biome-selection.png) | Top-down biome map, the fields and decision order that pick a biome, blend zones, and a cross-section from a lake basin to the highlands | Biome weight system, Lakeland, Highlands |
| [biome-01-rolling-hills](boards/biome-01-rolling-hills.png) | Field patchwork, hedgerows, lone oaks, cumulus over thermals | Biome weight system |
| [biome-02-woodland](boards/biome-02-woodland.png) | Dense mixed canopy, birch and autumn accents, glades where thermals rise | Biome weight system |
| [biome-03-lakeland](boards/biome-03-lakeland.png) | Long valley lakes, island, beach and reeds, lake cliffs, sun glitter | Lakeland, Water glints |
| [biome-04-highlands](boards/biome-04-highlands.png) | U-shaped valley, snow-capped ridges, scree, treeline, cirque lake; the eagle routing up the valley | Highlands |
| [biome-05-heath-moorland](boards/biome-05-heath-moorland.png) | Heather and bracken patches, granite tors, peat pools, big-sky cumulus | Biome weight system |

Each biome board lists its palette, terrain notes and flight and sound notes. Where a board gives numbers the issues don't (for example per-biome eagle height bands on the Rolling Hills, Woodland and Moorland boards), treat them as mood notes, not requirements.
