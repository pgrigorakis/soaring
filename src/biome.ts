import { hills } from './biomes/hills';
import { woodland } from './biomes/woodland';
import { moor } from './biomes/moor';
import { highlands } from './biomes/highlands';
import { lakeland } from './biomes/lakeland';
import { BIOME_SELECTION, CLIMATE } from './biomes/climate';
import { DEFAULT_CROWNS } from './biomes/shared';
import type { ClimateBiomeProfile, ClimatePoint } from './biomes/types';

export { BIOME_SELECTION, CLIMATE, CLIMATE_LINES, WOODLAND_GLADES } from './biomes/climate';
export type { BiomeProfile } from './biomes/types';

// Register a climate biome here. All consumers derive their keys from this registry.
// Order is part of deterministic output: never reorder existing profiles.
const climateProfiles = { hills, woodland, moor } satisfies Record<string, ClimateBiomeProfile>;
export const BIOME_PROFILES = { ...climateProfiles, highlands, lakeland };
export type BiomeKey = keyof typeof BIOME_PROFILES;
export type BiomeWeights = Record<BiomeKey, number>;
type ClimateBiomeKey = keyof typeof climateProfiles;
export const BIOME_KEYS = Object.keys(BIOME_PROFILES) as readonly BiomeKey[];
export const BIOME_ENTRIES = BIOME_KEYS.map((key) => [key, BIOME_PROFILES[key]] as const);
export const CLIMATE_BIOME_KEYS = Object.keys(climateProfiles) as readonly ClimateBiomeKey[];
export const BIOME_CLIMATE = Object.fromEntries(CLIMATE_BIOME_KEYS.map((key) => [key, BIOME_PROFILES[key].climate])) as Record<ClimateBiomeKey, ClimatePoint>;
export const AUDIO_BIOME_KEYS = [...BIOME_KEYS].sort((a, b) => BIOME_PROFILES[a].audio.order - BIOME_PROFILES[b].audio.order);
// Parameter blending historically accumulated Lakeland before Highlands.
const PARAMETER_KEYS = [...BIOME_KEYS.filter((key) => BIOME_PROFILES[key].selection !== 'relief'),
  ...BIOME_KEYS.filter((key) => BIOME_PROFILES[key].selection === 'relief')];

// WorldModel.sample calls these on every query, so they copy a template and reuse scratch storage.
const EMPTY_WEIGHTS = Object.fromEntries(BIOME_KEYS.map((key) => [key, 0])) as BiomeWeights;
const CLIMATE_POINTS = CLIMATE_BIOME_KEYS.map((key) => BIOME_CLIMATE[key]);
const PARAMETER_PROFILES = PARAMETER_KEYS.map((key) => [key, BIOME_PROFILES[key]] as const);
const claims = new Float64Array(CLIMATE_BIOME_KEYS.length);

export function emptyBiomeWeights(): BiomeWeights {
  return { ...EMPTY_WEIGHTS };
}

export const transition = (threshold: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - threshold + 0.06) / 0.12));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const climateAxis = (value: number) => Math.max(0, Math.min(1, (value - 0.5) * CLIMATE.stretch + 0.5));

/** Highlands, then Lakeland, claim their territory; N climate points share the rest. */
export function biomeWeights(relief: number, temperature: number, moisture: number, region: number, lakeField = 0): BiomeWeights {
  const highlands = transition(0.55, relief);
  const lakeland = (1 - highlands) * (1 - transition(0.4, relief)) * transition(BIOME_SELECTION.lakeThreshold, lakeField);
  const axisT = climateAxis(temperature);
  const axisM = climateAxis(moisture);
  const axisR = climateAxis(region);
  let nearest = Infinity;
  for (let index = 0; index < CLIMATE_POINTS.length; index += 1) {
    const point = CLIMATE_POINTS[index]!;
    const distance = (0 + (axisT - point[0]) ** 2 + (axisM - point[1]) ** 2 + (axisR - point[2]) ** 2) / CLIMATE.radius ** 2;
    claims[index] = distance;
    nearest = Math.min(nearest, distance);
  }
  // Measured from the nearest point, so the largest term is one and never underflows.
  let claimSum = 0;
  for (let index = 0; index < CLIMATE_POINTS.length; index += 1) {
    claims[index] = Math.exp(-CLIMATE.sharpness * (claims[index]! - nearest));
    claimSum += claims[index]!;
  }
  const remainder = (1 - highlands - lakeland) / claimSum;
  const weights = emptyBiomeWeights();
  weights.highlands = highlands;
  weights.lakeland = lakeland;
  // The first climate point receives the residual. Keep each subtraction separate
  // to retain the original Hills rounding, not just a mathematically equal sum.
  let residual = 1 - highlands - lakeland;
  for (let index = 1; index < CLIMATE_BIOME_KEYS.length; index += 1) {
    const weight = claims[index]! * remainder;
    weights[CLIMATE_BIOME_KEYS[index]!] = weight;
    residual -= weight;
  }
  weights[CLIMATE_BIOME_KEYS[0]!] = Math.max(0, residual);
  return weights;
}

type BlendedParameter = 'forestDensity' | 'treeDensity' | 'crownScale' | 'rockBias' | 'thermalOdds' | 'scenicBonus' | 'gladeEdgeScenic' | 'torScenic';
export function blendParameter(weights: BiomeWeights, key: BlendedParameter): number {
  let sum = 0;
  for (const [biome, profile] of PARAMETER_PROFILES) sum += weights[biome] * profile[key];
  return sum;
}

/** Hash offsets and selection order retain the existing crown distribution. */
export function crownTint(weights: BiomeWeights, kind: number, random: (offset: number) => number): number {
  let autumn = 0;
  const autumnRoll = random(355);
  for (const key of BIOME_KEYS) {
    const crowns = BIOME_PROFILES[key].crowns;
    autumn += weights[key] * crowns.autumnOdds;
    if (autumnRoll < autumn) return crowns.autumn[random(356) < 0.25 ? 0 : 1];
  }
  const defaults = DEFAULT_CROWNS.species[kind]!;
  let selected = 0;
  const roll = random(358);
  for (const key of BIOME_KEYS) {
    const tints = BIOME_PROFILES[key].crowns.species[kind]!;
    if (tints.length === defaults.length && tints.every((tint, index) => tint === defaults[index])) continue;
    selected += weights[key];
    if (roll < selected) return tints[Math.floor(random(357) * tints.length)]!;
  }
  return defaults[0]!;
}
