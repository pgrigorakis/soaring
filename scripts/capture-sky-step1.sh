#!/usr/bin/env bash
# Start Vite on SKY_URL's port first. Browser operations use an isolated axi session.
set -euo pipefail
export CHROME_DEVTOOLS_AXI_SESSION=soaring-sky-bodies-look
stage=${1:?Usage: bash scripts/capture-sky-step1.sh before-or-after}
out="evidence/sky-step1/$stage"
mkdir -p "$out"
chrome-devtools-axi open "${SKY_URL:-http://127.0.0.1:4378}/?smoke&profile"
chrome-devtools-axi resize 1280 800
chrome-devtools-axi eval '() => {
  localStorage.setItem("soaring.world-seed.v1", "1406157560");
  localStorage.setItem("soaring.scenic-visit.v1", "0");
  localStorage.setItem("soaring.settings.v1", JSON.stringify({ambienceVolume:0.52,musicVolume:0.52,muted:true,lowPower:false,cameraDistance:100,terrainVisibility:720,showThermal:false,minFlightHeight:470,maxFlightHeight:500}));
  location.reload(); return "seed and settings restored";
}'
sleep 1
for elevation in 3 -6 -12 -52; do
  chrome-devtools-axi eval "async () => {
    const api = window.__SOARING__;
    // Inverse of the scout tools/phases.mjs Soaring arc, without rounding.
    const phase = Math.acos(-($elevation) / 52) / (2 * Math.PI);
    api.setTimeOfDay(phase);
    api.reviewFlight({x:0,z:0,heading:phase * 2 * Math.PI});
    api.setCapturePixelRatio(1);
    document.querySelector('#intro')?.remove();
    document.querySelector('#controls').style.visibility = 'hidden';
    const frame = api.snapshot().renderedFrames;
    const start = performance.now();
    while(api.snapshot().pending > 0 || api.snapshot().renderedFrames < frame + 20 || api.snapshot().fog.readPending) {
      if(performance.now() - start > 120000) throw new Error('capture did not settle');
      await new Promise(resolve => setTimeout(resolve,100));
    }
    return {snapshot:api.snapshot(),clouds:api.puffCloudSnapshot(),sunDegrees:Math.asin(api.snapshot().sunElevation)*180/Math.PI};
  }" > "$out/sun${elevation}.txt"
  chrome-devtools-axi screenshot "$PWD/$out/sun${elevation}.png"
done
