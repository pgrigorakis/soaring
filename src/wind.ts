import { hash2 } from './world';

/**
 * One global wind for ridge lift. The vector is where the air moves, in m/s.
 * Angle 0 points +x and increases toward +z (cos on x, sin on z), unlike eagle heading.
 * It is driven by simulation time, not the sky clock, so a time-scaled hour cannot spin it.
 */
export type Wind = { x: number; z: number; speed: number; angle: number };

const DEGREE = Math.PI / 180;

export function globalWind(seed: number, seconds: number): Wind {
  const base = hash2(0, 0, seed + 907) * Math.PI * 2;
  const directionPhase = hash2(1, 0, seed + 911) * Math.PI * 2;
  const speedPhase = hash2(2, 0, seed + 919) * Math.PI * 2;
  const speed = 7.2 + 1.4 * Math.sin((2 * Math.PI * seconds) / 1200 + speedPhase);
  const angle = base
    + Math.sin((2 * Math.PI * seconds) / 1500 + directionPhase) * 20 * DEGREE
    + Math.sin((2 * Math.PI * seconds) / 4100 + 0.5 * directionPhase) * 8 * DEGREE;
  return { x: Math.cos(angle) * speed, z: Math.sin(angle) * speed, speed, angle };
}
