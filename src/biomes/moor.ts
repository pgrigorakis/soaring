import { Color } from 'three';
import { colors, DEFAULT_CROWNS } from './shared';
import type { ClimateBiomeProfile } from './types';

const palette = [0xa6849a, 0x93a76c, 0xa4b37f, 0xbfa35a];
const ground = colors(palette);
const gorse = new Color(0xd2b149);

export const moor: ClimateBiomeProfile = {
  selection: 'climate', climate: [0.24, 0.4, 0.4],
  forestDensity: 0.02,
  forest(_, weight) { return weight * this.forestDensity; },
  treeDensity: 1, treeChance: ({ moorGrove }, weight) => weight * (0.004 + moorGrove * 0.3),
  crownScale: 0.85, rockBias: 0.12, localRock: 0.7, rockTint: 0x899b98,
  palette,
  ground: ({ sample }, target) => {
    const patch = sample.moorPatch * 3;
    const index = Math.min(2, Math.floor(patch));
    return target.copy(ground[index]!).lerp(ground[index + 1]!, patch - index);
  },
  groundExtras: ({ jitter }, target, weight) => {
    if (jitter > 0.985) target.lerp(gorse, weight * 0.7);
  },
  extrasOrder: 1,
  crowns: DEFAULT_CROWNS, species: [0.2, 0.6, 0.2], canopySuppress: 0,
  thermalOdds: 1.2, scenicBonus: 0.25, gladeEdgeScenic: 0, torScenic: 0.5,
  audio: { order: 4, beat: 0.56, register: -1, mood: 'sparse', filter: 'lowpass', cutoff: 1500,
    drone: { frequency: 73.42, level: 0.28 },
    level: ({ weight, gust }) => 0.042 * weight * (0.7 + 0.3 * gust) },
};
