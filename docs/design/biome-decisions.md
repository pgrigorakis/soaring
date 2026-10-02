# Biome weights — decisions for review

## Failure modes to verify before implementation

- Non-normalized or negative weights; selection priority lost at overlap.
- Recursive height/weight evaluation (drainage needs biome height before rendered height exists).
- Chunk-local randomness, mismatched shared-edge colours, or placement changes at chunk boundaries.
- Moor disappears because the existing low-relief land is mostly below 90 m.
- Woodland glades inherit canopy tree density or canopy thermals.
- Species proportions or autumn tint depend on chunk traversal order.
- Added noise and tree sampling exceed the 20% chunk-build budget.
- Coverage and region span fail across seeds, despite attractive hand-picked screenshots.

## Design decisions for review

1. Selection uses broad pre-drainage elevation, not river-carved vertex height. Profiles contribute a candidate elevation before the height eligibility test, then the final profile is blended by the resulting weights. This avoids a height/weight cycle and lets dry uplands reach the board's 90–220 m range. Rejected: selecting against today's unmodified height (moor virtually disappears); selecting against carved height (riverbanks introduce biome stripes and drainage recursion).

Measurements and any further choices will be recorded here and in the PR.
