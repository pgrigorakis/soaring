import * as THREE from 'three';

export const PUFF_CLOUD_COUNT = 40;
export const PUFF_CLOUD_FIELD = 6400;
export const PUFF_CLOUD_DECK = 600;
export const PUFF_SPRITES_PER_CLOUD = 30;

export type PuffCloudLayout = {
  offsetX: number;
  offsetZ: number;
  height: number;
  width: number;
  driftSpeed: number;
};

export type PuffCloudPlacement = { x: number; y: number; z: number; opacity: number };
export type PuffCloudSnapshot = {
  count: number;
  sprites: number;
  layout: PuffCloudLayout[];
  placements: PuffCloudPlacement[];
  skyLight: number[];
};

/** The light the puffs need each frame, in world space. */
export type PuffCloudLight = {
  horizon: THREE.Color;
  skyLight: THREE.Color;
  keyDir: THREE.Vector3;
  /** Key light radiance, already divided by pi to match Lambert surfaces. */
  keyLight: THREE.Color;
  bodies: number;
  whiteout: number;
};

type Puff = PuffCloudLayout & {
  x: number;
  z: number;
  turn: number;
  opacity: number;
  whiteness: number;
};
type Wind = { x: number; z: number; speed: number };
type EaglePosition = { x: number; y: number; z: number };
/** A soft disc in cloud units: offsets and radius are shares of the cloud width, y is above the flat base. */
type Sprite = { cloud: number; x: number; y: number; z: number; r: number; seed: number };
type Lobe = { x: number; y: number; z: number; r: number };

const HALF_FIELD = PUFF_CLOUD_FIELD / 2;
/** Cloud height as a share of its width. */
const CLOUD_TOP = 0.62;
/** The flat base sits this far below the puff centre, as a share of the width. */
const BASE_DROP = CLOUD_TOP * 0.4;

