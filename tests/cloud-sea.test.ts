import { describe, expect, it } from 'vitest';
import { FLIGHT_HEIGHT_LIMITS } from '../src/eagle';
import {
  MIST_MAX_RISE,
  MORNING_MIST_FADE_SECONDS,
  MORNING_MIST_FULL_SECONDS,
  mistCover,
  morningMistAmount,
} from '../src/cloud-sea';
import { DAY_SECONDS } from '../src/sky-cycle';

describe('morning mist window', () => {
  const dawn = 0.25;
  const fullEnd = dawn + MORNING_MIST_FULL_SECONDS / DAY_SECONDS;
  const fadeEnd = fullEnd + MORNING_MIST_FADE_SECONDS / DAY_SECONDS;

  it('holds full cover from dawn for three minutes, then fades over one minute', () => {
    expect(MORNING_MIST_FULL_SECONDS).toBe(180);
    expect(MORNING_MIST_FADE_SECONDS).toBe(60);
    expect(morningMistAmount(dawn - 0.001)).toBe(0);
    expect(morningMistAmount(dawn)).toBe(1);
    expect(morningMistAmount(fullEnd)).toBe(1);
    expect(morningMistAmount((fullEnd + fadeEnd) / 2)).toBeCloseTo(0.5, 5);
    expect(morningMistAmount(fadeEnd)).toBe(0);
    expect(morningMistAmount(0.5)).toBeGreaterThan(0);
    expect(morningMistAmount(0.55)).toBe(0);
    expect(morningMistAmount(0)).toBe(0);
    expect(morningMistAmount(0.75)).toBe(0);
    expect(morningMistAmount(dawn + 1)).toBe(1);
    expect(morningMistAmount(Number.NaN)).toBe(0);
  });
});

describe('morning mist cover', () => {
  it('is dense over water and wet ground, and absent over dry ground', () => {
    expect(mistCover({ water: true, moisture: 0.2, bank: -40 })).toBe(1);
    expect(mistCover({ water: false, moisture: 0.4, bank: -2 })).toBe(1);
    expect(mistCover({ water: false, moisture: 0.9, bank: 400 })).toBeGreaterThan(0.9);
    expect(mistCover({ water: false, moisture: 0.5, bank: 20 })).toBeGreaterThan(0.7);
    expect(mistCover({ water: false, moisture: 0.19, bank: 1100 })).toBe(0);
    expect(mistCover({ water: false, moisture: 0.45, bank: 800 })).toBe(0);
  });

  it('stays below the eagle', () => {
    expect(MIST_MAX_RISE).toBeLessThan(FLIGHT_HEIGHT_LIMITS.min);
  });
});
