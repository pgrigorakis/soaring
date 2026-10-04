# Ground levels: Fly-with-me terrain rendering

## Problem

A camera tile crossing queued new terrain tiles. The nearest pending tile set the global fog distance, so fog closed in all directions and hid land that was already drawn. On seed 2272854000, a two-metre crossing of x = −1440 dropped visibility from 5000 m to 3310 m for many frames. Red traces and strips from unchanged `main` and green ones from this port are in `evidence/ground-levels/`.

## Reference

Inspected Fly-with-me at `aca247b487ffafa5696cce143f108a71a24a7950`:
https://github.com/kunchenguid/fly-with-me/tree/aca247b487ffafa5696cce143f108a71a24a7950

`src/main.js` keeps a toroidal 560 × 560 CPU heightfield at 16 m spacing (`fillCell`, `fillAll`, `updateHeightfield`). Texel `(ix mod N, iz mod N)` always holds world cell `(ix, iz)`. When the bird moves one cell, one row or column is refilled; a large jump refills the whole window. One fixed indexed 528 × 528-cell grid follows the bird. Its vertex shader reads heights with `textureLoad` and builds normals by central differences. The grid is not frustum culled. It covers distant land out to ±4224 m without separate far tiles. Fog does not depend on any build queue.

The reference is MIT licensed, copyright 2026 Kun Chen. `THIRD_PARTY_NOTICES.md` carries the notice.

## Soaring adaptation

`src/ground-levels.ts` keeps the reference architecture: fixed GPU-displaced grids, toroidal CPU sample windows, and incremental row and column refill. It keeps Soaring's world sampling, palette, water, vegetation, floating origin and 720–5000 m visibility control.

- **Three levels instead of one.** Soaring's established look uses 9 m spacing near the eagle, 18 m in the middle distance and 90 m far away. One 9 m grid over 7 km would cost too many triangles. The levels extend ±1440 m, ±4500 m and ±7200 m.
- **One shared centre.** Every level is published around one centre, snapped to 90 m. Each coarser level has a hole exactly the size of the next finer level, so the levels meet without gaps. Inward skirts below each hole edge hide T-junction cracks, as the old tile skirts did.
- **Budgeted refill.** Fly-with-me refills synchronously. Soaring keeps its per-frame CPU budget, so refills are resumable generators. Each window has a margin of one 90 m step. The next centre is filled first and published only when every displayed level has reached it, so a refill never overwrites a displayed texel.
- **One sample per texel.** Each point needs its sample for colour and its neighbours' heights for the normal. The line ahead is sampled once and kept for the next line.
- **Colour on the CPU.** Soaring's palette depends on many sample fields, so colours are painted on the CPU. Each texel packs the height, the normal's x and z, and an 8-bit sRGB colour into one float RGBA value, so each vertex makes one texture fetch.
- **Growth.** A refill first covers ±720 m for the finest level, or just past the finer level for a coarser one. The square then grows in 10-cell rings between moves, so displayed ground follows the camera while coverage grows outward. The outermost level a reach needs grows only to that reach. Vertices outside the valid square sink to −20 km, fully hazed and never against the sky.
- **Loading.** A level counts as pending until it is displayed at the radius the reach wants. Recentring a displayed level does not count; it still shares the CPU budget.
- **Fog.** Coverage comes only from displayed levels. Pending water and tree tiles no longer limit it. A level is shown only when it is valid at the published centre and every finer level is complete.
- **Culled tiles.** Unlike the reference, each level is split into square tiles (40, 50 and 40 cells: 360 m, 900 m and 3.6 km). Each tile gets a bounding sphere from its displayed heights, so three.js culls tiles outside the view and the shadow camera. Tiles fully inside a hole are not built. Without culling, CI's software renderer drew about 1M triangles per frame and smoke tests timed out. In the chase view under SwiftShader at 5 km, 100-cell 18 m tiles still drew 1.9M triangles; these sizes draw 529k against 723k on `main`, and the load finished in 46 s against 66 s.
- **Placement tiles.** The existing tiles still place water, trees, rocks, tors and hedgerows. Mid and far tiles no longer build ground meshes. Near tiles keep a hidden ground mesh because hedgerow placement needs its full-density samples.
- **Water.** Sea-level water uses a 9 m, 18 m or 90 m grid for near, mid and far tiles. These are the vertices and the diagonal of the level that usually draws the tile, so the shoreline follows the drawn triangles. Mid and far water reads heights from the level texels.
- **Memory.** A level keeps only the height, normal and colour of each texel, not the world sample object. Keeping the objects held about 125 MB of extra live heap at 5 km. Under CI's software renderer, garbage collection then slowed every load, and smoke tests timed out. The live heap after a 5 km load is now 12 MB, against 11 MB on `main`.

## Failure modes covered

- A crossing hides drawn land: `tests/terrain-coverage.smoke.ts` asserts 5000 m visibility and steady horizon pixels in every frame of two crossings. It covers normal and Low power rendering.
- A jump shows unbuilt ground: the same test jumps 21.6 km. It asserts zero visibility in the first frame and monotonic growth back to 5000 m.
- A rebase moves ground: the jump moves the eagle more than 10 km, so the render origin rebases. The second crossing runs after the rebase.
- Fog covers more than displayed ground: `tests/terrain.test.ts` checks that every point inside the covered radius lies on a displayed level.
- Placement, water seams and tree pools: the existing unit and smoke tests remain unchanged.

## Measurements

All runs used Chrome 154 with ANGLE Metal on an Apple M4 Pro, against `main` at `15046e0` in a separate export on its own dev server.

Interleaved held-vantage bench (`BENCH_BUILDS=port=…,main=… BENCH_ROUNDS=3 npm run bench`, seed 5, 5000 m, DPR 2):

| vantage | draw calls main → port | triangles main → port | main-thread work p50 (ms) | GPU p50 (ms) |
| --- | ---: | ---: | ---: | ---: |
| lake-noon | 141 → 90 | 351k → 391k | 1.20 → 0.90 | 2.70 → 2.72 |
| confluence-noon | 175 → 99 | 348k → 366k | 1.30 → 0.90 | 2.66 → 2.62 |
| river-run-golden-hour | 196 → 109 | 501k → 503k | 1.70 → 1.10 | 4.65 → 4.46 |
| network-noon | 174 → 99 | 346k → 366k | 1.40 → 0.90 | 3.74 → 3.49 |
| origin-night | 180 → 100 | 357k → 376k | 1.30 → 0.90 | 3.73 → 3.90 |

The frame interval stayed at the 16.7 ms display refresh in every vantage. With culled tiles, triangles and GPU time match `main` within a few percent. Draw calls fall by about 40% and main-thread work by about 30%. An earlier version without culling submitted about 1M triangles per frame; it cost up to 0.7 ms more GPU time here and timed out in CI's software renderer.

CPU sampling, measured in Node for a full load at the 16:9 reach for 5000 m: `main` 5.8 s, this port 6.6 s. One world sample costs about 7 µs; the ground levels take one sample per texel. In the browser regression, a cold load to zero pending work took 33 s on `main` and 45 s here in normal rendering, and 203 s and 270 s in Low power. The ground itself is visible much sooner: the central ±720 m square appears first, then 1.1 km, 3.4 km and 5 km of coverage.

Picture parity (`npm run parity`, `main` as reference): lake-noon, confluence-noon and river-run-golden-hour differ from `main` by 0.09–0.29 mean levels against a same-build floor of 0.06–0.12. In network-noon and origin-night, the `main` reference captures were fully hazed. A live `main` capture at network-noon after loading completed shows the same river, banks, rocks and snow as this port.
