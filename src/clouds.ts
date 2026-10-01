import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THERMAL_MARKER_RANGE } from './thermal-marker';
import { hash2, type Thermal, type WorldModel } from './world';
import type { WindVector } from './wind';

const MAX_THERMALS = 25;
const POOL_CAPACITY = MAX_THERMALS * 2;
const FADE_SECONDS = 4;
const CLOUD_BASE_CLEARANCE = 55;
const WIND_DRIFT_DISTANCE = 10;
const WIND_SWAY_DISTANCE = 7;

const scratchMatrix = new THREE.Matrix4();
const scratchColor = new THREE.Color();

export type CloudPlacement = {
  thermalX: number;
  thermalZ: number;
  x: number;
  y: number;
  z: number;
  fade: number;
  scale: number;
};

type CloudSlot = {
  thermal: Thermal;
  fade: number;
  target: boolean;
  groundY: number;
  placedX: number;
  placedZ: number;
};

function createCloudGeometry(): THREE.BufferGeometry {
  const halfSphere = (x: number, z: number, width: number, height: number, depth: number): THREE.BufferGeometry => {
    const geometry = new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    geometry.scale(width, height, depth);
    geometry.translate(x, height, z);
    return geometry;
  };
  const puffs = [
    halfSphere(0, 0, 54, 34, 39),
    halfSphere(-48, -2, 38, 25, 31),
    halfSphere(46, 3, 41, 27, 34),
    halfSphere(-5, -34, 31, 22, 26),
  ];
  const outline = new THREE.Shape();
  outline.moveTo(-28, 56);
  outline.lineTo(-52, 44);
  outline.lineTo(-78, 25);
  outline.lineTo(-88, 2);
  outline.lineTo(-79, -22);
  outline.lineTo(-56, -39);
  outline.lineTo(-27, -49);
  outline.lineTo(5, -52);
  outline.lineTo(37, -46);
  outline.lineTo(65, -34);
  outline.lineTo(84, -14);
  outline.lineTo(87, 8);
  outline.lineTo(71, 29);
  outline.lineTo(48, 45);
  outline.lineTo(22, 57);
  outline.closePath();
  const base = new THREE.ShapeGeometry(outline, 1);
  base.rotateX(-Math.PI / 2);
  base.translate(0, 0.01, 0);
  puffs.push(base);
  const geometry = mergeGeometries(puffs, false);
  for (const puff of puffs) puff.dispose();
  if (!geometry) throw new Error('Cloud geometry could not be merged');
  geometry.computeBoundingSphere();
  return geometry;
}

/** Low-poly cumulus pooled in one instanced draw call for thermals within 3.5 km. */
export class ThermalClouds {
  readonly mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly fadeAttribute: THREE.InstancedBufferAttribute;
  private readonly slots: CloudSlot[] = [];
  private readonly byThermal = new Map<Thermal, CloudSlot>();
  private readonly shown: CloudPlacement[] = [];

  constructor(private readonly scene: THREE.Scene, private readonly world: WorldModel) {
    const geometry = createCloudGeometry();
    const fades = new Float32Array(POOL_CAPACITY);
    this.fadeAttribute = new THREE.InstancedBufferAttribute(fades, 1);
    this.fadeAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('instanceFade', this.fadeAttribute);

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      transparent: true,
      depthWrite: true,
      depthTest: true,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float instanceFade;\nvarying float vInstanceFade;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceFade = instanceFade;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vInstanceFade;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceFade;');
    };
    material.customProgramCacheKey = () => 'thermal-cloud-fade-v1';

    this.mesh = new THREE.InstancedMesh(geometry, material, POOL_CAPACITY);
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

  update(
    origin: { x: number; z: number },
    maxFlightHeight: number,
    worldSeconds: number,
    deltaSeconds: number,
    wind: WindVector,
    skyColor: THREE.Color,
  ): void {
    const rangeThermals = this.world.thermalsWithin(origin.x, origin.z, THERMAL_MARKER_RANGE);
    const thermals = rangeThermals.length > MAX_THERMALS
      ? rangeThermals
        .slice()
        .sort((a, b) => Math.hypot(a.x - origin.x, a.z - origin.z) - Math.hypot(b.x - origin.x, b.z - origin.z))
        .slice(0, MAX_THERMALS)
      : rangeThermals;
    const inRange = new Set(thermals);
    for (const slot of this.slots) slot.target = inRange.has(slot.thermal);
    for (const thermal of thermals) {
      let slot = this.byThermal.get(thermal);
      if (!slot) {
        slot = { thermal, fade: 0, target: true, groundY: 0, placedX: Number.NaN, placedZ: Number.NaN };
        this.byThermal.set(thermal, slot);
        this.slots.push(slot);
      }
      slot.target = true;
    }

    const fadeStep = Math.max(0, deltaSeconds) / FADE_SECONDS;
    for (let index = this.slots.length - 1; index >= 0; index -= 1) {
      const slot = this.slots[index]!;
      slot.fade = Math.max(0, Math.min(1, slot.fade + (slot.target ? fadeStep : -fadeStep)));
      if (!slot.target && slot.fade === 0) {
        this.byThermal.delete(slot.thermal);
        this.slots.splice(index, 1);
      }
    }

    const windLength = Math.hypot(wind.x, wind.z) || 1;
    const windX = wind.x / windLength;
    const windZ = wind.z / windLength;
    const perpendicularX = -windZ;
    const perpendicularZ = windX;
    this.shown.length = 0;
    this.mesh.count = this.slots.length;
    this.mesh.visible = this.slots.some((slot) => slot.fade > 0);
    for (let index = 0; index < this.slots.length; index += 1) {
      const slot = this.slots[index]!;
      const thermal = slot.thermal;
      if (thermal.x !== slot.placedX || thermal.z !== slot.placedZ) {
        slot.placedX = thermal.x;
        slot.placedZ = thermal.z;
        slot.groundY = this.world.sample(thermal.x, thermal.z).height;
      }

      const driftPhase = worldSeconds * 0.04 + hash2(Math.floor(thermal.x), Math.floor(thermal.z), this.world.seed + 541) * Math.PI * 2;
      const alongWind = WIND_DRIFT_DISTANCE + Math.sin(driftPhase) * WIND_SWAY_DISTANCE;
      const acrossWind = Math.sin(driftPhase * 0.63) * 2.5;
      const x = thermal.x + windX * alongWind + perpendicularX * acrossWind;
      const z = thermal.z + windZ * alongWind + perpendicularZ * acrossWind;
      const strength = Math.max(0, Math.min(1, (thermal.strength - 0.72) / 0.72));
      const scale = 0.78 + strength * 0.56;
      const baseY = slot.groundY + maxFlightHeight + CLOUD_BASE_CLEARANCE;
      scratchMatrix.makeScale(scale, scale, scale);
      scratchMatrix.setPosition(x, baseY, z);
      this.mesh.setMatrixAt(index, scratchMatrix);
      this.mesh.setColorAt(index, scratchColor.copy(skyColor));
      this.fadeAttribute.setX(index, slot.fade);
      this.shown.push({ thermalX: thermal.x, thermalZ: thermal.z, x, y: baseY, z, fade: slot.fade, scale });
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.fadeAttribute.needsUpdate = true;
  }

  placements(): CloudPlacement[] {
    return this.shown;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}
