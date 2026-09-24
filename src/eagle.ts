import * as THREE from 'three';
import { hash2, Thermal, WorldModel } from './world';

export type EagleBehavior = 'gliding' | 'thermal-seeking' | 'thermal-riding';

export type EagleState = {
  x: number;
  y: number;
  z: number;
  heading: number;
  bank: number;
  behavior: EagleBehavior;
  flapping: boolean;
};

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export type FlightHeightRange = { min: number; max: number };
export const FLIGHT_HEIGHT_LIMITS = { min: 50, max: 240, gap: 20 } as const;
export const DEFAULT_FLIGHT_HEIGHT: FlightHeightRange = { min: 65, max: 210 };

export const GLIDE_SINK_RATE = 1; // m/s, per CONTEXT.md: Gliding
export const FLAP_CLIMB_RATE = 4; // m/s while flapping
const FLAP_BURST_SECONDS = 0.9; // a few wing beats, then glide again
// ponytail: last-resort collision floor; normal flapping keeps clearance well above this.
export const TERRAIN_SAFETY_MARGIN = 6;
export const THERMAL_RADIUS_RANGE = { min: 30, max: 60 } as const;
export const THERMAL_BANK_RANGE = { min: (20 * Math.PI) / 180, max: (35 * Math.PI) / 180 } as const;
export const THERMAL_CLIMB_RANGE = { min: 1, max: 3 } as const;
const THERMAL_CIRCLE_SPEED = 14; // m/s; with 30–60 m radius this yields a 20–35° bank
const THERMAL_WEAK_LIFT = 0.18;

export function normalizeFlightHeight(min: number, max: number): FlightHeightRange {
  const safeMin = clamp(Number.isFinite(min) ? min : DEFAULT_FLIGHT_HEIGHT.min,
    FLIGHT_HEIGHT_LIMITS.min, FLIGHT_HEIGHT_LIMITS.max - FLIGHT_HEIGHT_LIMITS.gap);
  return {
    min: safeMin,
    max: clamp(Number.isFinite(max) ? max : DEFAULT_FLIGHT_HEIGHT.max,
      safeMin + FLIGHT_HEIGHT_LIMITS.gap, FLIGHT_HEIGHT_LIMITS.max),
  };
}

export class EagleNavigator {
  readonly state: EagleState;
  private readonly world: WorldModel;
  private behaviorTime = 0;
  private totalTime = 0;
  private target = { x: 0, z: 0 };
  private thermal: Thermal | null = null;
  private scenicIndex = 0;
  private flapTimer = 0;
  private heightRange: FlightHeightRange;
  private circleAngle = 0;
  private circleRadius = 45;
  private targetRadius = 45;
  private circleDrift = 0;
  private rideLift = 1;
  private thermalCore = { x: 0, z: 0 };

  constructor(world: WorldModel, start: { x: number; z: number; heading: number }, heightRange = DEFAULT_FLIGHT_HEIGHT) {
    this.world = world;
    this.heightRange = normalizeFlightHeight(heightRange.min, heightRange.max);
    const ground = world.sample(start.x, start.z).height;
    this.state = { x: start.x, y: ground + clamp(105, this.heightRange.min, this.heightRange.max), z: start.z, heading: start.heading, bank: 0, behavior: 'gliding', flapping: false };
    this.chooseScenicTarget();
  }

  get activeThermal(): Thermal | null {
    return this.thermal;
  }

  setFlightHeightRange(range: FlightHeightRange): void {
    this.heightRange = normalizeFlightHeight(range.min, range.max);
    const ground = this.world.sample(this.state.x, this.state.z).height;
    this.state.y = ground + clamp(this.state.y - ground, this.heightRange.min, this.heightRange.max);
  }

