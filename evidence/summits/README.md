# Highlands pyramid summits (#88)

## What changed

`relief()` adds a pyramid summit term on top of the #87 massif, so the drainage lattice routes rivers round each summit. The shape follows fly-with-me `pyramidPeaks`:

- One candidate per 2.4 km cell, on a jittered lattice.
- Three or four planar faces with sharp creases up to the apex. The radius is 850 m and the profile power is 1.7.
- Neighbouring summits join through a soft maximum, so they share a ridge.
- Coordinates are warped only 90 m, so the faces stay flat.
- Under a summit the massif drops by up to 45%, so the faces stay clean.

The captain's decisions on 2026-10-03 set the rest:

- **Cores only.** A candidate stands only where the mountain region at its apex is at least 0.8. Full Highlands starts at 0.61.
- **A few summits.** 30% of core cells carry a summit. That is about one summit per 15 km² of core.
- **Height.** Each summit lifts its apex to 1,000–1,100 m over the lowered massif beneath it. The world top from #85 is 1,050 m.
- **No plumes.**

Two changes keep the shape visible:

- **Valley cones.** River valleys flatten ground within about a kilometre of a river. Drainage already keeps rivers off a summit, but the cone still cut summit tops down by hundreds of metres. On seed 57, apexes measured 270–690 m instead of 1,020–1,160 m. Away from the bank, the upper summit keeps its landform height. Within 150 m of a bank the valley is unchanged.
- **Tree line.** The forest ground colour stopped at no height. A summit face above the tree line was green in a snowfield. Forest ground now ends at the tree line, as the trees already do. Above it, the face is scree or rock. This also removes green faces from some cold massif crests on `main` (`before/summit-far.png`, right).

## Summits

`node scripts/measure-summits.mjs src/world.ts evidence/summits/measures.json`. The window is 96 km square. Each apex is climbed to its rendered top. Far loss is the rendered apex height minus the 90 m far-grid triangles. "Inner cores" are cores at region 0.8 or more, measured on a 600 m grid. Cores that touch the window edge are excluded.

| Seed | Summits | Median apex | Highest apex | Median far loss | Maximum far loss | Summits per inner core (core area) |
| --- | --- | --- | --- | --- | --- | --- |
| 57 | 50 | 1,044 m | 1,206 m | 56 m | 106 m | 1 (29 km²), 1 (66 km²), 2 (23 km²), 5 (85 km²), 11 (170 km²), 26 (379 km²) |
| 42 | 62 | 1,021 m | 1,184 m | 54 m | 158 m | 3 (38 km²), 7 (154 km²), 40 (739 km²) |
| 80231 | 51 | 1,014 m | 1,211 m | 51 m | 131 m | 1 (21 km²), 2 (29 km²), 4 (83 km²), 4 (100 km²), 13 (237 km²), 24 (513 km²) |

Cores under 20 km² mostly have no summit. Some apexes stand lower, at 460–950 m, where a river runs close to the summit. The far skyline still shows a sharp apex (`after/summit-far.png`).

## Flight

The eagle now uses a look-ahead climb in the Highlands, after fly-with-me `climbAhead`. Every 0.5 s it samples the next 2.2 km of its heading every 60 m. The sample stops 300 m past its target. The eagle then flaps for the height it needs now to clear each point by its flap floor, at four fifths of its 4 m/s flapping climb. If even a full climb cannot clear the heading, the eagle turns to the nearest heading it can clear. It tries 20°, 40°, 60°, 90° and 120° to each side. During a detour it tries the same side first, so it does not swap sides round a summit. It returns to its target when it has 30 m to spare on the direct heading. Thermal-riding and ridge-soaring are unchanged.

`tests/highlands.smoke.ts` now starts 500 m further west, at (−85000, 122000). From the old start the route crossed no ridge it could join. The new hour passes three summits and keeps two ridge episodes. The Chromium run is `highlands-navigation.json`:

| Measure | Value |
| --- | --- |
| Minimum clearance | 25.8 m |
| Safety corrections | 0 |
| Peak vertical speed | 4.0 m/s |
| Ridge episodes | 2, no flapping, no ceiling breach |
| Flapping (recorded, not limited) | 347 s |
| Longest behaviour | 204 s (gliding) |

The same hour was also flown in Node from nine starts on `main` and on this branch. The starts are the test start and two or three starts 3.6 km from tall summits on seeds 57, 42 and 80231. The raw records are in `navigation-compare.json`.

| Total over nine hours | `main` | This branch |
| --- | --- | --- |
| Lowest clearance | 11.8 m | 12.4 m |
| Safety corrections | 0 | 0 |
| Ridge episodes | 8 | 18 |
| Time held against a face | 204 s | 18.5 s |
| Flapping | 1,707 s | 1,992 s |
| Time on a detour | none | 1,059 s (3.3%) |
| Summits passed within 1.5 km | none | 12 |

"Held against a face" counts ticks where the bird moved less than 1.5 m outside a thermal. That happens when `moveAboveTerrain` holds it back from ground it cannot clear.

## Same-seed screenshots

Seed 57, 1600×1000. Chase shots use the default chase camera, 2.4 km short of the summit at (−11340, 20140), heading to it, with 3 km visibility. The far shot hides puff clouds and clears the haze, so the skyline is readable. Positions are in `before/vantages.json` and `after/vantages.json`.

| View | Before | After |
| --- | --- | --- |
| Chase, noon | [before](before/chase-noon.png) | [after](after/chase-noon.png) |
| Chase, golden hour | [before](before/chase-golden.png) | [after](after/chase-golden.png) |
| Summits at 5.4 km | [before](before/summit-far.png) | [after](after/summit-far.png) |

Repeat with Vite running: `node scripts/capture-summits.mjs http://127.0.0.1:4173 evidence/summits/after`.
