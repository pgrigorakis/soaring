# Issue #58: biome span decision evidence

## Decision B implementation (WIP)

Firstmate authorized independent Rolling Hills territory and broader fields. The current candidate passes the span/coverage **selection-field audit** across all three requested seeds. Runtime source uses:

- Climate: **16,000 m**, seed offset `127`, three octaves.
- Independent Hills field: **16,000 m**, seed offset `129`, three octaves; Hills claims values above **0.62**, smootherstep ±0.06.
- Relief: **18,000 m**, seed offset `61`, three octaves; today's `mountainRegion` smootherstep still applies. Highlands claims relief above **0.55**, smootherstep ±0.06.
- Priority: Highlands, reserved Lakeland (zero), Hills territory, then Woodland/Moor. Woodland uses a **0.50** climate threshold (±0.06); dry remainder goes to Moor if candidate elevation exceeds 90 m. Ineligible dry land remains Hills.
- Seed offset `61` replaces `59`: broadening the old relief field put the entire existing 9 km tree fixture in core Highlands, removing the three tree silhouettes expected by existing tests. The new field avoids that regression. This choice needs design review.
- Highlands shaping merged in #57 is retained and blended with the Highlands weight. Tree-line, cirque and snow integration still needs final validation.

## Reproduce

```sh
node scripts/audit-biome-spans.mjs --sweep
```

The script writes `test-results/biome-spans.json` with per-seed weights, run counts, median spans and mean spans. Temporary bundled wavelength substitutions do not edit runtime source. Without `--sweep`, it measures the chosen pair over the original 80 km window; use `--sweep` for the acceptance comparison below.

- Seeds: `80231`, `42`, `123456`.
- Grid: 240 × 240 km, centered on the origin; coverage sampled every 500 m.
- Flight lines: 100 m steps, parallel to the x axis, spaced 1,500 m apart.
- Span: median contiguous run of the dominant biome. Runs touching either end of a flight line are excluded. This interprets gliding time as actual distance flown through a biome, not a patch bounding-box diameter.
- Coverage: mean pre-drainage weights, including all terrain. This is **not yet the final dry-land-only sample-grid acceptance test**. Lakeland remains zero.
- The candidate elevation rule is recorded in `docs/design/biome-decisions.md`. Results are conditional on that rule.

## Final sweep

Span ranges in km show minimum and maximum median across the three seeds. Pass requires every biome/seed to have median span **6–10 km** and mean coverage **10–35%**, using unrounded values. Climate and Hills fields use the same wavelength in this sweep.

| Climate + Hills / relief (km) | Hills | Woodland | Moor | Highlands | Both limits pass? |
| --- | --- | --- | --- | --- | --- |
| 12 / 12 | 5.3–5.7 | 4.3–4.8 | 4.3–4.9 | 5.7–6.2 | No |
| 14 / 15 | 6.7–7.8 | 5.4–6.1 | 5.4–5.8 | 7.4–7.7 | No |
| 16 / 15 | 6.6–8.3 | 5.3–7.1 | 6.1–6.4 | 7.4–7.7 | No |
| 18 / 15 | 8.4–9.1 | 6.5–7.1 | 5.9–7.1 | 7.4–7.7 | No |
| 20 / 15 | 8.3–9.7 | 6.1–8.6 | 6.8–8.1 | 7.4–7.7 | Yes |
| **16 / 18 (chosen)** | **7.6–8.9** | **6.1–7.7** | **6.2–6.8** | **8.5–9.2** | **Yes** |
| 18 / 18 | 8.0–10.2 | 6.0–7.3 | 6.6–7.6 | 8.6–9.2 | No |
| 20 / 18 | 8.9–10.0 | 7.1–9.1 | 7.0–8.3 | 8.6–9.2 | Yes |
| 22 / 15 | 9.0–10.1 | 7.4–9.0 | 6.5–8.6 | 7.4–7.7 | No |
| 24 / 15 | 9.4–11.7 | 7.7–7.9 | 7.2–8.4 | 7.4–7.7 | No |

### Chosen-pair coverage and spans

Each cell is **median span in km / mean coverage in %**.

