import { Color, MathUtils } from 'three';
import { colors, DEFAULT_CROWNS } from './shared';
import type { BiomeProfile } from './types';

const palette = [0x6fa03c, 0x2f6b3a];
const ground = colors(palette);
const beach = new Color(0xe3cd8b);
const reeds = new Color(0x9fb65a);
const cliff = new Color(0x8a8174);
const shallowWater = new Color(0x78b4a3);
const deepWater = new Color(0x2b6c73);

export const lakeland: BiomeProfile = {
  selection: 'lake',
  forestDensity: 0.55,
  forest(_, weight) { return weight * this.forestDensity; },
  treeDensity: 1, treeChance: (_, weight) => weight * 0.2,
  crownScale: 1, rockBias: 0.02, localRock: 0,
  palette,
  ground: ({ sample, slope }, target) => {
    target.copy(ground[0]!).lerp(ground[1]!, sample.forest);
    if (sample.bank > 0 && sample.bank < 100) {
      if (slope > 0.45) target.copy(cliff);
      else if (sample.height - sample.surface <= 3) target.copy(beach);
      else if (sample.height - sample.surface < 5) target.copy(reeds);
    }
    return target;
  },
  crowns: DEFAULT_CROWNS, species: [0.45, 0.35, 0.2], canopySuppress: 0,
  waterTint: (sample, target) => target.copy(shallowWater).lerp(deepWater, MathUtils.smoothstep(sample.surface - sample.height, 2, 18)),
  thermalOdds: 1, scenicBonus: 0.3, gladeEdgeScenic: 0, torScenic: 0,
  audio: { order: 2, beat: 0.60, register: -2, mood: 'spaciousness', filter: 'lowpass', cutoff: 380,
    level: ({ weight, lap }) => 0.046 * weight * (0.2 + 0.8 * lap) },
};