  update(deltaSeconds: number): EagleState {
    const dt = Math.min(deltaSeconds, 0.1);
    this.behaviorTime += dt;
    this.totalTime += dt;
    const ground = this.world.sample(this.state.x, this.state.z).height;

    if (this.state.behavior !== 'thermal-riding') {
      if (this.state.behavior === 'thermal-seeking' && this.thermal) {
        this.target.x = this.thermal.x;
        this.target.z = this.thermal.z;
        const distance = Math.hypot(this.state.x - this.thermal.x, this.state.z - this.thermal.z);
        if (distance < 70) this.enter('thermal-riding');
        else if (this.behaviorTime > 42) this.enterGliding();
      } else if (this.behaviorTime > 34) {
        const altitude = this.state.y - ground;
        const span = this.heightRange.max - this.heightRange.min;
        if (altitude < this.heightRange.min + span * 0.2 || hash2(Math.floor(this.totalTime / 20), this.scenicIndex, this.world.seed + 401) > 0.64) this.seekThermal();
        else this.behaviorTime = 0;
      }
    }

    // Re-check: the block above may have just switched behavior this frame.
    if (this.state.behavior === 'thermal-riding') {
      this.state.flapping = false;
      this.updateCircle(dt, ground);
    } else {
      this.flyTowardTarget(dt, ground);
    }
    const currentGround = this.world.sample(this.state.x, this.state.z).height;
    if (this.state.behavior === 'thermal-riding') this.state.y = Math.min(this.state.y, currentGround + this.heightRange.max);
    this.state.y = Math.max(this.state.y, currentGround + TERRAIN_SAFETY_MARGIN);
    return this.state;
  }

  private flyTowardTarget(dt: number, ground: number): void {
    const desiredHeading = Math.atan2(this.target.x - this.state.x, this.target.z - this.state.z);
    const headingError = wrapAngle(desiredHeading - this.state.heading);
    const turnRate = clamp(headingError, -0.48, 0.48);
    this.state.heading = wrapAngle(this.state.heading + turnRate * dt);
    this.state.bank += (clamp(-headingError * 0.78, -0.48, 0.48) - this.state.bank) * Math.min(1, dt * 2.2);
    const speed = 32;
    this.state.x += Math.sin(this.state.heading) * speed * dt;
    this.state.z += Math.cos(this.state.heading) * speed * dt;

    const lookAhead = this.world.sample(this.state.x + Math.sin(this.state.heading) * 105, this.state.z + Math.cos(this.state.heading) * 105).height;
    this.updateHeightEnergy(dt, ground, lookAhead);

    if (this.state.behavior !== 'thermal-seeking' && Math.hypot(this.target.x - this.state.x, this.target.z - this.state.z) < 150) {
      this.chooseScenicTarget();
    }
  }

  // Gliding sinks; a flap burst climbs when near the floor or terrain rises ahead.
  private updateHeightEnergy(dt: number, ground: number, lookAheadGround: number): void {
    const span = this.heightRange.max - this.heightRange.min;
    const floorTrigger = this.heightRange.min + Math.max(10, span * 0.15);
    const clearance = this.state.y - ground;
    const aheadClearance = this.state.y - lookAheadGround;
    if (!this.state.flapping && (clearance < floorTrigger || aheadClearance < floorTrigger)) {
      this.state.flapping = true;
      this.flapTimer = FLAP_BURST_SECONDS;
    }
    if (this.state.flapping) {
      this.state.y += FLAP_CLIMB_RATE * dt;
      this.flapTimer -= dt;
      if (this.flapTimer <= 0) this.state.flapping = false;
    } else {
      this.state.y -= GLIDE_SINK_RATE * dt;
    }
  }

  private beginRide(): void {
    if (!this.thermal) return;
    this.thermalCore = { x: this.thermal.x, z: this.thermal.z };
    this.circleAngle = Math.atan2(this.state.z - this.thermal.z, this.state.x - this.thermal.x);
    const distance = Math.hypot(this.state.x - this.thermal.x, this.state.z - this.thermal.z);
    this.circleRadius = clamp(distance, THERMAL_RADIUS_RANGE.min, THERMAL_RADIUS_RANGE.max);
    this.targetRadius = THERMAL_RADIUS_RANGE.min + hash2(
      Math.floor(this.thermal.x), Math.floor(this.thermal.z), this.world.seed + 503,
    ) * (THERMAL_RADIUS_RANGE.max - THERMAL_RADIUS_RANGE.min);
    this.circleDrift = 0;
    this.rideLift = 1;
  }

