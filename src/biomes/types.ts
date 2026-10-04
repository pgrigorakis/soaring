import type { Color } from 'three';
import type { BiomeWeights } from '../biome';
import type { LandscapeSample } from '../world';

export type ClimatePoint = readonly [number, number, number];
export type GroundContext = {
  sample: LandscapeSample;
  x: number;
  z: number;
  seed: number;
  slope: number;
  normalY: number;
  fbm: (x: number, z: number, seed: number, octaves: number) => number;
  jitter: number;
  snowCover: (sample: LandscapeSample, slope: number, x: number, z: number, seed: number) => number;
};
export type ForestContext = { hedge: number; glade: number; legacyForest: number };
export type TreeContext = { sample: LandscapeSample; density: number; moorGrove: number; clumping: number };
export type MusicMood = 'openMajor' | 'warmth' | 'spaciousness' | 'modal' | 'sparse';
export type AmbienceContext = { weights: BiomeWeights; weight: number; gust: number; lap: number };
export type CrownTints = {
  /** Conifer, broadleaf, birch. Single swatches are the default; variants are chosen by world hash. */
  species: readonly [readonly number[], readonly number[], readonly number[]];
  autumnOdds: number;
  autumn: readonly [number, number];
  /** Rendered override, blended after the world tint. */
  fixed?: number;
};
export type ClimateBiomeProfile = BiomeProfile & { selection: 'climate'; climate: ClimatePoint };
export type BiomeProfile = {
  selection: 'climate' | 'relief' | 'lake';
  climate?: ClimatePoint;
  forestDensity: number;
  forest: (context: ForestContext, weight: number) => number;
  treeDensity: number;
  treeChance: (context: TreeContext, weight: number) => number;
  crownScale: number;
  rockBias: number;
  localRock: number;
  palette: readonly number[];
  ground: (context: GroundContext, target: Color) => Color;
  /** Applied after all base colours and the shared rock overlay. */
  groundExtras?: (context: GroundContext, target: Color, weight: number) => void;
  extrasOrder?: number;
  rockTint?: number;
  crowns: CrownTints;
  /** Conifer, broadleaf, birch. */
  species: readonly [number, number, number];
  waterTint?: (sample: LandscapeSample, target: Color) => Color;
  canopySuppress: number;
  thermalOdds: number;
  scenicBonus: number;
  gladeEdgeScenic: number;
  torScenic: number;
  audio: {
    /** Preserve the original audio accumulation and source creation order. */
    order: number;
    beat: number;
    register: number;
    mood: MusicMood;
    filter: BiquadFilterType;
    cutoff: number;
    reverb?: boolean;
    drone?: { frequency: number; level: number };
    wind?: boolean;
    level: (context: AmbienceContext) => number;
  };
};
