// Continental relief diagnostic. Failure modes: nonfinite height/slope, local
// water levels, or accidentally reporting retired drainage nodes/peat pools.
// Repeat: node scripts/measure-relief.mjs [world-source] [report-path]
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
await build({entryPoints:[process.argv[2]??'src/world.ts'],outfile:'test-results/relief-world.mjs',bundle:true,platform:'node',format:'esm'});
const {WorldModel}=await import('../test-results/relief-world.mjs');
const report={bounds:[-24000,24000],spacing:160,seeds:[]};
for(const seed of [42,80231,57]) {
  const world=new WorldModel(seed),slopes=[];let peak={height:-Infinity},wet=0,dry=0;
  for(let z=-24000;z<=24000;z+=160)for(let x=-24000;x<=24000;x+=160){
    const s=world.sample(x,z);
    if(s.surface!==0||!Number.isFinite(s.height))throw new Error('Invalid continental terrain');
    if(s.water){wet++;continue;}dry++;
    if(s.height>peak.height)peak={x,z,height:s.height,highlands:s.biome.highlands};
    const dx=world.sample(x+20,z).height-world.sample(x-20,z).height,dz=world.sample(x,z+20).height-world.sample(x,z-20).height;
    slopes.push(Math.atan(Math.hypot(dx,dz)/40)*180/Math.PI);
  }
  slopes.sort((a,b)=>a-b);
  report.seeds.push({seed,peak,waterFraction:wet/(wet+dry),drySamples:dry,medianSlope:slopes[Math.floor(slopes.length/2)],maxSlope:slopes.at(-1)});
}
await writeFile(process.argv[3]??'test-results/relief-measures.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
