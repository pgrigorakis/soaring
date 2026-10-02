# Issue #96: sky render order evidence

## Change and depth path

Three.js r180 sorts opaque objects by group order, then `renderOrder`, material ID, depth, and object ID. `WebGLRenderer` draws the opaque list before transmissive and transparent objects. The `Sky` addon maps its vertices to the far plane, keeps depth testing enabled, and disables depth writes. Setting `sky.renderOrder = 1` therefore draws the sky after the terrain. The depth test rejects sky fragments behind terrain. The lens flare remains in the later transparent pass.

The fog probe is a separate mesh in its own scene. This change does not alter its synchronous one-pixel sky sample.

## Visual evidence

Each pair uses seed 5, eagle start `(16250, 31250, heading 0)`, a fixed camera, 1440×900 viewport, 1800 m terrain visibility, and normal rendering quality.

- [Noon with terrain occlusion, before](baseline/noon-terrain-occlusion.png) · [after](after/noon-terrain-occlusion.png)
- [Golden-hour sun and lens flare, before](baseline/golden-hour-lens-flare.png) · [after](after/golden-hour-lens-flare.png)
- [Aurora, before](baseline/aurora-horizon.png) · [after](after/aurora-horizon.png)
- [Moon and stars, before](baseline/midnight-moon-stars.png) · [after](after/midnight-moon-stars.png)

The selected sky-only upper crops match pixel-for-pixel. The full screenshots have small changes outside those crops while the eagle and world continue to animate.

## GPU timing

[`gpu-timing.json`](gpu-timing.json) records the browser, scene, query method, sample counts, and measured values. Chrome exposed `EXT_disjoint_timer_query_webgl2`; every batch reported `GPU_DISJOINT_EXT` as false. I measured 360 GPU-timed animation frames before the change and in two runs after it. I also measured the Sky shader draw directly.

The frame timings varied between batches. The baseline frame median was 2.018 ms. The two after medians were 3.582 ms and 3.026 ms. The Sky draw medians were 2.026 ms before and 2.362 ms after. These readings do not show a repeatable GPU saving. I do not claim a GPU speedup from this run.

The after-frame draw-order probe found the sky draw at index 220 of 242 default-framebuffer draws. This confirms the sky no longer draws first. The query timings remain measurements from one Apple M4 Pro and do not guarantee the same result on other GPUs.

## Validation and repeat

`npm run check` passed with 52 unit tests and a production build. `npm run test:smoke` passed all 20 browser tests in 1.3 minutes. The smoke suite checks daytime, aurora, and midnight render states.

Run `npm run check` and `npm run test:smoke` to repeat validation.

For the GPU capture, use the normal development page with hardware WebGL. Keep a 1440×900 viewport, seed 5, `lowPower: false`, and the normal renderer. Run the dev server in one terminal:

```sh
npm run dev -- --host 127.0.0.1 --port 4189 --strictPort
```

Start an isolated Chrome session in another terminal:

```sh
CHROME_DEVTOOLS_AXI_SESSION=sky-order CHROME_DEVTOOLS_AXI_HEADED=1 \
  CHROME_DEVTOOLS_AXI_CHROME_ARGS='--enable-gpu --ignore-gpu-blocklist' chrome-devtools-axi start
CHROME_DEVTOOLS_AXI_SESSION=sky-order chrome-devtools-axi open http://127.0.0.1:4189/
```

Seed and reload the page, then call the setup function through `chrome-devtools-axi eval`:

```sh
CHROME_DEVTOOLS_AXI_SESSION=sky-order chrome-devtools-axi eval "localStorage.setItem('soaring.world-seed.v1', '5')"
CHROME_DEVTOOLS_AXI_SESSION=sky-order chrome-devtools-axi open http://127.0.0.1:4189/
```

```js
() => {
  const app = window.__SOARING__;
  document.querySelector('#intro')?.classList.add('hidden');
  app.reviewFlight({ x: 16250, z: 31250, heading: 0 });
  app.setVisibility(1800);
  app.setTimeOfDay(0.5);
  app.setViewpoint({
    x: 16250, y: 289.509161442006, z: 31150,
    lookX: 16250, lookY: 225.82914712620817, lookZ: 31288,
  });
  return app.snapshot();
}
```

Wait until `snapshot().pending === 0`. Then run this through `chrome-devtools-axi eval` to sample 360 frames:

```js
() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const native = window.requestAnimationFrame.bind(window);
  const measure = window.__skyGpuMeasure = { active: true, target: 360, queries: [] };
  window.requestAnimationFrame = callback => native(time => {
    if (!measure.active) return callback(time);
    const query = gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    try { callback(time); } finally {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      measure.queries.push(query);
      if (measure.queries.length === measure.target) measure.active = false;
    }
  });
  return { timerAvailable: !!timer };
}
```

Wait until `active` is false and every query is available. Use this `chrome-devtools-axi eval` function to summarize the samples:

```js
() => {
  const gl = document.querySelector('canvas').getContext('webgl2');
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const measure = window.__skyGpuMeasure;
  const ms = measure.queries.map(query => gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
  const sorted = [...ms].sort((a, b) => a - b);
  const percentile = p => sorted[Math.floor((sorted.length - 1) * p)];
  const result = {
    samples: ms.length,
    meanMs: ms.reduce((sum, value) => sum + value, 0) / ms.length,
    medianMs: percentile(0.5),
    p90Ms: percentile(0.9),
    disjoint: gl.getParameter(timer.GPU_DISJOINT_EXT),
  };
  measure.queries.forEach(query => gl.deleteQuery(query));
  measure.queries = [];
  return result;
}
```

Keep the same browser, GPU, viewport, settings, seed, and camera pose for both runs. The timing method and measured conditions are recorded in [`gpu-timing.json`](gpu-timing.json).
