/** Highlands follows the mountain landform and Lakeland the lake field (#93 decisions). */
export const BIOME_SELECTION = {
  reliefWavelength: 18000,
  lakeWavelength: 7000,
  lakeThreshold: 0.75,
} as const;

/**
 * Climate fields, after fly-with-me: moisture at 0.8× and region at 0.9× the
 * temperature scale, all warped about 900 m. Temperature falls by 1 every 2,600 m.
 * Each axis is stretched by 2.2 about its middle before selection. fly-with-me uses
 * 12 km; Gradient noise at that scale gave 3–5 km median spans, so the scale is
 * 28 km to keep #58's 6–10 km targets.
 */
export const CLIMATE = { scale: 28000, warp: 900, lapse: 2600, stretch: 2.2, radius: 0.12, sharpness: 2.2 } as const;

/**
 * [temperature, moisture, region] on the stretched axes. Each point keeps the sense
 * of its nearest fly-with-me biome: Hills is the warm, drier meadow (wildsong), Woodland
 * the moist forest (elderwood), Moor the cool heath (moor). The three points form a
 * triangle around the cooled lowland climate, so no biome is a thin band between two others.
 */
export const BIOME_CLIMATE = {
  hills: [0.56, 0.36, 0.45],
  woodland: [0.42, 0.7, 0.55],
  moor: [0.24, 0.4, 0.4],
} as const satisfies Record<'hills' | 'woodland' | 'moor', readonly [number, number, number]>;

/**
 * Snow and the tree line follow temperature, not a fixed height. Each pair is the
 * temperature at the line's start and end; at a mean climate (0.5) they sit at the
 * former heights: trees thin from 280 m to 320 m, scree at 320–340 m, snow at 380–420 m.
 */
export const CLIMATE_LINES = {
  treeLine: [0.5 - 280 / CLIMATE.lapse, 0.5 - 320 / CLIMATE.lapse],
  scree: [0.5 - 320 / CLIMATE.lapse, 0.5 - 340 / CLIMATE.lapse],
  snow: [0.5 - 380 / CLIMATE.lapse, 0.5 - 420 / CLIMATE.lapse],
} as const;

/** Glade size stays fixed; only the threshold controls how often holes occur. */
export const WOODLAND_GLADES = { wavelength: 300, start: 0.28, end: 0.43 } as const;

export type BiomeWeights = { hills: number; woodland: number; moor: number; highlands: number; lakeland: number };
export type BiomeProfile = {
  forestDensity: number;
  treeDensity: number;
  crownScale: number;
  rockBias: number;
  palette: readonly number[];
  /** conifer, broadleaf, birch */
  species: readonly [number, number, number];
  thermalOdds: number;
  scenicBonus: number;
  /** Scenic weight of a glade edge: open glade and canopy within 170 m of a target. */
  gladeEdgeScenic: number;
  /** Scenic weight of a granite tor on the target. */
  torScenic: number;
};

// Profiles own vegetation and appearance. Continental fields own height.
export const BIOME_PROFILES = {
  hills: { forestDensity: 0.025, treeDensity: 1, crownScale: 1,
    rockBias: 0, palette: [0x6fa03c, 0x86b83f, 0xb3b04a], species: [0, 1, 0], thermalOdds: 1, scenicBonus: 0.1,
    gladeEdgeScenic: 0, torScenic: 0 },
  woodland: { forestDensity: 0.92, treeDensity: 2.5, crownScale: 1.5,
    rockBias: 0.02, palette: [0x1f5a34, 0x2e7a3e, 0x5c9443, 0x7fae45, 0x2f6b3a], species: [0.3, 0.6, 0.1], thermalOdds: 1.6, scenicBonus: 0.2,
    gladeEdgeScenic: 0.5, torScenic: 0 },
  moor: { forestDensity: 0.02, treeDensity: 1, crownScale: 0.85,
    rockBias: 0.12, palette: [0x8a5a8c, 0xb06fa6, 0xb0763a, 0xa6a25a], species: [0.2, 0.6, 0.2], thermalOdds: 1.2, scenicBonus: 0.25,
    gladeEdgeScenic: 0, torScenic: 0.5 },
  lakeland: { forestDensity: 0.55, treeDensity: 1, crownScale: 1,
    rockBias: 0.02, palette: [0x6fa03c, 0x2f6b3a], species: [0.45, 0.35, 0.2], thermalOdds: 1, scenicBonus: 0.3,
    gladeEdgeScenic: 0, torScenic: 0 },
} satisfies Record<'hills' | 'woodland' | 'moor' | 'lakeland', BiomeProfile>;

export const transition = (threshold: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - threshold + 0.06) / 0.12));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const climateAxis = (value: number) => Math.max(0, Math.min(1, (value - 0.5) * CLIMATE.stretch + 0.5));

/**
 * Highlands, then Lakeland, claim their landform and lake territory first. Hills,
 * Woodland and Moor share the remainder by a soft nearest point in climate space.
 */
export function biomeWeights(relief: number, temperature: number, moisture: number, region: number, lakeField = 0): BiomeWeights {
  const highlands = transition(0.55, relief);
  const lakeland = (1 - highlands) * (1 - transition(0.4, relief)) * transition(BIOME_SELECTION.lakeThreshold, lakeField);
  const point = [climateAxis(temperature), climateAxis(moisture), climateAxis(region)];
  const distance = (centre: readonly number[]) =>
    centre.reduce((sum, value, axis) => sum + (point[axis]! - value) ** 2, 0) / CLIMATE.radius ** 2;
  const hills = distance(BIOME_CLIMATE.hills);
  const woodland = distance(BIOME_CLIMATE.woodland);
  const moor = distance(BIOME_CLIMATE.moor);
  // Measured from the nearest point, so the largest term is one and never underflows.
  const nearest = Math.min(hills, woodland, moor);
  const claim = (value: number) => Math.exp(-CLIMATE.sharpness * (value - nearest));
  const remainder = (1 - highlands - lakeland) / (claim(hills) + claim(woodland) + claim(moor));
  const woodlandWeight = claim(woodland) * remainder;
  const moorWeight = claim(moor) * remainder;
  return { hills: Math.max(0, 1 - highlands - lakeland - woodlandWeight - moorWeight), woodland: woodlandWeight, moor: moorWeight, highlands, lakeland };
}

/** Highlands keeps its existing parameters until it receives a full profile. */
export function blendParameter(weights: BiomeWeights, key: 'forestDensity' | 'treeDensity' | 'crownScale' | 'rockBias' | 'thermalOdds' | 'scenicBonus' | 'gladeEdgeScenic' | 'torScenic', fallback: number): number {
  return weights.hills * BIOME_PROFILES.hills[key] + weights.woodland * BIOME_PROFILES.woodland[key]
    + weights.moor * BIOME_PROFILES.moor[key] + weights.lakeland * BIOME_PROFILES.lakeland[key] + weights.highlands * fallback;
}
