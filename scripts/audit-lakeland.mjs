// Failure modes: too little/much territory, oversized inland seas, missing islands,
// flooded starts, thermals on water, cache-dependent shores, or a stalled lake crossing.
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
const reaches = world.reachesIn(-12000, -12000, 12000, 12000);
const lakes = reaches.filter((r) => r.lake && r.aWidth >= 1500).sort((a, b) => b.aWidth - a.aWidth);
assert(lakes.length > 0, 'No long valley lakes');
// Select a real, intact valley lake, not merely the largest nominal radius.
const lake = lakes.find((r) => Math.abs(r.ax - 7647.127558763605) < 1 && Math.abs(r.az + 11252.509786414448) < 1);
assert(lake, 'Repeatable lake landmark missing');
let islands = 0, beaches = 0, deep = 0;
for (let z = lake.az - 1500; z <= lake.az + 1500; z += 36) {
  for (let x = lake.ax - 1500; x <= lake.ax + 1500; x += 36) {
    const s = world.sample(x, z);
    if (s.island) islands++;
    if (!s.water && s.bank > 0 && s.height - s.surface <= 3) beaches++;
    if (s.water) deep = Math.max(deep, s.surface - s.height);
  }
}
for (let visit = 0; visit < 100; visit++) {
  const start = world.scenicStart(visit);
  assert(!world.sample(start.x, start.z).water, 'Flooded scenic start');
}
for (const thermal of world.nearbyThermals(lake.ax, lake.az, 3)) {
  assert(!world.sample(thermal.x, thermal.z).water, 'Thermal over water');
}
const navigator = new EagleNavigator(world, { x: lake.ax - Math.cos(lake.heading) * 1100,
  z: lake.az - Math.sin(lake.heading) * 1100, heading: Math.PI / 2 - lake.heading });
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
const report = { seed: world.seed, landSamples: land, waterSamples: water, coverage: weight / land, lake, islands, beaches, deep,
  flight: { seconds: 3600, distance, netDistance: Math.hypot(navigator.state.x - start.x, navigator.state.z - start.z), minimumClearance, wetTicks, longestCrossing, revisits, flappingSeconds: flappingTicks / 10, behaviorSeconds } };
await writeFile('test-results/lakeland-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
assert(report.coverage >= .1 && report.coverage <= .2, 'Lakeland outside 10–20% land');
assert(islands > 0 && beaches > 0 && deep > 10);
assert(minimumClearance >= 6);
assert(report.flight.netDistance >= distance * .35 && revisits <= 5);
assert(wetTicks > 100 && longestCrossing > 1000, 'Flight never crosses a large lake');
