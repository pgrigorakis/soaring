export interface PictureEnvironment {
  browser: string;
  renderer: string;
  viewport: [number, number];
  devicePixelRatio: number;
  pixelRatio: number;
  machine: string;
  os: string;
  arch: string;
  headless: boolean;
}

export interface Picture {
  width: number;
  height: number;
  pixels: Uint8Array;
  environment: PictureEnvironment;
  build: { commit: string; dirty: boolean };
}

export interface PictureDiff {
  meanDifference: number;
  changedPixelShare: number;
  worstPixel: { x: number; y: number; difference: number; before: number[]; after: number[] };
}

export function validateCompatibility(before: Picture, after: Picture): void {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(`Picture dimension mismatch: ${before.width}x${before.height} vs ${after.width}x${after.height}`);
  }
  for (const key of ['browser', 'renderer', 'viewport', 'devicePixelRatio', 'pixelRatio', 'machine', 'os', 'arch', 'headless'] as const) {
    if (JSON.stringify(before.environment[key]) !== JSON.stringify(after.environment[key])) {
      throw new Error(`Picture environment mismatch for ${key}: ${JSON.stringify(before.environment[key])} vs ${JSON.stringify(after.environment[key])}`);
    }
  }
  const expected = before.width * before.height * 4;
  if (before.pixels.length !== expected || after.pixels.length !== expected) {
    throw new Error(`Picture pixel data mismatch: expected ${expected} RGBA bytes`);
  }
}

export function comparePictures(before: Picture, after: Picture): PictureDiff {
  validateCompatibility(before, after);
  let total = 0;
  let changed = 0;
  let worst = { x: 0, y: 0, difference: 0, before: [0, 0, 0], after: [0, 0, 0] };
  const pixels = before.width * before.height;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    let pixelChanged = false;
    let pixelDifference = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const a = before.pixels[offset + channel]!;
      const b = after.pixels[offset + channel]!;
      const difference = Math.abs(a - b);
      total += difference;
      pixelDifference = Math.max(pixelDifference, difference);
      pixelChanged ||= difference !== 0;
    }
    if (pixelChanged) changed += 1;
    if (pixelDifference > worst.difference) {
      worst = {
        x: index % before.width,
        y: Math.floor(index / before.width),
        difference: pixelDifference,
        before: Array.from(before.pixels.slice(offset, offset + 3)),
        after: Array.from(after.pixels.slice(offset, offset + 3)),
      };
    }
  }
  return { meanDifference: total / (pixels * 3), changedPixelShare: changed / pixels, worstPixel: worst };
}
