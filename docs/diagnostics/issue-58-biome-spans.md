# Issue #58: biome span decision evidence

**No tested wavelength pair meets both acceptance limits for all three seeds.** No runtime wavelength change has been selected. Implementation remains WIP; do not open a PR from this branch yet.

## Reproduce

```sh
node scripts/audit-biome-spans.mjs --sweep
```

The script writes `test-results/biome-spans.json` with per-seed weights, run counts, median spans and mean spans. It bundles the current model with temporary field-wavelength substitutions; it does not edit runtime source.

- Seeds: `80231`, `42`, `123456`.
- Grid: 240 × 240 km, centered on the origin; coverage sampled every 500 m.
- Flight lines: 100 m steps, parallel to the x axis, spaced 1,500 m apart.
- Span: median contiguous run of the dominant biome. Runs touching either end of a flight line are excluded. This interprets the acceptance's gliding time as actual distance flown through a biome, not a patch's bounding-box diameter.
- Coverage: mean pre-drainage weight, including all terrain. This is a selection-field diagnostic, **not** the final dry-land-only sample-grid acceptance test. Lakeland remains zero. Relief uses today's `mountainRegion`, including its existing smootherstep.
- All other noise fields, thresholds, octaves and WIP profile values stay fixed. The provisional candidate-height rule is documented in `docs/design/biome-decisions.md`; these figures are conditional on that rule.

## Results

Each biome cell is **median span in km / coverage in %**. Ranges show the minimum and maximum across the three seeds, not measurement error. Acceptance requires each biome's span to be **6–10 km** and coverage to be **10–35%**. Pass flags use unrounded values.

| Climate / relief (km) | Rolling Hills | Woodland | Moor | Highlands | Coverage passes all seeds? |
| --- | --- | --- | --- | --- | --- |
| **4 / 5.4 (issue)** | 0.7–0.7 / 17.2–17.7 | 2.3–2.4 / 31.3–32.8 | 2.3–2.4 / 30.8–32.4 | 2.6–2.8 / 18.3–19.5 | Yes |
| 8 / 5.4 | 1.3–1.4 / 16.9–18.8 | 3.4–3.6 / 29.7–31.6 | 3.5–3.9 / 31.0–34.1 | 2.6–2.8 / 18.3–19.5 | Yes |
| 8 / 9 | 1.4–1.4 / 16.3–18.7 | 4.0–4.2 / 29.9–30.7 | 4.2–4.4 / 31.4–33.6 | 4.3–4.7 / 17.8–22.2 | Yes |
| 12 / 5.4 | 1.9–1.9 / 16.8–18.6 | 4.2–5.0 / 28.8–35.0 | 4.4–4.7 / 28.1–34.3 | 2.6–2.8 / 18.3–19.5 | Yes |
| 12 / 9 | 2.0–2.0 / 16.5–18.6 | 5.0–6.0 / 29.9–34.6 | 5.1–5.7 / 27.9–33.7 | 4.3–4.7 / 17.8–22.2 | Yes |
| 16 / 18 | 2.6–2.8 / 15.8–18.3 | 7.2–8.8 / 27.5–32.2 | 7.8–9.9 / 29.0–35.6 | 9.2–9.6 / 18.6–21.9 | No |
| 24 / 27 | 4.0–4.2 / 15.6–18.2 | 9.9–13.8 / 23.5–32.6 | 11.6–12.8 / 26.7–37.3 | 11.6–14.4 / 21.0–25.5 | No |
| 32 / 36 | 5.1–5.9 / 15.5–18.8 | 11.8–16.8 / 23.8–30.2 | 11.5–15.6 / 25.4–35.1 | 16.1–26.1 / 23.1–25.8 | No |
| 40 / 45 | 6.3–7.5 / 16.0–19.5 | 18.0–24.5 / 28.9–30.0 | 13.1–18.8 / 23.2–35.8 | 19.2–30.4 / 18.2–27.5 | No |
| 48 / 54 | 7.9–8.8 / 15.7–20.1 | 21.5–29.8 / 29.9–34.6 | 14.0–22.5 / 17.9–36.7 | 24.9–36.4 / 17.7–30.7 | No |
| 40 / 12 | 5.5–6.0 / 15.0–19.6 | 10.7–13.4 / 27.2–35.6 | 9.2–13.1 / 26.2–36.9 | 5.8–6.4 / 18.4–20.5 | No |
| 48 / 12 | 6.3–6.9 / 14.6–21.0 | 11.1–14.3 / 27.2–36.5 | 10.4–14.0 / 23.8–37.8 | 5.8–6.4 / 18.4–20.5 | No |
| 48 / 15 | 6.9–7.6 / 15.6–21.0 | 12.6–13.8 / 27.6–37.1 | 12.0–15.2 / 22.5–37.0 | 6.9–7.5 / 18.0–19.8 | No |
| 56 / 12 | 7.0–7.7 / 14.6–19.5 | 13.3–13.9 / 24.9–40.2 | 13.5–14.9 / 21.7–40.1 | 5.8–6.4 / 18.4–20.5 | No |
| 56 / 15 | 7.3–8.9 / 14.3–19.1 | 13.3–15.5 / 24.1–39.5 | 12.4–19.1 / 22.0–41.7 | 7.0–7.5 / 18.0–19.8 | No |
| 64 / 15 | 7.5–9.4 / 15.5–19.1 | 12.4–19.8 / 18.4–42.8 | 14.2–18.3 / 18.7–46.3 | 7.0–7.5 / 18.0–19.8 | No |

**None passes the span limit**, even if Highlands is excluded because its implementation belongs to #57. Broader climate fields can lengthen Rolling Hills enough, but Woodland and Moor then last too long. This is a finite sweep, not proof that no possible pair exists. Larger fields also leave fewer independent regions in the fixed window, so the coverage figures become more seed-sensitive.

## Options for morning review

1. **Keep 4 km climate / 5.4 km relief and revise the 6–10 km flight-span acceptance.** This preserves the explicit issue fields and measured coverage. The scene would change biome more often than the stated 3–5 minutes at 32 m/s.
2. **Broaden to the smallest pair that meets both limits.** No tested pair qualifies, so no pair can yet be recommended or called the smallest. Further search alone is not guaranteed to solve the mismatch: Rolling Hills occupies the narrow moisture remainder between Woodland and Moor. Changing threshold spacing, noise shape or the span metric would be another design choice, not merely a wavelength adjustment.

The captain must choose the acceptance interpretation before implementation can be verified. Neither option has been applied.

## WIP validation state

`npm run check` was run on the initial WIP: 46 tests passed, 4 failed (isolated grove presence, fixed river-count floor, one-hour route persistence, and the wide-band flapping baseline). TypeScript separately passed. Browser smoke, performance comparison, biome screenshots, and CI have not been completed. No shipping or acceptance success is claimed.
