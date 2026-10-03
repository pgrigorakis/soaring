import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Failure modes at the #86/#93 seam: hills disappear, their cooling changes the
// broad biome profile and reroutes drainage, or temperature ignores final ground.
test('ground-only hills do not feed back through climate into drainage', async ({ page }, testInfo) => {
  await page.goto('/?smoke');
  const evidence = await page.evaluate(async () => {
    const worldPath = '/src/world.ts';
    const biomePath = '/src/biome.ts';
    const { WorldModel } = await import(worldPath);
    const { CLIMATE } = await import(biomePath);
    const samples = [];
    const nodes = [];
    for (const seed of [80231, 42, 123456]) {
      const hills = new WorldModel(seed);
      const broad = new WorldModel(seed);
      // Narrow counterfactual: remove only the rendered hill term before any sampling.
      broad.lowlandHills = () => 0;
      for (const [x,z] of [[-3500,-40000],[-35500,-40000],[-40000,-25000],[28000,0],[-6900,4000]]) {
        const withHills = hills.relief(x,z);
        const withoutHills = broad.relief(x,z);
        const ground = hills.sample(x,z);
        const flat = broad.sample(x,z);
        samples.push({seed,x,z,hills:withHills.hills,groundDifference:ground.height-flat.height,
          broadElevation:withHills.elevation,withoutHillsElevation:withoutHills.elevation,
          sameBiome:JSON.stringify(withHills.biome)===JSON.stringify(withoutHills.biome),
          coolingError:Math.abs(ground.temperature-(withHills.seaTemperature-Math.max(0,ground.height)/CLIMATE.lapse))});
      }
      for (let i=-2;i<=2;i+=1) for(let j=-2;j<=2;j+=1) {
        nodes.push({seed,i,j,same:JSON.stringify(hills.drainageAt(i,j))===JSON.stringify(broad.drainageAt(i,j))});
      }
    }
    return {samples,nodes};
  });
  expect(evidence.samples.some((sample)=>Math.abs(sample.hills)>1)).toBe(true);
  expect(evidence.samples.some((sample)=>Math.abs(sample.groundDifference)>1)).toBe(true);
  for (const sample of evidence.samples) {
    expect(sample.broadElevation).toBe(sample.withoutHillsElevation);
    expect(sample.sameBiome).toBe(true);
    expect(sample.coolingError).toBeLessThan(1e-12);
  }
  for (const node of evidence.nodes) expect(node.same).toBe(true);
  const path=testInfo.outputPath('lowland-climate-evidence.json');
  await writeFile(path,JSON.stringify(evidence,null,2));
  await testInfo.attach('lowland-climate-evidence',{path,contentType:'application/json'});
});
