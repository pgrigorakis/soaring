# Matched biome palette captures

These captures review the Matched (V2) palette. Every capture uses seed **5**, the same start position and heading, and the default chase camera. The captures use the normal development renderer, full shadows, a 5,000 m terrain range, a 1440 × 900 viewport, and pixel ratio 1. Terrain had no pending chunks before each screenshot.

The captures use clean branch commit `bb69148`, which is `main` commit `a8dcdb8` plus this palette. `a8dcdb8` has the continental terrain from #127 and the biome profile files from #133. `after/captures.json` records the commit, working source changes, camera state and world position for each image. The before captures of the previous palette at `a8dcdb8` are no longer in the tree. They remain in git history at commit `5da4b07`, under `docs/design/biome-palette-evidence/before/`.

## Noon

| Biome | World position (x, z), heading | Capture |
| --- | --- | --- |
| Hills | −6950, −1000; 0 | [Capture](after/hills-noon.png) |
| Woodland | 8500, −6500; 0 | [Capture](after/woodland-noon.png) |
| Moor | −6000, 4000; 0 | [Capture](after/moor-noon.png) |
| Highlands | 4250, 1000; 0 | [Capture](after/highlands-noon.png) |
| Lakeland | −11000, 500; 0 | [Capture](after/lakeland-noon.png) |

## Across the day

The same five positions also have captures at golden hour (`0.72`), dusk (`0.75`) and moonlight (`0`). Noon is `0.5`.

| Biome | Golden hour | Dusk | Moonlight |
| --- | --- | --- | --- |
| Hills | [Capture](after/hills-golden-hour.png) | [Capture](after/hills-dusk.png) | [Capture](after/hills-moonlight.png) |
| Woodland | [Capture](after/woodland-golden-hour.png) | [Capture](after/woodland-dusk.png) | [Capture](after/woodland-moonlight.png) |
| Moor | [Capture](after/moor-golden-hour.png) | [Capture](after/moor-dusk.png) | [Capture](after/moor-moonlight.png) |
| Highlands | [Capture](after/highlands-golden-hour.png) | [Capture](after/highlands-dusk.png) | [Capture](after/highlands-moonlight.png) |
| Lakeland | [Capture](after/lakeland-golden-hour.png) | [Capture](after/lakeland-dusk.png) | [Capture](after/lakeland-moonlight.png) |

The first golden-hour Moor capture showed sage ground with too little visible lavender. I raised the heather saturation from `#a28895` to `#a6849a`, within the FWM envelope. The refreshed golden-hour view keeps sage dominant and makes the heather patch visible without a global terrain grade.

## Repeat the captures

Use Node.js 20 or newer. Start the normal Vite app, then run the capture script from the repository root:

```sh
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
node scripts/capture-biome-palette.mjs after http://127.0.0.1:4173 docs/design/biome-palette-evidence/after
```

The script fixes seed, settings, viewport and camera pose. It saves per-image diagnostics in `captures.json`.

The [Lavish review board](http://phantom.smelt-tyrannosaurus.ts.net:4387/session/61c7c668a1d753db) presents the same captures side by side.
