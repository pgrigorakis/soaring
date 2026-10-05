import { drawBird, drawScaleBar, drawTrail, paintBiomes, type MapView, type MapWorld } from './biome-map';
import type { Trail } from './trail';

/** Visible map width per zoom step. 70 km holds a typical four-day trail (55–60 km net drift). */
export const MINIMAP_ZOOMS = [6000, 20000, 70000] as const;
const SIZE = 184;
const RASTER = 288;
/** The raster spans this many view widths, so a rebuild can finish before the bird reaches its edge. */
const COVER = 1.6;
const SLICE_MS = 1.5;
/** Larger budget while part of the map would show no land (load, jump, zoom out), so it fills in quickly. */
const HURRY_SLICE_MS = 5;
const REDRAW_SECONDS = 0.1;

/**
 * North-up map of the land around the bird with its four-day trail, in the lower-right
 * corner. The biome raster covers 1.6 view widths and is rebuilt in small slices before
 * the bird reaches its edge, so the map never blocks a frame. A click steps the zoom.
 */
export class Minimap {
  readonly element: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private zoom = 0;
  private raster = document.createElement('canvas');
  private rasterView: MapView | null = null;
  private pending: { view: MapView; image: ImageData; job: Generator<number, void> } | null = null;
  private stale = false;
  private sinceDraw = Infinity;
  private readonly scale = Math.min(2, devicePixelRatio || 1);

  constructor(private readonly world: MapWorld, private readonly trail: Trail) {
    this.element = document.createElement('canvas');
    this.element.className = 'minimap';
    this.element.width = this.element.height = SIZE * this.scale;
    this.element.title = 'Click to zoom · M for the full biome map';
    this.element.setAttribute('role', 'img');
    this.element.setAttribute('aria-label', 'Map of the land around the eagle and its flight over the last four days');
    this.context = this.element.getContext('2d')!;
    this.raster.width = this.raster.height = RASTER;
    this.element.addEventListener('click', () => {
      // Keep showing the old raster, scaled, until the new zoom's raster is ready.
      this.zoom = (this.zoom + 1) % MINIMAP_ZOOMS.length;
      this.pending = null;
      this.stale = true;
      this.sinceDraw = Infinity;
      this.element.dataset.zoom = String(this.width);
    });
    this.element.dataset.zoom = String(this.width);
  }

  get width(): number { return MINIMAP_ZOOMS[this.zoom]!; }

  update(x: number, z: number, heading: number, delta: number): void {
    // `data-ready` tells tests and captures that the visible square shows land everywhere.
    const ready = String(this.updateRaster(x, z));
    if (this.element.dataset.ready !== ready) this.element.dataset.ready = ready;
    this.sinceDraw += delta;
    if (this.sinceDraw < REDRAW_SECONDS) return;
    this.sinceDraw = 0;
    this.draw(x, z, heading);
  }

  /** Paints one slice of the next raster when needed; returns whether the raster covers the visible square. */
  private updateRaster(x: number, z: number): boolean {
    const width = this.width;
    const drift = (): number => this.rasterView
      ? Math.max(Math.abs(x - this.rasterView.centreX), Math.abs(z - this.rasterView.centreZ)) : Infinity;
    const covers = (): boolean => !!this.rasterView && (this.rasterView.width * this.rasterView.metresPerPixel) / 2 - drift() >= width / 2;
    if (!this.pending && (this.stale || drift() > width * 0.15)) {
      this.stale = false;
      // Snap the centre to a grid so a rebuilt raster lines up with the trail exactly.
      const step = width / 16;
      const view = { centreX: Math.round(x / step) * step, centreZ: Math.round(z / step) * step,
        metresPerPixel: (COVER * width) / RASTER, width: RASTER, height: RASTER };
      const image = new ImageData(RASTER, RASTER);
      this.pending = { view, image, job: paintBiomes(this.world, view, image) };
    }
    if (!this.pending) return covers();
    // Hurry only while the visible square sticks out of the current raster.
    const budget = covers() ? SLICE_MS : HURRY_SLICE_MS;
    const start = performance.now();
    while (performance.now() - start < budget) {
      if (!this.pending.job.next().done) continue;
      this.raster.getContext('2d')!.putImageData(this.pending.image, 0, 0);
      this.rasterView = this.pending.view;
      this.pending = null;
      this.sinceDraw = Infinity;
      break;
    }
    return covers();
  }

  private draw(x: number, z: number, heading: number): void {
    const context = this.context;
    const s = this.scale;
    const size = SIZE * s;
    const view: MapView = { centreX: x, centreZ: z, metresPerPixel: this.width / size, width: size, height: size };
    context.save();
    context.clearRect(0, 0, size, size);
    context.beginPath();
    context.roundRect(0, 0, size, size, 14 * s);
    context.clip();
    context.fillStyle = '#4c6a5c';
    context.fillRect(0, 0, size, size);
    const raster = this.rasterView;
    if (raster) {
      const pixels = (raster.width * raster.metresPerPixel) / view.metresPerPixel;
      const left = size / 2 + (raster.centreX - x) / view.metresPerPixel - pixels / 2;
      const top = size / 2 + (raster.centreZ - z) / view.metresPerPixel - pixels / 2;
      context.imageSmoothingQuality = 'high';
      context.drawImage(this.raster, left, top, pixels, pixels);
    }
    drawTrail(context, view, this.trail, s * 0.85);
    drawBird(context, size / 2, size / 2, heading, 7 * s);
    // A soft band keeps the caption readable over pale Highlands.
    const band = context.createLinearGradient(0, 0, 0, 34 * s);
    band.addColorStop(0, 'rgba(16, 24, 21, 0.55)');
    band.addColorStop(1, 'rgba(16, 24, 21, 0)');
    context.fillStyle = band;
    context.fillRect(0, 0, size, 34 * s);
    context.restore();
    this.drawNorth();
    drawScaleBar(context, view, 12 * s, size - 12 * s, size * 0.38, s);
    this.drawCaption();
  }

  private drawNorth(): void {
    const context = this.context;
    const s = this.scale;
    const x = (SIZE - 15) * s, y = 15 * s;
    context.save();
    context.font = `700 ${10 * s}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(22, 32, 29, 0.7)';
    context.beginPath();
    context.arc(x, y, 8 * s, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#fbf6e8';
    context.fillText('N', x, y + 0.5 * s);
    context.restore();
  }

  private drawCaption(): void {
    const context = this.context;
    const s = this.scale;
    const label = `Day ${Math.floor(this.trail.days) + 1} · ${(this.trail.distanceToday() / 1000).toFixed(1)} km today`;
    context.save();
    context.font = `600 ${10 * s}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.textBaseline = 'top';
    context.fillStyle = '#fbf6e8';
    context.shadowColor = 'rgba(0,0,0,.65)';
    context.shadowBlur = 3 * s;
    context.fillText(label, 12 * s, 10 * s);
    context.restore();
  }
}
