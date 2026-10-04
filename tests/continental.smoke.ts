import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Failure modes: biome profiles still own heights; drainage survives; water gets
// local levels; shelf jumps; placement floods; seed hashing loses determinism.
test('continental terrain interlocks land and common sea-level water', async ({ page }, testInfo) => {
  await page.goto('/?smoke');
  const evidence = await page.evaluate(async () => {
    const worldPath = '/src/world.ts',
      biomePath = '/src/biome.ts';
    const { WorldModel } = await import(worldPath);
    const { BIOME_PROFILES, CLIMATE } = await import(biomePath);
    const world = new WorldModel(42),
      again = new WorldModel(42);
    const samples = [];
    let wet = 0,
      dry = 0,
      changes = 0,
      maxStep = 0;
    for (let z = -12000; z <= 12000; z += 300)
      for (let x = -12000; x <= 12000; x += 300) {
        const a = world.sample(x, z),
          b = again.sample(x, z);
        if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('Nondeterministic terrain');
        if (a.water) wet++;
        else dry++;
        if (a.water !== a.height < 0 || a.surface !== 0) throw new Error('Not sea-level water');
        if (!Number.isFinite(a.bank)) throw new Error('Invalid shore distance');
        maxStep = Math.max(maxStep, Math.abs(world.sample(x + 0.01, z).height - a.height));
        if (
          Math.abs(a.temperature - (world.climate(x, z).seaTemperature - Math.max(0, a.height) / CLIMATE.lapse)) > 1e-12
        )
          throw new Error('Incorrect cooling');
        if (samples.length < 32) samples.push({ x, z, height: a.height, water: a.water });
      }
    const original = world.sample(28000, 0).height;
    const saved = Object.values(BIOME_PROFILES).map((p: any) => [p.heightOffset, p.heightAmplitude]);
    try {
      Object.values(BIOME_PROFILES).forEach((p: any) => {
        p.heightOffset = 99999;
        p.heightAmplitude = 99999;
      });
      changes = Number(world.sample(28000, 0).height !== original);
    } finally {
      Object.values(BIOME_PROFILES).forEach((p: any, i) => {
        [p.heightOffset, p.heightAmplitude] = saved[i]!;
      });
    }
    const thermals = world.nearbyThermals(0, 0, 4);
    const trees = world.treesInArea(-3600, -3600, 7200, 36);
    return {
      seed: 42,
      wet,
      dry,
      maxStep,
      profileHeightChanges: changes,
      samples,
      trees: trees.length,
      thermals: thermals.length,
      dryTrees: trees.every((t: any) => !world.sample(t.x, t.z).water),
      dryThermals: thermals.every((t: any) => !world.sample(t.x, t.z).water),
    };
  });
  await writeFile(testInfo.outputPath('continental.json'), JSON.stringify(evidence, null, 2));
  await testInfo.attach('continental', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  expect(evidence.wet).toBeGreaterThan(1000);
  expect(evidence.dry).toBeGreaterThan(1000);
  expect(evidence.profileHeightChanges).toBe(0);
  expect(evidence.maxStep).toBeLessThan(0.1);
  expect(evidence.trees).toBeGreaterThan(100);
  expect(evidence.thermals).toBeGreaterThan(10);
  expect(evidence.dryTrees).toBe(true);
  expect(evidence.dryThermals).toBe(true);
});
