import { Color, MathUtils } from 'three';
import { CLIMATE_LINES } from './climate';
import { colors, DEFAULT_CROWNS } from './shared';
import type { BiomeProfile } from './types';

const palette = [0x8cc74a, 0x2c6b49, 0x828070, 0x9aa188, 0x9ea59a, 0xe4e9d1];
const ground = colors(palette);
const water = new Color(0x2a7fa0);

export const highlands: BiomeProfile = {
  selection: 'relief',
  forestDensity: 0, forest: ({ legacyForest }, weight) => weight * legacyForest,
  treeDensity: 1, treeChance: ({ sample, clumping }, weight) => weight * (0.018 + sample.forest * clumping),
  crownScale: 1, rockBias: 0, localRock: 0,
  palette,
  ground: ({ sample, slope, normalY, x, z, seed, snowCover }, target) => {
    target.copy(ground[0]!);
    // Forest ground ends at the tree line; summit faces above it are scree or rock.
    if (sample.forest > 0.55 && sample.temperature > CLIMATE_LINES.treeLine[1]) target.copy(ground[1]!);
    else if (sample.temperature < CLIMATE_LINES.scree[1] || slope > 0.5) target.copy(ground[2]!).lerp(ground[3]!, MathUtils.clamp(normalY - 0.3, 0, 1));
    else if (sample.temperature < CLIMATE_LINES.scree[0]) target.lerp(ground[4]!, 1 - MathUtils.smoothstep(sample.temperature, CLIMATE_LINES.scree[1], CLIMATE_LINES.scree[0]));
    const weight = sample.biome.highlands;
    const snow = weight > 0 ? snowCover(sample, slope, x, z, seed) / weight : 0;
    return target.lerp(ground[5]!, snow);
  },
  crowns: { ...DEFAULT_CROWNS, fixed: 0x2c6b49 }, species: [1, 0, 0], canopySuppress: 0,
  waterTint: (_, target) => target.copy(water),
  thermalOdds: 1, scenicBonus: 0, gladeEdgeScenic: 0, torScenic: 0,
  audio: { order: 3, beat: 0.50, register: 0, mood: 'modal', filter: 'highpass', cutoff: 1250, reverb: true,
    level: ({ weight }) => 0.04 * weight },
};
