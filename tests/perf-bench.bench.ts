import { mkdir, writeFile } from 'node:fs/promises';
import { test } from '@playwright/test';
import { runBenchRound, VANTAGES, type RoundResult, type Stat } from '../scripts/perf-bench';

// Environment: BENCH_BUILDS="label=url,label=url" interleaves builds round by round (A B A B ...),
// BENCH_ROUNDS (default 3), BENCH_FRAMES (default 300), BENCH_WARMUP (default 60),
// BENCH_DPR (default 2), BENCH_OUT (default test-results/perf-bench).
const rounds = Number(process.env.BENCH_ROUNDS ?? 3);
const frames = Number(process.env.BENCH_FRAMES ?? 300);
const warmupFrames = Number(process.env.BENCH_WARMUP ?? 60);
const deviceScaleFactor = Number(process.env.BENCH_DPR ?? 2);
const outDir = process.env.BENCH_OUT ?? 'test-results/perf-bench';

test('held-vantage bench', async ({ browser, baseURL }) => {
  const builds = (process.env.BENCH_BUILDS ?? `build=${baseURL}`).split(',').map((entry) => {
    const [label, url] = entry.split('=') as [string, string];
    return { label, url };
  });
  const results: Array<RoundResult & { label: string; round: number }> = [];
  for (let round = 1; round <= rounds; round += 1) {
    for (const build of builds) {
      const result = await runBenchRound(browser, { url: build.url, frames, warmupFrames, deviceScaleFactor });
      results.push({ ...result, label: build.label, round });
      console.log(`round ${round} ${build.label}: ${result.vantages.map((vantage) => `${vantage.name} p50 ${vantage.frameIntervalMs.p50.toFixed(1)} ms`).join(', ')}`);
    }
  }
  await mkdir(outDir, { recursive: true });
  const command = `${process.env.BENCH_BUILDS ? `BENCH_BUILDS=${process.env.BENCH_BUILDS} ` : ''}BENCH_ROUNDS=${rounds} BENCH_FRAMES=${frames} BENCH_WARMUP=${warmupFrames} BENCH_DPR=${deviceScaleFactor} npm run bench`;
  await writeFile(`${outDir}/bench.json`, JSON.stringify({ command, generated: new Date().toISOString(), results }, null, 2));
  await writeFile(`${outDir}/bench.md`, markdown(command, results, builds.map((build) => build.label)));
});

const fixed = (value: number | undefined, digits = 2) => (value === undefined ? 'n/a' : value.toFixed(digits));
const best = (values: Array<Stat | null>, key: keyof Stat): number | undefined => {
  const present = values.filter((value): value is Stat => value !== null);
  return present.length === 0 ? undefined : Math.min(...present.map((value) => value[key]));
};

/** Method: p5 and p50 per round, minimum across rounds, so a transient stall cannot inflate a result. */
function markdown(command: string, results: Array<RoundResult & { label: string; round: number }>, labels: string[]): string {
  const first = results[0]!;
  const lines = [
    `Command: \`${command}\``, '',
    `- Commit: ${[...new Set(results.map((result) => `${result.label} ${result.build.commit}${result.build.dirty ? ' (dirty)' : ''}`))].join(', ')}`,
    `- Machine: ${first.environment.machine.cpu}, ${first.environment.machine.cores} cores, ${first.environment.machine.memoryGiB} GiB, ${first.environment.machine.os} ${first.environment.machine.arch}`,
    `- Browser: ${first.environment.browser}${first.environment.headless ? ' headless' : ''}; GL ${first.environment.glRenderer}`,
    `- Viewport ${first.environment.viewport.join('×')}, devicePixelRatio ${first.environment.devicePixelRatio}, render pixel ratio ${first.environment.pixelRatio}`,
    `- Seed ${first.parameters.seed}, terrain visibility ${first.parameters.visibility} m, ${first.parameters.frames} frames per vantage after ${first.parameters.warmupFrames} warmup frames, ${rounds} rounds`,
    `- GPU timing: ${[...new Set(results.map((result) => result.gpu.status))].join(', ')}${first.gpu.reason ? ` (${first.gpu.reason})` : ''}`, '',
    '| build | vantage | calls | triangles | frame p5 | frame p50 | frame p95 | work p50 | GPU p50 | CPU busy | GPU busy |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const label of labels) {
    for (const vantage of VANTAGES) {
      const rows = results.filter((result) => result.label === label).map((result) => result.vantages.find((entry) => entry.name === vantage.name)!);
      const calls = new Set(rows.map((row) => `${row.counts.calls}/${row.counts.triangles}`));
      const share = (values: Array<number | null>) => { const present = values.filter((value): value is number => value !== null); return present.length ? Math.min(...present) : undefined; };
      lines.push(`| ${label} | ${vantage.name} | ${rows[0]!.counts.calls} | ${rows[0]!.counts.triangles}${calls.size > 1 ? ' ⚠ varies' : ''} | ${fixed(best(rows.map((row) => row.frameIntervalMs), 'p5'))} | ${fixed(best(rows.map((row) => row.frameIntervalMs), 'p50'))} | ${fixed(best(rows.map((row) => row.frameIntervalMs), 'p95'))} | ${fixed(best(rows.map((row) => row.mainThreadWorkMs), 'p50'))} | ${fixed(best(rows.map((row) => row.gpuMs), 'p50'))} | ${fixed(share(rows.map((row) => row.mainThreadBusyShare)) === undefined ? undefined : share(rows.map((row) => row.mainThreadBusyShare))! * 100, 1)}% | ${share(rows.map((row) => row.gpuBusyShare)) === undefined ? 'n/a' : `${(share(rows.map((row) => row.gpuBusyShare))! * 100).toFixed(1)}%`} |`);
    }
  }
  return `${lines.join('\n')}\n\nTimes are milliseconds, each the minimum across rounds. "n/a" means the GPU timer query was unavailable.\n`;
}
