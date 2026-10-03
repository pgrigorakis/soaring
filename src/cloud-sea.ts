import * as THREE from 'three';
import { DAY_SECONDS } from './sky-cycle';
import { FLIGHT_HEIGHT_LIMITS } from './eagle';
import type { WorldModel } from './world';

/** Full cover from sunrise until this many seconds later, then a one-minute fade. */
export const MORNING_MIST_FULL_SECONDS = 3 * 60;
export const MORNING_MIST_FADE_SECONDS = 60;

/** Metres of clear air between the ground or water and the first mist. */
export const MIST_CLEARANCE = 2.5;
/** Tallest noise heap above that clearance. The sum stays under the eagle's minimum flight height. */
export const MIST_HEAP = 14;
export const MIST_MAX_RISE = MIST_CLEARANCE + MIST_HEAP;

const FIELD_SIZE = 64;
const FIELD_SPACING = 56;
const FIELD_SPAN = FIELD_SIZE * FIELD_SPACING;
const PLANE_SIZE = 3200;
const PLANE_SEGMENTS = 80;
const NOISE_SCALE = 0.0065;
const HEIGHT_FOG_DENSITY = 0.000085;

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * 1 from dawn through three minutes after sunrise, then fades to 0 over one minute.
 * Phase 0.25 is sunrise. The value is 0 for the rest of the day.
 */
export function morningMistAmount(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  const wrapped = phase - Math.floor(phase);
  const dawn = 0.25;
  const fullEnd = dawn + MORNING_MIST_FULL_SECONDS / DAY_SECONDS;
  const fadeEnd = fullEnd + MORNING_MIST_FADE_SECONDS / DAY_SECONDS;
  if (wrapped < dawn || wrapped >= fadeEnd) return 0;
  if (wrapped <= fullEnd) return 1;
  return 1 - smoothstep(fullEnd, fadeEnd, wrapped);
}

/** 1 over water, high on wet banks and moist ground, 0 on dry ground. */
export function mistCover(sample: { water: boolean; moisture: number; bank: number }): number {
  if (sample.water || sample.bank <= 0) return 1;
  const shore = 1 - smoothstep(8, 160, sample.bank);
  const damp = smoothstep(0.62, 0.84, sample.moisture);
  return Math.max(shore * 0.92, damp);
}

if (MIST_MAX_RISE >= FLIGHT_HEIGHT_LIMITS.min) {
  throw new Error('Morning mist rises into the eagle\'s minimum flight height');
}

const NOISE_GLSL = /* glsl */`
float mistHash(vec2 cell) {
  uvec2 bits = uvec2(ivec2(cell)) * uvec2(1597334673u, 3812015801u);
  uint h = (bits.x ^ bits.y) * 1597334673u;
  h ^= h >> 16u;
  return float(h) * (1.0 / 4294967295.0);
}
float mistNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 curve = local * local * (3.0 - 2.0 * local);
  float lower = mix(mistHash(cell), mistHash(cell + vec2(1.0, 0.0)), curve.x);
  float upper = mix(mistHash(cell + vec2(0.0, 1.0)), mistHash(cell + vec2(1.0, 1.0)), curve.x);
  return mix(lower, upper, curve.y);
}
float mistHeap(vec2 noiseP) {
  return mistNoise(noiseP) * 0.56 + mistNoise(noiseP * 2.15 + 4.2) * 0.30 + mistNoise(noiseP * 4.7 + 9.1) * 0.14;
}
float mistAzimuth(vec3 dir, vec3 reference) {
  float denom = max(length(dir.xz) * length(reference.xz), 0.0001);
  return max(dot(dir.xz, reference.xz) / denom, 0.0);
}
`;

export type MistUniforms = {
  field: { value: THREE.Texture };
  originRender: { value: THREE.Vector2 };
  spacing: { value: number };
  size: { value: number };
  amount: { value: number };
  density: { value: number };
  renderOriginY: { value: number };
  cameraWorldY: { value: number };
};

