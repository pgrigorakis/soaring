import { colors, DEFAULT_CROWNS } from './shared';
import type { ClimateBiomeProfile } from './types';

const palette = [0x579b3b, 0x6dad3f, 0x8cc74a];
const ground = colors(palette);
const flowers = colors([0xd3b84d, 0xd05741, 0xa6849a]);

export const woodland: ClimateBiomeProfile = {
  selection: 'climate', climate: [0.42, 0.7, 0.55],
  forestDensity: 0.92,
  forest({ glade }, weight) { return weight * this.forestDensity * (1 - glade); },
  // A 0.35 reference occupancy leaves headroom for the full 2.5× profile density.
  treeDensity: 2.5, treeChance: ({ sample, density }, weight) => weight * (1 - sample.glade) * 0.35 * density,
  crownScale: 1.5, rockBias: 0.02, localRock: 0, rockTint: 0x899b98,
  palette,
  ground: ({ sample, x, z, seed, fbm }, target) => {
    const patch = sample.biome.woodland > 0 ? 0.5 + fbm(x / 180, z / 180, seed + 162, 2) * 0.5 : 0;
    return target.copy(ground[0]!).lerp(ground[1]!, patch).lerp(ground[2]!, sample.glade);
  },
  groundExtras: ({ sample, jitter, fbm, x, z, seed }, target, weight) => {
    if (weight * sample.glade > 0.1 && jitter < 0.2 && fbm(x / 65, z / 65, seed + 163, 2) > 0.22) {
      target.lerp(flowers[Math.floor(jitter * 15)]!, weight * sample.glade * 0.7);
    }
  },
  extrasOrder: 2,
  crowns: { ...DEFAULT_CROWNS, species: [[0x2c6b49], [0x316e30, 0x53973e, 0x8dbd6a], [0x9bc558]], autumnOdds: 0.04 },
  species: [0.3, 0.6, 0.1], canopySuppress: 1,
  thermalOdds: 1.6, scenicBonus: 0.2, gladeEdgeScenic: 0.5, torScenic: 0,
  audio: { order: 1, beat: 0.47, register: -5, mood: 'warmth', filter: 'bandpass', cutoff: 1700,
    level: ({ weight, gust }) => 0.052 * weight * (0.08 + 0.92 * gust) },
};
