export type WindVector = { x: number; z: number };

const WIND_SPEED = 3.4;
const DIRECTION_DRIFT_SECONDS = 180;

function directionAt(seed: number, segment: number): number {
  let hash = (Math.imul(segment + 1, 0x9e3779b1) ^ seed) | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296 * Math.PI * 2;
}

/** One deterministic world wind vector, in meters per second, shared by weather and flight. */
export function globalWind(seed: number, worldSeconds: number): WindVector {
  const time = Number.isFinite(worldSeconds) ? worldSeconds : 0;
  const segment = Math.floor(time / DIRECTION_DRIFT_SECONDS);
  const progress = time / DIRECTION_DRIFT_SECONDS - segment;
  const blend = progress * progress * (3 - 2 * progress);
  const from = directionAt(seed, segment);
  const to = directionAt(seed, segment + 1);
  const turn = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const angle = from + turn * blend;
  return { x: Math.cos(angle) * WIND_SPEED, z: Math.sin(angle) * WIND_SPEED };
}
