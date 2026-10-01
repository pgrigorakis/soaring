/** One world clock. A full day is 15 minutes of real time, not simulation time. */
export const DAY_SECONDS = 15 * 60;

/** Peak elevation. High enough for a clear noon sky, and off zenith so shadows stay stable. */
const MAX_ELEVATION = 52 * Math.PI / 180;
const SUN_PEAK_INTENSITY = 3.6;
const MOON_PEAK_INTENSITY = 1.7;
const AURORA_PROBABILITY = 0.2;

export type Vec3 = { x: number; y: number; z: number };
export type RGB = { r: number; g: number; b: number };

/** Index by dusk so one seeded choice spans sunset, midnight, and dawn. */
export function nightCycle(seconds: number): number {
  return Math.floor(seconds / DAY_SECONDS + 0.25);
}

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

function seededNightValue(seed: number, cycle: number): number {
  let hash = (Math.imul(cycle + 1, 0x9e3779b1) ^ seed) | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}

/** Seeded aurora nights. An aurora blocks the next two complete day/night cycles. */
export class AuroraSchedule {
  private readonly nights: boolean[] = [];

  constructor(private readonly seed: number) {}

  hasAurora(cycle: number): boolean {
    const target = Math.floor(cycle);
    if (!Number.isSafeInteger(target) || target < 0) return false;

    while (this.nights.length <= target) {
      const nextCycle = this.nights.length;
      const coolingDown = this.nights[nextCycle - 1] || this.nights[nextCycle - 2];
      this.nights.push(!coolingDown && seededNightValue(this.seed, nextCycle) < AURORA_PROBABILITY);
    }
    return this.nights[target]!;
  }
}

/** Zero at and below the horizon, so a body can take the shadow light before it contributes. */
function directionalIntensity(elevation: number, peak: number): number {
  if (elevation <= 0) return 0;
  const t = Math.min(1, elevation / Math.sin(MAX_ELEVATION));
  const rise = t * t * (3 - 2 * t);
  return peak * rise;
}

/** Aurora intensity for a scheduled night, with smooth dusk/dawn fades and a strict daylight cutoff. */
export function auroraAmount(body: Daylight, scheduled: boolean): number {
  if (!scheduled || body.night <= 0) return 0;
  const nightProgress = (body.phase >= 0.75 ? body.phase - 0.75 : body.phase + 0.25) * 2;
  const fadeIn = smoothstep(0.04, 0.24, nightProgress);
  const fadeOut = 1 - smoothstep(0.76, 0.96, nightProgress);
  return body.night * fadeIn * fadeOut;
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
