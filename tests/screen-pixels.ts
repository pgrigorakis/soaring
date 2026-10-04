import type { Page } from '@playwright/test';

declare global {
  interface Window { __screen?: { width: number; height: number; data: Uint8ClampedArray } }
}

/** Saves a screenshot and decodes it into window.__screen, so measures run in the page beside the pixels. */
export async function captureScreen(page: Page, path: string): Promise<void> {
  const shot = await page.screenshot({ path });
  await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const context = new OffscreenCanvas(image.width, image.height).getContext('2d')!;
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
    window.__screen = { data, width, height };
  }, shot.toString('base64'));
}