  private updateCircle(dt: number, ground: number): void {
    if (!this.thermal) {
      this.enterGliding();
      return;
    }
    const strengthT = clamp((this.thermal.strength - 0.72) / 0.72, 0, 1);
    const climbRate = (THERMAL_CLIMB_RANGE.min + (THERMAL_CLIMB_RANGE.max - THERMAL_CLIMB_RANGE.min) * strengthT) * this.rideLift;
    this.rideLift = Math.max(0, this.rideLift - dt * (0.008 - 0.0055 * strengthT));

    this.circleDrift += dt * 0.07;
    const driftRadius = 6 + (1 - strengthT) * 4;
    this.thermal.x = this.thermalCore.x + Math.cos(this.circleDrift) * driftRadius;
    this.thermal.z = this.thermalCore.z + Math.sin(this.circleDrift) * driftRadius;

    this.circleRadius += (this.targetRadius - this.circleRadius) * Math.min(1, dt * 0.35);
    const radius = clamp(this.circleRadius + Math.sin(this.totalTime * 0.35) * 2.5, THERMAL_RADIUS_RANGE.min, THERMAL_RADIUS_RANGE.max);
    this.circleAngle += dt * (THERMAL_CIRCLE_SPEED / radius);
    const desiredX = this.thermal.x + Math.cos(this.circleAngle) * radius;
    const desiredZ = this.thermal.z + Math.sin(this.circleAngle) * radius;
    const follow = Math.min(1, dt * 1.6);
    this.state.x += (desiredX - this.state.x) * follow;
    this.state.z += (desiredZ - this.state.z) * follow;
    const tangent = wrapAngle(-this.circleAngle);
    this.state.heading = wrapAngle(this.state.heading + wrapAngle(tangent - this.state.heading) * Math.min(1, dt * 2.4));

    const span = THERMAL_RADIUS_RANGE.max - THERMAL_RADIUS_RANGE.min;
    const bankSpan = THERMAL_BANK_RANGE.max - THERMAL_BANK_RANGE.min;
    const bankMag = THERMAL_BANK_RANGE.max - ((radius - THERMAL_RADIUS_RANGE.min) / span) * bankSpan
      + Math.sin(this.totalTime * 0.5) * ((1.5 * Math.PI) / 180);
    const targetBank = -clamp(bankMag, THERMAL_BANK_RANGE.min, THERMAL_BANK_RANGE.max);
    this.state.bank += (targetBank - this.state.bank) * Math.min(1, dt * 1.4);

    this.state.y = Math.min(this.state.y + climbRate * dt, ground + this.heightRange.max);
    // Skip the max-height/weaken exit on the entry tick: gliding can arrive already at/above max over low ground,
    // and this guarantees at least one visible thermal-riding tick before assessing it.
    const clearance = this.state.y - ground;
    if (this.behaviorTime > 0 && (clearance >= this.heightRange.max || this.rideLift < THERMAL_WEAK_LIFT)) {
      this.enterGliding();
    }
  }

  private seekThermal(): void {
    const thermals = this.world.nearbyThermals(this.state.x, this.state.z, 2);
    const aheadX = Math.sin(this.state.heading);
    const aheadZ = Math.cos(this.state.heading);
    thermals.sort((a, b) => {
      const score = (thermal: Thermal) => {
        const dx = thermal.x - this.state.x;
        const dz = thermal.z - this.state.z;
        return Math.hypot(dx, dz) - (dx * aheadX + dz * aheadZ) * 0.28 - thermal.strength * 95;
      };
      return score(a) - score(b);
    });
    this.thermal = thermals[0] ?? null;
    if (!this.thermal) {
      this.enterGliding();
      return;
    }
    this.target = { x: this.thermal.x, z: this.thermal.z };
    this.enter('thermal-seeking');
  }

  private enterGliding(): void {
    this.thermal = null;
    this.enter('gliding');
    this.chooseScenicTarget();
  }

  private enter(behavior: EagleBehavior): void {
    this.state.behavior = behavior;
    this.behaviorTime = 0;
    if (behavior === 'thermal-riding') this.beginRide();
  }

