import { describe, expect, it } from 'vitest';
import { AuroraSchedule, DAY_SECONDS, auroraAmount, daylight, type Vec3 } from '../src/sky-cycle';

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

describe('seeded aurora schedule', () => {
  it('keeps aurora nights at least three cycles apart and repeats for the same seed', () => {
    const first = new AuroraSchedule(1234);
    const nights = Array.from({ length: 500 }, (_, cycle) => first.hasAurora(cycle));
    const auroraCycles = nights.flatMap((aurora, cycle) => aurora ? [cycle] : []);

    expect(auroraCycles.length).toBeGreaterThan(0);
    for (let index = 1; index < auroraCycles.length; index += 1) {
      expect(auroraCycles[index]! - auroraCycles[index - 1]!).toBeGreaterThanOrEqual(3);
    }
    const repeat = new AuroraSchedule(1234);
    expect(Array.from({ length: 500 }, (_, cycle) => repeat.hasAurora(cycle))).toEqual(nights);
  });

  it('fades auroras through the night and never shows them during daylight', () => {
    const schedule = new AuroraSchedule(1234);
    const cycle = Array.from({ length: 500 }, (_, day) => day).find((day) => schedule.hasAurora(day));
    expect(cycle).toBeDefined();

    for (let step = 0; step <= 200; step += 1) {
      const phase = step / 200;
      const body = daylight((cycle! + phase) * DAY_SECONDS);
      const amount = auroraAmount(body, true);
      if (body.sun.y >= 0) expect(amount).toBe(0);
      if (phase === 0.5) expect(amount).toBe(0);
    }
    expect(auroraAmount(daylight(cycle! * DAY_SECONDS), true)).toBeGreaterThan(0);
    expect(auroraAmount(daylight((cycle! + 0.75) * DAY_SECONDS), true)).toBe(0);
    expect(auroraAmount(daylight(cycle! * DAY_SECONDS), false)).toBe(0);
  });
});

describe('world clock sun and moon', () => {
  it('maps a 15-minute day onto opposite world-fixed bodies', () => {
    expect(DAY_SECONDS).toBe(15 * 60);
    const midnight = daylight(0);
    const dawn = daylight(DAY_SECONDS * 0.25);
    const noon = daylight(DAY_SECONDS * 0.5);
    const dusk = daylight(DAY_SECONDS * 0.75);

    for (const body of [midnight, dawn, noon, dusk]) {
      expect(Math.hypot(body.sun.x, body.sun.y, body.sun.z)).toBeCloseTo(1, 6);
      expect(Math.hypot(body.moon.x, body.moon.y, body.moon.z)).toBeCloseTo(1, 6);
      expect(dot(body.sun, body.moon)).toBeCloseTo(-1, 6);
      expect(body.moon).toEqual({ x: -body.sun.x, y: -body.sun.y, z: -body.sun.z });
    }

    expect(midnight.phase).toBe(0);
    expect(midnight.sun.y).toBeLessThan(0);
    expect(midnight.moon.y).toBeGreaterThan(0.25);
    expect(midnight.dominant).toBe('moon');
    expect(midnight.sunIntensity).toBe(0);
    expect(midnight.moonIntensity).toBeGreaterThan(0.5);
    expect(midnight.moonColor.b).toBeGreaterThan(midnight.moonColor.r);

    expect(dawn.phase).toBeCloseTo(0.25, 6);
    expect(dawn.sun.y).toBeCloseTo(0, 6);
    expect(dawn.sun.x).toBeGreaterThan(0.9);
    expect(dawn.sunIntensity).toBeCloseTo(0, 6);
    expect(dawn.moonIntensity).toBeCloseTo(0, 6);
    expect(dawn.dominant).toBe('sun');

    expect(noon.sun.y).toBeGreaterThan(0.25);
    expect(noon.moon.y).toBeLessThan(-0.25);
    expect(noon.dominant).toBe('sun');
    expect(noon.moonIntensity).toBe(0);
    expect(noon.sunIntensity).toBeGreaterThan(3);
    expect(noon.sunColor.r).toBeGreaterThanOrEqual(noon.sunColor.g);

    expect(dusk.sun.y).toBeCloseTo(0, 6);
    expect(dusk.sun.x).toBeLessThan(-0.9);
    expect(dot(dusk.sun, dawn.sun)).toBeCloseTo(-1, 6);

    expect(daylight(DAY_SECONDS).phase).toBeCloseTo(0, 6);
    expect(daylight(DAY_SECONDS).sun).toEqual(midnight.sun);
    expect(daylight(-DAY_SECONDS * 0.5).phase).toBeCloseTo(0.5, 6);
    expect(daylight(DAY_SECONDS * 2.5).sun).toEqual(noon.sun);
  });

  it('keeps both bodies dark on the horizon so the shadow caster can switch without a pop', () => {
    for (const phase of [0.25, 0.75]) {
      const at = daylight(DAY_SECONDS * phase);
      expect(at.sunIntensity).toBeCloseTo(0, 6);
      expect(at.moonIntensity).toBeCloseTo(0, 6);
      const before = daylight(DAY_SECONDS * phase - 1);
      const after = daylight(DAY_SECONDS * phase + 1);
      expect(Math.max(before.sunIntensity, before.moonIntensity)).toBeLessThan(0.05);
      expect(Math.max(after.sunIntensity, after.moonIntensity)).toBeLessThan(0.05);
      expect(before.dominant).not.toBe(after.dominant);
    }
  });
});
