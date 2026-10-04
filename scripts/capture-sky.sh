#!/usr/bin/env bash
# Matched sky captures for one step: same seed, chase camera and exact sun elevations.
# Start Vite on SKY_URL's port first. Browser operations use an isolated axi session.
set -euo pipefail
export CHROME_DEVTOOLS_AXI_SESSION=soaring-sky-bodies-look
step=${1:?Usage: bash scripts/capture-sky.sh step-name before-or-after}
stage=${2:?Usage: bash scripts/capture-sky.sh step-name before-or-after}
out="evidence/$step/$stage"
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
# name, sun elevation in degrees, view: sun or moon heads the chase camera at that body; look aims the camera at the moon.
for shot in sun3:3:sun sun-6:-6:sun sun-12:-12:sun sun-52:-52:sun moon-6:-6:moon moon-12:-12:moon moon-52:-52:look; do
  IFS=: read -r name elevation view <<< "$shot"
  chrome-devtools-axi eval "async () => {
    const api = window.__SOARING__;
    // Inverse of the scout tools/phases.mjs Soaring arc, without rounding.
    const phase = Math.acos(-($elevation) / 52) / (2 * Math.PI);
    api.setTimeOfDay(phase);
    const body = api.snapshot();
    // Older builds have no body directions in the snapshot; their moon is opposite the sun.
    const target = '$view' === 'moon' ? body.moonDirection : body.sunDirection;
    const heading = target ? Math.atan2(target[0], target[2]) : phase * 2 * Math.PI + ('$view' === 'moon' ? Math.PI : 0);
    api.reviewFlight({x:0,z:0,heading});
    api.lookAtBody('$view' === 'look' ? 'moon' : 'chase');
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
  }" > "$out/$name.txt"
  chrome-devtools-axi screenshot "$PWD/$out/$name.png"
done
