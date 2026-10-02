# Real-app biome screenshots

Captured from the normal running dev app through `chrome-devtools-axi`, not `?smoke`. All captures use seed **80231**, time of day **0.5**, visibility **2500 m**, normal shadows, thermal markers off, a **1440 × 900** viewport, and fully loaded chunks. The eagle continues its normal flight outside these fixed terrain review cameras.

| Screenshot | Camera x/y/z | Look-at x/y/z |
| --- | --- | --- |
| `rolling-hills.png` | -8200 / 250 / -39500 | -8000 / 84 / -40300 |
| `woodland.png` | -36150 / 275 / -39500 | -36000 / 115 / -40300 |
| `heath-moorland.png` | -40200 / 355 / -39500 | -40000 / 175 / -40300 |
| `blend-zone.png` | -21200 / 330 / -45500 | -21000 / 125 / -46300 |
| `moor-peat-pool.png` | -23900 / 280 / -42370 | -23809 / 146 / -42646 |

The blend target has Woodland weight **0.353** and Moor weight **0.647**. The pool target is a real water sample with peat weight **1**, not a painted screenshot.

## Repeat

Start `npm run dev`, open the normal app, then set the seed and settings with the browser tool:

```js
localStorage.setItem('soaring.world-seed.v1', '80231');
localStorage.setItem('soaring.settings.v1', JSON.stringify({
  terrainVisibility: 2500, showThermal: false, muted: true, lowPower: false,
}));
location.reload();
```

After reload, run `window.__SOARING__.setTimeOfDay(0.5)` and `setViewpoint({x,y,z,lookX,lookY,lookZ})` using a row above. Wait for `snapshot().pending === 0` and a subsequent rendered frame, then capture the screenshot. `clearViewpoint()` restores the chase camera.
