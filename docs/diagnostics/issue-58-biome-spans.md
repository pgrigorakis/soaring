# Issue #58: biome span decision evidence

The scripts named below, `scripts/audit-biome-spans.mjs`, `scripts/audit-biomes-browser.ts` and `scripts/audit-route.mjs`, are no longer in the tree. They remain in git history at commit `5da4b07`.

## Decision B implementation

Firstmate authorized independent Rolling Hills territory and broader fields. The implementation passes the median-span audit and the **actual dry-land sample-grid coverage** across all three requested seeds. Runtime source uses:

- Climate: **16,000 m**, seed offset `127`, three octaves.
- Independent Hills field: **16,000 m**, seed offset `129`, three octaves; Hills claims values above **0.62**, smootherstep ±0.06.
- Relief: **18,000 m**, seed offset `61`, three octaves; today's `mountainRegion` smootherstep still applies. Highlands claims relief above **0.55**, smootherstep ±0.06.
- Priority: Highlands, reserved Lakeland (zero), Hills territory, then Woodland/Moor. Woodland uses a **0.50** climate threshold (±0.06); dry remainder goes to Moor if candidate elevation exceeds 90 m. Ineligible dry land remains Hills.
- Seed offset `61` replaces `59`: broadening the old relief field put the entire existing 9 km tree fixture in core Highlands, removing the three tree silhouettes expected by existing tests. The new field avoids that regression. This choice needs design review.
- Highlands shaping merged in #57 is retained and blended with the Highlands weight. Tree-line, cirque, snow and hour-long flight checks pass.

## Reproduce

```sh
node scripts/audit-biome-spans.mjs --sweep
```

The script writes `test-results/biome-spans.json` with per-seed weights, run counts, median spans and mean spans. Temporary bundled wavelength substitutions do not edit runtime source. Without `--sweep`, it measures only the chosen pair over the same 240 km window.

- Seeds: `80231`, `42`, `123456`.
- Grid: 240 × 240 km, centered on the origin; coverage sampled every 500 m.
- Flight lines: 100 m steps, parallel to the x axis, spaced 1,500 m apart.
- Span: median contiguous run of the dominant biome. Runs touching either end of a flight line are excluded. This interprets gliding time as actual distance flown through a biome, not a patch bounding-box diameter.
- The sweep's coverage is mean pre-drainage weight, including all terrain. The separate actual dry-land grid below excludes water. Lakeland remains zero.
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

## Actual dry-land coverage

Measured in the real browser with `WorldModel.sample()`, not just the relief field. Grid: 240 × 240 km, 2,500 m spacing, coordinate offset `(123.75, -231.5)` to avoid lattice alignment. Each seed has 9,216 samples; water is excluded from the weight averages.

| Seed | Dry samples | Hills | Woodland | Moor | Highlands |
| --- | --- | --- | --- | --- | --- |
| 80231 | 7,955 | 25.03% | 30.49% | 27.02% | 17.46% |
| 42 | 7,948 | 31.02% | 26.17% | 26.03% | 16.78% |
| 123456 | 7,934 | 29.42% | 22.14% | 30.10% | 18.35% |

All land biomes pass 10–35%. Maximum normalization error is `2.22e-16`; Lakeland is zero. Reproduce in the running dev app:

```sh
CHROME_DEVTOOLS_AXI_SESSION=soaring-biome-weights chrome-devtools-axi eval \
  "async () => (await import('/scripts/audit-biomes-browser.ts')).coverage()"
```

## Build-time diagnostics

Compared against immutable main commit `5103c32` (Highlands plus floating origin), in the same real Chrome session. Four locations cover Hills, Woodland, Moor and a blend zone. Each run builds 100 near chunks. After one warm-up per version, five paired runs alternate version order (500 measured chunks per version). Timers observe `createChunk`, the boundary used by the production `buildTiming` diagnostic.

- Baseline mean: **12.2170 ms/chunk**.
- New mean: **13.7844 ms/chunk** (**+12.83%**, within the +20% limit).
- Observed cold-chunk maxima: baseline 31.4–32.2 ms; new 39.9–44.8 ms. The mean passes; worst cold chunks are slower. This is reported explicitly, not hidden by the average.

Reproduce baseline setup inside this worktree, then call `benchmark()` in the live app:

```sh
mkdir -p test-results/baseline
git show 5103c32:src/world.ts > test-results/baseline/world.ts
git show 5103c32:src/terrain.ts > test-results/baseline/terrain.ts
CHROME_DEVTOOLS_AXI_SESSION=soaring-biome-weights chrome-devtools-axi eval \
  "async () => (await import('/scripts/audit-biomes-browser.ts')).benchmark()"
```

The visible diagnostics panel and `snapshot().buildTiming` also expose mean/max chunk timing. Raw measurements, field sweep, route trace and a verified dark peat pool are committed in `docs/diagnostics/issue-58-biome-validation.json`.