  private chooseScenicTarget(): void {
    this.scenicIndex += 1;
    let bestScore = -Infinity;
    for (let candidate = 0; candidate < 6; candidate += 1) {
      const variation = (hash2(this.scenicIndex * 6 + candidate, Math.floor(this.state.x / 400), this.world.seed + 419) - 0.5) * 1.35;
      const distance = 720 + hash2(this.scenicIndex * 6 + candidate, Math.floor(this.state.z / 400), this.world.seed + 421) * 680;
      const heading = this.state.heading + variation;
      const x = this.state.x + Math.sin(heading) * distance;
      const z = this.state.z + Math.cos(heading) * distance;
      const score = this.world.interest(x, z);
      if (score <= bestScore) continue;
      bestScore = score;
      this.target = { x, z };
    }
  }
}

// All feathers in each surface share one vertex-colored draw call. Coordinates are
// in the bird's frame: +z is the bill, +y is up, and the wings extend along x.
type FeatherPoint = [number, number, number];

class Plumage {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];

  polygon(points: FeatherPoint[], color: number): void {
    const rgb = new THREE.Color(color);
    const outline = points.map(([x, , z]) => new THREE.Vector2(x, z));
    for (const triangle of THREE.ShapeUtils.triangulateShape(outline, [])) {
      for (const index of triangle) {
        this.positions.push(...points[index]!);
        this.colors.push(rgb.r, rgb.g, rgb.b);
      }
    }
  }

  mesh(): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.94, flatShading: true }));
  }
}

function makeWing(sign: number): THREE.Mesh {
  const feathers = new Plumage();
  const point = (x: number, z: number, lift = 0): FeatherPoint => [sign * x, 0.08 + x * 0.065 + lift, z];

  // Overlapping secondaries form the broad, rounded inner trailing edge.
  for (let i = 0; i < 12; i += 1) {
    const x = 0.5 + i * 0.39;
    const back = -1.62 - Math.sin((i / 12) * Math.PI) * 0.45;
    feathers.polygon([
      point(x - 0.33, -0.28), point(x + 0.29, -0.39),
      point(x + 0.36, back + 0.14), point(x + 0.18, back - 0.28), point(x - 0.04, back - 0.31),
    ], i % 3 === 0 ? 0x483025 : 0x39271f);
  }

  // The long outer flight feathers spread into individually visible fingers.
  for (let i = 0; i < 7; i += 1) {
    const x = 3.85 + i * 0.26;
    const tipX = 5.45 + i * 0.52;
    const tipZ = -2.35 + i * 0.44;
    feathers.polygon([
      point(x - 0.3, -0.24), point(x + 0.24, -0.18),
      point(tipX - 0.55, tipZ + 0.1), point(tipX, tipZ + 0.04),
      point(tipX + 0.06, tipZ - 0.07), point(tipX - 0.55, tipZ - 0.11),
      point(x - 0.2, -1.48),
    ], i % 2 ? 0x35241e : 0x442c22);
  }

  // Broad inner wing, swept at the wrist; it covers the feather roots.
  feathers.polygon([
    point(0, 0.43, 0.09), point(1.35, 0.66, 0.13),
    point(2.95, 0.58, 0.12), point(4.3, 0.15, 0.08),
    point(5.22, -0.31), point(5.28, -1.05),
    point(4.2, -1.37), point(2.4, -1.43), point(0.45, -0.97),
  ], 0x402b21);

  // Two rows of coverts follow the sweep. Contrasting edges stay legible
  // against the landscape at the default trailing-camera distance.
  for (let i = 0; i < 12; i += 1) {
    const x = 0.48 + i * 0.43;
    const sweep = 0.32 - x * 0.15;
    feathers.polygon([
      point(x - 0.38, sweep + 0.15, 0.15), point(x + 0.31, sweep + 0.03, 0.15),
      point(x + 0.44, sweep - 0.4, 0.15), point(x + 0.12, sweep - 0.54, 0.15),
    ], i % 3 === 0 ? 0x896039 : 0x70482d);
    feathers.polygon([
      point(x - 0.26, sweep - 0.39, 0.17), point(x + 0.29, sweep - 0.48, 0.17),
      point(x + 0.44, sweep - 0.87, 0.17), point(x + 0.15, sweep - 0.96, 0.17),
    ], i % 2 ? 0x533526 : 0x62412b);
  }
  return feathers.mesh();
}

