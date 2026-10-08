import { DAY_SECONDS } from './sky-cycle';

/** Keep four days of flight. One point every 4 s is about 130 m of cruise. */
export const TRAIL_DAYS = 4;
export const TRAIL_KEY = 'soaring.trail.v1';
const POINT_SECONDS = 4;
const SAVE_SECONDS = 20;

/** `t` is flight time in seconds since the trail began; `gap` starts a new line (a reload moves the bird). */
export type TrailPoint = { x: number; z: number; t: number; gap: boolean };
type Stored = { seed: number; clock: number; points: number[] };

/**
 * World-space flight history for the minimap and the biome map. The clock is flight time,
 * and a day is one sky day (30 minutes) of it. The trail survives reloads in localStorage;
 * a different world seed starts a fresh trail.
 */
export class Trail {
  readonly points: TrailPoint[] = [];
  clock = 0;
  private sinceLast = Infinity;
  private sinceSave = 0;
  private nextIsGap = true;

  constructor(private readonly seed: number, private readonly storage: Storage | null = globalThis.localStorage ?? null) {
    try {
      const stored = JSON.parse(this.storage?.getItem(TRAIL_KEY) ?? 'null') as Stored | null;
      if (!stored || stored.seed !== seed || !Array.isArray(stored.points)) return;
      this.clock = stored.clock;
      for (let index = 0; index + 3 < stored.points.length; index += 4) {
        const [x, z, t, gap] = stored.points.slice(index, index + 4) as [number, number, number, number];
        this.points.push({ x, z, t, gap: gap === 1 });
      }
    } catch {
      this.points.length = 0;
    }
  }

  get days(): number { return this.clock / DAY_SECONDS; }

  /** Advance the flight clock and record the bird's world position at a fixed cadence. */
  tick(x: number, z: number, delta: number): void {
    this.clock += delta;
    this.sinceLast += delta;
    this.sinceSave += delta;
    if (this.sinceLast >= POINT_SECONDS) {
      this.sinceLast = 0;
      this.points.push({ x, z, t: this.clock, gap: this.nextIsGap });
      this.nextIsGap = false;
      const oldest = this.clock - TRAIL_DAYS * DAY_SECONDS;
      let drop = 0;
      while (drop < this.points.length && this.points[drop]!.t < oldest) drop += 1;
      if (drop) {
        this.points.splice(0, drop);
        if (this.points[0]) this.points[0].gap = true;
      }
    }
    if (this.sinceSave >= SAVE_SECONDS) this.save();
  }

  save(): void {
    this.sinceSave = 0;
    const points: number[] = [];
    for (const point of this.points) points.push(Math.round(point.x), Math.round(point.z), Math.round(point.t), point.gap ? 1 : 0);
    try {
      this.storage?.setItem(TRAIL_KEY, JSON.stringify({ seed: this.seed, clock: Math.round(this.clock), points } satisfies Stored));
    } catch {
      // A full storage quota only loses the trail, never the flight.
    }
  }

  /** Age of a point in days, 0 for now. */
  age(point: TrailPoint): number { return (this.clock - point.t) / DAY_SECONDS; }

  /** Path length flown in the last day, without the jumps between reloads. */
  distanceToday(): number {
    let metres = 0;
    for (let index = 1; index < this.points.length; index += 1) {
      const point = this.points[index]!;
      const previous = this.points[index - 1]!;
      if (!point.gap && this.age(point) < 1) metres += Math.hypot(point.x - previous.x, point.z - previous.z);
    }
    return metres;
  }

  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
    if (!this.points.length) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const { x, z } of this.points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return { minX, maxX, minZ, maxZ };
  }
}
