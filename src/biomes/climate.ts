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