| Seed | Hills | Woodland | Moor | Highlands |
| --- | --- | --- | --- | --- |
| 80231 | 7.6 / 24.81 | 7.0 / 31.69 | 6.8 / 26.46 | 9.1 / 17.04 |
| 42 | 8.9 / 30.71 | 7.7 / 27.70 | 6.2 / 25.41 | 8.5 / 16.17 |
| 123456 | 8.5 / 29.37 | 6.1 / 23.49 | 6.7 / 29.50 | 9.2 / 17.64 |

The selected pair is the lowest Climate/Hills wavelength among tested passing pairs, not proof of a global minimum. A wider middle moisture band was also tried (0.36–0.64); Hills still produced only 4.6–4.7 km spans at 16/15 km, while Woodland/Moor reached 6.9–8.1 km. Independent territory solved that mismatch. The original 4/5.4 km fields yielded 0.7 km Hills and 2.3–2.8 km other biome spans; the captain rejected relaxing the metric.

## Design decisions for review

1. Independent Hills territory, threshold 0.62; Woodland/Moor split at climate 0.50. Rejected the narrow original remainder and the widened middle moisture band.
2. Climate/Hills 16 km; relief 18 km. Rejected smaller tested pairs that failed, and larger pairs that were not needed.
3. Relief seed offset 61 rather than 59, to keep nearby mixed vegetation under the broadened field.
4. Candidate pre-drainage elevation resolves height/selection recursion; see `docs/design/biome-decisions.md`.
5. Moor trees are rare isolated trees plus rare small groves, still well under 3% candidate density by construction (0.4% base plus sparse 100–150 m grove masks). Rejected uniform 2% placement, which erased adjacent open cells in the existing biome-transition fixture.
6. River bend amplitude is reduced to keep newly shaped adjacent drainage reaches from crossing. This changes river appearance and needs review.
7. Woodland thermal odds remain provisionally 1.6. Scenic targets now follow the persistent compass in every biome, and its noise amplitude is halved (π/2 rather than π). Thermal seeking uses that compass with the original 0.28 forward bias. This fixes route persistence but still exceeds the wide-band flapping budget; see the bounded experiment below.

## WIP validation state / current blocker

World-model tests now pass all 17 assertions, including grove presence, river count, non-crossing rivers and river-wall slope. Last terrain-only check passed all five assertions before the final 16/18 km tuning; it still needs rerunning on the final candidate.

Latest navigation run passes 12 of 13 assertions, **including route persistence** and both narrow-band flapping baselines. The 65–210 m band fails: **1,822 flapping ticks versus maximum 1,622.5**. No assertion was relaxed.

### Bounded navigation experiment

Reproduce the current one-hour trace with `node scripts/audit-route.mjs`. It writes `test-results/biome-route.json` with progress, repeated visits, backward thermal approaches, stalls and 300-second snapshots. The exact existing assertions are exercised by `npx vitest run tests/navigation.test.ts`.

The baseline had no terrain stalls and 12 backward thermal approaches in 33 seeks. Four bounded candidates were tested; field sizes and profile heights stayed fixed.

| Candidate | Net distance (m) | Required net distance (m) | Revisit passes (limit 5) | Flapping ticks (limit 1,622.5) |
| --- | --- | --- | --- | --- |
| Baseline: 35% lowland compass, full amplitude | 20,304.55 | 35,577.20 | 2 | 1,400 |
| 1: scenic targets use compass directly | 21,000.96 | 35,828.93 | 2 | 1,922 |
| 2: compass thermal seeking, forward bias 0.8 | 25,919.53 | 36,238.07 | 2 | 2,127 |
| 3: compass noise amplitude π/2 | 66,160.74 | 37,190.94 | 0 | 3,149 |
| **4: restore thermal forward bias 0.28 (current)** | **51,075.50** | **36,198.90** | **0** | **1,822** |

Full navigation tests confirm candidate 4 passes the route contract and fails only the wide-band flapping ceiling. The trace still has zero terrain stalls. Progress is no longer trapped in the enlarged regions; supporting that progress with enough lift remains unresolved.

**One design choice requested:** permit more frequent Woodland glades (still 150–400 m) to provide more lift along forward routes, rather than restoring broad compass reversals. This is a proposed next experiment, not a verified diagnosis of the remaining 199.5-tick excess. Both route and flapping assertions must remain unchanged. No further tuning was attempted after this bounded round.

No PR is open. Browser smoke, final type/build check, dry-land coverage, performance comparison, biome screenshots and CI remain incomplete. No shipping or full acceptance success is claimed.
