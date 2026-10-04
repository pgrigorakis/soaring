async () => {
  // Run this expression with chrome-devtools-axi eval on the development page.
  // Seed 448122, 1440 x 900 viewport, default chase distance 100 m and orbit zero.
  const api = window.__SOARING__;
  if (api.snapshot().seed !== 448122) throw new Error('Expected seed 448122');
  const place = api.reviewSpots().lake;
  api.setVisibility(1440);
  api.setCapturePixelRatio(1);
  document.querySelector('#intro')?.classList.add('hidden');
  document.querySelector('#controls').style.visibility = 'hidden';
  window.captureCloudView = async (cameraHeight, phase = 0.5) => {
    api.setTimeOfDay(phase);
    api.reviewFlight({ x: place.x, z: place.z, heading: 0.4, y: cameraHeight - 178 * 0.31 / 3 });
    const frame = api.snapshot().renderedFrames;
    const deadline = performance.now() + 120000;
    while (api.snapshot().pending > 0 || api.snapshot().renderedFrames < frame + 8) {
      if (performance.now() > deadline) throw new Error('Terrain/render did not settle');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    const snapshot = api.snapshot();
    return { cameraWorldY: snapshot.position[1] + snapshot.cameraHeight,
      quaternion: 'Default chase, orbit zero, heading 0.4', ...snapshot };
  };
  return { place, capture: 'captureCloudView(cameraWorldY, phase)' };
}
