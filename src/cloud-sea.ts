import * as THREE from 'three';
import { CLOUD_DECK, CLOUD_HEIGHT_SCALE, CLOUD_SURFACE, cloudControls, smoothstep } from './cloud-layer';

export type CloudFogUniforms = {
  above: { value: number };
  whiteout: { value: number };
  density: { value: number };
  renderOriginY: { value: number };
};

/** Shared by land, water, foliage, rocks and the bird. Camera gates use world Y. */
export function bindCloudFog(material: THREE.Material, uniforms: CloudFogUniforms, streamingCover = true): void {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.cloudAbove = uniforms.above;
    shader.uniforms.cloudWhiteout = uniforms.whiteout;
    shader.uniforms.cloudDensity = uniforms.density;
    shader.uniforms.cloudOriginY = uniforms.renderOriginY;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vCloudRender;`).replace('#include <project_vertex>', `#include <project_vertex>
vec4 cloudPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
cloudPosition = batchingMatrix * cloudPosition;
#endif
#ifdef USE_INSTANCING
cloudPosition = instanceMatrix * cloudPosition;
#endif
vCloudRender = (modelMatrix * cloudPosition).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform float cloudAbove;
uniform float cloudWhiteout;
uniform float cloudDensity;
uniform float cloudOriginY;
varying vec3 vCloudRender;`).replace('#include <fog_fragment>', `
#ifdef USE_FOG
float cloudY = (vCloudRender.y + cloudOriginY) / ${CLOUD_HEIGHT_SCALE};
float cloudDistance = length(vCloudRender - cameraPosition);
float cloudDepth = max(vFogDepth, 0.0);
float distF = (1.0 - exp(-pow(cloudDensity * cloudDepth, 2.0))) * mix(1.0, 0.55, smoothstep(100.0, 1000.0, cloudY));
float lowAir = clamp(cloudDistance / ${120 * CLOUD_HEIGHT_SCALE}, 0.0, 1.0) * 0.055 * (1.0 - smoothstep(200.0, 800.0, cloudY));
float farCover = smoothstep(${2600 * CLOUD_HEIGHT_SCALE}, ${4100 * CLOUD_HEIGHT_SCALE}, cloudDistance);
// Preserve the live streaming boundary, including short visibility and Low power.
// The nearby eagle is not streamed, so it stays visible while that boundary grows.
float coverage = ${streamingCover ? 'smoothstep(fogNear, max(fogNear + 1.0, fogFar), cloudDepth)' : '0.0'};
float air = 1.0 - (1.0 - distF) * (1.0 - lowAir) * (1.0 - max(farCover, coverage));
float below = max(490.0 - cloudY, 0.0);
float seaF = (1.0 - exp(-pow(0.0000085 * below * cloudDepth / ${CLOUD_HEIGHT_SCALE}, 2.0))) * cloudAbove;
float factor = max(max(air, seaF), cloudWhiteout);
gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, factor);
#endif`);
  };
  material.customProgramCacheKey = () => `${previousKey()}|fwm-cloud-fog${streamingCover ? '' : '-near'}`;
  material.needsUpdate = true;
}

// Reuse the old sea's world-anchored value noise and shader-painted folds. Signed
// noise substitutes for FWM's MaterialX noise without adding a shader dependency.
const NOISE_GLSL = /* glsl */`
float mistHash(vec2 cell) {
  uvec2 bits = uvec2(ivec2(cell)) * uvec2(1597334673u, 3812015801u);
  uint h = (bits.x ^ bits.y) * 1597334673u;
  h ^= h >> 16u;
  return float(h) * (1.0 / 4294967295.0);
}
float mistNoise(vec2 point) {
  vec2 cell = floor(point), local = fract(point);
  vec2 curve = local * local * (3.0 - 2.0 * local);
  return mix(mix(mistHash(cell), mistHash(cell + vec2(1.0, 0.0)), curve.x),
    mix(mistHash(cell + vec2(0.0, 1.0)), mistHash(cell + vec2(1.0)), curve.x), curve.y);
}
float cloudHeap(vec2 worldXZ) {
  vec2 p = worldXZ / ${CLOUD_HEIGHT_SCALE};
  return ((mistNoise(p * 0.0016 + mistTime * 0.003) * 2.0 - 1.0) * 38.0
    + (mistNoise(p * 0.006 - mistTime * 0.004) * 2.0 - 1.0) * 14.0
    + sin(p.x * 0.006 + mistTime * 0.2) * 4.0) * ${CLOUD_HEIGHT_SCALE};
}
`;

