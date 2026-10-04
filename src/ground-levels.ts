import * as THREE from 'three';
import { type LandscapeSample, WorldModel } from './world';

// Fixed GPU-displaced grids over toroidal CPU sample windows, adapted from Fly-with-me
// (https://github.com/kunchenguid/fly-with-me at aca247b487ffafa5696cce143f108a71a24a7950).
// Copyright (c) 2026 Kun Chen, MIT licence. See THIRD_PARTY_NOTICES.md.

/** Writes the linear ground colour for one world sample. */
export type GroundPaint = (sample: LandscapeSample, x: number, z: number, normal: THREE.Vector3, target: THREE.Color) => void;

// Every level shares one published centre, snapped to the coarsest spacing. Each coarser level's
// hole is the next finer level's extent, so the levels meet exactly and never leave a gap.
// Each level is split into square tiles of `tile` cells, so three.js can frustum-cull them.
const LEVELS = [
  { step: 9, extent: 1440, tile: 40 },
  { step: 18, extent: 4500, tile: 50 },
  { step: 90, extent: 7200, tile: 40 },
] as const;
const SNAP = 90;
// The published centre moves at most this far at once. Each window keeps a matching margin,
// so refilling toward the next centre never overwrites a texel the current centre displays.
const MAX_MOVE = SNAP;
// A cold refill of the finest level shows this central half-size first.
const CORE = 720;
// Ring width, in cells, as a level grows toward its wanted radius between moves.
const GROW = 10;
// Height of texels not filled yet. Fully hazed, far below the camera, never against the sky.
const UNFILLED = -20_000;
const SKIRT_DEPTH = 140;

function geometry(positions: number[], indices: number[]): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setIndex(indices);
  return result;
}

/** One tile of a grid centred on its local origin, without the cells inside the square hole. */
function tileGeometry(cells: number, step: number, hole: number, x0: number, z0: number, size: number): THREE.BufferGeometry | null {
  const half = cells / 2;
  const side = size + 1;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let z = 0; z <= size; z++) for (let x = 0; x <= size; x++) positions.push((x0 + x - half) * step, 0, (z0 + z - half) * step);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      if (Math.abs(x0 + x + 0.5 - half) < hole && Math.abs(z0 + z + 0.5 - half) < hole) continue;
      const a = z * side + x;
      // The same diagonal as the CPU chunk mesh.
      indices.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
    }
  }
  return indices.length ? geometry(positions, indices) : null;
}

/**
 * The camera is always inside the finer level. Where the finer edge lies below this coarser edge,
 * the crack between them faces the camera; an inward-facing skirt below the coarser hole edge hides it.
 */
function skirtGeometry(step: number, hole: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const skirt = (points: [number, number][], flip: boolean) => {
    points.forEach(([x, z], i) => {
      const top = positions.length / 3;
      positions.push(x * step, 0, z * step, x * step, -SKIRT_DEPTH, z * step);
      if (i === 0) return;
      const [previous, previousBottom, bottom] = [top - 2, top - 1, top + 1];
      if (flip) indices.push(previous, previousBottom, top, top, previousBottom, bottom);
      else indices.push(previous, top, previousBottom, top, bottom, previousBottom);
    });
  };
  const line = (point: (i: number) => [number, number]) => Array.from({ length: 2 * hole + 1 }, (_, i) => point(i - hole));
  skirt(line((i) => [i, -hole]), true);
  skirt(line((i) => [i, hole]), false);
  skirt(line((i) => [-hole, i]), false);
  skirt(line((i) => [hole, i]), true);
  return geometry(positions, indices);
}

/** A linear channel as an 8-bit sRGB value. */
function srgb8(linear: number): number {
  const c = THREE.MathUtils.clamp(linear, 0, 1);
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
}

