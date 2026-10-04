/** One world clock. A full day is 15 minutes of real time, not simulation time. */
export const DAY_SECONDS = 15 * 60;

/** Peak elevation. High enough for a clear noon sky, and off zenith so shadows stay stable. */
const MAX_ELEVATION = 52 * Math.PI / 180;
const SUN_PEAK_INTENSITY = 3.6;
const MOON_PEAK_INTENSITY = 1.7;
const AURORA_PROBABILITY = 0.2;
/** The moon falls a full turn behind the sun every 8 game days, so it rises later and changes phase each night. */
export const LUNAR_DAYS = 8;
/** The first dusk after a new game (day 0.75) has a full moon rising opposite the sun. */
const FULL_MOON_DAY = 0.75;

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
  /** Lit fraction of the moon's face, (1 + cos α) / 2 for the phase angle α: 1 opposite the sun, 0 beside it. */
  moonLit: number;
  /** Sunlight on the moon's face: toward the sun in the sky, at the orbital angle from the moon. */
  moonSunlight: Vec3;
  /** The lit fraction once the sun has set. Moonlight, its glint and its halo scale by this. */
  moonShine: number;
  sunColor: RGB;
  moonColor: RGB;
  /** 0 in daylight, 1 once the sun is well below the horizon. */
  night: number;
  /**
   * Shadow caster: the sun while it is up, else the moon. The sun is dark on the
   * horizon and moonlight waits for the sun to set, so the switch does not pop.
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

/** A point on the world-fixed arc. Angle 0 is the lowest point, under the north horizon. */
function arcPoint(angle: number): Vec3 {
  const elevation = -Math.cos(angle) * MAX_ELEVATION;
  const horizontal = Math.cos(elevation);
  const snap = (value: number) => (Math.abs(value) < 1e-8 ? 0 : value);
  return {
    x: snap(Math.sin(angle) * horizontal),
    y: snap(Math.sin(elevation)),
    z: snap(Math.cos(angle) * horizontal),
  };
}

/**
 * Sun and moon on a world-fixed arc. The arc does not depend on the camera.
 * Phase 0 is midnight. The moon starts opposite the sun and falls behind it
 * by a full turn every LUNAR_DAYS days.
 */
export function daylight(seconds: number): Daylight {
  const phase = wrapPhase(seconds);
  const angle = phase * Math.PI * 2;
  const sun = arcPoint(angle);
  const lag = (seconds / DAY_SECONDS - FULL_MOON_DAY) / LUNAR_DAYS * Math.PI * 2;
  const moon = arcPoint(angle + Math.PI - lag);
  // The arc is not a great circle, so the angle between the two directions wobbles through the day.
  // The phase follows the orbit instead: the phase angle is the lag, and the light leans toward the sun.
  const moonLit = (1 + Math.cos(lag)) / 2;
  const facing = sun.x * moon.x + sun.y * moon.y + sun.z * moon.z;
  const across = { x: sun.x - facing * moon.x, y: sun.y - facing * moon.y, z: sun.z - facing * moon.z };
  const acrossLength = Math.hypot(across.x, across.y, across.z) || 1;
  const toward = Math.abs(Math.sin(lag)) / acrossLength;
  const moonSunlight = {
    x: -Math.cos(lag) * moon.x + toward * across.x,
    y: -Math.cos(lag) * moon.y + toward * across.y,
    z: -Math.cos(lag) * moon.z + toward * across.z,
  };
  const moonShine = moonLit * (1 - smoothstep(-0.1, 0, sun.y));
  const high = smoothstep(0.05, 0.55, sun.y);
  return {
    phase,
    sun,
    moon,
    sunIntensity: directionalIntensity(sun.y, SUN_PEAK_INTENSITY),
    moonIntensity: directionalIntensity(moon.y, MOON_PEAK_INTENSITY) * moonShine,
    moonLit,
    moonSunlight,
    moonShine,
    sunColor: { r: 1, g: 0.56 + high * 0.38, b: 0.26 + high * 0.56 },
    moonColor: { r: 0.62, g: 0.72, b: 1 },
    night: 1 - smoothstep(-0.22, -0.01, sun.y),
    dominant: sun.y >= 0 ? 'sun' : 'moon',
  };
}
