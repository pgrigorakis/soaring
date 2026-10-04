// Failure modes: flooded starts, thermals on sea-level water, cache-dependent
// shores, collision-floor corrections, or a stalled crossing.
// Repeatable integration artifact: node scripts/audit-lakeland.mjs
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('test-results', { recursive: true });
await build({ entryPoints: ['src/world.ts'], outfile: 'test-results/lakeland-world.mjs', bundle: true, platform: 'node', format: 'esm' });
await build({ entryPoints: ['src/eagle.ts'], outfile: 'test-results/lakeland-eagle.mjs', bundle: true, platform: 'node', format: 'esm' });
const { WorldModel } = await import('../test-results/lakeland-world.mjs');
const { EagleNavigator } = await import('../test-results/lakeland-eagle.mjs');
const world = new WorldModel(448122);
let land = 0, weight = 0, water = 0;
for (let z = -60000; z <= 60000; z += 2000) {
  for (let x = -60000; x <= 60000; x += 2000) {
    const sample = world.sample(x, z);
    if (!sample.water) { land++; weight += sample.biome.lakeland; } else water++;
  }
  world.trim(20000);
}
const lake = world.landmarkNear(0, 0);
assert(lake && world.sample(lake.x, lake.z).water, 'Sea-level landmark missing');
let beaches = 0, deep = 0;
for (let z = lake.z - 1500; z <= lake.z + 1500; z += 36) {
  for (let x = lake.x - 1500; x <= lake.x + 1500; x += 36) {
    const s = world.sample(x, z);
    if (!s.water && s.height >= 1.5 && s.height <= 7.5) beaches++;
    if (s.water) deep = Math.max(deep, s.surface - s.height);
  }
}
for (let visit = 0; visit < 100; visit++) {
  const start = world.scenicStart(visit);
  assert(!world.sample(start.x, start.z).water, 'Flooded scenic start');
}
for (const thermal of world.nearbyThermals(lake.x, lake.z, 3)) {
  assert(!world.sample(thermal.x, thermal.z).water, 'Thermal over water');
}
const navigator = new EagleNavigator(world, { x: lake.x, z: lake.z, heading: .4 });
const start = { x: navigator.state.x, z: navigator.state.z };
let distance = 0, minimumClearance = Infinity, wetTicks = 0, longestCrossing = 0, crossing = 0, flappingTicks = 0;
const behaviorSeconds = {};
const route = [{ time: 0, ...start }];
let revisits = 0, nearOld = false;
for (let step = 0; step < 36000; step++) {
  const before = { ...navigator.state };
  const s = navigator.update(.1);
  if (s.flapping) flappingTicks++;
  behaviorSeconds[s.behavior] = (behaviorSeconds[s.behavior] ?? 0) + .1;
  const traveled = Math.hypot(s.x - before.x, s.z - before.z);
  distance += traveled;
  const ground = world.sample(s.x, s.z);
  minimumClearance = Math.min(minimumClearance, s.y - Math.max(ground.height, ground.water ? ground.surface : ground.height));
  if (ground.water) { wetTicks++; crossing += traveled; longestCrossing = Math.max(longestCrossing, crossing); } else crossing = 0;
  if ((step + 1) % 100 === 0) {
    const time = (step + 1) / 10;
    const near = route.some((p) => time - p.time > 600 && Math.hypot(s.x - p.x, s.z - p.z) <= 1000);
    if (near && !nearOld) revisits++;
    nearOld = near;
    route.push({ time, x: s.x, z: s.z });
    world.trim(20000);
  }
}
const report = { seed: world.seed, landSamples: land, waterSamples: water, coverage: weight / land, lake, beaches, deep,
  flight: { seconds: 3600, distance, netDistance: Math.hypot(navigator.state.x - start.x, navigator.state.z - start.z), minimumClearance, wetTicks, longestCrossing, revisits, flappingSeconds: flappingTicks / 10, behaviorSeconds } };
await writeFile('test-results/lakeland-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert(report.coverage >= .1 && report.coverage <= .2, 'Lakeland outside 10–20% land');
assert(beaches > 0 && deep > 10);
assert(minimumClearance > 6);
assert(report.flight.netDistance >= distance * .35 && revisits <= 5);
assert(wetTicks > 100 && longestCrossing > 1000, 'Flight never crosses a large lake');
