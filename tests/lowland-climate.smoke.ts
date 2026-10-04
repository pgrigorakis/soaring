import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Failure modes: climate changes its 28 km scale, biome selection owns ground
// height, or temperature ignores the final shelved ground.
test('continental height and climate remain separate fields', async ({ page }, testInfo) => {
  await page.goto('/?smoke');
  const evidence = await page.evaluate(async () => {
    const worldPath = '/src/world.ts',
      biomePath = '/src/biome.ts';
    const { WorldModel } = await import(worldPath);
    const { CLIMATE } = await import(biomePath);
    const samples = [];
    for (const seed of [80231, 42, 123456]) {
      const world = new WorldModel(seed),
        changed = new WorldModel(seed);
      changed.climate = () => ({ seaTemperature: 1, moisture: 0, region: 1 });
      for (const [x, z] of [
        [-3500, -40000],
        [-35500, -40000],
        [-40000, -25000],
        [28000, 0],
        [-6900, 4000],
      ]) {
        const relief = world.relief(x, z),
          ground = world.sample(x, z),
          other = changed.sample(x, z);
        samples.push({
          seed,
          x,
          z,
          hills: relief.hills,
          sameHeight: ground.height === other.height,
          differentBiome: JSON.stringify(ground.biome) !== JSON.stringify(other.biome),
          coolingError: Math.abs(
            ground.temperature - (world.climate(x, z).seaTemperature - Math.max(0, ground.height) / CLIMATE.lapse),
          ),
        });
      }
    }
    return { scale: CLIMATE.scale, samples };
  });
  expect(evidence.scale).toBe(28000);
  expect(evidence.samples.some((s) => Math.abs(s.hills) > 1)).toBe(true);
  expect(evidence.samples.some((s) => s.differentBiome)).toBe(true);
  for (const sample of evidence.samples) {
    expect(sample.sameHeight).toBe(true);
    expect(sample.coolingError).toBeLessThan(1e-12);
  }
  const path = testInfo.outputPath('lowland-climate-evidence.json');
  await writeFile(path, JSON.stringify(evidence, null, 2));
  await testInfo.attach('lowland-climate-evidence', { path, contentType: 'application/json' });
});
