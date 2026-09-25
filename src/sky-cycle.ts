/** One world clock. A full day is 15 minutes of real time, not simulation time. */
export const DAY_SECONDS = 15 * 60;

/** Peak elevation. High enough for a clear noon sky, and off zenith so shadows stay stable. */
const MAX_ELEVATION = 52 * Math.PI / 180;
const SUN_PEAK_INTENSITY = 3.6;
const MOON_PEAK_INTENSITY = 1.7;

export type Vec3 = { x: number; y: number; z: number };
export type RGB = { r: number; g: number; b: number };

export type Daylight = {
  /** 0 midnight, 0.25 dawn, 0.5 noon, 0.75 dusk. */
  phase: number;
  sun: Vec3;
  moon: Vec3;
  sunIntensity: number;
  moonIntensity: number;
  sunColor: RGB;
  moonColor: RGB;
  /** 0 in daylight, 1 once the sun is well below the horizon. */
  night: number;
  /**
   * Shadow caster. Equal elevation keeps the sun, which is only true on the
   * horizon, where both intensities are zero, so the switch does not pop.
   */
  dominant: 'sun' | 'moon';
};

function wrapPhase(seconds: number): number {
  const turns = seconds / DAY_SECONDS;
  return turns - Math.floor(turns);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Zero at and below the horizon, so a body can take the shadow light before it contributes. */
function directionalIntensity(elevation: number, peak: number): number {
  if (elevation <= 0) return 0;
  const t = Math.min(1, elevation / Math.sin(MAX_ELEVATION));
  const rise = t * t * (3 - 2 * t);
  return peak * rise;
}

/**
 * Sun and full moon on opposite sides of a world-fixed arc.
 * The arc does not depend on the camera. Phase 0 is midnight.
 */
export function daylight(seconds: number): Daylight {
  const phase = wrapPhase(seconds);
  const angle = phase * Math.PI * 2;
  const elevation = -Math.cos(angle) * MAX_ELEVATION;
  const azimuth = angle;
  const horizontal = Math.cos(elevation);
  const snap = (value: number) => (Math.abs(value) < 1e-8 ? 0 : value);
  const sun = {
    x: snap(Math.sin(azimuth) * horizontal),
    y: snap(Math.sin(elevation)),
    z: snap(Math.cos(azimuth) * horizontal),
  };
  const moon = { x: -sun.x, y: -sun.y, z: -sun.z };
  const high = smoothstep(0.05, 0.55, sun.y);
  return {
    phase,
    sun,
    moon,
    sunIntensity: directionalIntensity(sun.y, SUN_PEAK_INTENSITY),
    moonIntensity: directionalIntensity(moon.y, MOON_PEAK_INTENSITY),
    sunColor: { r: 1, g: 0.56 + high * 0.38, b: 0.26 + high * 0.56 },
    moonColor: { r: 0.62, g: 0.72, b: 1 },
    night: 1 - smoothstep(-0.22, -0.01, sun.y),
    dominant: sun.y >= moon.y ? 'sun' : 'moon',
  };
}