function randomStream(seed: number): () => number {
  let state = (seed >>> 0) ^ 0xa511e9b3;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapOffset(value: number): number {
  return ((value + HALF_FIELD) % PUFF_CLOUD_FIELD + PUFF_CLOUD_FIELD) % PUFF_CLOUD_FIELD - HALF_FIELD;
}

/** A cumulus silhouette on a flat base: a broad dome, a ring of five shoulders and cauliflower towers. */
function cumulusLobes(random: () => number): Lobe[] {
  const lobes: Lobe[] = [{ x: (random() - 0.5) * 0.06, y: 0.16, z: (random() - 0.5) * 0.06, r: 0.3 }];
  const spin = random() * Math.PI * 2;
  for (let index = 0; index < 5; index += 1) {
    const angle = spin + index * Math.PI * 2 / 5 + (random() - 0.5) * 0.5;
    const orbit = 0.2 + random() * 0.09;
    lobes.push({ x: Math.cos(angle) * orbit, y: 0.08 + random() * 0.07, z: Math.sin(angle) * orbit, r: 0.15 + random() * 0.07 });
  }
  while (lobes.length < 10) {
    const angle = random() * Math.PI * 2;
    const orbit = random() * 0.13;
    lobes.push({ x: Math.cos(angle) * orbit, y: 0.3 + random() * 0.12, z: Math.sin(angle) * orbit, r: 0.12 + random() * 0.07 });
  }
  return lobes;
}

/** One disc per lobe, then smaller discs on the lobes' upper surfaces for the cauliflower edge. */
function cloudSprites(seed: number, cloud: number): Sprite[] {
  const random = randomStream(seed * 977 + cloud * 131 + 17);
  const lobes = cumulusLobes(random);
  const sprites: Sprite[] = lobes.map((lobe) => ({ cloud, x: lobe.x, y: Math.max(lobe.y, lobe.r * 0.35), z: lobe.z, r: lobe.r * 1.05, seed: random() }));
  while (sprites.length < PUFF_SPRITES_PER_CLOUD) {
    const lobe = lobes[Math.floor(random() * lobes.length)]!;
    const theta = random() * Math.PI * 2;
    const up = 0.15 + random() * 0.85;
    const side = Math.sqrt(1 - up * up);
    const r = lobe.r * (0.45 + random() * 0.2);
    sprites.push({ cloud, x: lobe.x + Math.cos(theta) * side * lobe.r * 0.8, y: Math.max(lobe.y + up * lobe.r * 0.8, r * 0.35),
      z: lobe.z + Math.sin(theta) * side * lobe.r * 0.8, r, seed: random() });
  }
  return sprites;
}

/**
 * A seeded, drifting pool of forty cumulus clouds in a 6.4 km wrap field. Each cloud is thirty soft,
 * camera-facing discs on a lobed cumulus shape, lit as one body; all of them draw in one call.
 */
export class PuffClouds {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly puffs: Puff[];
  private readonly sprites: Sprite[];
  private readonly order: { index: number; distance: number }[];
  private readonly spriteWorld: Float32Array;
  private readonly centre: THREE.InstancedBufferAttribute;
  private readonly cloud: THREE.InstancedBufferAttribute;
  private readonly params: THREE.InstancedBufferAttribute;
  private readonly uniforms = {
    keyDir: { value: new THREE.Vector3(0, 1, 0) },
    keyLight: { value: new THREE.Color(1, 1, 1) },
    skyLight: { value: new THREE.Color(1, 1, 1) },
    horizonColor: { value: new THREE.Color(0x8faeb8) },
    cloudWhiteout: { value: 0 },
    time: { value: 0 },
  };
  private readonly lastEagle: { x: number; z: number };
  private enabled = true;
  private readonly shown: PuffCloudPlacement[] = Array.from({ length: PUFF_CLOUD_COUNT }, () => ({ x: 0, y: 0, z: 0, opacity: 0 }));

  constructor(scene: THREE.Object3D, seed: number, origin: EaglePosition) {
    const random = randomStream(seed);
    this.puffs = Array.from({ length: PUFF_CLOUD_COUNT }, () => {
      const offsetX = random() * PUFF_CLOUD_FIELD - HALF_FIELD;
      const offsetZ = random() * PUFF_CLOUD_FIELD - HALF_FIELD;
      return {
        offsetX,
        offsetZ,
        x: offsetX,
        z: offsetZ,
        height: PUFF_CLOUD_DECK + (random() - 0.5) * 90,
        width: 55 + random() * 95,
        driftSpeed: 2.4 + random() * 3.2,
        turn: random() * Math.PI * 2,
        opacity: 0,
        whiteness: 0.78 + random() * 0.22,
      };
    });
    this.lastEagle = { x: origin.x, z: origin.z };

    this.sprites = this.puffs.flatMap((_, cloud) => cloudSprites(seed, cloud));
    this.order = this.sprites.map((_, index) => ({ index, distance: 0 }));
    this.spriteWorld = new Float32Array(this.sprites.length * 4);
    const geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(2, 2);
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.attributes.position!);
    const instanced = (size: number) => {
      const attribute = new THREE.InstancedBufferAttribute(new Float32Array(this.sprites.length * size), size);
      attribute.setUsage(THREE.DynamicDrawUsage);
      return attribute;
    };
    this.centre = instanced(4);
    this.cloud = instanced(4);
    this.params = instanced(4);
    geometry.setAttribute('aCentre', this.centre);
    geometry.setAttribute('aCloud', this.cloud);
    geometry.setAttribute('aParams', this.params);
    geometry.instanceCount = this.sprites.length;
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      vertexShader: /* glsl */ `
        attribute vec4 aCentre; // world centre, radius
        attribute vec4 aCloud;  // world centre of the cloud's flat base, cloud width
        attribute vec4 aParams; // cloud opacity, sprite seed, cloud whiteness
        varying vec2 vUv;
        varying vec3 vWorld;
        varying vec3 vCentre;
        varying vec4 vCloud;
        varying vec3 vParams;
        void main() {
          vec3 centre = (modelMatrix * vec4(aCentre.xyz, 1.0)).xyz;
          // Near the camera the discs thin into mist. Fully faded discs collapse off screen,
          // so flying through a cloud does not shade many transparent full-screen layers.
          float near = smoothstep(aCentre.w * 0.6, aCentre.w * 1.8, distance(cameraPosition, centre));
          vParams = vec3(aParams.x * near, aParams.yz);
          if (vParams.x < 0.003) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 world = centre + (right * position.x + up * position.y) * aCentre.w;
          vUv = position.xy;
          vWorld = world;
          vCentre = centre;
          vCloud = vec4((modelMatrix * vec4(aCloud.xyz, 1.0)).xyz, aCloud.w);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 keyDir;
        uniform vec3 keyLight;
        uniform vec3 skyLight;
        uniform vec3 horizonColor;
        uniform float cloudWhiteout;
        uniform float time;
        varying vec2 vUv;
        varying vec3 vWorld;
        varying vec3 vCentre;
        varying vec4 vCloud;
        varying vec3 vParams;
        float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float vnoise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
            mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
        void main() {
          float r2 = dot(vUv, vUv);
          if (r2 > 1.0) discard;
          // Fluffy edges: slow noise erodes each disc's falloff.
          vec3 q = vec3(vUv * 1.7, vParams.y * 13.0) + vec3(0.0, 0.0, time * 0.02);
          float fluff = vnoise(q * 2.0) * 0.65 + vnoise(q * 4.0) * 0.35;
          float body = smoothstep(0.95, 0.4, sqrt(r2) + (fluff - 0.5) * 0.4);
          // Flat base: cut the discs below the cloud base.
          float base = smoothstep(vCloud.y - 1.0, vCloud.y + vCloud.w * 0.06, vWorld.y);
          // Inside the deck, whiteout hides puffs as it hides the ground and markers.
          float alpha = body * base * vParams.x * 0.9 * (1.0 - cloudWhiteout);
          if (alpha < 0.004) discard;

          vec3 toEye = cameraPosition - vWorld;
          float dist = length(toEye);
          vec3 v = toEye / dist;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          // A sphere normal on the disc, bent toward the whole cloud's normal so the cloud shades as one body.
          vec3 sphere = normalize(right * vUv.x + up * vUv.y + v * sqrt(1.0 - r2));
          vec3 outward = normalize(vCentre - (vCloud.xyz + vec3(0.0, vCloud.w * 0.18, 0.0)) + vec3(0.0, vCloud.w * 0.05, 0.0));
          vec3 n = normalize(sphere + outward * 0.9);
          float height = clamp((vWorld.y - vCloud.y) / (vCloud.w * ${CLOUD_TOP.toFixed(2)}), 0.0, 1.0);
          // Cheap self-shadow: the side away from the sun and the base sit behind more cloud.
          float depthToSun = dot(vCentre - vCloud.xyz, keyDir) / vCloud.w;
          float shadow = mix(0.45, 1.0, smoothstep(-0.25, 0.25, depthToSun)) * mix(0.55, 1.0, smoothstep(0.0, 0.6, height));
          float wrap = clamp((dot(n, keyDir) + 0.55) / 1.55, 0.0, 1.0);
          // Sky ambient from above, a cooler and darker underside.
          vec3 ambient = mix(skyLight * vec3(0.26, 0.29, 0.36), skyLight * 0.5, clamp(0.5 + 0.5 * n.y, 0.0, 1.0) * mix(0.55, 1.0, height));
          // A silver lining where the thin fringe faces into the sun.
          vec3 silver = keyLight * (1.0 - body) * hg(dot(-v, keyDir), 0.6) * 4.0;
          vec3 color = (ambient + keyLight * wrap * shadow) * mix(0.9, 1.0, vParams.z) + silver;
          color = mix(color, horizonColor, smoothstep(700.0, 2900.0, dist) * 0.8);
          color = mix(color, horizonColor, cloudWhiteout);
          gl_FragColor = vec4(color, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  get count(): number {
    return this.puffs.length;
  }

  get spriteCount(): number {
    return this.sprites.length;
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
  }

  update(eagle: EaglePosition, wind: Wind, delta: number, camera: EaglePosition, light: PuffCloudLight): void {
    const uniforms = this.uniforms;
    uniforms.horizonColor.value.copy(light.horizon);
    uniforms.skyLight.value.copy(light.skyLight);
    uniforms.keyDir.value.copy(light.keyDir);
    uniforms.keyLight.value.copy(light.keyLight);
    uniforms.cloudWhiteout.value = light.whiteout;
    uniforms.time.value += delta;
    this.mesh.visible = this.enabled && light.bodies > 0.001;
    const birdDeltaX = eagle.x - this.lastEagle.x;
    const birdDeltaZ = eagle.z - this.lastEagle.z;
    for (let index = 0; index < this.puffs.length; index += 1) {
      const puff = this.puffs[index]!;
      const windScale = puff.driftSpeed / 7.2;
      puff.x = wrapOffset(puff.x + wind.x * windScale * delta - birdDeltaX);
      puff.z = wrapOffset(puff.z + wind.z * windScale * delta - birdDeltaZ);
      const shown = this.shown[index]!;
      shown.x = eagle.x + puff.x;
      shown.y = puff.height;
      shown.z = eagle.z + puff.z;
      const cameraDistance = Math.hypot(camera.x - shown.x, camera.y - shown.y, camera.z - shown.z);
      puff.opacity = light.bodies * (1 - smoothstep(2300, 2900, cameraDistance));
      shown.opacity = puff.opacity;
    }
    this.lastEagle.x = eagle.x;
    this.lastEagle.z = eagle.z;
    if (this.mesh.visible) this.writeSprites(camera);
  }

  /** Places every disc in world space and sorts them back to front, so the one draw blends like sorted sprites. */
  private writeSprites(camera: EaglePosition): void {
    for (let index = 0; index < this.sprites.length; index += 1) {
      const sprite = this.sprites[index]!;
      const puff = this.puffs[sprite.cloud]!;
      const shown = this.shown[sprite.cloud]!;
      const cos = Math.cos(puff.turn), sin = Math.sin(puff.turn);
      const x = shown.x + (sprite.x * cos + sprite.z * sin) * puff.width;
      const y = shown.y + (sprite.y - BASE_DROP) * puff.width;
      const z = shown.z + (sprite.z * cos - sprite.x * sin) * puff.width;
      this.spriteWorld.set([x, y, z, sprite.r * puff.width], index * 4);
      const slot = this.order[index]!;
      slot.index = index;
      slot.distance = (x - camera.x) ** 2 + (y - camera.y) ** 2 + (z - camera.z) ** 2;
    }
    this.order.sort((a, b) => b.distance - a.distance);
    const centre = this.centre.array as Float32Array;
    const cloud = this.cloud.array as Float32Array;
    const params = this.params.array as Float32Array;
    for (let slot = 0; slot < this.order.length; slot += 1) {
      const index = this.order[slot]!.index;
      const sprite = this.sprites[index]!;
      const puff = this.puffs[sprite.cloud]!;
      const shown = this.shown[sprite.cloud]!;
      centre.set(this.spriteWorld.subarray(index * 4, index * 4 + 4), slot * 4);
      cloud.set([shown.x, shown.y - BASE_DROP * puff.width, shown.z, puff.width], slot * 4);
      params.set([puff.opacity, sprite.seed, puff.whiteness, 0], slot * 4);
    }
    this.centre.needsUpdate = true;
    this.cloud.needsUpdate = true;
    this.params.needsUpdate = true;
  }

  snapshot(): PuffCloudSnapshot {
    return {
      count: this.count,
      sprites: this.spriteCount,
      skyLight: this.uniforms.skyLight.value.toArray(),
      layout: this.puffs.map(({ offsetX, offsetZ, height, width, driftSpeed }) => ({ offsetX, offsetZ, height, width, driftSpeed })),
      placements: this.shown.map(({ x, y, z, opacity }) => ({ x, y, z, opacity })),
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