export class CloudSea {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly fogUniforms: CloudFogUniforms = {
    above: { value: 0 }, whiteout: { value: 0 }, density: { value: 0.0001476 / CLOUD_HEIGHT_SCALE }, renderOriginY: { value: 0 },
  };
  readonly cloudWhite = { value: new THREE.Color(0xe1e4cb) };
  private readonly noiseOrigin = { value: new THREE.Vector2() };
  private readonly sunDirection = { value: new THREE.Vector3(0, 1, 0) };
  private readonly moonDirection = { value: new THREE.Vector3(0, -1, 0) };
  private readonly sunColor = { value: new THREE.Color() };
  private readonly horizonColor = { value: new THREE.Color() };
  private readonly lowSun = { value: 1 };
  private readonly moonLight = { value: 0 };
  private readonly hollowColor = { value: new THREE.Color(0x6a7c98) };
  private readonly baseHollow = new THREE.Color(0x6a7c98);
  private readonly time = { value: 0 };
  private readonly baseWhite = new THREE.Color(0xe1e4cb);
  private bodies = 0;

  constructor(parent: THREE.Object3D) {
    const geometry = new THREE.PlaneGeometry(9000 * CLOUD_HEIGHT_SCALE, 9000 * CLOUD_HEIGHT_SCALE, 96, 96);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
      uniforms: {
        noiseOrigin: this.noiseOrigin, mistTime: this.time,
        cloudAbove: this.fogUniforms.above, cloudWhiteout: this.fogUniforms.whiteout,
        sunDirection: this.sunDirection, moonDirection: this.moonDirection, sunColor: this.sunColor,
        horizonColor: this.horizonColor, lowSun: this.lowSun, moonLight: this.moonLight,
        cloudWhite: this.cloudWhite, hollowColor: this.hollowColor,
      },
      vertexShader: /* glsl */`
        uniform vec2 noiseOrigin;
        uniform float mistTime;
        varying vec2 vWorldXZ;
        varying vec3 vRender;
        ${NOISE_GLSL}
        void main() {
          vWorldXZ = noiseOrigin + position.xz;
          vec3 displaced = position;
          displaced.y = cloudHeap(vWorldXZ);
          vec4 rendered = modelMatrix * vec4(displaced, 1.0);
          vRender = rendered.xyz;
          gl_Position = projectionMatrix * viewMatrix * rendered;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float mistTime;
        uniform float cloudAbove;
        uniform float cloudWhiteout;
        uniform vec3 sunDirection;
        uniform vec3 moonDirection;
        uniform vec3 sunColor;
        uniform vec3 horizonColor;
        uniform vec3 cloudWhite;
        uniform vec3 hollowColor;
        uniform float lowSun;
        uniform float moonLight;
        varying vec2 vWorldXZ;
        varying vec3 vRender;
        ${NOISE_GLSL}
        void main() {
          float heap = cloudHeap(vWorldXZ);
          float span = ${10 * CLOUD_HEIGHT_SCALE};
          float slopeX = (cloudHeap(vWorldXZ + vec2(span, 0.0)) - heap) / span;
          float slopeZ = (cloudHeap(vWorldXZ + vec2(0.0, span)) - heap) / span;
          vec3 normal = normalize(vec3(-3.5 * slopeX, 1.0, -3.5 * slopeZ));
          float sunUp = smoothstep(-0.04, 0.06, sunDirection.y);
          float lit = smoothstep(sunDirection.y - 0.6, sunDirection.y + 0.3, dot(normal, sunDirection)) * sunUp;
          float hollow = 1.0 - smoothstep(-32.0, 26.0, heap / ${CLOUD_HEIGHT_SCALE});
          vec3 viewDir = normalize(vRender - cameraPosition);
          float align = dot(viewDir.xz, sunDirection.xz) / max(length(viewDir.xz) * length(sunDirection.xz), 0.0001);
          vec3 shade = mix(hollowColor * 0.6, cloudWhite, 0.2) * (1.0 - hollow * 0.3);
          float sunFacing = max(dot(viewDir, sunDirection), 0.0) * sunUp;
          vec3 light = mix(cloudWhite, sunColor, lowSun * 0.7 + pow(sunFacing, 4.0) * 0.3);
          light = mix(light, sunColor, lowSun * pow(max(align, 0.0), 1.5) * 0.65);
          // Rose counterlight uses the existing sky's sunset palette, not terrain colour.
          float venus = exp(-pow((sunDirection.y + 0.03) / 0.09, 2.0));
          light = mix(light, mix(light, vec3(0.52, 0.36, 0.3), 0.5), venus * pow(max(-align, 0.0), 1.5) * 0.45);
          vec3 tops = mix(shade, light, lit * (1.0 - hollow * 0.55));
          float moonRamp = smoothstep(moonDirection.y - 0.6, moonDirection.y + 0.3, dot(normal, moonDirection));
          tops += vec3(0.42, 0.5, 0.72) * 0.1 * moonRamp * moonLight;
          float dist = length(vRender - cameraPosition);
          float farFade = smoothstep(${2000 * CLOUD_HEIGHT_SCALE}, ${4300 * CLOUD_HEIGHT_SCALE}, dist);
          vec3 color = mix(tops, horizonColor, max(farFade, cloudWhiteout));
          gl_FragColor = vec4(color, cloudAbove * 0.94);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'cloud-deck';
    parent.add(this.mesh);
  }

  snapshot(): { above: number; whiteout: number; bodies: number; opacity: number; visible: boolean; deck: number } {
    return { above: this.fogUniforms.above.value, whiteout: this.fogUniforms.whiteout.value, bodies: this.bodies,
      opacity: this.fogUniforms.above.value * 0.94, visible: this.mesh.visible, deck: CLOUD_DECK };
  }

  update(birdX: number, birdZ: number, cameraWorldY: number, flightSeconds: number, sun: THREE.Vector3, moon: THREE.Vector3,
    sunColor: { r: number; g: number; b: number }, horizon: THREE.Color, renderOrigin: THREE.Vector3, moonLit = 1): void {
    const controls = cloudControls(cameraWorldY);
    this.fogUniforms.above.value = controls.above;
    this.fogUniforms.whiteout.value = controls.whiteout;
    this.fogUniforms.renderOriginY.value = renderOrigin.y;
    this.bodies = controls.bodies;
    const night = smoothstep(-0.02, -0.2, sun.y);
    this.fogUniforms.density.value = 0.0001476 / CLOUD_HEIGHT_SCALE
      * (1 - 0.28 * smoothstep(0.1, 0.65, sun.y)) * (1 + 0.35 * night);
    this.mesh.visible = controls.above > 0.001;
    this.mesh.position.set(birdX, CLOUD_SURFACE, birdZ);
    this.noiseOrigin.value.set(birdX, birdZ);
    this.time.value = flightSeconds;
    this.sunDirection.value.copy(sun);
    this.moonDirection.value.copy(moon);
    this.sunColor.value.setRGB(sunColor.r, sunColor.g, sunColor.b);
    this.lowSun.value = Math.exp(-((sun.y / 0.14) ** 2));
    this.moonLight.value = smoothstep(-0.09, -0.2, sun.y) * smoothstep(-0.02, 0.12, moon.y) * moonLit;
    this.cloudWhite.value.copy(this.baseWhite).lerp(this.sunColor.value, this.lowSun.value * 0.45).lerp(horizon, night * 0.97);
    this.hollowColor.value.copy(this.baseHollow).lerp(horizon, night * 0.97);
    this.horizonColor.value.copy(horizon).lerp(this.cloudWhite.value, controls.above * 0.4).lerp(this.cloudWhite.value, controls.whiteout);
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
