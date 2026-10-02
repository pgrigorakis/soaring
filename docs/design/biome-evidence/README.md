# Real-app biome screenshots

Captured from the normal running dev app through `chrome-devtools-axi`, not `?smoke`. All captures use seed **80231**, time of day **0.5**, visibility **5000 m**, normal shadows, thermal markers off, a **1440 × 900** viewport, and fully loaded chunks. These final views show the approved Hills **150 ±75 m**, varied farmland, physical hedgerows and Woodland colour/flower changes.

| Screenshot | Camera x/y/z | Look-at x/y/z |
| --- | --- | --- |
| `rolling-hills.png` | -8200 / 290 / -39500 | -8000 / 140 / -40300 |
| `woodland.png` | -36150 / 275 / -39500 | -36000 / 115 / -40300 |
| `woodland-glade.png` | -35940 / 220 / -38350 | -35820 / 102.55 / -38620 |
| `heath-moorland.png` | -40200 / 355 / -39500 | -40000 / 175 / -40300 |
| `blend-zone.png` | -21200 / 350 / -45500 | -21000 / 145 / -46300 |
| `moor-peat-pool.png` | -23900 / 280 / -42370 | -23809 / 146 / -42646 |

The blend target has Woodland weight **0.353** and Moor weight **0.647**. The pool target is a real water sample with peat weight **1**, not painted terrain. The glade target has glade weight **1**; nearby vertices show the sparse flower colour patches.

## Repeat

Start `npm run dev`, open the normal app, then set the seed and settings with the browser tool:

```js
localStorage.setItem('soaring.world-seed.v1', '80231');
localStorage.setItem('soaring.settings.v1', JSON.stringify({
  terrainVisibility: 5000, showThermal: false, muted: true, lowPower: false,
  cameraDistance: 100, minFlightHeight: 65, maxFlightHeight: 210,
}));
location.reload();
```

After reload, run `window.__SOARING__.setTimeOfDay(0.5)`, `setCaptureClear(true)`, and `setViewpoint({x,y,z,lookX,lookY,lookZ})` using a row above. Wait for `snapshot().pending === 0`, confirm `snapshot().shadowsEnabled`, and wait for a subsequent rendered frame. Capture the screenshot at 1440 × 900. `clearViewpoint()` restores the chase camera.
