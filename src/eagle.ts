import * as THREE from 'three';
import { fbm, hash2, highlandWeight, Thermal, WorldModel } from './world';

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
const COMPASS_SEED = 431;

function fbm1d(x: number, seed: number): number {
  // At a 300 s input scale, two octaves keep the shortest swing near 150 s.
  return fbm(x, 0, seed, 2);
}

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
export const THERMAL_CLIMB_RANGE = { min: 3, max: 4 } as const;
const THERMAL_CIRCLE_SPEED = 14; // m/s; with 30–60 m radius this yields a 20–35° bank
const THERMAL_WEAK_LIFT = 0.18;

// Positive bank is a positive local-Z rotation: it lowers the left wing. After the heading yaw,
// the right wing (+X) points along (cos heading, -sin heading). The sign follows that wing and
// the thermal, so either orbit direction banks inward instead of a fixed roll.
export function inwardThermalBankSign(
  heading: number, birdX: number, birdZ: number, thermalX: number, thermalZ: number,
): 1 | -1 {
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  const rightTowardCenter = rightX * (thermalX - birdX) + rightZ * (thermalZ - birdZ);
  return rightTowardCenter > 0 ? -1 : 1;
}

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
  private readonly seedAngle: number;
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
  private smoothedGround: number;
  private groundEnvelope: number;
  private groundSampleAge = 0;

  constructor(world: WorldModel, start: { x: number; z: number; heading: number }, heightRange = DEFAULT_FLIGHT_HEIGHT) {
    this.world = world;
    this.seedAngle = hash2(0, 0, world.seed + COMPASS_SEED) * Math.PI * 2;
    this.heightRange = normalizeFlightHeight(heightRange.min, heightRange.max);
    const startSample = world.sample(start.x, start.z);
    const startGround = startSample.water ? startSample.surface : startSample.height;
    const ground = startGround + highlandWeight(startSample.mountainRegion) * (this.highestGround(start.x, start.z) - startGround);
    this.smoothedGround = ground;
    this.groundEnvelope = ground;
    this.state = { x: start.x, y: ground + clamp(105, this.heightRange.min, this.heightRange.max), z: start.z, heading: start.heading, bank: 0, behavior: 'gliding', flapping: false };
    this.chooseScenicTarget();
  }

  get flightGround(): number {
    return this.smoothedGround;
  }

  get activeThermal(): Thermal | null {
    return this.thermal;
  }

  setFlightHeightRange(range: FlightHeightRange): void {
    this.heightRange = normalizeFlightHeight(range.min, range.max);
    const ground = this.flightGround;
    this.state.y = ground + clamp(this.state.y - ground, this.heightRange.min, this.heightRange.max);
  }

  update(deltaSeconds: number): EagleState {
    const dt = Math.min(deltaSeconds, 0.1);
    this.behaviorTime += dt;
    this.totalTime += dt;
    this.groundSampleAge += dt;
    if (this.groundSampleAge >= 0.5) {
      this.groundEnvelope = this.highestGround(this.state.x, this.state.z);
      this.groundSampleAge = 0;
    }
    const local = this.world.sample(this.state.x, this.state.z);
    const mountain = highlandWeight(local.mountainRegion);
    const localGround = local.water ? local.surface : local.height;
    const envelope = localGround + mountain * (this.groundEnvelope - localGround);
    const easingSeconds = Math.max(0.01, 5 * mountain);
    this.smoothedGround += (envelope - this.smoothedGround) * (1 - Math.exp(-dt / easingSeconds));
    const ground = this.smoothedGround;

    if (this.state.behavior !== 'thermal-riding') {
      if (this.state.behavior === 'thermal-seeking' && this.thermal) {
        this.target.x = this.thermal.x;
        this.target.z = this.thermal.z;
        const distance = Math.hypot(this.state.x - this.thermal.x, this.state.z - this.thermal.z);
        if (distance < 70) this.enter('thermal-riding');
        else if (this.behaviorTime > 42 && distance > 150) this.enterGliding(); // never give up on a final approach
      } else if (this.behaviorTime > 34) {
        const altitude = this.state.y - ground;
        const span = this.heightRange.max - this.heightRange.min;
        if (altitude < this.heightRange.min + span * (0.2 + mountain * 0.35) || hash2(Math.floor(this.totalTime / 20), this.scenicIndex, this.world.seed + 401) > 0.64) this.seekThermal();
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
    const current = this.world.sample(this.state.x, this.state.z);
    this.state.y = Math.max(this.state.y, Math.max(current.height, current.water ? current.surface : current.height) + TERRAIN_SAFETY_MARGIN);
    return this.state;
  }

  /** Sample the 250 m disk, not just the point below the bird. Refresh at 2 Hz. */
  private highestGround(x: number, z: number): number {
    let highest = -Infinity;
    for (let dz = -250; dz <= 250; dz += 125) {
      for (let dx = -250; dx <= 250; dx += 125) {
        if (dx * dx + dz * dz > 250 ** 2) continue;
        highest = Math.max(highest, this.world.sample(x + dx, z + dz).height);
      }
    }
    return highest;
  }

  /** Trade forward progress, not a vertical jump, when a face outruns climb lift. */
  private moveAboveTerrain(dx: number, dz: number): void {
    const mountain = highlandWeight(this.world.sample(this.state.x, this.state.z).mountainRegion);
    if (mountain === 0) {
      this.state.x += dx;
      this.state.z += dz;
      return;
    }
    const clear = (fraction: number) => this.world.sample(this.state.x + dx * fraction, this.state.z + dz * fraction).height
      + TERRAIN_SAFETY_MARGIN + 6 < this.state.y;
    let fraction = 1;
    if (!clear(1)) {
      let low = 0;
      let high = 1;
      for (let step = 0; step < 8; step += 1) {
        const middle = (low + high) / 2;
        if (clear(middle)) low = middle;
        else high = middle;
      }
      fraction = low;
    }
    this.state.x += dx * fraction;
    this.state.z += dz * fraction;
  }

  private flyTowardTarget(dt: number, ground: number): void {
    const desiredHeading = Math.atan2(this.target.x - this.state.x, this.target.z - this.state.z);
    const headingError = wrapAngle(desiredHeading - this.state.heading);
    const turnRate = clamp(headingError, -0.48, 0.48);
    this.state.heading = wrapAngle(this.state.heading + turnRate * dt);
    this.state.bank += (clamp(-headingError * 0.78, -0.48, 0.48) - this.state.bank) * Math.min(1, dt * 2.2);
    const speed = 32;
    this.moveAboveTerrain(Math.sin(this.state.heading) * speed * dt, Math.cos(this.state.heading) * speed * dt);

    const aheadX = Math.sin(this.state.heading);
    const aheadZ = Math.cos(this.state.heading);
    const local = this.world.sample(this.state.x, this.state.z);
    const localGround = local.height;
    const nearGround = this.world.sample(this.state.x + aheadX * 105, this.state.z + aheadZ * 105).height;
    const slope = Math.max(0, (nearGround - localGround) / 105);
    const distance = clamp(105 + slope * 500 * highlandWeight(local.mountainRegion), 105, 250);
    // Check the approach as well as its endpoint: looking across a crest into a
    // lower basin must not hide the ground that lies between them.
    let lookAhead = nearGround;
    for (const along of [distance / 2, distance]) {
      lookAhead = Math.max(lookAhead, this.world.sample(this.state.x + aheadX * along, this.state.z + aheadZ * along).height);
    }
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
    this.moveAboveTerrain((desiredX - this.state.x) * follow, (desiredZ - this.state.z) * follow);
    const tangent = wrapAngle(-this.circleAngle);
    this.state.heading = wrapAngle(this.state.heading + wrapAngle(tangent - this.state.heading) * Math.min(1, dt * 2.4));

    const span = THERMAL_RADIUS_RANGE.max - THERMAL_RADIUS_RANGE.min;
    const bankSpan = THERMAL_BANK_RANGE.max - THERMAL_BANK_RANGE.min;
    const bankMag = THERMAL_BANK_RANGE.max - ((radius - THERMAL_RADIUS_RANGE.min) / span) * bankSpan
      + Math.sin(this.totalTime * 0.5) * ((1.5 * Math.PI) / 180);
    const bankSign = inwardThermalBankSign(
      this.state.heading, this.state.x, this.state.z, this.thermal.x, this.thermal.z,
    );
    const targetBank = bankSign * clamp(bankMag, THERMAL_BANK_RANGE.min, THERMAL_BANK_RANGE.max);
    this.state.bank += (targetBank - this.state.bank) * Math.min(1, dt * 1.4);

    // A falling reference must not teleport the bird down when crossing a crest.
    this.state.y += Math.min(climbRate * dt, Math.max(0, this.flightGround + this.heightRange.max - this.state.y));
    // Skip the max-height/weaken exit on the entry tick: gliding can arrive already at/above max over low ground,
    // and this guarantees at least one visible thermal-riding tick before assessing it.
    const clearance = this.state.y - ground;
    if (this.behaviorTime > 0 && (clearance >= this.heightRange.max || this.rideLift < THERMAL_WEAK_LIFT)) {
      this.enterGliding();
    }
  }

  private seekThermal(): void {
    // Two 1.8 km cells give the eagle a 3.6 km thermal search reach.
    const thermals = this.world.nearbyThermals(this.state.x, this.state.z, 2);
    const bearing = this.seedAngle + fbm1d(this.totalTime / 300, this.world.seed + COMPASS_SEED) * Math.PI / 2;
    const aheadX = Math.sin(bearing);
    const aheadZ = Math.cos(bearing);
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
    const bearing = this.seedAngle + fbm1d(this.totalTime / 300, this.world.seed + COMPASS_SEED) * Math.PI / 2;
    const local = this.world.sample(this.state.x, this.state.z);
    const mountain = highlandWeight(local.mountainRegion);
    const lakeland = local.biome.lakeland;
    // Keep the long-lived compass through a pass; do not let a thermal's exit yaw
    // turn valley preference into repeated trips around the same basin.
    const routeHeading = bearing;
    let bestScore = -Infinity;
    for (let candidate = 0; candidate < 6; candidate += 1) {
      const variation = (hash2(this.scenicIndex * 6 + candidate, Math.floor(this.state.x / 400), this.world.seed + 419) - 0.5) * 1.35;
      const distance = 720 + hash2(this.scenicIndex * 6 + candidate, Math.floor(this.state.z / 400), this.world.seed + 421) * (680 + lakeland * 600);
      const heading = routeHeading + variation;
      const x = this.state.x + Math.sin(heading) * distance;
      const z = this.state.z + Math.cos(heading) * distance;
      const midpoint = this.world.sample((this.state.x + x) / 2, (this.state.z + z) / 2);
      const destination = this.world.sample(x, z);
      const climb = Math.max(0, Math.max(midpoint.height, destination.height) - this.flightGround);
      const score = this.world.interest(x, z) + 0.25 * Math.cos(heading - bearing) - mountain * climb / 160;
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
