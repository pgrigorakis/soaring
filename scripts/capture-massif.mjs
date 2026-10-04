// Captures the Highlands massif at a fixed seed and vantage.
// Start Vite, then run: node scripts/capture-massif.mjs <origin> <output-dir>
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';

const exec = promisify(execFile);
const origin = process.argv[2] ?? 'http://127.0.0.1:4217';
const output = process.argv[3] ?? 'evidence/massifs/after';
const seed = 57;
const crest = { x: -7880, z: 3960, height: 1065 };
const shots = [
  {
    name: 'chase-noon',
    mode: 'chase',
    x: 158,
    z: 19842,
    heading: Math.atan2(-198, 198),
    timeOfDay: 0.5,
    visibility: 1800,
  },
  {
    name: 'chase-golden',
    mode: 'chase',
    x: 158,
    z: 19842,
    heading: Math.atan2(-198, 198),
    timeOfDay: 0.72,
    visibility: 1800,
  },
  {
    name: 'ridge-near',
    mode: 'view',
    x: crest.x,
    y: 980,
    z: crest.z - 700,
    lookX: crest.x,
    lookY: 1040,
    lookZ: crest.z,
    timeOfDay: 0.5,
    visibility: 2500,
  },
  {
    name: 'ridge-far',
    mode: 'view',
    x: crest.x,
    y: 900,
    z: crest.z - 4700,
    lookX: crest.x,
    lookY: 1000,
    lookZ: crest.z,
    timeOfDay: 0.5,
    visibility: 5000,
  },
];
const cli = async (...args) => {
  const { stdout } = await exec('chrome-devtools-axi', args, {
    env: { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'soaring-massifs' },
    timeout: 360000,
    maxBuffer: 1024 * 1024,
  });
  if (/^error:/m.test(stdout)) throw new Error(stdout);
  return stdout;
};
await mkdir(output, { recursive: true });
await cli('open', `${origin}/?smoke`);
await cli('resize', '1600', '1000');
await cli('eval', `() => { localStorage.setItem('soaring.world-seed.v1', '${seed}'); location.reload(); }`);
const record = { seed, origin, viewport: { width: 1600, height: 1000 }, shots: {} };
for (const shot of shots) {
  await cli('eval', `async () => {
    const wait = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const deadline = performance.now() + 300000;
    while (!window.__SOARING__?.reviewFlight) {
      if (performance.now() > deadline) throw Error('App unavailable');
      await wait();
    }
    document.querySelector('#intro')?.classList.add('hidden');
    document.querySelector('#controls').style.visibility = 'hidden';
    document.body.classList.add('cursor-hidden');
    const shot = ${JSON.stringify(shot)};
    window.__SOARING__.setVisibility(shot.visibility);
    window.__SOARING__.setTimeOfDay(shot.timeOfDay);
    window.__SOARING__.setPuffCloudsVisible(shot.mode !== 'view');
    window.__SOARING__.setCaptureClear(shot.mode === 'view');
    if (shot.mode === 'chase') {
      window.__SOARING__.clearViewpoint();
      window.__SOARING__.reviewFlight({ x: shot.x, z: shot.z, heading: shot.heading });
    } else {
      window.__SOARING__.reviewFlight({ x: shot.lookX, z: shot.lookZ, heading: 0 });
      window.__SOARING__.setViewpoint({ x: shot.x, y: shot.y, z: shot.z, lookX: shot.lookX, lookY: shot.lookY, lookZ: shot.lookZ });
    }
    let stable = 0;
    while (stable < 40) {
      if (performance.now() > deadline) throw Error('Terrain did not settle');
      await wait();
      const state = window.__SOARING__.snapshot();
      stable = state.pending === 0 && state.visibleDistance >= Math.min(state.requestedDistance, shot.visibility) * 0.9 ? stable + 1 : 0;
    }
    return window.__SOARING__.snapshot();
  }`);
  const snapshot = await cli('snapshot');
  const canvas = snapshot.match(/uid=(\S+) Canvas/);
  if (!canvas) throw new Error(`Canvas missing from browser snapshot: ${snapshot.slice(0, 500)}`);
  await cli('screenshot', `${output}/${shot.name}.png`, '--uid', `@${canvas[1]}`);
  const diagnostics = await cli('eval', `() => {
    const s = window.__SOARING__.snapshot();
    return { seed: s.seed, position: s.position, pending: s.pending, chunks: s.chunks,
      visibleDistance: s.visibleDistance, requestedDistance: s.requestedDistance,
      cameraDistance: s.cameraDistance, timeOfDay: s.timeOfDay, tiers: s.tiers };
  }`);
  const result = diagnostics.match(/^result: (.+)$/m);
  if (!result) throw new Error('Capture diagnostics missing');
  record.shots[shot.name] = { ...shot, diagnostics: JSON.parse(JSON.parse(result[1])) };
  console.log('Captured', shot.name);
}
await writeFile(`${output}/vantages.json`, JSON.stringify(record, null, 2));
