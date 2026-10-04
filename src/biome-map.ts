import type { BiomeKey, BiomeWeights } from './biome';
import { TRAIL_DAYS, type Trail, type TrailPoint } from './trail';

type RGB = readonly [number, number, number];
/** Any world that can be sampled: the live WorldModel or a diagnostic variant of it. */
export type MapWorld = { seed: number; sample(x: number, z: number): { biome: BiomeWeights; water: boolean; height: number } };
/** North is up: world -z is at the top of the image, +x to the right. */
export type MapView = { centreX: number; centreZ: number; metresPerPixel: number; width: number; height: number };

/** Map colours, not ground colours: chosen to separate biomes at a glance. */
export const MAP_LEGEND: readonly { key: BiomeKey; label: string; colour: RGB }[] = [
  { key: 'hills', label: 'Rolling Hills', colour: [168, 196, 98] },
  { key: 'woodland', label: 'Woodland', colour: [52, 112, 62] },
  { key: 'moor', label: 'Moor', colour: [164, 126, 160] },
  { key: 'highlands', label: 'Highlands', colour: [176, 170, 158] },
  { key: 'lakeland', label: 'Lakeland', colour: [96, 178, 160] },
];
const SHALLOW: RGB = [104, 152, 184];
const DEEP: RGB = [44, 82, 124];
export const WATER_LEGEND = { label: 'Sea and lakes', colour: SHALLOW };

export const toPixel = (view: MapView, x: number, z: number): [number, number] => [
  view.width / 2 + (x - view.centreX) / view.metresPerPixel,
  view.height / 2 + (z - view.centreZ) / view.metresPerPixel,
];

/**
 * Paint the biome blend with relief shading into `image`, one row per step, so callers can
 * spread the work over frames. The shading pass runs after the last row.
 */
export function* paintBiomes(world: MapWorld, view: MapView, image: ImageData, coverage?: Record<string, number>): Generator<number, void> {
  const { width, height, metresPerPixel: mpp } = view;
  const heights = new Float32Array(width * height);
  const data = image.data;
  for (let j = 0; j < height; j += 1) {
    const z = view.centreZ + (j + 0.5 - height / 2) * mpp;
    for (let i = 0; i < width; i += 1) {
      const sample = world.sample(view.centreX + (i + 0.5 - width / 2) * mpp, z);
      const offset = (j * width + i) * 4;
      heights[j * width + i] = sample.height;
      let r = 0, g = 0, b = 0;
      if (sample.water) {
        const t = Math.min(1, -sample.height / 50);
        r = SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * t;
        g = SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * t;
        b = SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * t;
        if (coverage) coverage.water = (coverage.water ?? 0) + 1;
      } else {
        for (const { key, colour } of MAP_LEGEND) {
          const weight = sample.biome[key];
          if (coverage) coverage[key] = (coverage[key] ?? 0) + weight;
          r += colour[0] * weight; g += colour[1] * weight; b += colour[2] * weight;
        }
      }
      data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
    }
    yield j / height;
  }
  if (coverage) for (const key of Object.keys(coverage)) coverage[key]! /= width * height;
  // North-west light. Slopes are per metre; the gain keeps hills readable at every scale.
  for (let j = 0; j < height; j += 1)
    for (let i = 0; i < width; i += 1) {
      const index = j * width + i;
      const h = heights[index]!;
      if (h < 0) continue;
      const dx = (heights[j * width + Math.min(width - 1, i + 1)]! - heights[j * width + Math.max(0, i - 1)]!) / (2 * mpp);
      const dz = (heights[Math.min(height - 1, j + 1) * width + i]! - heights[Math.max(0, j - 1) * width + i]!) / (2 * mpp);
      const shade = 1 + Math.max(-0.32, Math.min(0.22, (-dx - dz) * 2.2)) + Math.min(0.08, h / 6000);
      const offset = index * 4;
      for (let c = 0; c < 3; c += 1) data[offset + c] = Math.min(255, data[offset + c]! * shade);
    }
}

/** Trail colour by age: today is warm and bright, older days fade to a thin pale line. */
export function trailStyle(age: number): { colour: string; width: number } {
  const day = Math.max(0, Math.min(TRAIL_DAYS - 1, Math.floor(age)));
  return [
    { colour: 'rgba(255, 236, 170, 0.98)', width: 2.4 },
    { colour: 'rgba(255, 214, 120, 0.78)', width: 1.9 },
    { colour: 'rgba(255, 196, 96, 0.56)', width: 1.5 },
    { colour: 'rgba(255, 182, 80, 0.38)', width: 1.2 },
  ][day]!;
}

