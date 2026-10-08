import type { Page } from '@playwright/test';

declare global {
  interface Window { __screen?: { width: number; height: number; data: Uint8ClampedArray } }
}

/** Captures scene pixels without the flight HUD, then decodes them into window.__screen. */
export async function captureScreen(page: Page, path: string): Promise<void> {
  const shot = await page.screenshot({ path, style: '.flight-hud { visibility: hidden !important; }' });
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
