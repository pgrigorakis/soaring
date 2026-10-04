// Fixed-seed, default-chase captures for the Matched biome palette review.
// Run: node scripts/capture-biome-palette.mjs <before|after> <origin> <output-dir>
// Browser operations use chrome-devtools-axi in an isolated named session.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
const exec = promisify(execFile);
const stage = process.argv[2] ?? 'after';
const origin = process.argv[3] ?? 'http://127.0.0.1:4173';
const output = process.argv[4] ?? `docs/design/biome-palette-evidence/${stage}`;
if (!['before', 'after'].includes(stage)) throw new Error('Stage must be before or after');
const seed = 5;
const viewport = { width: 1440, height: 900 };
const visibility = 5000;
const phases = stage === 'before'
  ? [{ name: 'noon', phase: 0.5 }]
  : [{ name: 'noon', phase: 0.5 }, { name: 'golden-hour', phase: 0.72 }, { name: 'dusk', phase: 0.75 }, { name: 'moonlight', phase: 0 }];
const vantages = [
  { name: 'hills', x: -6950, z: -1000, heading: 0 },
  { name: 'woodland', x: 7600, z: -7250, heading: 0 },
  { name: 'moor', x: -6850, z: 1500, heading: 0 },
  { name: 'highlands', x: 0, z: 0, heading: 0 },
  { name: 'lakeland', x: -10950, z: 1050, heading: 0 },
];
const cli = async (...args) => {
  const { stdout } = await exec('chrome-devtools-axi', args, {
    env: { ...process.env, CHROME_DEVTOOLS_AXI_SESSION: 'soaring-biome-palette' },
    timeout: 360000, maxBuffer: 1024 * 1024,
  });
  if (/^error:/m.test(stdout)) throw new Error(stdout);
  return stdout;
};
const result = (stdout) => {
  const match = stdout.match(/^result: (.+)$/m);
  if (!match) throw new Error(`Browser result missing: ${stdout}`);
  const parsed = JSON.parse(match[1]);
  return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
};
const git = async (...args) => (await exec('git', args)).stdout.trim();
await mkdir(output, { recursive: true });
await cli('open', origin);
await cli('resize', String(viewport.width), String(viewport.height));
await cli('eval', `() => {
  localStorage.setItem('soaring.world-seed.v1', '${seed}');
  localStorage.setItem('soaring.settings.v1', JSON.stringify({
    ambienceVolume: 0.52, musicVolume: 0.52, muted: true, lowPower: false,
    cameraDistance: 100, terrainVisibility: ${visibility}, showThermal: false,
    minFlightHeight: 65, maxFlightHeight: 210,
  }));
  location.reload();
}`);
const record = {
  stage, commit: await git('rev-parse', 'HEAD'),
  sourceChanges: await git('status', '--porcelain', '--', 'src/biome.ts', 'src/terrain.ts', 'src/world.ts', 'src/main.ts'),
  origin, seed, viewport, visibility, phases, vantages, captures: {},
};
for (const vantage of vantages) {
  for (const phase of phases) {
    const state = result(await cli('eval', `async () => {
      const wait = () => new Promise(resolve => requestAnimationFrame(resolve));
      const deadline = performance.now() + 300000;
      while (!window.__SOARING__?.reviewFlight) {
        if (performance.now() > deadline) throw Error('App unavailable');
        await wait();
      }
      document.querySelector('#intro')?.classList.add('hidden');
      document.body.classList.add('cursor-hidden');
      const app = window.__SOARING__;
      app.setCapturePixelRatio(1);
      app.reviewFlight(${JSON.stringify(vantage)});
      app.setVisibility(${visibility});
      app.setTimeOfDay(${phase.phase});
      let stable = 0;
      while (stable < 60) {
        if (performance.now() > deadline) throw Error('Terrain did not settle');
        await wait();
        const snapshot = app.snapshot();
        const ready = snapshot.pending === 0
          && snapshot.visibleDistance >= snapshot.requestedDistance * 0.95
          && snapshot.shadowsEnabled;
        stable = ready ? stable + 1 : 0;
      }
      const s = app.snapshot();
      return { seed: s.seed, position: s.position, pending: s.pending, chunks: s.chunks,
        visibleDistance: s.visibleDistance, requestedDistance: s.requestedDistance,
        cameraDistance: s.cameraDistance, orbitYaw: s.orbitYaw, orbitPitch: s.orbitPitch,
        pixelRatio: s.pixelRatio, qualityStep: s.qualityStep, lowPower: s.lowPower,
        shadowsEnabled: s.shadowsEnabled, timeOfDay: s.timeOfDay };
    }`));
    const snapshot = await cli('snapshot');
    const canvas = snapshot.match(/uid=(\S+) Canvas/);
    if (!canvas) throw new Error('Canvas missing from browser snapshot');
    const name = `${vantage.name}-${phase.name}`;
    const file = `${output}/${name}.png`;
    await cli('screenshot', file, '--uid', `@${canvas[1]}`);
    record.captures[name] = { file, vantage, phase, state };
    console.log(`Captured ${file}`);
  }
}
record.completed = new Date().toISOString();
await writeFile(`${output}/captures.json`, JSON.stringify(record, null, 2));
