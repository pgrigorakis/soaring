import { MAP_LEGEND, drawBird, drawLegend, drawScaleBar, drawTrail, paintBiomes, trailStyle, type MapView, type MapWorld } from './biome-map';
import type { Trail } from './trail';

/** Export size in pixels. The biome raster is half that and drawn up; text and trail stay sharp. */
const EXPORT = 1200;
const RASTER = 600;
const SLICE_MS = 8;
const LEGEND_ROWS = MAP_LEGEND.length + 1;
export type MapExtent = 'trail' | 40000 | 120000;

/**
 * Full biome map of the current world around the bird's path, with legend, scale bar and
 * PNG export. Painting runs in 8 ms slices while the panel is open.
 */
export class MapPanel {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly status: HTMLElement;
  private job: Generator<number, void> | null = null;
  private finish: (() => void) | null = null;
  private extent: MapExtent = 'trail';
  private bird = { x: 0, z: 0, heading: 0 };
  /** Resolves once the current picture is complete, so an export never saves a half-painted map. */
  ready: Promise<void> = Promise.resolve();

  constructor(private readonly world: MapWorld, private readonly trail: Trail) {
    this.element = document.createElement('section');
    this.element.className = 'map-panel';
    this.element.setAttribute('aria-label', 'Biome map');
    this.element.innerHTML = `
      <div class="map-card">
        <header>
          <h1>Biome map</h1>
          <div class="map-extent" role="group" aria-label="Map extent">
            <button type="button" data-extent="trail" aria-pressed="true">Trail</button>
            <button type="button" data-extent="40000" aria-pressed="false">40 km</button>
            <button type="button" data-extent="120000" aria-pressed="false">120 km</button>
          </div>
          <button type="button" class="map-export">Export PNG</button>
          <button type="button" class="map-close" aria-label="Close map">✕</button>
        </header>
        <canvas width="${EXPORT}" height="${EXPORT}"></canvas>
        <p class="map-status" role="status"></p>
      </div>`;
    this.canvas = this.element.querySelector('canvas')!;
    this.status = this.element.querySelector('.map-status')!;
    this.element.querySelector('.map-close')!.addEventListener('click', () => this.close());
    this.element.querySelector('.map-export')!.addEventListener('click', () => void this.download());
    this.element.addEventListener('click', (event) => { if (event.target === this.element) this.close(); });
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-extent]'))
      button.addEventListener('click', () => {
        const value = button.dataset.extent!;
        this.open(value === 'trail' ? 'trail' : (Number(value) as MapExtent), this.bird);
      });
  }

  get isOpen(): boolean { return this.element.classList.contains('open'); }

  open(extent: MapExtent, bird: { x: number; z: number; heading: number }): Promise<void> {
    this.extent = extent;
    this.bird = { ...bird };
    this.element.classList.add('open');
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-extent]'))
      button.setAttribute('aria-pressed', String(button.dataset.extent === String(extent)));
    const view = this.view();
    const raster = document.createElement('canvas');
    raster.width = raster.height = RASTER;
    const image = new ImageData(RASTER, RASTER);
    const coverage: Record<string, number> = {};
    const rasterView = { ...view, width: RASTER, height: RASTER, metresPerPixel: view.metresPerPixel * (EXPORT / RASTER) };
    this.job = paintBiomes(this.world, rasterView, image, coverage);
    delete this.element.dataset.ready;
    this.ready = new Promise((resolve) => {
      this.finish = () => {
        raster.getContext('2d')!.putImageData(image, 0, 0);
        this.compose(raster, view, coverage);
        this.element.dataset.ready = 'true';
        resolve();
      };
    });
    return this.ready;
  }

  close(): void {
    this.element.classList.remove('open');
    this.job = null;
  }

  /** Advance painting by one slice; call every frame. */
  update(): void {
    if (!this.job) return;
    const start = performance.now();
    let progress = 0;
    while (performance.now() - start < SLICE_MS) {
      const step = this.job.next();
      if (step.done) {
        this.job = null;
        this.status.textContent = '';
        this.finish?.();
        return;
      }
      progress = step.value;
    }
    this.status.textContent = `Surveying the land… ${Math.round(progress * 100)}%`;
  }

  /** North-up square that fits the trail with a margin, or a fixed width around the bird. */
  private view(): MapView {
    let centreX = this.bird.x, centreZ = this.bird.z, width = typeof this.extent === 'number' ? this.extent : 0;
    const bounds = this.trail.bounds();
    if (this.extent === 'trail') {
      if (bounds) {
        centreX = (bounds.minX + bounds.maxX) / 2;
        centreZ = (bounds.minZ + bounds.maxZ) / 2;
        // A wide margin keeps the trail clear of the corner title, keys and scale.
        width = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 1.4;
      }
      width = Math.max(16000, width);
    }
    return { centreX, centreZ, metresPerPixel: width / EXPORT, width: EXPORT, height: EXPORT };
  }

  private compose(raster: HTMLCanvasElement, view: MapView, coverage: Record<string, number>): void {
    const context = this.canvas.getContext('2d')!;
    const s = EXPORT / 600;
    context.imageSmoothingQuality = 'high';
    context.drawImage(raster, 0, 0, EXPORT, EXPORT);
    drawTrail(context, view, this.trail, s);
    // Title block, legend and scale: the exported image must read on its own.
    context.save();
    context.fillStyle = 'rgba(22, 32, 29, 0.78)';
    context.beginPath();
    context.roundRect(14 * s, 14 * s, 236 * s, 50 * s, 8 * s);
    context.fill();
    context.fillStyle = '#f4efe1';
    context.font = `500 ${16 * s}px Georgia, serif`;
    context.fillText('Soaring · biome map', 26 * s, 36 * s);
    context.font = `500 ${10 * s}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = 'rgba(244, 239, 225, 0.75)';
    const width = view.metresPerPixel * EXPORT;
    context.fillText(`World ${this.world.seed} · ${(width / 1000).toFixed(0)} × ${(width / 1000).toFixed(0)} km · north up`, 26 * s, 54 * s);
    context.restore();
    drawLegend(context, 14 * s, EXPORT - LEGEND_ROWS * 19 * s - 26 * s, s, coverage);
    this.drawTrailKey(context, s);
    context.save();
    context.fillStyle = 'rgba(22, 32, 29, 0.78)';
    context.beginPath();
    context.roundRect(EXPORT - 214 * s, EXPORT - 46 * s, 200 * s, 32 * s, 8 * s);
    context.fill();
    context.restore();
    drawScaleBar(context, view, EXPORT - 196 * s, EXPORT - 22 * s, 160 * s, s);
    // The bird goes last, so no key ever hides where it is now.
    drawBird(context, EXPORT / 2 + (this.bird.x - view.centreX) / view.metresPerPixel,
      EXPORT / 2 + (this.bird.z - view.centreZ) / view.metresPerPixel, this.bird.heading, 8 * s);
  }

  private drawTrailKey(context: CanvasRenderingContext2D, s: number): void {
    const rows = ['Today', 'Yesterday', '2 days ago', '3 days ago'].map((label, day) => [trailStyle(day).colour, label] as const);
    const x = EXPORT - 134 * s, y = 14 * s;
    context.save();
    context.fillStyle = 'rgba(22, 32, 29, 0.78)';
    context.beginPath();
    context.roundRect(x, y, 120 * s, (rows.length * 18 + 30) * s, 8 * s);
    context.fill();
    context.font = `600 ${10 * s}px Inter, ui-sans-serif, system-ui, sans-serif`;
    context.fillStyle = 'rgba(244, 239, 225, 0.75)';
    context.fillText('Flight trail', x + 10 * s, y + 17 * s);
    context.font = `500 ${11 * s}px Inter, ui-sans-serif, system-ui, sans-serif`;
    rows.forEach(([colour, label], index) => {
      const cy = y + (34 + index * 18) * s;
      context.strokeStyle = colour;
      context.lineWidth = 3 * s;
      context.beginPath();
      context.moveTo(x + 10 * s, cy);
      context.lineTo(x + 30 * s, cy);
      context.stroke();
      context.fillStyle = '#f4efe1';
      context.fillText(label, x + 38 * s, cy + 4 * s);
    });
    context.restore();
  }

  toBlob(): Promise<Blob | null> {
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }

  private async download(): Promise<void> {
    await this.ready;
    const blob = await this.toBlob();
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `soaring-biomes-${this.world.seed}-${this.extent === 'trail' ? 'trail' : `${Number(this.extent) / 1000}km`}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
}
