// Captures #86 at fixed seed, pose, noon, and the default chase camera.
// Start Vite, then run: node scripts/capture-lowland.mjs <origin> <output-dir>
// Browser operations use chrome-devtools-axi in an isolated named session.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
const exec = promisify(execFile);
const origin = process.argv[2] ?? 'http://127.0.0.1:4198';
const output = process.argv[3] ?? 'evidence/lowland-hills/after';
const seed = 5;
const vantages = [
  { name: 'hills', x: 28000, z: 0, heading: 0 },
  { name: 'woodland', x: -7800, z: -7800, heading: 0 },
  { name: 'moor', x: -6900, z: 4000, heading: 0 },
];
const cli = async (...args) => {
  const { stdout } = await exec('chrome-devtools-axi', args, {
    env: { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'soaring-lowland-hills' },
    timeout: 360000, maxBuffer: 1024 * 1024,
  });
  if (/^error:/m.test(stdout)) throw new Error(stdout);
  return stdout;
};
await mkdir(output, { recursive: true });
await cli('open', origin);
await cli('resize', '1600', '1000');
await cli('eval', `() => { localStorage.setItem('soaring.world-seed.v1', '${seed}'); location.reload(); }`);
const record = { seed, origin, viewport: { width: 1600, height: 1000 }, vantages: {} };
for (const vantage of vantages) {
  await cli('eval', `async () => {
    const wait = () => new Promise(resolve => requestAnimationFrame(resolve));
    const deadline = performance.now() + 300000;
    while (!window.__SOARING__?.reviewFlight) { if (performance.now() > deadline) throw Error('App unavailable'); await wait(); }
    document.querySelector('#intro')?.classList.add('hidden');
    document.body.classList.add('cursor-hidden');
    window.__SOARING__.reviewFlight(${JSON.stringify(vantage)});
    window.__SOARING__.setTimeOfDay(0.5);
    let stable = 0;
    while (stable < 60) {
      if (performance.now() > deadline) throw Error('Terrain did not settle');
      await wait();
      const state = window.__SOARING__.snapshot();
      stable = state.pending === 0 && state.visibleDistance >= state.requestedDistance * .95 ? stable + 1 : 0;
    }
    return window.__SOARING__.snapshot();
  }`);
  const snapshot = await cli('snapshot');
  const canvas = snapshot.match(/uid=(\S+) Canvas/);
  if (!canvas) throw new Error('Canvas missing from browser snapshot');
  await cli('screenshot', `${output}/${vantage.name}.png`, '--uid', `@${canvas[1]}`);
  const diagnostics = await cli('eval', `() => {
    const s = window.__SOARING__.snapshot();
    return { seed: s.seed, position: s.position, pending: s.pending, chunks: s.chunks,
      visibleDistance: s.visibleDistance, requestedDistance: s.requestedDistance,
      cameraDistance: s.cameraDistance, orbitYaw: s.orbitYaw, orbitPitch: s.orbitPitch,
      pixelRatio: s.pixelRatio, qualityStep: s.qualityStep, lowPower: s.lowPower, timeOfDay: s.timeOfDay };
  }`);
  const result = diagnostics.match(/^result: (.+)$/m);
  if (!result) throw new Error('Capture diagnostics missing');
  record.vantages[vantage.name] = { ...vantage, diagnostics: JSON.parse(JSON.parse(result[1])) };
  console.log('Captured', vantage.name);
}
await writeFile(`${output}/vantages.json`, JSON.stringify(record, null, 2));
