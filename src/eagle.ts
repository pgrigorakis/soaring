import * as THREE from 'three';
import { globalWind, type Wind } from './wind';
import { fbm, hash2, highlandWeight, lakeShorePoint, Reach, Thermal, WorldModel } from './world';

export type EagleBehavior = 'gliding' | 'thermal-seeking' | 'thermal-riding' | 'ridge-soaring';

export type EagleState = {
  x: number;
  y: number;
  z: number;
  heading: number;
  bank: number;
  behavior: EagleBehavior;
  flapping: boolean;
  /** Visual-only yaw into a crosswind. Movement follows `heading`. */
  crab?: number;
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
const CRUISE_SPEED = 32;
/** No behaviour may run four minutes; a long glide seeks a thermal before that. */
const MAX_GLIDE_SECONDS = 200;
const MAX_TURN_RATE = 0.48;

const DEGREE = Math.PI / 180;
/** Settled ridge model for issue #60; see the PR description for the sources behind each number. */
export const RIDGE = {
  minSlope: 18 * DEGREE,
  minFacing: 0.5,
  minWind: 5,
  enterClimb: 1,
  maxClimb: 2,
  liftScale: 0.55,
  weakClimb: 0.7,
  weakSeconds: 8,
  confirmSeconds: 1.5,
  easeSeconds: 2,
  gradientBaseline: 80,
  crestStep: 40,
  crestReach: 400,
  crestStopSlope: 8 * DEGREE,
  offset: 100,
  bandUpwind: 40,
  bandBelow: 20,
  bandAbove: 120,
  segmentStep: 80,
  minSegment: 700,
  maxScan: 1200,
  crestDrop: 40,
  continuation: 200,
  joinReach: 350,
  joinAngle: 50 * DEGREE,
  joinSpan: 0.55,
  exitSeconds: 210,
  hardSeconds: 240,
  lockoutSeconds: 45,
  lockoutRadius: 400,
  scenicOffAxis: 70 * DEGREE,
  scenicInterest: 0.85,
  lakeBank: { min: 40, max: 450 },
  seekCommitDistance: 400,
  seekCommitSeconds: 20,
} as const;

/** Orographic climb: scaled Bohrer coefficient, V sin θ cos δ, clamped to 2 m/s. */
export function ridgeClimb(slope: number, upslopeAngle: number, wind: Wind): number {
  const facing = Math.max(0, Math.cos(upslopeAngle - wind.angle));
  return Math.min(RIDGE.maxClimb, wind.speed * Math.sin(slope) * facing * RIDGE.liftScale);
}

/** Shore legs trace up to half a lake, then the compass takes over again. */
const SHORE = { reach: 700, odds: 0.6, offset: 60, leg: 300, arc: Math.PI, revisitSeconds: 600 } as const;

type Face = { slope: number; angle: number };
/** Sideways offsets, in metres right of the heading, where the gate looks for a face. A valley route flies beside its faces. */
const RIDGE_PROBES = [0, -150, 150, -300, 300] as const;
const PROBE_SECONDS = 0.5;
/** One 80 m station along the ridge axis: the crest there, and the track point 100 m upwind of it. */
type RidgeStation = { x: number; z: number; crestX: number; crestZ: number; crestHeight: number };
type Ridge = {
  /** Upslope unit vector of the windward face, x/z. */
  upX: number;
  upZ: number;
  /** Ridge axis unit vector; `direction` picks which way along it the bird beats. */
  axisX: number;
  axisZ: number;
  direction: 1 | -1;
  /** Station k sits k * 80 m along the axis from the origin, for k in [first, first + stations.length). */
  originX: number;
  originZ: number;
  first: number;
  stations: RidgeStation[];
  anchorHeight: number;
  crestX: number;
  crestZ: number;
  crestHeight: number;
  faceDepth: number;
  trackX: number;
  trackZ: number;
  refresh: number;
  turnSign: number;
  weakTime: number;
};
type ShoreTrace = { lake: Reach; angle: number; sign: 1 | -1; arcLeft: number };

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
  private face: Face = { slope: 0, angle: 0 };
  private probes: (Face | null)[] = RIDGE_PROBES.map(() => null);
  private probeAge = 0;
  private ridgeGate = 0;
  private ridgeCooldown = 0;
  private ridge: Ridge | null = null;
  private ridgeLockout: { x: number; z: number; until: number } | null = null;
  private liftRate = 0;
  private ridgeLeadUntil = 0;
  private glideStart = 0;
  private shore: ShoreTrace | null = null;
  private lastShore: { x: number; z: number; time: number } | null = null;

  constructor(world: WorldModel, start: { x: number; z: number; heading: number }, heightRange = DEFAULT_FLIGHT_HEIGHT) {
    this.world = world;
    this.seedAngle = hash2(0, 0, world.seed + COMPASS_SEED) * Math.PI * 2;
    this.heightRange = normalizeFlightHeight(heightRange.min, heightRange.max);
    const startSample = world.sample(start.x, start.z);
    const ground = startSample.height + highlandWeight(startSample.mountainRegion) * (this.highestGround(start.x, start.z) - startSample.height);
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

  /** The global wind at this navigator's simulation time. */
  get wind(): Wind {
    return globalWind(this.world.seed, this.totalTime);
  }

  /** Predicted orographic climb of the face being watched or flown, in m/s. */
  get ridgeLift(): number {
    return this.liftRate;
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
    const envelope = local.height + mountain * (this.groundEnvelope - local.height);
    const easingSeconds = Math.max(0.01, 5 * mountain);
    this.smoothedGround += (envelope - this.smoothedGround) * (1 - Math.exp(-dt / easingSeconds));
    const ground = this.smoothedGround;

    if (this.state.behavior === 'gliding' || this.state.behavior === 'thermal-seeking') this.watchRidge(dt, ground);
    if (this.state.behavior !== 'thermal-riding' && this.state.behavior !== 'ridge-soaring') {
      if (this.state.behavior === 'thermal-seeking' && this.thermal) {
        this.target.x = this.thermal.x;
        this.target.z = this.thermal.z;
        const distance = Math.hypot(this.state.x - this.thermal.x, this.state.z - this.thermal.z);
        if (distance < 70) this.enter('thermal-riding');
        else if (this.behaviorTime > 42 && distance > 150) this.enterGliding(); // never give up on a final approach
      } else if (this.behaviorTime > 34) {
        const altitude = this.state.y - ground;
        const span = this.heightRange.max - this.heightRange.min;
        if (altitude < this.heightRange.min + span * (0.2 + mountain * 0.35) || hash2(Math.floor(this.totalTime / 20), this.scenicIndex, this.world.seed + 401) > 0.64
          || this.totalTime - this.glideStart > MAX_GLIDE_SECONDS) this.seekThermal();
        else this.behaviorTime = 0;
      }
    }

    // Re-check: the block above may have just switched behavior this frame.
    if (this.state.behavior === 'thermal-riding') {
      this.state.flapping = false;
      this.updateCircle(dt, ground);
    } else if (this.state.behavior === 'ridge-soaring') {
      this.updateRidge(dt, ground);
    } else {
      this.flyTowardTarget(dt, ground);
    }
    if (this.state.behavior !== 'ridge-soaring') this.state.crab = (this.state.crab ?? 0) * Math.exp(-dt / RIDGE.easeSeconds);
    const current = this.world.sample(this.state.x, this.state.z);
    this.state.y = Math.max(this.state.y, current.height + TERRAIN_SAFETY_MARGIN);
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
    this.steer(headingError, dt);

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

  private steer(headingError: number, dt: number): void {
    this.state.heading = wrapAngle(this.state.heading + clamp(headingError, -MAX_TURN_RATE, MAX_TURN_RATE) * dt);
    this.state.bank += (clamp(-headingError * 0.78, -0.48, 0.48) - this.state.bank) * Math.min(1, dt * 2.2);
    this.moveAboveTerrain(Math.sin(this.state.heading) * CRUISE_SPEED * dt, Math.cos(this.state.heading) * CRUISE_SPEED * dt);
  }

  /** Slope and upslope angle on an 80 m baseline. The angle uses the wind convention: 0 is +x, toward +z. */
  private measureFace(x: number, z: number): Face {
    const half = RIDGE.gradientBaseline / 2;
    const gx = (this.world.sample(x + half, z).height - this.world.sample(x - half, z).height) / RIDGE.gradientBaseline;
    const gz = (this.world.sample(x, z + half).height - this.world.sample(x, z - half).height) / RIDGE.gradientBaseline;
    return { slope: Math.atan(Math.hypot(gx, gz)), angle: Math.atan2(gz, gx) };
  }

  private easeFace(eased: Face | null, measured: Face, dt: number): Face {
    if (!eased) return { ...measured };
    const blend = 1 - Math.exp(-dt / RIDGE.easeSeconds);
    eased.slope += (measured.slope - eased.slope) * blend;
    eased.angle = wrapAngle(eased.angle + wrapAngle(measured.angle - eased.angle) * blend);
    return eased;
  }

  /** Slope, facing, wind and climb gates, on a highland face or a lake-bowl wall. */
  private faceQualifies(x: number, z: number, face: Face, wind: Wind, minClimb: number): boolean {
    if (face.slope < RIDGE.minSlope || wind.speed < RIDGE.minWind) return false;
    if (Math.cos(face.angle - wind.angle) < RIDGE.minFacing || ridgeClimb(face.slope, face.angle, wind) < minClimb) return false;
    const sample = this.world.sample(x, z);
    if (highlandWeight(sample.mountainRegion) >= 0.5) return true;
    if (sample.water) return false;
    const lake = this.world.nearestLake(x, z);
    return !!lake && lake.shoreDist >= RIDGE.lakeBank.min && lake.shoreDist <= RIDGE.lakeBank.max
      && Math.cos(face.angle) * (x - lake.reach.ax) + Math.sin(face.angle) * (z - lake.reach.az) > 0;
  }

  /** Walk upslope in 40 m steps, up to 400 m, until the slope eases below 8° or the ground falls. */
  private crestFrom(x: number, z: number, upX: number, upZ: number): { x: number; z: number; height: number } {
    let height = this.world.sample(x, z).height;
    const rise = Math.tan(RIDGE.crestStopSlope) * RIDGE.crestStep;
    for (let walked = 0; walked < RIDGE.crestReach; walked += RIDGE.crestStep) {
      const next = this.world.sample(x + upX * RIDGE.crestStep, z + upZ * RIDGE.crestStep).height;
      if (next - height < rise) break;
      x += upX * RIDGE.crestStep;
      z += upZ * RIDGE.crestStep;
      height = next;
    }
    return { x, z, height };
  }

  /** Distance from the crest to the foot of the steep face, past any rounded top, within 400 m. */
  private faceDepth(crestX: number, crestZ: number, upX: number, upZ: number): number {
    let height = this.world.sample(crestX, crestZ).height;
    const drop = Math.tan(RIDGE.minSlope) * RIDGE.crestStep;
    let depth = 0;
    for (let walked = RIDGE.crestStep; walked <= RIDGE.crestReach; walked += RIDGE.crestStep) {
      const next = this.world.sample(crestX - upX * walked, crestZ - upZ * walked).height;
      if (height - next >= drop) depth = walked;
      else if (depth > 0) break;
      height = next;
    }
    return depth;
  }

  /**
   * While gliding or on an uncommitted seek, watch the ground below and to each side at 2 Hz.
   * Enter once some face has qualified for 1.5 s and a long enough crest lies close ahead.
   */
  private watchRidge(dt: number, ground: number): void {
    this.ridgeCooldown -= dt;
    this.probeAge += dt;
    if (this.probeAge < PROBE_SECONDS) return;
    const elapsed = this.probeAge;
    this.probeAge = 0;
    const wind = this.wind;
    const rightX = Math.cos(this.state.heading);
    const rightZ = -Math.sin(this.state.heading);
    let best: { x: number; z: number; face: Face; climb: number } | null = null;
    RIDGE_PROBES.forEach((offset, index) => {
      const x = this.state.x + rightX * offset;
      const z = this.state.z + rightZ * offset;
      const face = this.easeFace(this.probes[index] ?? null, this.measureFace(x, z), elapsed);
      this.probes[index] = face;
      const climb = ridgeClimb(face.slope, face.angle, wind);
      if (index === 0) this.liftRate = climb;
      if ((!best || climb > best.climb) && this.faceQualifies(x, z, face, wind, RIDGE.enterClimb)) best = { x, z, face, climb };
    });
    const committedSeek = this.state.behavior === 'thermal-seeking' && (!this.thermal
      || this.behaviorTime < RIDGE.seekCommitSeconds
      || Math.hypot(this.state.x - this.thermal.x, this.state.z - this.thermal.z) < RIDGE.seekCommitDistance);
    const gate = best as { x: number; z: number; face: Face; climb: number } | null;
    if (committedSeek || !gate) {
      this.ridgeGate = 0;
      return;
    }
    this.ridgeGate += elapsed;
    const span = this.heightRange.max - this.heightRange.min;
    if (this.ridgeGate < RIDGE.confirmSeconds || this.ridgeCooldown > 0
      || this.state.y - ground >= this.heightRange.min + RIDGE.joinSpan * span) return;
    const ridge = this.findRidge(gate.x, gate.z, gate.face, wind);
    if (!ridge || Math.acos(clamp(ridge.axisX * Math.sin(this.state.heading) + ridge.axisZ * Math.cos(this.state.heading), -1, 1)) > RIDGE.joinAngle) {
      this.ridgeCooldown = 1;
      // Crossing a long windward crest: glide toward its far end so the bird arrives along it.
      // Entry still needs the gate, the 350 m reach and ±50° alignment at that point.
      if (ridge && this.state.behavior === 'gliding' && this.totalTime >= this.ridgeLeadUntil) {
        const end = ridge.stations[ridge.stations.length - 1]!;
        this.target = { x: end.x, z: end.z };
        this.ridgeLeadUntil = this.totalTime + RIDGE.lockoutSeconds;
      }
      return;
    }
    this.ridge = ridge;
    this.face = { ...gate.face };
    this.thermal = null;
    this.state.flapping = false;
    this.enter('ridge-soaring');
  }

  /** A qualifying crest of at least 700 m along a straight axis, close to the bird. The caller checks alignment. */
  private findRidge(faceX: number, faceZ: number, face: Face, wind: Wind): Ridge | null {
    const upX = Math.cos(face.angle);
    const upZ = Math.sin(face.angle);
    const crest = this.crestFrom(faceX, faceZ, upX, upZ);
    if (this.state.y >= crest.height + RIDGE.bandAbove) return null;
    if (this.ridgeLockout && this.totalTime < this.ridgeLockout.until
      && Math.hypot(crest.x - this.ridgeLockout.x, crest.z - this.ridgeLockout.z) < RIDGE.lockoutRadius) return null;
    let axisX = -upZ;
    let axisZ = upX;
    if (axisX * Math.sin(this.state.heading) + axisZ * Math.cos(this.state.heading) < 0) {
      axisX = -axisX;
      axisZ = -axisZ;
    }
    const originX = crest.x - upX * RIDGE.offset;
    const originZ = crest.z - upZ * RIDGE.offset;
    if (Math.hypot(originX - this.state.x, originZ - this.state.z) > RIDGE.joinReach) return null;
    const origin = this.ridgeStation(originX, originZ, upX, upZ, wind, crest.height);
    if (!origin) return null;
    // Follow the crest sideways from station to station. A crest that bends more than 45°
    // between stations is a spur or a gap, and ends the segment.
    const scan = (sign: 1 | -1) => {
      const found: RidgeStation[] = [];
      let previous = origin;
      for (let along = RIDGE.segmentStep; along <= RIDGE.maxScan; along += RIDGE.segmentStep) {
        const station = this.ridgeStation(
          previous.x + axisX * sign * RIDGE.segmentStep, previous.z + axisZ * sign * RIDGE.segmentStep, upX, upZ, wind, previous.crestHeight);
        if (!station || Math.abs((station.x - previous.x) * upX + (station.z - previous.z) * upZ) > RIDGE.segmentStep) break;
        found.push(station);
        previous = station;
      }
      return found;
    };
    const ahead = scan(1);
    const behind = scan(-1);
    if ((ahead.length + behind.length) * RIDGE.segmentStep < RIDGE.minSegment) return null;
    return {
      upX, upZ, axisX, axisZ, direction: 1, originX, originZ,
      first: -behind.length, stations: [...behind.reverse(), origin, ...ahead],
      anchorHeight: crest.height, crestX: origin.crestX, crestZ: origin.crestZ, crestHeight: origin.crestHeight,
      faceDepth: this.faceDepth(origin.crestX, origin.crestZ, upX, upZ),
      trackX: origin.x, trackZ: origin.z, refresh: 0, turnSign: 0, weakTime: 0,
    };
  }

  /** From a guess near the track, find the crest; the station qualifies if 100 m upwind of it does. */
  private ridgeStation(x: number, z: number, upX: number, upZ: number, wind: Wind, anchorHeight: number): RidgeStation | null {
    const crest = this.crestFrom(x, z, upX, upZ);
    if (crest.height < anchorHeight - RIDGE.crestDrop) return null;
    const trackX = crest.x - upX * RIDGE.offset;
    const trackZ = crest.z - upZ * RIDGE.offset;
    if (!this.faceQualifies(trackX, trackZ, this.measureFace(trackX, trackZ), wind, RIDGE.enterClimb)) return null;
    return { x: trackX, z: trackZ, crestX: crest.x, crestZ: crest.z, crestHeight: crest.height };
  }

  /** Beat along the windward face 100 m upwind of the crest; turn into the wind at each end. */
  private updateRidge(dt: number, ground: number): void {
    const ridge = this.ridge;
    if (!ridge) {
      this.enterGliding();
      return;
    }
    this.state.flapping = false;
    const wind = this.wind;
    const along = (this.state.x - ridge.originX) * ridge.axisX + (this.state.z - ridge.originZ) * ridge.axisZ;
    const last = ridge.first + ridge.stations.length - 1;
    const stationAt = (k: number) => ridge.stations[clamp(Math.round(k), ridge.first, last) - ridge.first]!;
    const here = Math.round(along / RIDGE.segmentStep);
    ridge.refresh -= dt;
    let faceEnded = false;
    if (ridge.refresh <= 0) {
      ridge.refresh = 0.5;
      const station = stationAt(here);
      ridge.crestX = station.crestX;
      ridge.crestZ = station.crestZ;
      ridge.crestHeight = station.crestHeight;
      ridge.faceDepth = this.faceDepth(station.crestX, station.crestZ, ridge.upX, ridge.upZ);
      // Wind drifts during a beat: the face must still be usable here or within 200 m ahead.
      const reach = Math.floor(RIDGE.continuation / RIDGE.segmentStep);
      faceEnded = true;
      for (let k = 0; k <= reach && faceEnded; k += 1) {
        const ahead = stationAt(here + k * ridge.direction);
        faceEnded = !this.faceQualifies(ahead.x, ahead.z, this.measureFace(ahead.x, ahead.z), wind, 0);
      }
    }
    // Interpolate the track between stations, then ease it so the line does not kink.
    const aim = (distance: number) => {
      const k = clamp((along + distance) / RIDGE.segmentStep, ridge.first, last);
      const a = stationAt(Math.floor(k));
      const b = stationAt(Math.ceil(k));
      const t = k - Math.floor(k);
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    };
    const goal = aim(0);
    const ease = 1 - Math.exp(-dt / RIDGE.easeSeconds);
    ridge.trackX += (goal.x - ridge.trackX) * ease;
    ridge.trackZ += (goal.z - ridge.trackZ) * ease;
    const face = this.easeFace(this.face, this.measureFace(ridge.trackX, ridge.trackZ), dt);
    const climb = ridgeClimb(face.slope, face.angle, wind);
    this.liftRate = climb;

    const turnAt = (ridge.direction > 0 ? last : ridge.first) * RIDGE.segmentStep;
    if (ridge.turnSign === 0 && (along - turnAt) * ridge.direction >= 0) {
      // Scenic targets may end the beat only here, at a turn, never mid-beat.
      const scenic = this.scenicCandidate();
      const toX = scenic.x - this.state.x;
      const toZ = scenic.z - this.state.z;
      const alignment = Math.abs(toX * ridge.axisX + toZ * ridge.axisZ) / Math.max(1, Math.hypot(toX, toZ));
      if (Math.acos(clamp(alignment, 0, 1)) > RIDGE.scenicOffAxis && this.world.interest(scenic.x, scenic.z) > RIDGE.scenicInterest) {
        this.leaveRidge(scenic);
        return;
      }
      const from = Math.atan2(ridge.axisX * ridge.direction, ridge.axisZ * ridge.direction);
      const intoWind = Math.atan2(-ridge.upX, -ridge.upZ);
      ridge.turnSign = Math.sign(wrapAngle(intoWind - from)) || 1;
      ridge.direction = ridge.direction > 0 ? -1 : 1;
    }
    let headingError: number;
    const beatHeading = Math.atan2(ridge.axisX * ridge.direction, ridge.axisZ * ridge.direction);
    if (ridge.turnSign !== 0 && Math.abs(wrapAngle(beatHeading - this.state.heading)) > 0.35) {
      headingError = ridge.turnSign * Math.PI / 2;
    } else {
      ridge.turnSign = 0;
      const ahead = aim(160 * ridge.direction);
      const aimX = ahead.x + ridge.trackX - goal.x;
      const aimZ = ahead.z + ridge.trackZ - goal.z;
      headingError = wrapAngle(Math.atan2(aimX - this.state.x, aimZ - this.state.z) - this.state.heading);
    }
    this.steer(headingError, dt);
    const crosswind = wind.x * Math.cos(this.state.heading) - wind.z * Math.sin(this.state.heading);
    const crab = -Math.asin(clamp(crosswind / CRUISE_SPEED, -1, 1));
    this.state.crab = (this.state.crab ?? 0) + (crab - (this.state.crab ?? 0)) * ease;

    // Windward band only: 40 m beyond the steep face up to the crest, 20 m over the slope to 120 m over the crest.
    const upwind = (ridge.crestX - this.state.x) * ridge.upX + (ridge.crestZ - this.state.z) * ridge.upZ;
    const below = this.world.sample(this.state.x, this.state.z).height;
    const inBand = upwind >= 0 && upwind <= ridge.faceDepth + RIDGE.bandUpwind
      && this.state.y >= below + RIDGE.bandBelow && this.state.y <= ridge.crestHeight + RIDGE.bandAbove;
    if (inBand) this.state.y += Math.min(climb * dt, Math.max(0, this.flightGround + this.heightRange.max - this.state.y));
    else this.state.y -= GLIDE_SINK_RATE * dt;

    ridge.weakTime = climb < RIDGE.weakClimb ? ridge.weakTime + dt : 0;
    const clearance = this.state.y - ground;
    if (this.behaviorTime > 0 && (clearance >= this.heightRange.max || clearance < this.heightRange.min
      || ridge.weakTime >= RIDGE.weakSeconds || faceEnded
      || this.behaviorTime >= RIDGE.exitSeconds || this.behaviorTime >= RIDGE.hardSeconds)) {
      this.leaveRidge();
    }
  }

  /** Gliding owns recovery; the same crest stays closed for 45 s so one exit cannot reset the clock. */
  private leaveRidge(target?: { x: number; z: number }): void {
    if (this.ridge) this.ridgeLockout = { x: this.ridge.crestX, z: this.ridge.crestZ, until: this.totalTime + RIDGE.lockoutSeconds };
    this.ridge = null;
    this.enterGliding(target);
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

  private enterGliding(target?: { x: number; z: number }): void {
    this.thermal = null;
    this.enter('gliding');
    if (target) this.target = target;
    else this.chooseScenicTarget();
  }

  private enter(behavior: EagleBehavior): void {
    const previous = this.state.behavior;
    this.state.behavior = behavior;
    this.behaviorTime = 0;
    if (behavior !== 'gliding') this.shore = null;
    else if (previous !== 'gliding') this.glideStart = this.totalTime;
    if (behavior !== 'ridge-soaring') this.ridge = null;
    this.ridgeGate = 0;
    if (behavior === 'thermal-riding') this.beginRide();
  }

  private get compassBearing(): number {
    return this.seedAngle + fbm1d(this.totalTime / 300, this.world.seed + COMPASS_SEED) * Math.PI / 2;
  }

  private chooseScenicTarget(): void {
    this.target = this.nextShoreTarget() ?? this.scenicCandidate();
  }

  /**
   * Near a lake shore, some targets trace up to half the shore, then the compass resumes.
   * Keyed to lake discs, not to a biome weight, so any biome's lakes qualify.
   */
  private nextShoreTarget(): { x: number; z: number } | null {
    if (!this.shore) {
      const near = this.world.nearestLake(this.state.x, this.state.z);
      if (!near || near.shoreDist > SHORE.reach) return null;
      const lake = near.reach;
      if (this.lastShore && this.totalTime - this.lastShore.time < SHORE.revisitSeconds
        && Math.hypot(lake.ax - this.lastShore.x, lake.az - this.lastShore.z) < 1) return null;
      if (hash2(this.scenicIndex, Math.floor(lake.ax), this.world.seed + 433) > SHORE.odds) return null;
      const angle = Math.atan2(this.state.z - lake.az, this.state.x - lake.ax);
      const bearing = this.compassBearing;
      // Go round the side whose tangent agrees with the route compass.
      const sign = -Math.sin(angle) * Math.sin(bearing) + Math.cos(angle) * Math.cos(bearing) >= 0 ? 1 : -1;
      this.shore = { lake, angle, sign, arcLeft: SHORE.arc };
      this.lastShore = { x: lake.ax, z: lake.az, time: this.totalTime };
    }
    const shore = this.shore;
    if (shore.arcLeft <= 0) {
      this.shore = null;
      return null;
    }
    const step = Math.min(shore.arcLeft, SHORE.leg / (shore.lake.aWidth / 2 + SHORE.offset));
    shore.angle += shore.sign * step;
    shore.arcLeft -= step;
    this.scenicIndex += 1;
    return lakeShorePoint(shore.lake, shore.angle, SHORE.offset);
  }

  private scenicCandidate(): { x: number; z: number } {
    this.scenicIndex += 1;
    const bearing = this.compassBearing;
    const mountain = highlandWeight(this.world.sample(this.state.x, this.state.z).mountainRegion);
    // Keep the long-lived compass through a pass; do not let a thermal's exit yaw
    // turn valley preference into repeated trips around the same basin.
    const routeHeading = bearing;
    let best = { x: this.state.x, z: this.state.z };
    let bestScore = -Infinity;
    for (let candidate = 0; candidate < 6; candidate += 1) {
      const variation = (hash2(this.scenicIndex * 6 + candidate, Math.floor(this.state.x / 400), this.world.seed + 419) - 0.5) * 1.35;
      const distance = 720 + hash2(this.scenicIndex * 6 + candidate, Math.floor(this.state.z / 400), this.world.seed + 421) * 680;
      const heading = routeHeading + variation;
      const x = this.state.x + Math.sin(heading) * distance;
      const z = this.state.z + Math.cos(heading) * distance;
      // Valley routing: in Highlands the cost is the highest point on the path, its col, so the
      // bird follows the valley floor and crosses a ridge at its lowest pass.
      const midpoint = this.world.sample((this.state.x + x) / 2, (this.state.z + z) / 2);
      const destination = this.world.sample(x, z);
      let pathHeight = Math.max(midpoint.height, destination.height);
      for (const fraction of mountain > 0 ? [0.25, 0.75] : []) {
        pathHeight = Math.max(pathHeight, this.world.sample(this.state.x + (x - this.state.x) * fraction, this.state.z + (z - this.state.z) * fraction).height);
      }
      const climb = Math.max(0, pathHeight - this.flightGround);
      const score = this.world.interest(x, z) + 0.25 * Math.cos(heading - bearing) - mountain * climb / 160;
      if (score <= bestScore) continue;
      bestScore = score;
      best = { x, z };
    }
    return best;
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
    this.group.rotation.y = state.heading + (state.crab ?? 0);
    this.group.rotation.z = state.bank;
    const flap = state.flapping ? Math.sin(this.time * 8) * 0.28 : Math.sin(this.time * 1.15) * 0.025;
    this.leftWing.rotation.z = -flap;
    this.rightWing.rotation.z = flap;
  }
}
