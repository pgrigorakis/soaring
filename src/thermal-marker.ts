import * as THREE from 'three';
import type { Thermal, WorldModel } from './world';

const HEIGHT = 260;
const RADIUS = 62;
/** Eagle line-of-sight used by the Show thermal setting. */
export const THERMAL_MARKER_RANGE = 3500;
export const THERMAL_MARKER_OPACITY = 0.4;
const FADE_BAND = 500;
// 1.8 km cells: a 3.5 km range fits inside a 5×5 scan window.
const CAPACITY = 25;

const scratch = new THREE.Matrix4();
const scratchColor = new THREE.Color();

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export type ThermalPlacement = { x: number; z: number; y: number; active: boolean };

/** Pooled columns for every thermal inside the eagle's 3.5 km line of sight. */
export class ThermalMarker {
  readonly mesh: THREE.InstancedMesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private readonly time = { value: 0 };
  private readonly assigned: (Thermal | null)[] = Array.from({ length: CAPACITY }, () => null);
  private readonly placedX: number[] = Array.from({ length: CAPACITY }, () => Number.NaN);
  private readonly placedZ: number[] = Array.from({ length: CAPACITY }, () => Number.NaN);
  private readonly groundY: number[] = Array.from({ length: CAPACITY }, () => 0);
  private readonly shown: ThermalPlacement[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly world: WorldModel) {
    const geometry = new THREE.CylinderGeometry(RADIUS, RADIUS, HEIGHT, 40, 1, true);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        time: this.time,
        markerOpacity: { value: THERMAL_MARKER_OPACITY },
      },
      fog: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      vertexShader: `
        #include <fog_pars_vertex>
        varying vec2 vUv;
        varying float vFacing;
        varying float vActive;
        varying float vFade;
        varying float vDist;
        void main() {
          vUv = uv;
          vActive = instanceColor.r;
          vFade = instanceColor.g;
          vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vDist = length(mvPosition.xyz);
          vFacing = dot(normalize(normalMatrix * mat3(instanceMatrix) * normal), normalize(-mvPosition.xyz));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform float time;
        uniform float markerOpacity;
        varying vec2 vUv;
        varying float vFacing;
        varying float vActive;
        varying float vFade;
        varying float vDist;
        void main() {
          // Near columns stay a light heat-shimmer. Distant ones stay soft, but strong enough to read at 3 km.
          float near = smoothstep(2400.0, 500.0, vDist);
          float bottom = smoothstep(0.0, mix(0.01, 0.16, near), vUv.y);
          float top = 1.0 - smoothstep(mix(0.28, 0.7, near), 1.0, vUv.y);
          float rise = bottom * top;
          // Vertical phase only. A second wall must not cross it into a lattice.
          float shimmer = 0.5 + 0.5 * sin(vUv.y * mix(5.0, 18.0, near) - time * 1.5);
          float facing = smoothstep(0.0, mix(0.92, 0.4, near), abs(vFacing));
          float spark = near * 0.1 * pow(shimmer, 8.0);
          float base = mix(0.2, 0.05, near);
          float alpha = markerOpacity * vFade * rise * facing * (base + spark + near * 0.015 * shimmer);
          alpha *= mix(0.72, 1.0, vActive);
          vec3 calm = vec3(1.0, 0.46, 0.05);
          vec3 hot = mix(vec3(1.0, 0.12, 0.0), vec3(1.0, 0.32, 0.02), shimmer * near);
          gl_FragColor = vec4(mix(calm, hot, vActive), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
          #ifdef USE_FOG
            // Haze tints the column, but must not erase thermals inside the 3.5 km line of sight.
            vec3 columnColor = mix(calm, hot, vActive);
            gl_FragColor.rgb = mix(columnColor, mix(columnColor, fogColor, 0.4), fogFactor * 0.28);
            gl_FragColor.a *= mix(0.88, 1.0, 1.0 - fogFactor);
          #endif
        }
      `,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, scratchColor.setRGB(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  get count(): number {
    return this.mesh.count;
  }

  update(origin: { x: number; z: number }, active: Thermal | null, enabled: boolean, elapsedSeconds: number): void {
    this.time.value = elapsedSeconds;
    const thermals = enabled ? this.world.thermalsWithin(origin.x, origin.z, THERMAL_MARKER_RANGE) : [];
    const shown = thermals.length > CAPACITY
      ? thermals
        .slice()
        .sort((a, b) => {
          const da = (a.x - origin.x) ** 2 + (a.z - origin.z) ** 2;
          const db = (b.x - origin.x) ** 2 + (b.z - origin.z) ** 2;
          return da - db;
        })
        .slice(0, CAPACITY)
      : thermals;
    this.mesh.count = shown.length;
    this.mesh.visible = shown.length > 0;
    this.shown.length = 0;
    if (!this.mesh.instanceColor) this.mesh.setColorAt(0, scratchColor);
    for (let index = 0; index < shown.length; index += 1) {
      const thermal = shown[index]!;
      const isActive = thermal === active;
      const moved = this.assigned[index] !== thermal
        || thermal.x !== this.placedX[index]
        || thermal.z !== this.placedZ[index];
      if (moved) {
        this.assigned[index] = thermal;
        this.placedX[index] = thermal.x;
        this.placedZ[index] = thermal.z;
        this.groundY[index] = this.world.sample(thermal.x, thermal.z).height;
      }
      const distance = Math.hypot(thermal.x - origin.x, thermal.z - origin.z);
      // A short column becomes a floating bar at 3 km. Stretch it so the plume still rises off the ground.
      const heightScale = 1 + 2.2 * smoothstep(450, 2800, distance);
      const columnHeight = HEIGHT * heightScale;
      scratch.makeScale(1, heightScale, 1);
      scratch.setPosition(thermal.x, this.groundY[index]! + columnHeight / 2 + 3, thermal.z);
      this.mesh.setMatrixAt(index, scratch);
      const edge = smoothstep(THERMAL_MARKER_RANGE - FADE_BAND, THERMAL_MARKER_RANGE, distance);
      scratchColor.setRGB(isActive ? 1 : 0, (1 - edge) * (isActive ? 1 : 0.84), 1);
      this.mesh.setColorAt(index, scratchColor);
      this.shown.push({
        x: thermal.x,
        z: thermal.z,
        y: this.groundY[index]! + columnHeight / 2 + 3,
        active: isActive,
      });
    }
    for (let index = shown.length; index < CAPACITY; index += 1) this.assigned[index] = null;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  placements(): ThermalPlacement[] {
    return this.shown;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