function dataTexture(data: Float32Array, size: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

type Line = { column: boolean; index: number; lo: number; samples: LandscapeSample[] };

/** One fixed grid. Texel (x mod size, z mod size) always holds world cell (x, z) of its window. */
class Level {
  readonly mesh = new THREE.Group();
  private readonly tiles: { mesh: THREE.Mesh; x0: number; z0: number; size: number }[] = [];
  private readonly cells: number;
  readonly step: number;
  readonly extent: number;
  private readonly size: number;
  // One texel per point: height, normal x and z, and the sRGB colour packed into one exact float.
  // One fetch per vertex keeps software renderers fast.
  private readonly ground: Float32Array;
  private readonly groundTexture: THREE.DataTexture;
  private readonly offset = { value: new THREE.Vector2() };
  private readonly validUniform = { value: 0 };
  private readonly normal = new THREE.Vector3();
  private readonly color = new THREE.Color();
  // A refill first covers this half-size, in cells; the square then grows in rings toward `wanted`.
  private readonly first: number;
  // The window centre, in cells. Once `filled`, the square of half-size `radius` cells around it,
  // plus the move margin, holds valid texels. The outermost level a reach needs keeps only what that
  // reach needs; every other level grows to its whole extent.
  private centerX = 0;
  private centerZ = 0;
  private filled = false;
  private radius = 0;
  wanted = 0;
  private job: Generator<void> | null = null;
  private ahead: Line | null = null;
  // The cell behind each texel, so placement tiles can reuse its height. Only the finest level keeps
  // whole samples, for near tiles: keeping them in every level slows each garbage collection.
  private readonly samples: (LandscapeSample | undefined)[] | null;
  private readonly sampleX: Int32Array;
  private readonly sampleZ: Int32Array;
  private dirty = false;
  private shownX = Number.NaN;
  private shownZ = Number.NaN;
  private shownFilled = false;
  private shownRadius = 0;

  constructor(private readonly world: WorldModel, private readonly paint: GroundPaint,
    level: (typeof LEVELS)[number], hole: number, baseMaterial: THREE.MeshStandardMaterial) {
    this.step = level.step;
    this.extent = level.extent;
    // Nearby ground appears first; a coarser level starts just past the finer level it surrounds.
    this.first = (hole === 0 ? CORE : hole + SNAP) / level.step;
    const cells = level.extent * 2 / level.step;
    this.size = cells + 2 * (MAX_MOVE / level.step + 1);
    this.ground = new Float32Array(this.size * this.size * 4);
    this.samples = hole === 0 ? new Array(this.size * this.size) : null;
    this.sampleX =new Int32Array(this.size * this.size).fill(2 ** 31 - 1);
    this.sampleZ = new Int32Array(this.size * this.size);
    this.clearGround();
    this.groundTexture = dataTexture(this.ground, this.size);
    const uniforms = {
      groundField: { value: this.groundTexture },
      groundFieldSize: { value: this.size }, groundStep: { value: level.step }, groundOffset: this.offset, groundValid: this.validUniform,
    };
    const declarations = `uniform sampler2D groundField;
uniform float groundFieldSize;
uniform float groundStep;
uniform vec2 groundOffset;
uniform float groundValid;
varying vec3 vGroundColor;
ivec2 groundTexel() { return ivec2( mod( floor( position.xz / groundStep + 0.5 ) + groundOffset, groundFieldSize ) ); }`;
    const displace = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${declarations}`)
        .replace('#include <beginnormal_vertex>', `#define GROUND_SAMPLED
vec4 groundSample = texelFetch( groundField, groundTexel(), 0 );
vec3 objectNormal = vec3( groundSample.y, sqrt( max( 0.0, 1.0 - dot( groundSample.yz, groundSample.yz ) ) ), groundSample.z );`)
        .replace('#include <begin_vertex>', `// The depth material has no normal stage, so it fetches here.
#ifndef GROUND_SAMPLED
vec4 groundSample = texelFetch( groundField, groundTexel(), 0 );
#endif
vec3 transformed = vec3( position.x, position.y + groundSample.x, position.z );
// Texels outside the valid square may hold another cell's data: sink them, as never-filled texels are.
if ( max( abs( position.x ), abs( position.z ) ) > groundValid ) transformed.y = ${UNFILLED.toFixed(1)};
vec3 groundSRGB = vec3( floor( groundSample.w / 65536.0 ), mod( floor( groundSample.w / 256.0 ), 256.0 ), mod( groundSample.w, 256.0 ) ) / 255.0;
vGroundColor = mix( groundSRGB / 12.92, pow( ( groundSRGB + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, groundSRGB ) );`);
    };
    const material = baseMaterial.clone();
    material.vertexColors = false;
    material.onBeforeCompile = (shader, renderer) => {
      baseMaterial.onBeforeCompile(shader, renderer);
      displace(shader);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundColor;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGroundColor;');
    };
    material.customProgramCacheKey = () => 'soaring-ground-level';
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = displace;
    depth.customProgramCacheKey = () => 'soaring-ground-level-depth';
    this.cells = cells;
    this.mesh.name = `ground ${level.step} m`;
    this.mesh.visible = false;
    const holeCells = hole / level.step;
    for (let z0 = 0; z0 < cells; z0 += level.tile) {
      for (let x0 = 0; x0 < cells; x0 += level.tile) {
        const tile = tileGeometry(cells, level.step, holeCells, x0, z0, level.tile);
        if (!tile) continue;
        // The flat grid's bounds would cull displaced ground; updateBounds() uses the displayed heights.
        tile.boundingSphere = new THREE.Sphere();
        const mesh = new THREE.Mesh(tile, material);
        // Only the finest level reaches the 600 m shadow camera.
        mesh.castShadow = hole === 0;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = depth;
        this.mesh.add(mesh);
        this.tiles.push({ mesh, x0, z0, size: level.tile });
      }
    }
    if (holeCells > 0) {
      const skirt = new THREE.Mesh(skirtGeometry(level.step, holeCells), material);
      skirt.frustumCulled = false;
      skirt.receiveShadow = true;
      this.mesh.add(skirt);
    }
  }

  /**
   * Tile bounding spheres from the displayed heights, so culling sees the GPU-displaced surface.
   * Tiles wholly outside the valid square only hold sunk texels and are not drawn.
   */
  private updateBounds(): void {
    const half = this.cells / 2;
    const originX = this.shownX / this.step - half;
    const originZ = this.shownZ / this.step - half;
    const valid = Math.floor(this.validExtent / this.step);
    const lo = Math.max(0, half - valid);
    const hi = Math.min(this.cells, half + valid);
    for (const { mesh, x0, z0, size } of this.tiles) {
      let low = Infinity;
      let high = -Infinity;
      for (let z = Math.max(z0, lo); z <= Math.min(z0 + size, hi); z++) {
        const row = this.wrap(originZ + z) * this.size;
        for (let x = Math.max(x0, lo); x <= Math.min(x0 + size, hi); x++) {
          const height = this.ground[(row + this.wrap(originX + x)) * 4]!;
          if (height <= UNFILLED) continue;
          low = Math.min(low, height);
          high = Math.max(high, height);
        }
      }
      // A tile without one valid texel is sunk and fully hazed: it has nothing to draw.
      mesh.visible = low <= high;
      if (!mesh.visible) continue;
      mesh.geometry.boundingSphere!.center.set((x0 + size / 2 - half) * this.step, (low + high) / 2, (z0 + size / 2 - half) * this.step);
      mesh.geometry.boundingSphere!.radius = Math.hypot(size * this.step / Math.SQRT2, (high - low) / 2) + this.step;
    }
  }

  get shown(): boolean { return this.mesh.visible; }
  get busy(): boolean { return this.job !== null; }

  get complete(): boolean { return this.filled; }
  /** Complete and valid over its whole extent, so a coarser level may surround it. */
  get full(): boolean { return this.shownFilled && this.shownRadius * this.step === this.extent; }
  /** Complete at the radius the current reach wants. */
  get settled(): boolean { return this.shownFilled && this.shownRadius >= this.wanted; }
  get cellsHalf(): number { return this.cells / 2; }
  get state(): string {
    return `${this.step}m:${this.shown ? 'shown' : 'hidden'}${this.filled ? '' : '/filling'}${this.job ? '/busy' : ''} r${this.shownRadius}/${this.radius}/${this.wanted}`;
  }

  /** True when the window is complete, idle and centred on this world position. */
  isAt(x: number, z: number): boolean {
    return this.filled && !this.job && this.centerX * this.step === x && this.centerZ * this.step === z;
  }

  /**
   * Half-size, in metres around the displayed centre, of the ground shown as valid. A level kept at
   * a smaller radius loses one move of it, because its window centre can lead the displayed one.
   */
  get validExtent(): number {
    if (!this.shownFilled) return 0;
    return this.shownRadius === this.cells / 2 ? this.extent : this.shownRadius * this.step - MAX_MOVE;
  }

  /**
   * True when every texel displayed around (x, z) is valid. A move refills only the line its
   * window leaves behind, which stays outside the displayed area within MAX_MOVE of the centre.
   */
  covers(x: number, z: number): boolean {
    const margin = MAX_MOVE / this.step;
    return this.filled && Math.abs(this.centerX - x / this.step) <= margin && Math.abs(this.centerZ - z / this.step) <= margin;
  }

  /** The height this level holds for cell (x, z), if any. Samples are deterministic, so an old window's height is still exact. */
  heightAt(x: number, z: number): number | undefined {
    const cell = this.wrap(z) * this.size + this.wrap(x);
    return this.sampleX[cell] === x && this.sampleZ[cell] === z ? this.ground[cell * 4] : undefined;
  }

  /** The world sample this level keeps for cell (x, z), if any. */
  sampleAt(x: number, z: number): LandscapeSample | undefined {
    const cell = this.wrap(z) * this.size + this.wrap(x);
    return this.sampleX[cell] === x && this.sampleZ[cell] === z ? this.samples?.[cell] : undefined;
  }

  private wrap(value: number): number { return ((value % this.size) + this.size) % this.size; }

  /** Never-filled texels: far below any ground, facing up, so they cannot reach the sky or yield NaN light. */
  private clearGround(): void {
    for (let i = 0; i < this.ground.length; i += 4) {
      this.ground[i] = UNFILLED;
      this.ground[i + 1] = 0;
      this.ground[i + 2] = 0;
      this.ground[i + 3] = 0;
    }
    this.dirty = true;
  }

  private *sampleLine(column: boolean, index: number, lo: number, count: number): Generator<void, LandscapeSample[]> {
    const samples: LandscapeSample[] = [];
    for (let i = 0; i < count + 2; i++) {
      const along = (lo - 1 + i) * this.step;
      const across = index * this.step;
      samples.push(column ? this.world.sample(across, along) : this.world.sample(along, across));
      if (i % 8 === 7) yield;
    }
    return samples;
  }

  /**
   * Fills `count` texels of one row or column, from `lo`, while the window advances in `direction`.
   * Each world point is sampled once in steady motion: the line ahead is kept for the next call.
   */
  private *fillLine(column: boolean, index: number, direction: 1 | -1, behindValid: boolean,
    lo: number, count: number): Generator<void> {
    const cached = this.ahead;
    const own = cached && cached.column === column && cached.index === index && cached.lo === lo && cached.samples.length === count + 2
      ? cached.samples : yield* this.sampleLine(column, index, lo, count);
    const next = yield* this.sampleLine(column, index + direction, lo, count);
    const behind = behindValid ? null : yield* this.sampleLine(column, index - direction, lo, count);
    for (let i = 1; i <= count; i++) {
      const along = lo + i - 1;
      const x = column ? index : along;
      const z = column ? along : index;
      const behindHeight = behind ? behind[i]!.height
        : this.ground[(column ? this.wrap(z) * this.size + this.wrap(x - direction) : this.wrap(z - direction) * this.size + this.wrap(x)) * 4]!;
      const across = direction > 0 ? behindHeight - next[i]!.height : next[i]!.height - behindHeight;
      const lengthwise = own[i - 1]!.height - own[i + 1]!.height;
      this.normal.set(column ? across : lengthwise, this.step * 2, column ? lengthwise : across).normalize();
      const sample = own[i]!;
      this.paint(sample, x * this.step, z * this.step, this.normal, this.color);
      const cell = this.wrap(z) * this.size + this.wrap(x);
      if (this.samples) this.samples[cell] = sample;
      this.sampleX[cell] = x;
      this.sampleZ[cell] = z;
      const texel = cell * 4;
      this.ground[texel] = sample.height;
      this.ground[texel + 1] = this.normal.x;
      this.ground[texel + 2] = this.normal.z;
      this.ground[texel + 3] = srgb8(this.color.r) * 65536 + srgb8(this.color.g) * 256 + srgb8(this.color.b);
      if (i % 16 === 0) yield;
    }
    this.ahead = { column, index: index + direction, lo, samples: next };
    this.dirty = true;
  }

  /** Fills rows of the square of half-size `radius` plus the move margin around the current centre. */
  private *fillSquare(radius: number): Generator<void> {
    const half = radius + MAX_MOVE / this.step + 1;
    for (let row = this.centerZ - half; row < this.centerZ + half; row++) {
      yield* this.fillLine(false, row, 1, row > this.centerZ - half, this.centerX - half, half * 2);
    }
  }

  private *refill(x: number, z: number, radius: number): Generator<void> {
    this.filled = false;
    this.centerX = x;
    this.centerZ = z;
    yield* this.fillSquare(radius);
    this.radius = radius;
    this.filled = true;
  }

  /** Extends the valid square by one ring of at most GROW cells, filling only the new ring. */
  private *grow(): Generator<void> {
    const margin = MAX_MOVE / this.step + 1;
    const radius = Math.min(this.wanted, this.radius + GROW);
    const inner = this.radius + margin;
    const outer = radius + margin;
    const x = this.centerX;
    const z = this.centerZ;
    for (let row = z - outer; row < z - inner; row++) yield* this.fillLine(false, row, 1, row > z - outer, x - outer, outer * 2);
    for (let row = z + inner; row < z + outer; row++) yield* this.fillLine(false, row, 1, row > z + inner, x - outer, outer * 2);
    for (let column = x - outer; column < x - inner; column++) yield* this.fillLine(true, column, 1, column > x - outer, z - inner, inner * 2);
    for (let column = x + inner; column < x + outer; column++) yield* this.fillLine(true, column, 1, column > x + inner, z - inner, inner * 2);
    this.radius = radius;
  }

  // Fly-with-me's incremental recentring: each step refills the line the window leaves behind.
  private *move(x: number, z: number): Generator<void> {
    const half = this.radius + MAX_MOVE / this.step + 1;
    while (this.centerX !== x) {
      const direction = x > this.centerX ? 1 : -1;
      const next = this.centerX + direction;
      yield* this.fillLine(true, direction > 0 ? next + half - 1 : next - half, direction, true, this.centerZ - half, half * 2);
      this.centerX = next;
    }
    while (this.centerZ !== z) {
      const direction = z > this.centerZ ? 1 : -1;
      const next = this.centerZ + direction;
      yield* this.fillLine(false, direction > 0 ? next + half - 1 : next - half, direction, true, this.centerX - half, half * 2);
      this.centerZ = next;
    }
  }

  /** Works toward a window centred on world position (x, z) until the deadline. */
  update(x: number, z: number, deadline: number): void {
    if (!this.job && this.filled && this.wanted < this.radius) this.radius = this.wanted;
    if (!this.job) {
      const cx = x / this.step;
      const cz = z / this.step;
      const far = Math.max(Math.abs(cx - this.centerX), Math.abs(cz - this.centerZ)) >= this.size;
      // Following the camera comes before growing, so the displayed ground stays centred.
      if (!this.filled || far) this.job = this.refill(cx, cz, Math.min(this.wanted, this.first));
      else if (!this.isAt(x, z)) this.job = this.move(cx, cz);
      else if (this.radius < this.wanted) this.job = this.grow();
    }
    while (this.job && performance.now() < deadline) {
      if (this.job.next().done) this.job = null;
    }
  }

  /** Displays the window around world position (x, z). Texture uploads happen only when the displayed area changes. */
  show(x: number, z: number): void {
    this.mesh.visible = true;
    const moved = x !== this.shownX || z !== this.shownZ;
    if (moved) {
      this.shownX = x;
      this.shownZ = z;
      this.offset.value.set(this.wrap(x / this.step), this.wrap(z / this.step));
      this.mesh.position.set(x, 0, z);
    }
    // Growth is displayed every few rings, or once the wanted radius is reached, to bound uploads.
    const grown = this.radius !== this.shownRadius && (this.radius >= this.wanted || this.radius - this.shownRadius >= 4 * GROW);
    if (moved || this.filled !== this.shownFilled || grown) {
      if (this.dirty) this.groundTexture.needsUpdate = true;
      this.dirty = false;
      this.shownFilled = this.filled;
      this.shownRadius = this.radius;
      this.validUniform.value = this.validExtent + 0.5;
      this.updateBounds();
    }
  }

  hide(): void {
    this.mesh.visible = false;
    this.shownX = this.shownZ = Number.NaN;
    this.shownFilled = false;
    this.shownRadius = 0;
  }

  /** Forgets the window, for teleports. */
  reset(): void {
    this.hide();
    this.job?.return(undefined);
    this.job = null;
    this.filled = false;
    this.radius = 0;
    this.ahead = null;
  }

  dispose(): void {
    this.reset();
    this.mesh.removeFromParent();
    const tile = this.tiles[0]!.mesh;
    (tile.material as THREE.Material).dispose();
    tile.customDepthMaterial!.dispose();
    this.mesh.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    this.groundTexture.dispose();
  }
}

/**
 * The visible ground, as in Fly-with-me: fixed grids that read heights, normals and colours from
 * CPU sample windows. A coarser level is shown only with every finer level, and fog follows the
 * shown levels alone, so pending water or tree tiles can never hide land that is already drawn.
 */
export class GroundLevels {
  private readonly levels: Level[] = [];
  private publishedX = 0;
  private publishedZ = 0;
  private targetX = Number.NaN;
  private targetZ = Number.NaN;

  constructor(private readonly scene: THREE.Object3D, private readonly world: WorldModel,
    private readonly paint: GroundPaint, private readonly material: THREE.MeshStandardMaterial) {}

  /** Levels needed so that the reach stays covered while the centre trails the camera by one move. */
  private required(reach: number): number {
    const index = LEVELS.findIndex((level) => level.extent >= reach + MAX_MOVE + SNAP);
    return index < 0 ? LEVELS.length : index + 1;
  }

  update(x: number, z: number, reach: number, deadline: number): void {
    const count = this.required(reach);
    for (let i = this.levels.length; i < count; i++) {
      const level = new Level(this.world, this.paint, LEVELS[i]!, i > 0 ? LEVELS[i - 1]!.extent : 0, this.material);
      this.levels.push(level);
      this.scene.add(level.mesh);
    }
    // The target follows the camera in whole snaps, with hysteresis at snap boundaries.
    if (!(Math.abs(x - this.targetX) <= SNAP && Math.abs(z - this.targetZ) <= SNAP)) {
      this.targetX = Math.round(x / SNAP) * SNAP;
      this.targetZ = Math.round(z / SNAP) * SNAP;
    }
    const finest = this.levels[0]!;
    const lag = Math.max(Math.abs(this.targetX - this.publishedX), Math.abs(this.targetZ - this.publishedZ));
    // A camera jump beyond the finest level cannot reuse displayed or filling ground: refill from scratch.
    if (lag > LEVELS[0].extent) for (const level of this.levels) level.reset();
    // With nothing displayed, a first fill stays where it began. Chasing a moving camera would
    // leave every finished fill off-centre, and nothing would ever appear.
    if (!finest.shown && !finest.busy) {
      this.publishedX = this.targetX;
      this.publishedZ = this.targetZ;
    }
    const step = (target: number, published: number) => finest.shown ? published + THREE.MathUtils.clamp(target - published, -MAX_MOVE, MAX_MOVE) : published;
    const nextX = step(this.targetX, this.publishedX);
    const nextZ = step(this.targetZ, this.publishedZ);
    // Finer levels first: the ground near the camera matters most.
    for (let i = 0; i < count; i++) {
      const level = this.levels[i]!;
      // Coverage must reach past the camera's offset from the centre, up to one move and one snap.
      level.wanted = i < count - 1 ? level.cellsHalf : Math.min(level.cellsHalf, Math.ceil((reach + 2 * MAX_MOVE + SNAP) / level.step) + 1);
      level.update(nextX, nextZ, deadline);
    }
    const shown = this.levels.slice(0, count).filter((level) => level.shown);
    if (shown.length && (nextX !== this.publishedX || nextZ !== this.publishedZ) && shown.every((level) => level.isAt(nextX, nextZ))) {
      this.publishedX = nextX;
      this.publishedZ = nextZ;
    }
    // A level appears once it is valid at the published centre, and only around every complete finer level.
    let finerComplete = true;
    this.levels.forEach((level, i) => {
      const x = this.publishedX;
      const z = this.publishedZ;
      const visible = finerComplete && i < count && (level.shown ? level.covers(x, z) : level.isAt(x, z));
      if (visible) level.show(x, z);
      else level.hide();
      finerComplete = visible && level.full;
    });
  }

  /** Horizontal distance around (x, z) that displayed ground covers, capped by the reach. */
  coveredDistance(x: number, z: number, reach: number): number {
    const offset = Math.max(Math.abs(x - this.publishedX), Math.abs(z - this.publishedZ));
    let covered = 0;
    for (const level of this.levels) {
      if (!level.shown) break;
      covered = Math.max(covered, level.validExtent - offset - level.step);
      if (!level.full) break;
    }
    return THREE.MathUtils.clamp(covered, 0, reach);
  }

  /** The finest level's world sample at (x, z), when it holds one; near tiles then skip sampling it again. */
  sampleAt(x: number, z: number): LandscapeSample | undefined {
    const step = LEVELS[0].step;
    return x % step === 0 && z % step === 0 ? this.levels[0]?.sampleAt(x / step, z / step) : undefined;
  }

  /** A level's terrain height at (x, z), when one holds it; placement tiles then skip sampling it again. */
  heightAt(x: number, z: number): number | undefined {
    for (const level of this.levels) {
      const height = x % level.step === 0 && z % level.step === 0 ? level.heightAt(x / level.step, z / level.step) : undefined;
      if (height !== undefined) return height;
    }
    return undefined;
  }

  /** Levels the reach needs that are not yet displayed in full. A displayed level that is only recentring is loaded. */
  pending(reach: number): number {
    return this.levels.slice(0, this.required(reach)).filter((level) => !level.shown || !level.settled).length;
  }

  /** True while any level the reach needs has refill or recentring work. */
  working(reach: number): boolean {
    return this.levels.slice(0, this.required(reach)).some((level) => !level.shown || level.busy);
  }

  /** True when the displayed centre trails the camera by more than one move, so the ground needs the whole budget. */
  get lagging(): boolean {
    return this.levels[0]?.shown === true
      && Math.max(Math.abs(this.targetX - this.publishedX), Math.abs(this.targetZ - this.publishedZ)) > MAX_MOVE;
  }

  /** Per-level state, for diagnostics. */
  get state(): string {
    return this.levels.map((level) => level.state).join(' ');
  }

  reset(): void {
    for (const level of this.levels) level.reset();
    this.targetX = this.targetZ = Number.NaN;
  }

  dispose(): void {
    for (const level of this.levels) level.dispose();
    this.levels.length = 0;
  }
}
