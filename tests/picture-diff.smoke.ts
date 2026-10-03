import { expect, test } from '@playwright/test';
import { comparePictures, validateCompatibility, type Picture } from '../scripts/picture-diff';

const picture = (pixels: number[], overrides: Partial<Picture> = {}): Picture => ({
  width: 2, height: 1, pixels: new Uint8Array(pixels),
  environment: { browser: 'Chromium 154', renderer: 'ANGLE Metal', viewport: [2, 1], devicePixelRatio: 1, pixelRatio: 1, machine: 'M4 Pro', os: 'Darwin 27', arch: 'arm64', headless: true },
  build: { commit: 'abc123', dirty: false },
  ...overrides,
});

test('picture diff reports exact changed-pixel statistics', async () => {
  const baseline = picture([10, 20, 30, 255, 40, 50, 60, 255]);
  const changed = picture([10, 20, 30, 255, 44, 50, 68, 255]);
  expect(comparePictures(baseline, changed)).toEqual({
    meanDifference: 2,
    changedPixelShare: 0.5,
    worstPixel: { x: 1, y: 0, difference: 8, before: [40, 50, 60], after: [44, 50, 68] },
  });
});

test('picture diff refuses dimensions and environment mismatches', async () => {
  const baseline = picture([10, 20, 30, 255, 40, 50, 60, 255]);
  expect(() => validateCompatibility(baseline, picture([10, 20, 30, 255], { width: 1 }))).toThrow(/dimension/i);
  expect(() => validateCompatibility(baseline, picture([10, 20, 30, 255, 40, 50, 60, 255], {
    environment: { ...baseline.environment, renderer: 'other' },
  }))).toThrow(/environment mismatch.*renderer/i);
});
