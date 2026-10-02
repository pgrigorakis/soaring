/** Decision B: Hills has a broad moisture territory, not a narrow remainder strip. */
export const BIOME_SELECTION = {
  climateWavelength: 16000,
  reliefWavelength: 18000,
  hillsWavelength: 16000,
  hillsThreshold: 0.62,
  woodlandThreshold: 0.5,
  moorThreshold: 0.5,
} as const;

/** Glade size stays fixed; only the threshold controls how often holes occur. */
export const WOODLAND_GLADES = { wavelength: 300, start: 0.28, end: 0.43 } as const;

export type BiomeWeights = { hills: number; woodland: number; moor: number; highlands: number; lakeland: number };
export type BiomeProfile = {
  heightAmplitude: number;
  heightOffset: number;
  forestDensity: number;
  treeDensity: number;
  crownScale: number;
  rockBias: number;
  palette: readonly number[];
  /** conifer, broadleaf, birch */
  species: readonly [number, number, number];
  thermalOdds: number;
  scenicBonus: number;
};

// Highlands and Lakeland keep the existing landscape until their own issues supply profiles.
export const BIOME_PROFILES = {
  hills: { heightAmplitude: 75, heightOffset: 150, forestDensity: 0.025, treeDensity: 1, crownScale: 1,
    rockBias: 0, palette: [0x6fa03c, 0x86b83f, 0xb3b04a], species: [0, 1, 0], thermalOdds: 1, scenicBonus: 0.1 },
  woodland: { heightAmplitude: 60, heightOffset: 100, forestDensity: 0.92, treeDensity: 2.5, crownScale: 1.5,
    rockBias: 0.02, palette: [0x1f5a34, 0x2e7a3e, 0x5c9443, 0x7fae45, 0x2f6b3a], species: [0.3, 0.6, 0.1], thermalOdds: 1.6, scenicBonus: 0.2 },
  moor: { heightAmplitude: 60, heightOffset: 150, forestDensity: 0.02, treeDensity: 1, crownScale: 0.85,
    rockBias: 0.12, palette: [0x8a5a8c, 0xb06fa6, 0xb0763a, 0xa6a25a], species: [0.2, 0.6, 0.2], thermalOdds: 1.2, scenicBonus: 0.25 },
} satisfies Record<'hills' | 'woodland' | 'moor', BiomeProfile>;

export const transition = (threshold: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - threshold + 0.06) / 0.12));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Ordered allocation, never independent masks: each rule consumes only the remainder. */
export function biomeWeights(relief: number, climate: number, elevation: number, hillsField: number): BiomeWeights {
  const highlands = transition(0.55, relief);
  const lakeland = 0;
  const hillsClaim = (1 - highlands) * transition(BIOME_SELECTION.hillsThreshold, hillsField);
  const woodland = (1 - highlands - hillsClaim) * transition(BIOME_SELECTION.woodlandThreshold, climate);
  const moor = (1 - highlands - hillsClaim - woodland) * transition(0.6, elevation / 150);
  return { hills: 1 - highlands - woodland - moor, woodland, moor, highlands, lakeland };
}

/** Reserved biome weights use today's neutral values, not a speculative future profile. */
export function blendParameter(weights: BiomeWeights, key: 'forestDensity' | 'treeDensity' | 'crownScale' | 'rockBias' | 'thermalOdds' | 'scenicBonus', fallback: number): number {
  return weights.hills * BIOME_PROFILES.hills[key] + weights.woodland * BIOME_PROFILES.woodland[key]
    + weights.moor * BIOME_PROFILES.moor[key] + (weights.highlands + weights.lakeland) * fallback;
}
