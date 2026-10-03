# Issue #94: render-pixel evidence

The before and after captures use seed `123456789`, the same frozen eagle pose, time of day, camera distance, and terrain visibility. The viewport is 1512×982 CSS pixels at DPR 2. Chrome saved both screenshots at 3024×1964 pixels.

| Capture | Render buffer | Render pixels | Pixel ratio |
| --- | ---: | ---: | ---: |
| Before (`40a1791`) | 2646×1718 | 4,545,828 | 1.75 |
| After | 1754×1139 | 1,997,806 | 1.1606 |

The after diagnostics screenshot shows the actual render dimensions and pixel count. I inspected both scene screenshots at high density. The after image is slightly softer, but the eagle, trees, shoreline, and terrain remain clear. The 2 million-pixel budget is retained.

## Artifacts

- [Before screenshot](issue-94-before.png)
- [After screenshot](issue-94-after.png)
- [After diagnostics](issue-94-diagnostics.png)
- [Machine-readable measurements](issue-94-pixel-budget.json)

## Repeat the capture

Run the same steps once at baseline commit `40a1791` and once at the feature revision. Start the development server for that revision:

```sh
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

In another terminal, open an isolated Chrome session and set the retina viewport:

```sh
CHROME_DEVTOOLS_AXI_SESSION=soaring-pixel-cap chrome-devtools-axi start
CHROME_DEVTOOLS_AXI_SESSION=soaring-pixel-cap chrome-devtools-axi emulate --viewport '1512x982x2'
CHROME_DEVTOOLS_AXI_SESSION=soaring-pixel-cap chrome-devtools-axi open http://127.0.0.1:4173
```

Set the deterministic world and settings, then reload:

```sh
CHROME_DEVTOOLS_AXI_SESSION=soaring-pixel-cap chrome-devtools-axi eval '() => {
  localStorage.setItem("soaring.world-seed.v1", "123456789");
  localStorage.setItem("soaring.scenic-visit.v1", "0");
  localStorage.setItem("soaring.settings.v1", JSON.stringify({
    ambienceVolume: 0.52, musicVolume: 0.52, muted: true, lowPower: false,
    cameraDistance: 100, terrainVisibility: 2160, showThermal: true,
    minFlightHeight: 45, maxFlightHeight: 180
  }));
  location.reload();
}'
```

After reload, freeze the same pose and lighting:

```sh
CHROME_DEVTOOLS_AXI_SESSION=soaring-pixel-cap chrome-devtools-axi eval '() => {
  window.__SOARING__.reviewFlight({
    x: 2429.937660789593, z: 3669.388148595139, heading: 0.7499700901356202
  });
  window.__SOARING__.setTimeOfDay(0.5);
  window.__SOARING__.lookAtBody("chase");
  return window.__SOARING__.snapshot();
}'
```

Wait for all 249 chunks to finish building, then capture the clean scene. Use the matching output name for each revision:

```sh
until CHROME_DEVTOOLS_AXI_SESSION=soaring-pixel-cap chrome-devtools-axi eval \
  '() => { const s = window.__SOARING__.snapshot(); return s.pending === 0 && s.chunks === 249; }' \
  | grep -q true; do sleep 1; done
CHROME_DEVTOOLS_AXI_SESSION=soaring-pixel-cap chrome-devtools-axi screenshot evidence/issue-94-after.png
```

Press `D` and capture another screenshot to record the render ratio, dimensions, and pixel count in the diagnostics panel. Use `file evidence/issue-94-*.png` to verify screenshot dimensions.