export function drawTrail(context: CanvasRenderingContext2D, view: MapView, trail: Trail, scale = 1): void {
  const points = trail.points;
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  // One path per run of same-day points, oldest first so today is on top. A dark
  // under-stroke keeps the line legible on pale land.
  for (const pass of [0, 1]) {
    let day = -1;
    const stroke = () => {
      if (day < 0) return;
      const style = trailStyle(day);
      context.strokeStyle = pass ? style.colour : 'rgba(30, 36, 30, 0.35)';
      context.lineWidth = (style.width + (pass ? 0 : 1.6)) * scale;
      context.stroke();
    };
    let previous: TrailPoint | null = null;
    for (const point of points) {
      const pointDay = Math.min(TRAIL_DAYS - 1, Math.floor(trail.age(point)));
      if (point.gap || pointDay !== day || !previous) {
        stroke();
        day = pointDay;
        context.beginPath();
        const from = previous && !point.gap ? previous : point;
        context.moveTo(...toPixel(view, from.x, from.z));
      }
      context.lineTo(...toPixel(view, point.x, point.z));
      previous = point;
    }
    stroke();
  }
  // Day markers: a ringed dot where each earlier day ended.
  for (let day = 1; day < TRAIL_DAYS; day += 1) {
    if (!points.length || trail.age(points[0]!) < day) continue;
    const at = points.find((point) => trail.age(point) < day)!;
    const [x, y] = toPixel(view, at.x, at.z);
    context.beginPath();
    context.arc(x, y, 2.6 * scale, 0, Math.PI * 2);
    context.fillStyle = 'rgba(40, 32, 20, 0.85)';
    context.fill();
    context.lineWidth = 1.2 * scale;
    context.strokeStyle = 'rgba(255, 236, 170, 0.95)';
    context.stroke();
  }
  context.restore();
}

/** The bird as a small arrow pointing along its heading (0 = +z, drawn south). */
export function drawBird(context: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(Math.PI - heading);
  context.beginPath();
  context.moveTo(0, -size);
  context.lineTo(size * 0.7, size * 0.75);
  context.lineTo(0, size * 0.35);
  context.lineTo(-size * 0.7, size * 0.75);
  context.closePath();
  context.fillStyle = '#fff6dc';
  context.strokeStyle = 'rgba(40, 30, 18, 0.9)';
  context.lineWidth = size * 0.22;
  context.stroke();
  context.fill();
  context.restore();
}

/** The largest 1-2-5 distance that fits in `pixels`. */
export function scaleBarLength(metresPerPixel: number, pixels: number): number {
  const limit = metresPerPixel * pixels;
  let best = 1;
  for (let power = 1; power <= 1e6; power *= 10)
    for (const step of [1, 2, 5]) if (step * power <= limit) best = step * power;
  return best;
}
export const formatDistance = (metres: number): string => (metres >= 1000 ? `${metres / 1000} km` : `${metres} m`);

export function drawScaleBar(context: CanvasRenderingContext2D, view: MapView, x: number, y: number, maxPixels: number, scale = 1): void {
  const metres = scaleBarLength(view.metresPerPixel, maxPixels);
  const pixels = metres / view.metresPerPixel;
  context.save();
  context.font = `600 ${10 * scale}px Inter, ui-sans-serif, system-ui, sans-serif`;
  context.textBaseline = 'bottom';
  context.lineWidth = 3 * scale;
  context.strokeStyle = 'rgba(20, 28, 24, 0.55)';
  context.fillStyle = '#fbf6e8';
  // Alternate halves like a printed map's bar.
  context.fillRect(x, y, pixels, 4 * scale);
  context.fillStyle = 'rgba(20, 28, 24, 0.75)';
  context.fillRect(x + pixels / 2, y, pixels / 2, 4 * scale);
  context.strokeRect(x, y, pixels, 4 * scale);
  context.lineWidth = 1 * scale;
  context.strokeStyle = '#fbf6e8';
  context.strokeRect(x, y, pixels, 4 * scale);
  context.fillStyle = '#fbf6e8';
  context.shadowColor = 'rgba(0,0,0,.6)';
  context.shadowBlur = 3 * scale;
  context.fillText('0', x - 2 * scale, y - 2 * scale);
  context.textAlign = 'right';
  context.fillText(formatDistance(metres), x + pixels + 4 * scale, y - 2 * scale);
  context.restore();
}

export function drawLegend(context: CanvasRenderingContext2D, x: number, y: number, scale = 1, coverage?: Record<string, number>): number {
  const rows = [...MAP_LEGEND.map(({ key, label, colour }) => ({ label, colour, share: coverage?.[key] })),
    { ...WATER_LEGEND, share: coverage?.water }];
  const row = 19 * scale;
  context.save();
  context.fillStyle = 'rgba(22, 32, 29, 0.78)';
  const width = (coverage ? 172 : 132) * scale;
  context.beginPath();
  context.roundRect(x, y, width, row * rows.length + 12 * scale, 8 * scale);
  context.fill();
  context.font = `500 ${11 * scale}px Inter, ui-sans-serif, system-ui, sans-serif`;
  context.textBaseline = 'middle';
  rows.forEach(({ label, colour, share }, index) => {
    const cy = y + 6 * scale + row * (index + 0.5);
    context.fillStyle = `rgb(${colour.join(',')})`;
    context.fillRect(x + 10 * scale, cy - 5 * scale, 14 * scale, 10 * scale);
    context.fillStyle = '#f4efe1';
    context.fillText(label, x + 32 * scale, cy);
    if (share !== undefined) {
      context.textAlign = 'right';
      context.fillStyle = 'rgba(244, 239, 225, 0.7)';
      context.fillText(`${Math.round(share * 100)}%`, x + width - 10 * scale, cy);
      context.textAlign = 'left';
    }
  });
  context.restore();
  return row * rows.length + 12 * scale;
}