/** Light exponential height fog below the local mist deck, only where the morning mist has cover. */
export function bindMistHeightFog(material: THREE.Material, uniforms: MistUniforms): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.mistField = uniforms.field;
    shader.uniforms.mistOriginRender = uniforms.originRender;
    shader.uniforms.mistSpacing = uniforms.spacing;
    shader.uniforms.mistSize = uniforms.size;
    shader.uniforms.mistAmount = uniforms.amount;
    shader.uniforms.mistDensity = uniforms.density;
    shader.uniforms.mistRenderOriginY = uniforms.renderOriginY;
    shader.uniforms.mistCameraWorldY = uniforms.cameraWorldY;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec2 mistOriginRender;
varying vec3 vMistRender;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec3 mistLocal = transformed;
#ifdef USE_INSTANCING
mistLocal = (instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif
vMistRender = (modelMatrix * vec4(mistLocal, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D mistField;
uniform vec2 mistOriginRender;
uniform float mistSpacing;
uniform float mistSize;
uniform float mistAmount;
uniform float mistDensity;
uniform float mistRenderOriginY;
uniform float mistCameraWorldY;
varying vec3 vMistRender;

vec2 mistSample(vec2 renderXZ) {
  vec2 texel = (renderXZ - mistOriginRender) / mistSpacing;
  if (texel.x < 0.0 || texel.y < 0.0 || texel.x > mistSize - 1.0 || texel.y > mistSize - 1.0) return vec2(0.0);
  vec2 base = floor(texel);
  vec2 f = fract(texel);
  vec4 s00 = texture2D(mistField, (clamp(base, vec2(0.0), vec2(mistSize - 1.0)) + 0.5) / mistSize);
  vec4 s10 = texture2D(mistField, (clamp(base + vec2(1.0, 0.0), vec2(0.0), vec2(mistSize - 1.0)) + 0.5) / mistSize);
  vec4 s01 = texture2D(mistField, (clamp(base + vec2(0.0, 1.0), vec2(0.0), vec2(mistSize - 1.0)) + 0.5) / mistSize);
  vec4 s11 = texture2D(mistField, (clamp(base + vec2(1.0, 1.0), vec2(0.0), vec2(mistSize - 1.0)) + 0.5) / mistSize);
  float w00 = s00.a * (1.0 - f.x) * (1.0 - f.y);
  float w10 = s10.a * f.x * (1.0 - f.y);
  float w01 = s01.a * (1.0 - f.x) * f.y;
  float w11 = s11.a * f.x * f.y;
  float weight = w00 + w10 + w01 + w11;
  if (weight < 0.001) return vec2(0.0);
  float cover = (s00.r * w00 + s10.r * w10 + s01.r * w01 + s11.r * w11) / weight;
  float ground = (s00.g * w00 + s10.g * w10 + s01.g * w01 + s11.g * w11) / weight;
  return vec2(cover, ground);
}`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
#ifdef USE_FOG
if (mistAmount > 0.001) {
  vec2 mist = mistSample(vMistRender.xz);
  float deck = mist.y + ${MIST_CLEARANCE.toFixed(1)} + ${MIST_HEAP.toFixed(1)} * 0.42;
  float worldY = vMistRender.y + mistRenderOriginY;
  float below = max(0.0, deck - worldY);
  float above = smoothstep(0.0, 12.0, mistCameraWorldY - deck);
  float depth = length(vMistRender - cameraPosition);
  float span = below * depth;
  float heightFog = (1.0 - exp(-mistDensity * mistDensity * span * span)) * mist.x * mistAmount * above;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, clamp(heightFog, 0.0, 0.38));
}
#endif`,
      );
  };
  material.customProgramCacheKey = () => `${previousKey?.() ?? ''}|morning-mist`;
  material.needsUpdate = true;
}

class MistField {
  readonly size = FIELD_SIZE;
  readonly spacing = FIELD_SPACING;
  readonly data = new Float32Array(FIELD_SIZE * FIELD_SIZE * 4);
  readonly texture: THREE.DataTexture;
  originX = 0;
  originZ = 0;
  private pending: number[] = [];
  private placed = false;

