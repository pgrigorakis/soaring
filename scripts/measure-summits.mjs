// Continental pyramid candidates and rendered far-grid loss. Failure modes:
// obsolete summitLift/core/odds APIs, wrong field seed, or a wrong triangle diagonal.
// Repeat: node scripts/measure-summits.mjs [world-source] [report-path]
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results',{recursive:true});
await build({entryPoints:[process.argv[2]??'src/world.ts'],outfile:'test-results/summits-world.mjs',bundle:true,platform:'node',format:'esm'});
const {WorldModel,hash2,SUMMIT}=await import('../test-results/summits-world.mjs');
function meshHeight(world,x,z,step){
  const x0=Math.floor(x/step)*step,z0=Math.floor(z/step)*step,tx=(x-x0)/step,tz=(z-z0)/step;
  const a=world.sample(x0,z0).height,b=world.sample(x0+step,z0).height,c=world.sample(x0,z0+step).height,d=world.sample(x0+step,z0+step).height;
  return tx+tz<=1?a+(b-a)*tx+(c-a)*tz:d+(c-d)*(1-tx)+(b-d)*(1-tz);
}
const report=[];
for(const seed of [57,42,80231]) {
  const world=new WorldModel(seed),s=Math.floor(hash2(world.seed,1,0x1a2b)*0x10000),summits=[];
  for(let gz=-20;gz<20;gz++)for(let gx=-20;gx<20;gx++){
    const x=(gx+.25+.5*hash2(gx,gz,s+47))*SUMMIT.cell,z=(gz+.25+.5*hash2(gx,gz,s+48))*SUMMIT.cell;
    if(world.relief(x,z).mountainMask<.3)continue;
    let best={x,z,height:world.sample(x,z).height};
    for(const step of [80,40,20,10,5])for(let pass=0;pass<20;pass++){
      const previous=best;
      for(const [dx,dz]of [[step,0],[-step,0],[0,step],[0,-step]]){
        const height=world.sample(previous.x+dx,previous.z+dz).height;
        if(height>best.height)best={x:previous.x+dx,z:previous.z+dz,height};
      }
      if(best===previous)break;
    }
    summits.push({...best,highlands:world.sample(best.x,best.z).biome.highlands,farLoss:best.height-meshHeight(world,best.x,best.z,90)});
  }
  summits.sort((a,b)=>b.height-a.height);report.push({seed,summits:summits.length,list:summits});
}
await writeFile(process.argv[3]??'test-results/summits.json',JSON.stringify(report,null,2));
console.log(report.map(r=>({seed:r.seed,summits:r.summits,peak:r.list[0]})));
