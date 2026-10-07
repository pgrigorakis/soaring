# Data-driven biome profiles

`src/biome.ts` registers the biome set. `src/biomes/` contains one profile per biome. This refactor adds no biome and changes no colour or landform.

Each profile owns its climate point, ground painter, ground extras, crown tints, species shares, tree occupancy, forest cover, thermal/scenic parameters, and audio mapping. Ground and crown colours are separate. Highlands now has an explicit profile with the former fallback values. Continental fields own terrain height, so profiles have no height parameters.

## Selection and accumulation

- `BiomeWeights` is a record over the registry keys. Climate selection iterates all registered climate points.
- Highlands still claims relief first. Lakeland still claims lake territory second. Climate points share the remainder.
- The first climate point receives the residual, with separate subtractions. This preserves the former Hills rounding exactly.
- Registry order preserves world, ground, forest, species, and tree accumulation. Parameter blending retains Highlands last. Audio retains its separate historical order.
- Ground painters write an unweighted base colour. Shared terrain code adds the weighted colours, groups equal rock swatches into one overlay, then applies ordered extras.
- Forest and tree-occupancy functions receive the weight. This preserves multiplication order, notably Woodland's `weight * density * (1 - glade)`.
- Profile painters use world samples and world coordinates. They receive noise functions from the renderer, so the profiles do not import the world implementation.

Do not reorder existing profiles or reassociate arithmetic during a no-visible-change refactor. Mathematically equal expressions can produce different floating-point results.

## Adding a climate biome later

Create its profile and register it in `climateProfiles`. Weights, profile blending, ground painting, crown/species selection, water tinting, audio layers, and the diagnostics list include it automatically. No new biome is included in this change.

Existing landform-specific behavior remains explicit: Highlands relief, snow and tree line, Lakeland territory, Hills hedgerows, Woodland glades, and Moor tors. A new shape or feature needs its own world-generation rule. Tree geometry and instance pools still support the three existing species shapes.

Adding a climate point does not move terrain height. It does move biome territory, and with it ground colour, forest, rock, trees and thermals. The new-biome batches must re-baseline climate spans, navigation routes, tree pools, and approved looks. This refactor does not change those fixtures.

## Validation

See [testing](../testing.md) for the commands. The refactor's parity evidence against main is no longer in the tree; it remains in git history at commit `5da4b07`, under `evidence/biome-data/`. `tests/biomes.smoke.ts` writes `biome-parity.json` without app timing or animation state. It includes exact world samples, ground RGB at three slopes, shared-mesh hashes, and tree placement/tints at five fixed poses.
