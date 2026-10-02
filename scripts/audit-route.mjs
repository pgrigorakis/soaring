// Integration trace for the one-hour route contract. No test limits are changed.
// Run: node scripts/audit-route.mjs
// Failure modes: circling the same thermal, seeking behind the persistent compass,
// scenic targets following thermal-exit yaw, steep approaches starving progress,
// excessive flapping, and returns to a route visited more than ten minutes ago.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
await build({ entryPoints: ['src/eagle.ts'], outfile: 'test-results/route-eagle.mjs', bundle: true, platform: 'node', format: 'esm' });
await build({ entryPoints: ['src/world.ts'], outfile: 'test-results/route-world.mjs', bundle: true, platform: 'node', format: 'esm' });
const { EagleNavigator } = await import('../test-results/route-eagle.mjs');
const { WorldModel } = await import('../test-results/route-world.mjs');
const world = new WorldModel(448122);
const navigator = new EagleNavigator(world, world.scenicStart(2));
const start = { x: navigator.state.x, z: navigator.state.z };
const route = [{ time: 0, ...start }];
const visits = new Map();
const snapshots = [];
let distance = 0;
let flappingTicks = 0;
let revisitPasses = 0;
let nearOldRoute = false;
let seekEntries = 0;
let backwardSeekEntries = 0;
let stalledTicks = 0;
for (let step = 0; step < 36000; step += 1) {
  const before = { ...navigator.state };
  const state = navigator.update(0.1);
  const traveled = Math.hypot(state.x - before.x, state.z - before.z);
  distance += traveled;
  if (traveled < 0.1) stalledTicks += 1;
  if (state.flapping) flappingTicks += 1;
  const thermal = navigator.activeThermal;
  if (state.behavior === 'thermal-seeking' && before.behavior !== state.behavior && thermal) {
    seekEntries += 1;
    const dot = (thermal.x - state.x) * Math.sin(before.heading) + (thermal.z - state.z) * Math.cos(before.heading);
    if (dot < 0) backwardSeekEntries += 1;
  }
  if (state.behavior === 'thermal-riding' && before.behavior !== state.behavior && thermal) {
    const key = `${thermal.x.toFixed(0)},${thermal.z.toFixed(0)}`;
    visits.set(key, (visits.get(key) ?? 0) + 1);
  }
  if ((step + 1) % 100 === 0) {
    const time = (step + 1) * 0.1;
    const near = route.some((visit) => time - visit.time > 600 && Math.hypot(state.x - visit.x, state.z - visit.z) <= 1000);
    if (near && !nearOldRoute) revisitPasses += 1;
    nearOldRoute = near;
    route.push({ time, x: state.x, z: state.z });
    world.trim(20000);
  }
  if ((step + 1) % 3000 === 0) snapshots.push({ seconds: (step + 1) / 10, position: [state.x, state.z],
    behavior: state.behavior, biome: world.sample(state.x, state.z).biome,
    netDistance: Math.hypot(state.x - start.x, state.z - start.z), distance, flappingTicks });
}
const report = { seed: world.seed, start, netDistance: Math.hypot(navigator.state.x - start.x, navigator.state.z - start.z),
  requiredNetDistance: distance * 0.35, distance, revisitPasses, flappingTicks, maxFlappingTicks: 1298 * 1.25,
  seekEntries, backwardSeekEntries, stalledTicks,
  mostVisitedThermals: [...visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8), snapshots };
await writeFile('test-results/biome-route.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