## Design decisions for review

The complete ten-choice list, including rejected alternatives, is in `docs/design/biome-decisions.md` and the PR description. The captain explicitly chose broader independent territories and later accepted fewer Woodland thermals and more flapping, instead of increasing glade frequency.

## Height review

The captain selected **Hills 150 ±75 m** with original rivers after the 400 ±200 m and 250 ±125 m variants failed bounded checks. Their evidence remains in `issue-58-tuscany-height-probes.json`; failed repairs were undone through new commits. No accepted selection, Moor/Highlands, thermal, navigation, river-bend or flapping decision changed. D4 adds varied polygonal parcels and physical hedgerows; D5 adds Woodland colour variation and glade flower flecks without changing glade thresholds or density.

## Validation

`npm run check` passes all 50 existing unit assertions plus production type/build validation. `npm run test:smoke` passes all 19 browser tests, including deterministic biome/shared edges and real hedgerow instances with varied field orientations. Browser evidence is repeatable and attached by the test runner. The original grove, river-count, route-persistence and narrow-band flapping assertions remain intact.

### Bounded navigation experiment

Reproduce the current one-hour trace with `node scripts/audit-route.mjs`. It writes `test-results/biome-route.json` with progress, repeated visits, backward thermal approaches, stalls and 300-second snapshots. The exact existing assertions are exercised by `npx vitest run tests/navigation.test.ts`.

The baseline had no terrain stalls and 12 backward thermal approaches in 33 seeks. Four bounded candidates were tested; field sizes and profile heights stayed fixed.

| Candidate | Net distance (m) | Required net distance (m) | Revisit passes (limit 5) | Flapping ticks (limit 1,622.5) |
| --- | --- | --- | --- | --- |
| Baseline: 35% lowland compass, full amplitude | 20,304.55 | 35,577.20 | 2 | 1,400 |
| 1: scenic targets use compass directly | 21,000.96 | 35,828.93 | 2 | 1,922 |
| 2: compass thermal seeking, forward bias 0.8 | 25,919.53 | 36,238.07 | 2 | 2,127 |
| 3: compass noise amplitude π/2 | 66,160.74 | 37,190.94 | 0 | 3,149 |
| **4: restore thermal forward bias 0.28 (historical, before height/farmland review)** | **51,075.50** | **36,198.90** | **0** | **1,822** |

At that historical stage, candidate 4 passed the route contract and failed only the old wide-band flapping ceiling. The captain subsequently approved the Woodland exposure allowance below. The final 150 ±75 m Hills and varied farmland produce **49,046.86 m net versus 35,673.64 m required**, **zero revisits**, **zero stalls**, and **1,283 flap ticks versus 1,711.54 allowed**. All navigation assertions pass. The accepted compass and thermal-bias settings are unchanged.

### Captain-approved flapping contract

A glade-frequency trial shifted the noise thresholds by 0.02 and reduced flapping to 1,331 ticks. The captain rejected this direction: fewer Woodland thermals and compensating flaps are acceptable. Glade thresholds were restored to **0.28–0.43**, with the 300 m field unchanged.

The wide-band test now scales the original allowance by actual, fractionally weighted Woodland exposure:

```text
allowed = original 1,622.5 ticks × (1 + 0.5 × Woodland time fraction)
```

The pre-review exposure was 9,902.25 equivalent ticks / 36,000 = **27.51%**, giving **1,845.64 allowed ticks**, versus **1,822 actual**. Final exposure is **3,951.14 / 36,000 = 10.98%**, giving **1,711.54 allowed**, versus **1,283 actual**. The formula did not change. A flight with no Woodland gets the unchanged 1,622.5 limit; both narrow-band assertions remain unchanged. Directly excluding only flaps above Woodland was rejected because it missed the carried energy deficit after leaving a forest.

Final route persistence passes at **49,046.86 m net versus 35,673.64 m required**, with zero revisits. All navigation assertions now pass.

### Relocated Highlands fixtures

The approved larger fields and relief phase invalidate the old fixed Highlands coordinates. The smoke fixtures now target measured Highlands, without changing any snow, cirque, clearance, energy or duration assertions. Seed 57 snow/cirque uses peak `(16250, 32000)` with height **420.60 m** and a 150 m cirque. The hour flight starts at `(-84000, 122000)`: **2,772.0 s Highlands exposure**, **143.1 s flapping** against the original 206 s ceiling, **27.43 m minimum clearance**, **4 m/s peak vertical speed**, and **zero safety corrections**.

### Screenshots

Real normal-mode app captures (not the low-resolution smoke mode) show each shipped biome, a Woodland/Moor blend, a dark peat pool and a flower-coloured glade. See `docs/design/biome-evidence/README.md` for seed, lighting, camera poses and repeatable capture instructions.