function makeTail(): THREE.Mesh {
  const tail = new Plumage();
  for (let i = -4; i <= 4; i += 1) {
    const x = i * 0.22;
    const tipX = i * 0.31;
    const end = -4.88 + Math.abs(i) * 0.11;
    tail.polygon([
      [x - 0.16, -0.1, -1.8], [x + 0.16, -0.1, -1.8],
      [tipX + 0.2, -0.2, end + 0.15], [tipX + 0.08, -0.2, end],
      [tipX - 0.12, -0.2, end], [tipX - 0.2, -0.2, end + 0.15],
    ], i % 2 ? 0x594438 : 0x654c3b);
    tail.polygon([
      [tipX - 0.19, -0.18, end + 0.55], [tipX + 0.19, -0.18, end + 0.55],
      [tipX + 0.19, -0.18, end + 0.15], [tipX + 0.08, -0.18, end],
      [tipX - 0.12, -0.18, end], [tipX - 0.19, -0.18, end + 0.15],
    ], 0x30251e);
  }
  return tail.mesh();
}

export class EagleView {
  readonly group = new THREE.Group();
  private readonly leftWing = new THREE.Group();
  private readonly rightWing = new THREE.Group();
  private time = 0;

  constructor() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x392820, roughness: 0.94 });
    const warm = new THREE.MeshStandardMaterial({ color: 0x65412b, roughness: 0.94 });
    const gold = new THREE.MeshStandardMaterial({ color: 0x946b3b, roughness: 0.9 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd4a34c, roughness: 0.85 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1e1b18, roughness: 0.8 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x17120e, roughness: 0.22 });

    const oval = (material: THREE.Material, position: [number, number, number], scale: [number, number, number]): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), material);
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      this.group.add(mesh);
      return mesh;
    };
    oval(dark, [0, 0, 0], [1.04, 0.7, 2.23]);
    oval(warm, [0, -0.12, 1.25], [0.82, 0.67, 1.17]);
    // Golden hackles drape over the shoulders and back of the neck.
    oval(gold, [0, 0.32, 2.0], [0.65, 0.57, 1.02]);
    oval(dark, [0, 0.33, 2.84], [0.55, 0.52, 0.64]);
    oval(yellow, [0, 0.17, 3.37], [0.31, 0.24, 0.26]);
    const bill = oval(black, [0, 0.12, 3.61], [0.23, 0.19, 0.35]);
    bill.rotation.x = -0.32;
    for (const side of [-1, 1]) {
      oval(eye, [side * 0.49, 0.48, 3.03], [0.075, 0.075, 0.075]);
      oval(yellow, [side * 0.37, -0.65, -1.08], [0.22, 0.37, 0.24]);
      for (let toe = -1; toe <= 1; toe += 1) {
        const claw = oval(black, [side * 0.37 + toe * 0.16, -0.97, -0.83], [0.07, 0.09, 0.28]);
        claw.rotation.x = -0.25;
      }
    }

    this.leftWing.position.set(-0.8, 0.12, 0.4);
    this.rightWing.position.set(0.8, 0.12, 0.4);
    this.leftWing.add(makeWing(-1));
    this.rightWing.add(makeWing(1));
    this.group.add(this.leftWing, this.rightWing, makeTail());
    this.group.scale.setScalar(1.15);
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = true;
    });
  }

  update(state: EagleState, deltaSeconds: number): void {
    this.time += deltaSeconds;
    this.group.position.set(state.x, state.y, state.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = state.heading;
    this.group.rotation.z = state.bank;
    const flap = state.flapping ? Math.sin(this.time * 8) * 0.28 : Math.sin(this.time * 1.15) * 0.025;
    this.leftWing.rotation.z = -flap;
    this.rightWing.rotation.z = flap;
  }
}
