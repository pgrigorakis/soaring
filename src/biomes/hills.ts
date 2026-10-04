import { Color } from 'three';
import { colors, DEFAULT_CROWNS } from './shared';
import type { ClimateBiomeProfile } from './types';

const palette = [0x8cc74a, 0xafcc71, 0xb0be5e];
const ground = colors(palette);
const hedge = new Color(0x518628);
const flecks = colors([0xd3b84d, 0xd05741]);

export const hills: ClimateBiomeProfile = {
  selection: 'climate', climate: [0.56, 0.36, 0.45],
  forestDensity: 0.025,
  forest({ hedge }, weight) { return weight * (this.forestDensity + hedge * 0.55); },
  treeDensity: 1, treeChance: ({ sample }, weight) => weight * (0.018 + sample.hedge * 0.45),
  crownScale: 1, rockBias: 0, localRock: 0, rockTint: 0x899b98,
  palette,
  ground: ({ sample }, target) => target.copy(ground[sample.field < 0.55 ? 2 : sample.field < 0.85 ? 0 : 1]!).lerp(hedge, sample.hedge),
  groundExtras: ({ jitter }, target, weight) => {
    if (jitter < 0.012) target.lerp(flecks[jitter < 0.002 ? 1 : 0]!, weight * 0.65);
  },
  extrasOrder: 0,
  crowns: { ...DEFAULT_CROWNS, fixed: 0x518628 }, species: [0, 1, 0], canopySuppress: 0,
  thermalOdds: 1, scenicBonus: 0.1, gladeEdgeScenic: 0, torScenic: 0,
  audio: { order: 0, beat: 0.42, register: 0, mood: 'openMajor', filter: 'lowpass', cutoff: 680, wind: true,
    level: ({ weight, weights }) => 0.075 * weight * (1 - 0.55 * weights.lakeland) },
};