  constructor() {
    this.texture = new THREE.DataTexture(this.data, FIELD_SIZE, FIELD_SIZE, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  get ready(): boolean {
    return this.placed && this.pending.length === 0;
  }

  private cellIndex(i: number, j: number): number {
    return (j * this.size + i) * 4;
  }

  private pack(i: number, j: number): number {
    return i | (j << 16);
  }

  follow(x: number, z: number): void {
    const originX = Math.round(x / this.spacing) * this.spacing - FIELD_SPAN / 2 + this.spacing / 2;
    const originZ = Math.round(z / this.spacing) * this.spacing - FIELD_SPAN / 2 + this.spacing / 2;
    if (!this.placed) {
      this.originX = originX;
      this.originZ = originZ;
      this.placed = true;
      this.queueAll(x, z);
      return;
    }
    const di = Math.round((originX - this.originX) / this.spacing);
    const dj = Math.round((originZ - this.originZ) / this.spacing);
    if (di === 0 && dj === 0) return;
    this.shift(di, dj, originX, originZ, x, z);
  }

  fill(world: WorldModel, budgetMs: number): void {
    const start = performance.now();
    let wrote = false;
    while (this.pending.length > 0 && performance.now() - start < budgetMs) {
      const packed = this.pending.pop()!;
      this.write(packed & 0xffff, packed >> 16, world);
      wrote = true;
    }
    if (wrote) this.texture.needsUpdate = true;
  }

  private queueAll(x: number, z: number): void {
    const cells: number[] = [];
    for (let j = 0; j < this.size; j += 1) {
      for (let i = 0; i < this.size; i += 1) cells.push(this.pack(i, j));
    }
    this.pending = this.farFirst(cells, x, z);
  }

  private shift(di: number, dj: number, originX: number, originZ: number, x: number, z: number): void {
    if (Math.abs(di) >= this.size || Math.abs(dj) >= this.size) {
      this.data.fill(0);
      this.originX = originX;
      this.originZ = originZ;
      this.queueAll(x, z);
      this.texture.needsUpdate = true;
      return;
    }
    const next = new Float32Array(this.data.length);
    const fresh: number[] = [];
    for (let j = 0; j < this.size; j += 1) {
      for (let i = 0; i < this.size; i += 1) {
        const fromI = i + di;
        const fromJ = j + dj;
        const to = this.cellIndex(i, j);
        if (fromI >= 0 && fromJ >= 0 && fromI < this.size && fromJ < this.size) {
          const from = this.cellIndex(fromI, fromJ);
          next[to] = this.data[from]!;
          next[to + 1] = this.data[from + 1]!;
          next[to + 2] = this.data[from + 2]!;
          next[to + 3] = this.data[from + 3]!;
          if (next[to + 3]! < 0.5) fresh.push(this.pack(i, j));
        } else {
          fresh.push(this.pack(i, j));
        }
      }
    }
    this.data.set(next);
    this.originX = originX;
    this.originZ = originZ;
    this.pending = this.farFirst(fresh, x, z);
    this.texture.needsUpdate = true;
  }

  private farFirst(cells: number[], x: number, z: number): number[] {
    return cells.sort((a, b) => this.distance(b, x, z) - this.distance(a, x, z));
  }

  private distance(packed: number, x: number, z: number): number {
    const cx = this.originX + (packed & 0xffff) * this.spacing;
    const cz = this.originZ + (packed >> 16) * this.spacing;
    return Math.hypot(cx - x, cz - z);
  }

  private write(i: number, j: number, world: WorldModel): void {
    const x = this.originX + i * this.spacing;
    const z = this.originZ + j * this.spacing;
    const sample = world.sample(x, z);
    const index = this.cellIndex(i, j);
    this.data[index] = mistCover(sample);
    this.data[index + 1] = sample.water ? sample.surface : sample.height;
    this.data[index + 2] = sample.water ? 1 : 0;
    this.data[index + 3] = 1;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

export class CloudSea {
  readonly mesh: THREE.Mesh;
  private readonly field = new MistField();
  private readonly uniforms: MistUniforms;
  private readonly centerTexel = { value: new THREE.Vector2() };
  private readonly noiseBias = { value: new THREE.Vector2() };
  private readonly sunDirection = { value: new THREE.Vector3(0, 1, 0) };
  private readonly sunColor = { value: new THREE.Color(1, 0.7, 0.4) };
  private readonly fogColor = { value: new THREE.Color(0x8faeb8) };
  private readonly lowSun = { value: 1 };
  private readonly time = { value: 0 };
  private readonly fogNear = { value: 400 };
  private readonly fogFar = { value: 2400 };
  private amount = 0;

  constructor(parent: THREE.Object3D) {
    this.uniforms = {
      field: { value: this.field.texture },
      originRender: { value: new THREE.Vector2() },
      spacing: { value: FIELD_SPACING },
      size: { value: FIELD_SIZE },
      amount: { value: 0 },
      density: { value: HEIGHT_FOG_DENSITY },
      renderOriginY: { value: 0 },
      cameraWorldY: { value: 0 },
    };
    const geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, PLANE_SEGMENTS, PLANE_SEGMENTS);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      fog: false,
      uniforms: {
        mistField: this.uniforms.field,
        mistCenterTexel: this.centerTexel,
        mistNoiseBias: this.noiseBias,
        mistSpacing: this.uniforms.spacing,
        mistSize: this.uniforms.size,
        mistAmount: this.uniforms.amount,
        mistTime: this.time,
        sunDirection: this.sunDirection,
        sunColor: this.sunColor,
        fogColor: this.fogColor,
        lowSun: this.lowSun,
        fogNear: this.fogNear,
        fogFar: this.fogFar,
        cloudWhite: { value: new THREE.Color(0xe7e6d6) },
        hollowColor: { value: new THREE.Color(0x6a7c98) },
      },
      vertexShader: /* glsl */`
        uniform sampler2D mistField;
        uniform vec2 mistCenterTexel;
        uniform vec2 mistNoiseBias;
        uniform float mistSpacing;
        uniform float mistSize;
        uniform float mistTime;
        varying float vCover;
        varying float vHeap;
        varying vec2 vNoiseP;
        varying vec3 vRender;
        ${NOISE_GLSL}
        void main() {
          vec2 texel = mistCenterTexel + position.xz / mistSpacing;
          vec2 noiseP = mistNoiseBias + texel * mistSpacing * ${NOISE_SCALE.toFixed(4)} + vec2(mistTime * 0.012, mistTime * 0.004);
          float heap = mistHeap(noiseP);
          float cover = 0.0;
          float ground = 0.0;
          if (texel.x >= 0.0 && texel.y >= 0.0 && texel.x <= mistSize - 1.0 && texel.y <= mistSize - 1.0) {
            vec2 base = floor(texel);
            vec2 f = fract(texel);
            vec4 s00 = texture2D(mistField, (clamp(base, vec2(0.0), vec2(mistSize - 1.0)) + 0.5) / mistSize);
            vec4 s10 = texture2D(mistField, (clamp(base + vec2(1.0, 0.0), vec2(0.0), vec2(mistSize - 1.0)) + 0.5) / mistSize);
            vec4 s01 = texture2D(mistField, (clamp(base + vec2(0.0, 1.0), vec2(0.0), vec2(mistSize - 1.0)) + 0.5) / mistSize);
            vec4 s11 = texture2D(mistField, (clamp(base + vec2(1.0, 1.0), vec2(0.0), vec2(mistSize - 1.0)) + 0.5) / mistSize);
            float w00 = s00.a * (1.0 - f.x) * (1.0 - f.y);
            float w10 = s10.a * f.x * (1.0 - f.y);
            float w01 = s01.a * (1.0 - f.x) * f.y;
            float w11 = s11.a * f.x * f.y;
            float weight = w00 + w10 + w01 + w11;
            if (weight > 0.001) {
              cover = (s00.r * w00 + s10.r * w10 + s01.r * w01 + s11.r * w11) / weight;
              ground = (s00.g * w00 + s10.g * w10 + s01.g * w01 + s11.g * w11) / weight;
            }
          }
          vec3 displaced = position;
          displaced.y = ground + ${MIST_CLEARANCE.toFixed(1)} + heap * ${MIST_HEAP.toFixed(1)};
          vCover = cover;
          vHeap = heap;
          vNoiseP = noiseP;
          vec4 rendered = modelMatrix * vec4(displaced, 1.0);
          vRender = rendered.xyz;
          gl_Position = projectionMatrix * viewMatrix * rendered;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float mistAmount;
        uniform vec3 sunDirection;
        uniform vec3 sunColor;
        uniform vec3 fogColor;
        uniform vec3 cloudWhite;
        uniform vec3 hollowColor;
        uniform float lowSun;
        uniform float fogNear;
        uniform float fogFar;
        varying float vCover;
        varying float vHeap;
        varying vec2 vNoiseP;
        varying vec3 vRender;
        ${NOISE_GLSL}
        void main() {
          float cover = vCover * mistAmount;
          if (cover < 0.02) discard;
          float slopeSpan = 12.0 * ${NOISE_SCALE.toFixed(4)};
          float heap = vHeap;
          float slopeX = (mistHeap(vNoiseP + vec2(slopeSpan, 0.0)) - heap) * ${MIST_HEAP.toFixed(1)} / 12.0;
          float slopeZ = (mistHeap(vNoiseP + vec2(0.0, slopeSpan)) - heap) * ${MIST_HEAP.toFixed(1)} / 12.0;
          vec3 normal = normalize(vec3(-slopeX * 5.5, 1.0, -slopeZ * 5.5));
          float sunUp = smoothstep(-0.03, 0.08, sunDirection.y);
          float lit = smoothstep(sunDirection.y - 0.35, sunDirection.y + 0.22, dot(normal, sunDirection)) * sunUp;
          float hollow = smoothstep(0.62, 0.22, heap);
          vec3 shade = mix(hollowColor, cloudWhite, 0.42);
          vec3 viewDir = normalize(vRender - cameraPosition);
          float facing = pow(max(dot(viewDir, sunDirection), 0.0), 4.0) * sunUp;
          float align = mistAzimuth(viewDir, sunDirection);
          vec3 light = mix(cloudWhite, sunColor, lowSun * 0.22 + facing * 0.16);
          light = mix(light, sunColor, lowSun * pow(align, 1.5) * 0.22);
          vec3 tops = mix(shade, light, smoothstep(0.2, 0.78, lit) * (1.0 - hollow * 0.62));
          float dist = length(vRender - cameraPosition);
          float farFade = smoothstep(fogNear, max(fogFar, fogNear + 1.0), dist);
          vec3 color = mix(tops, fogColor, farFade);
          float holes = smoothstep(0.1, 0.34, heap);
          float body = mix(holes, 1.0, smoothstep(0.7, 0.96, vCover));
          float alpha = cover * body * 0.93 * (1.0 - farFade * 0.92);
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'morning-mist';
    parent.add(this.mesh);
  }

  get heightFogUniforms(): MistUniforms {
    return this.uniforms;
  }

  get ready(): boolean {
    return this.field.ready;
  }

  get morningAmount(): number {
    return this.amount;
  }

  fillNow(world: WorldModel, budgetMs: number): void {
    this.field.fill(world, budgetMs);
  }

  update(cameraX: number, cameraZ: number, cameraWorldY: number, phase: number, skySeconds: number, fog: THREE.Fog, sun: THREE.Vector3, sunColor: { r: number; g: number; b: number }, renderOrigin: THREE.Vector3, world: WorldModel): void {
    this.amount = morningMistAmount(phase);
    this.uniforms.amount.value = this.amount;
    this.field.follow(cameraX, cameraZ);
    // Stay under the terrain stream's budget. Screenshot tests call fillNow when they need the field at once.
    this.field.fill(world, 0.4);
    this.mesh.visible = this.amount > 0.004;
    this.mesh.position.set(cameraX, 0, cameraZ);
    this.centerTexel.value.set(
      (cameraX - this.field.originX) / FIELD_SPACING,
      (cameraZ - this.field.originZ) / FIELD_SPACING,
    );
    this.noiseBias.value.set(this.field.originX * NOISE_SCALE, this.field.originZ * NOISE_SCALE);
    this.uniforms.originRender.value.set(this.field.originX - renderOrigin.x, this.field.originZ - renderOrigin.z);
    this.uniforms.renderOriginY.value = renderOrigin.y;
    this.uniforms.cameraWorldY.value = cameraWorldY;
    this.time.value = skySeconds;
    this.fogColor.value.copy(fog.color);
    this.fogNear.value = fog.near;
    this.fogFar.value = fog.far;
    this.sunDirection.value.copy(sun);
    this.sunColor.value.setRGB(sunColor.r, sunColor.g, sunColor.b);
    this.lowSun.value = 1 - smoothstep(0.04, 0.42, Math.max(0, sun.y));
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.field.dispose();
  }
}
