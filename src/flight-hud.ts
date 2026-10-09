const SVG_NS = 'http://www.w3.org/2000/svg';
const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const normalise = (degrees: number): number => ((degrees % 360) + 360) % 360;

/** A field compass and local flight height. Navigation stays in world coordinates. */
export class FlightHud {
  readonly element = document.createElement('section');
  private readonly track = document.createElementNS(SVG_NS, 'g');
  private readonly bearingOutput: HTMLOutputElement;
  private readonly heightOutput: HTMLOutputElement;
  private readonly ticks: { group: SVGGElement; line: SVGLineElement; text: SVGTextElement }[];
  private bearing: number | null = null;
  private drawnBearing: number | null = null;
  private drawnBase: number | null = null;
  private heightAge = 0;
  private height: number | null = null;

  constructor() {
    this.element.className = 'flight-hud';
    this.element.setAttribute('aria-label', 'Flight height and bearing');
    this.element.innerHTML = `
      <div class="flight-compass">
        <svg height="53" aria-hidden="true"></svg>
        <span class="flight-centre" aria-hidden="true">▾</span>
      </div>
      <output class="flight-bearing" aria-label="Eagle bearing" aria-live="off"></output>
      <div class="flight-height-medallion">
        <output class="flight-height" aria-label="Flight height" aria-live="off"></output>
        <span>above ground</span>
      </div>`;
    this.track.classList.add('flight-compass-track');
    this.element.querySelector('svg')!.append(this.track);
    this.bearingOutput = this.element.querySelector('.flight-bearing')!;
    this.heightOutput = this.element.querySelector('.flight-height')!;
    // CSS places fixed ticks responsively; only their labels change at 5° crossings.
    this.ticks = Array.from({ length: 37 }, (_, index) => {
      const group = document.createElementNS(SVG_NS, 'g');
      group.style.setProperty('--compass-tick-angle', String((index - 18) * 5));
      const line = document.createElementNS(SVG_NS, 'line');
      const text = document.createElementNS(SVG_NS, 'text');
      line.setAttribute('y1', '31');
      text.setAttribute('y', '24');
      text.setAttribute('text-anchor', 'middle');
      group.append(line, text);
      this.track.append(group);
      return { group, line, text };
    });
  }

  /** Height is above terrain on land and above the surface over water. Delta is real time. */
  update(heading: number, height: number, delta: number): void {
    // The north-up map draws heading 0 (+z) south; positive pi/2 (+x) is east.
    const target = normalise(180 - heading * 180 / Math.PI);
    this.bearing ??= target;
    const turn = ((target - this.bearing) % 360 + 540) % 360 - 180;
    // Finish imperceptible easing, so a held view can stop repainting the instrument.
    this.bearing = Math.abs(turn) < 0.0001 ? target : normalise(this.bearing + turn * (1 - Math.exp(-delta * 12)));
    if (this.bearing !== this.drawnBearing) {
      const base = Math.floor(this.bearing / 5) * 5;
      // Resize and DPR changes need no JavaScript work or relabelling.
      if (base !== this.drawnBase) {
        for (const [index, { group, line, text }] of this.ticks.entries()) {
          const bearing = normalise(base + (index - 18) * 5);
          const cardinal = bearing % 45 === 0;
          group.setAttribute('class', cardinal ? 'major' : bearing % 15 === 0 ? 'medium' : 'minor');
          line.setAttribute('y2', String(cardinal ? 49 : bearing % 15 === 0 ? 44 : 38));
          text.textContent = cardinal ? CARDINALS[bearing / 45]! : '';
        }
      }
      this.track.style.setProperty('--compass-course-offset', String(base - this.bearing));
      const label = `${String(Math.round(this.bearing) % 360).padStart(3, '0')}°`;
      if (this.bearingOutput.value !== label) this.bearingOutput.value = label;
      this.element.dataset.bearing = String(this.bearing);
      this.drawnBearing = this.bearing;
      this.drawnBase = base;
    }

    this.heightAge += delta;
    if (this.height === null || (this.heightAge >= 0.5 && Math.abs(height - this.height) > 1)) {
      this.height = Math.round(height);
      this.heightOutput.value = `${this.height} m`;
      this.heightAge = 0;
    }
  }
}
