/** FWM's metre offsets scaled to Soaring's existing 600 m puff deck. */
export const CLOUD_HEIGHT_SCALE = 600 / 520;
export const CLOUD_DECK = 600;
export const CLOUD_SURFACE = CLOUD_DECK - 55 * CLOUD_HEIGHT_SCALE;
export const CLOUD_HIGH_CRUISE = CLOUD_DECK + 190 * CLOUD_HEIGHT_SCALE;

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function cloudControls(cameraWorldY: number): { above: number; whiteout: number; bodies: number } {
  const rel = (cameraWorldY - CLOUD_DECK) / CLOUD_HEIGHT_SCALE;
  return {
    above: smoothstep(-90, 30, rel),
    whiteout: 0.996 * (1 - smoothstep(0, 80, Math.abs(rel + 20))),
    bodies: smoothstep(-240, -80, rel),
  };
}
