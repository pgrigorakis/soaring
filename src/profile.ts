import type * as THREE from 'three';

const MAX_OPEN_QUERIES = 8;
const GPU_DISJOINT = 0x8fbb;

/** Raw per-frame record. Latency and active work are separate fields. */
export interface FrameSample {
  /** requestAnimationFrame timestamp gap to the previous frame: cadence, includes idle waiting. */
  intervalMs: number;
  /** Synchronous time inside the frame callback: main-thread active work, excludes GPU execution. */
  workMs: number;
  /** Part of workMs spent inside renderer.render (command submission, not GPU execution). */
  renderMs: number;
  rendered: boolean;
  calls: number;
  triangles: number;
  /** Frame index the GPU time belongs to; null until its query resolves. */
  gpuMs: number | null;
}

export interface ProfileReport {
  samples: FrameSample[];
  gpu: { status: 'available' | 'unavailable'; reason: string | null; valid: number; discardedDisjoint: number; discardedInvalid: number; skipped: number };
  openQueries: number;
  createdQueries: number;
  deletedQueries: number;
}

interface OpenQuery { query: WebGLQuery; sample: FrameSample; window: number }

/**
 * Dev-only frame profiler. It records frame cadence, callback time, draw calls and triangles for
 * every frame, and GPU time through EXT_disjoint_timer_query_webgl2 when the browser offers it.
 * Query results are polled on later frames; the profiler never blocks on the GPU.
 */
export class FrameProfiler {
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly open: OpenQuery[] = [];
  private activeQuery: OpenQuery | null = null;
  private samples: FrameSample[] = [];
  private recording = false;
  private window = 0;
  private lastFrameStart: number | null = null;
  private frameStart = 0;
  private renderStart = 0;
  private current: FrameSample | null = null;
  private valid = 0;
  private discardedDisjoint = 0;
  private discardedInvalid = 0;
  private skipped = 0;
  private created = 0;
  private deleted = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }

  /** Start a new recording window and forget earlier samples. Open queries finish into discarded samples. */
  begin(): void {
    this.samples = [];
    this.valid = 0;
    this.discardedDisjoint = 0;
    this.discardedInvalid = 0;
    this.skipped = 0;
    this.window += 1;
    this.recording = true;
  }

  end(): void {
    this.recording = false;
    this.lastFrameStart = null;
  }

  frameBegin(now: number): void {
    this.frameStart = performance.now();
    this.pollQueries();
    if (!this.recording) { this.current = null; return; }
    this.current = { intervalMs: this.lastFrameStart === null ? 0 : now - this.lastFrameStart, workMs: 0, renderMs: 0,
      rendered: false, calls: 0, triangles: 0, gpuMs: null };
    this.lastFrameStart = now;
  }

  renderBegin(): void {
    this.renderStart = performance.now();
    if (!this.ext || !this.current) return;
    if (this.open.length >= MAX_OPEN_QUERIES) { this.skipped += 1; return; }
    const query = this.gl.createQuery();
    this.created += 1;
    this.activeQuery = { query, sample: this.current, window: this.window };
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
  }

  /** Read renderer.info right after the render: it resets at the start of the next render. */
  renderEnd(): void {
    if (this.ext && this.activeQuery) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.open.push(this.activeQuery);
      this.activeQuery = null;
    }
    const sample = this.current;
    if (!sample) return;
    sample.renderMs = performance.now() - this.renderStart;
    sample.rendered = true;
    sample.calls = this.renderer.info.render.calls;
    sample.triangles = this.renderer.info.render.triangles;
  }

  frameEnd(): void {
    const sample = this.current;
    if (!sample) return;
    sample.workMs = performance.now() - this.frameStart;
    this.samples.push(sample);
    this.current = null;
  }

  report(): ProfileReport {
    this.pollQueries();
    const reason = this.ext === null ? 'EXT_disjoint_timer_query_webgl2 extension is not exposed by this browser or GPU'
      : this.valid === 0 && this.discardedDisjoint > 0 ? 'every GPU timing was discarded after a disjoint event'
      : this.valid === 0 ? 'no GPU timing has resolved yet' : null;
    return {
      samples: this.samples.map((sample) => ({ ...sample })),
      gpu: { status: this.ext !== null && this.valid > 0 ? 'available' : 'unavailable', reason, valid: this.valid,
        discardedDisjoint: this.discardedDisjoint, discardedInvalid: this.discardedInvalid, skipped: this.skipped },
      openQueries: this.open.length + (this.activeQuery ? 1 : 0),
      createdQueries: this.created,
      deletedQueries: this.deleted,
    };
  }

  dispose(): void {
    for (const entry of this.open.splice(0)) this.deleteQuery(entry);
    if (this.activeQuery) { this.gl.endQuery(this.ext!.TIME_ELAPSED_EXT); this.deleteQuery(this.activeQuery); this.activeQuery = null; }
  }

  private pollQueries(): void {
    if (!this.ext || this.open.length === 0) return;
    // A disjoint event (power change, context reset) makes every outstanding result unreliable.
    if (this.gl.getParameter(GPU_DISJOINT)) {
      for (const entry of this.open.splice(0)) { if (entry.window === this.window) this.discardedDisjoint += 1; this.deleteQuery(entry); }
      return;
    }
    while (this.open.length > 0) {
      const entry = this.open[0]!;
      if (!this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT_AVAILABLE)) break;
      const nanoseconds = Number(this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT));
      this.open.shift();
      if (entry.window !== this.window) { /* belongs to an earlier recording */ }
      else if (Number.isFinite(nanoseconds) && nanoseconds > 0) { entry.sample.gpuMs = nanoseconds / 1e6; this.valid += 1; }
      else this.discardedInvalid += 1;
      this.deleteQuery(entry);
    }
  }

  private deleteQuery(entry: OpenQuery): void {
    this.gl.deleteQuery(entry.query);
    this.deleted += 1;
  }
}
