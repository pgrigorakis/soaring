import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Failure modes: adjacent seeds reuse fields, altitude cooling uses old heights,
// climate overrides Highlands/Lakeland, or warm snow and cold trees ignore temperature.
test('climate selects lowland biomes and cools rendered ground deterministically', async ({ page }, testInfo) => {
  await page.goto('/?smoke');
  const evidence = await page.evaluate(async () => {
    const worldPath = '/src/world.ts';
    const biomePath = '/src/biome.ts';
    const terrainPath = '/src/terrain.ts';
    const { WorldModel } = await import(worldPath);
    const { CLIMATE, BIOME_CLIMATE, CLIMATE_LINES, biomeWeights } = await import(biomePath);
    const { snowCover } = await import(terrainPath);
    const raw = (point: number[]) => point.map((value) => (value - .5) / CLIMATE.stretch + .5);
    const centres = Object.entries(BIOME_CLIMATE).map(([name, point]) => ({ name,
      weights: biomeWeights(0, ...raw(point as number[])) }));
    const seeds = [80231, 42, 123456, 43, 44];
    const fields = seeds.map((seed) => {
      const world = new WorldModel(seed);
      const sample = world.sample(17250, 33000);
      const climate = world.climate(17250, 33000);
      return { seed, climate, sample, coolingError: Math.abs(sample.temperature
        - (climate.seaTemperature - Math.max(0, sample.height) / CLIMATE.lapse)) };
    });
    const world = new WorldModel(57);
    // The 7 km continental field moves the cold crest. Cooling assertions are unchanged.
    const peak = world.sample(1200, -101700);
    const trees = world.treesInArea(1200, -101700, 360, 36);
    return { centres, fields,
      highlands: biomeWeights(1, 1, 0, 1, 1), lakeland: biomeWeights(0, 0, 1, 0, 1),
      coldPeak: { temperature: peak.temperature, treeEnd: CLIMATE_LINES.treeLine[1], trees: trees.length,
        snow: snowCover(peak, .2, 1200, -101700, 57),
        warmSnow: snowCover({ ...peak, temperature: .5 }, .2, 1200, -101700, 57) } };
  });
  for (const { name, weights } of evidence.centres) expect(weights[name]).toBeGreaterThan(.99);
  expect(evidence.highlands.highlands).toBe(1);
  expect(evidence.lakeland.lakeland).toBe(1);
  for (const field of evidence.fields) expect(field.coolingError).toBeLessThan(1e-12);
  for (let i = 0; i < evidence.fields.length; i += 1) {
    for (let j = i + 1; j < evidence.fields.length; j += 1) {
      const a = evidence.fields[i]!.climate;
      const b = evidence.fields[j]!.climate;
      for (const value of Object.values(a)) expect(Object.values(b)).not.toContain(value);
    }
  }
  expect(evidence.coldPeak.temperature).toBeLessThan(evidence.coldPeak.treeEnd);
  expect(evidence.coldPeak.trees).toBe(0);
  expect(evidence.coldPeak.snow).toBe(1);
  expect(evidence.coldPeak.warmSnow).toBe(0);
  const path = testInfo.outputPath('climate-evidence.json');
  await writeFile(path, JSON.stringify(evidence, null, 2));
  await testInfo.attach('climate-evidence', { path, contentType: 'application/json' });
});
