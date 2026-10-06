import * as THREE from 'three';
import { globalWind, type Wind } from './wind';
import type { Daylight, Vec3 } from './sky-cycle';
import { BONE, buildEagleMesh, FINGER_COUNT, sideBones } from './eagle-model';
import { fbm, hash2, highlandWeight, type Shore, Thermal, WorldModel } from './world';

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
/** Fixed height band above local ground: it guides low flight and caps thermal and ridge climbs. */
export const FLIGHT_HEIGHT: FlightHeightRange = { min: 50, max: 800 };

/**
 * Fly With Me's cycle: ride a thermal to a top near 700 m above sea level, dive at 5–6 m/s to a cruise
 * height of 50–150 m, hold it ±30 m by flapping for 300 s, then seek the next thermal.
 * Each cycle draws its own top, dive rate and cruise height.
 */
export const CYCLE = {
  top: 700,
  topVariation: 50,
  diveRate: { min: 5, max: 6 },
  cruise: { min: 50, max: 150 },
  cruiseWander: 30,
  cruiseSeconds: 300,
  /** The first cruise is short, so a new flight soon shows a climb. */
  firstCruiseSeconds: 30,
  /** Lift that fades this far below the top sends the bird to the next thermal, not into a dive. */
  reseekBelowTop: 150,
  /** A climb over high ground still rises at least this far. */
  minRide: 250,
} as const;
export type FlightPhase = 'lift' | 'dive' | 'cruise';

const SKY_LOW = { min: Math.sin(-4 * Math.PI / 180), max: Math.sin(12 * Math.PI / 180) } as const;

/**
 * Bearing to the show in the sky, as Fly With Me heads for it: a low sun at sunrise or
 * sunset, a low moon after dark, or the galaxy core on a dark night. Null when none is up.
 */
export function skyBearing(body: Daylight, milkyWay: number, core: Vec3): number | null {
  const low = (y: number) => y > SKY_LOW.min && y < SKY_LOW.max;
  if (low(body.sun.y)) return Math.atan2(body.sun.x, body.sun.z);
  if (body.sun.y < 0 && low(body.moon.y) && body.moonLit > 0.25) return Math.atan2(body.moon.x, body.moon.z);
  if (milkyWay > 0.5) return Math.atan2(core.x, core.z);
  return null;
}

export const GLIDE_SINK_RATE = 1; // m/s, per CONTEXT.md: Gliding
export const FLAP_CLIMB_RATE = 4; // m/s while flapping
const FLAP_BURST_SECONDS = 0.9; // a few wing beats, then glide again
// ponytail: last-resort collision floor; normal flapping keeps clearance well above this.
export const TERRAIN_SAFETY_MARGIN = 6;
export const THERMAL_RADIUS_RANGE = { min: 60, max: 120 } as const;
export const THERMAL_BANK_RANGE = { min: (10 * Math.PI) / 180, max: (20 * Math.PI) / 180 } as const;
export const THERMAL_CLIMB_RANGE = { min: 12, max: 16 } as const;
const THERMAL_CIRCLE_SPEED = 14; // m/s; a 60–120 m radius turns at 0.12–0.23 rad/s and banks 10–20°
const THERMAL_WEAK_LIFT = 0.18;
const CRUISE_SPEED = 32;
/** A seek that has not reached its thermal in two minutes picks again. */
const SEEK_SECONDS = 120;
const MAX_TURN_RATE = 0.48;

/** Roll rate limit, so entries and exits bank in rather than snap. */
const BANK_RATE = 45 * Math.PI / 180;
/** A thermal column leans downwind: the circle drifts with this share of the wind. */
const THERMAL_WIND_DRIFT = 0.7;
/**
 * Arrow-key nudge. A turn bends the course; a turn of `adoptMin` or more becomes the compass
 * bearing for `adoptSeconds`. A smaller bend holds for `holdSeconds`, then eases back.
 */
export const NUDGE = { turnRate: 30 * Math.PI / 180, maxBias: 110 * Math.PI / 180, holdSeconds: 2, decaySeconds: 3,
  adoptMin: 20 * Math.PI / 180, adoptSeconds: 180, leaveSeconds: 0.8, diveSink: 4 } as const;
export type NudgeInput = { turn: number; climb: number };
export type NudgeStatus = { turn: number; climb: number; bias: number; resumeIn: number; adopted: number };

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
  /**
   * Straight crest the bird may join. The old broad ridge used 700 m. A 1.6 km
   * arête is peaked, so the seed-57 hour's aligned windward crest is 320 m.
   * Shorter spurs stay ineligible. Slope, wind, and the 40 m crest drop are unchanged.
   */
  minSegment: 320,
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

/**
 * Look-ahead climb after fly-with-me `climbAhead` (#88). Summits rise faster than the
 * bird climbs, so in Highlands it flaps for the height it needs now to clear the path
 * ahead at four fifths of its flapping climb. If even a full climb cannot clear a heading,
 * the bird steers to the nearest heading it can clear, and returns once the way is open.
 */
const CLIMB_AHEAD = {
  reach: 2200,
  step: 60,
  climbShare: 0.8,
  /** Look this far past a target: a summit behind it is the next leg's concern. */
  pastTarget: 300,
  seconds: 0.5,
  detours: [20, 40, 60, 90, 120].map((degrees) => degrees * DEGREE),
  /** Height the bird must have spare before it leaves a detour, so it does not dither. */
  resume: 30,
} as const;

/** Four coast-following legs, then the compass takes over again. */
const SHORE = { reach: 700, odds: 0.6, offset: 60, leg: 300, revisitSeconds: 600 } as const;

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
type ShoreTrace = { point: Shore; sign: 1 | -1; legsLeft: number };

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
  private readonly heightRange: FlightHeightRange;
  private circleAngle = 0;
  private circleRadius = 90;
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
  private shore: ShoreTrace | null = null;
  private aheadAge: number = CLIMB_AHEAD.seconds;
  private climbNeed = -Infinity;
  private detour: number | null = null;
  private lastShore: { x: number; z: number; time: number } | null = null;
  private phase: FlightPhase = 'cruise';
  private phaseSince = CYCLE.firstCruiseSeconds - CYCLE.cruiseSeconds;
  private cycleIndex = 0;
  private topOffset = 0;
  private diveRate: number = CYCLE.diveRate.min;
  private cruiseHeight: number = CYCLE.cruise.min;
  private skyGoal: number | null = null;
  private airspeed = CRUISE_SPEED;
  private orbitSign: 1 | -1 = 1;
  private circleSpeed = THERMAL_CIRCLE_SPEED;
  private circleCentre = { x: 0, z: 0 };
  private nudgeInput: NudgeInput = { turn: 0, climb: 0 };
  private headingBias = 0;
  private nudgeIdle = Infinity;
  private turnHeld = 0;
  private nudgedBearing: { bearing: number; until: number } | null = null;

  constructor(world: WorldModel, start: { x: number; z: number; heading: number }, heightRange = FLIGHT_HEIGHT) {
    this.world = world;
    this.seedAngle = hash2(0, 0, world.seed + COMPASS_SEED) * Math.PI * 2;
    this.heightRange = heightRange;
    this.drawCycle();
    const startSample = world.sample(start.x, start.z);
    const startGround = startSample.water ? startSample.surface : startSample.height;
    const ground = startGround + highlandWeight(startSample.mountainRegion) * (this.highestGround(start.x, start.z) - startGround);
    this.smoothedGround = ground;
    this.groundEnvelope = ground;
    this.state = { x: start.x, y: ground + this.holdClearance, z: start.z, heading: start.heading, bank: 0, behavior: 'gliding', flapping: false };
    this.chooseScenicTarget();
  }

  get flightSeconds(): number {
    return this.totalTime;
  }

  /** The flight cycle: its phase, the thermal top over the current ground, and the cruise clearance. */
  get cycle(): { phase: FlightPhase; top: number; cruise: number } {
    return { phase: this.phase, top: this.thermalTop(this.smoothedGround), cruise: this.holdClearance };
  }

  /** Main passes the bearing of the show in the sky, or null; see `skyBearing`. */
  setSkyBearing(bearing: number | null): void {
    this.skyGoal = bearing;
  }

  get flightGround(): number {
    return this.smoothedGround;
  }

  get activeThermal(): Thermal | null {
    return this.thermal;
  }

  /** The centre of the circle being flown. It starts tangent to the entry and eases onto the thermal. */
  get orbitCentre(): { x: number; z: number } | null {
    return this.state.behavior === 'thermal-riding' ? { ...this.circleCentre } : null;
  }

  /** The global wind at this navigator's simulation time. */
  get wind(): Wind {
    return globalWind(this.world.seed, this.totalTime);
  }

  /** Predicted orographic climb of the face being watched or flown, in m/s. */
  get ridgeLift(): number {
    return this.liftRate;
  }

  setNudge(input: NudgeInput): void {
    this.nudgeInput = input;
  }

  get nudgeStatus(): NudgeStatus {
    const resumeIn = this.nudgeIdle === Infinity ? 0 : Math.max(0, NUDGE.holdSeconds + NUDGE.decaySeconds - this.nudgeIdle);
    return { ...this.nudgeInput, bias: this.headingBias, resumeIn: Math.abs(this.headingBias) > 0.02 ? resumeIn : 0,
      adopted: this.nudgedBearing ? Math.max(0, this.nudgedBearing.until - this.totalTime) : 0 };
  }

  /** Arrow keys bias the autopilot; terrain safety and the height floor still win. */
  private applyNudge(dt: number): void {
    const { turn, climb } = this.nudgeInput;
    const active = turn !== 0 || climb !== 0;
    const wasTurning = this.turnHeld > 0;
    this.turnHeld = turn !== 0 ? this.turnHeld + dt : 0;
    if (active) this.nudgeIdle = 0;
    else this.nudgeIdle += dt;
    if (turn !== 0) {
      this.headingBias = clamp(this.headingBias + turn * NUDGE.turnRate * dt, -NUDGE.maxBias, NUDGE.maxBias);
      // Holding a turn while circling or beating a ridge leaves it toward the new side.
      if ((this.state.behavior === 'thermal-riding' || this.state.behavior === 'ridge-soaring') && this.turnHeld >= NUDGE.leaveSeconds) {
        const heading = this.state.heading + turn * 0.6;
        this.leaveRidge({ x: this.state.x + Math.sin(heading) * 1500, z: this.state.z + Math.cos(heading) * 1500 });
        this.headingBias = 0;
      }
      if (this.state.behavior === 'thermal-seeking') this.enterGliding();
    } else if (wasTurning && Math.abs(this.headingBias) >= NUDGE.adoptMin) {
      // The compass follows the new heading for three minutes, then drifts home.
      this.nudgedBearing = { bearing: this.state.heading, until: this.totalTime + NUDGE.adoptSeconds };
      this.headingBias = 0;
      this.target = this.scenicCandidate();
    } else if (this.nudgeIdle > NUDGE.holdSeconds) {
      this.headingBias *= Math.exp(-dt / NUDGE.decaySeconds * 2);
    }
    if (this.nudgedBearing && this.totalTime > this.nudgedBearing.until) this.nudgedBearing = null;
  }

  update(deltaSeconds: number): EagleState {
    const dt = Math.min(deltaSeconds, 0.1);
    this.behaviorTime += dt;
    this.totalTime += dt;
    this.applyNudge(dt);
    if (this.state.behavior !== 'thermal-riding') {
      this.airspeed += (CRUISE_SPEED - this.airspeed) * (1 - Math.exp(-dt / 4));
    }
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

    if (this.state.behavior === 'gliding' || this.state.behavior === 'thermal-seeking') this.watchRidge(dt, ground);
    if (this.state.behavior !== 'thermal-riding' && this.state.behavior !== 'ridge-soaring') {
      if (this.state.behavior === 'thermal-seeking' && this.thermal) {
        this.target.x = this.thermal.x;
        this.target.z = this.thermal.z;
        const distance = Math.hypot(this.state.x - this.thermal.x, this.state.z - this.thermal.z);
        if (distance < 70) this.enter('thermal-riding');
        else if (this.behaviorTime > SEEK_SECONDS && distance > 150) this.enterGliding(); // never give up on a final approach
      } else if (this.phase === 'cruise' && this.totalTime - this.phaseSince >= CYCLE.cruiseSeconds
        // Retry every 5 s if no thermal is in reach. Wait while the viewer steers or holds an adopted course.
        && this.behaviorTime > 5 && this.nudgeIdle > NUDGE.holdSeconds && !this.nudgedBearing) {
        this.seekThermal();
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
    this.state.y = Math.max(this.state.y, Math.max(current.height, current.water ? current.surface : current.height) + TERRAIN_SAFETY_MARGIN);
    return this.state;
  }

  /** Draw this cycle's top, dive rate and cruise height. */
  private drawCycle(): void {
    this.cycleIndex += 1;
    const draw = (salt: number) => hash2(this.cycleIndex, salt, this.world.seed + 541);
    this.topOffset = (draw(1) * 2 - 1) * CYCLE.topVariation;
    this.diveRate = CYCLE.diveRate.min + draw(2) * (CYCLE.diveRate.max - CYCLE.diveRate.min);
    this.cruiseHeight = CYCLE.cruise.min + draw(3) * (CYCLE.cruise.max - CYCLE.cruise.min);
  }

  /** Clearance the bird holds by flapping: the cruise height, wandering up to 30 m. */
  private get holdClearance(): number {
    const wander = clamp(fbm1d(this.totalTime / 60, this.world.seed + 527), -1, 1) * CYCLE.cruiseWander;
    return clamp(this.cruiseHeight + wander, this.heightRange.min, this.heightRange.max);
  }

  /**
   * World height where this cycle's thermal climb ends: about 700 m above sea level, so lowland
   * climbs pass the 600 m cloud deck. High ground still gets a 250 m climb, within the 800 m cap.
   */
  private thermalTop(ground: number): number {
    return clamp(CYCLE.top + this.topOffset, ground + CYCLE.minRide, ground + this.heightRange.max);
  }

  /** Leaving a thermal high starts the dive; leaving it low starts the cruise. */
  private leaveLift(): void {
    this.drawCycle();
    this.phase = this.state.y - this.smoothedGround > this.holdClearance + 60 ? 'dive' : 'cruise';
    this.phaseSince = this.totalTime;
  }

  /** Sample the 250 m disk, not just the point below the bird. Refresh at 2 Hz. */
  private highestGround(x: number, z: number): number {
    let highest = -Infinity;
    for (let dz = -250; dz <= 250; dz += 125) {
      for (let dx = -250; dx <= 250; dx += 125) {
        if (dx * dx + dz * dz > 250 ** 2) continue;
        const sample = this.world.sample(x + dx, z + dz);
        highest = Math.max(highest, sample.height, sample.surface);
      }
    }
    return highest;
  }

  /** Trade forward progress, not a vertical jump, when a face outruns climb lift. */
  private moveAboveTerrain(dx: number, dz: number): void {
    // Continental mountains can stand in any climate biome. Movement protection
    // follows ground and sea level, never the Highlands appearance weight.
    const clear = (fraction: number) => {
      const sample = this.world.sample(this.state.x + dx * fraction, this.state.z + dz * fraction);
      return Math.max(sample.height, sample.surface) + TERRAIN_SAFETY_MARGIN + 6 < this.state.y;
    };
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
    const desiredHeading = wrapAngle(Math.atan2(this.target.x - this.state.x, this.target.z - this.state.z) + this.headingBias);
    // Height is independent of biome selection now. Check every flight route.
    this.aheadAge += dt;
    if (this.aheadAge >= CLIMB_AHEAD.seconds) {
      this.aheadAge = 0;
      this.planAhead(desiredHeading);
    }
    const headingError = wrapAngle((this.detour !== null && Math.abs(this.headingBias) < 0.02 ? this.detour : desiredHeading) - this.state.heading);
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

  /**
   * Height needed now to clear the path along a heading: at a share of the flapping climb
   * (`need`) and at the full climb (`full`). Both keep the flap floor over each point.
   */
  private climbAlong(heading: number, reach: number): { need: number; full: number } {
    const floor = this.holdClearance;
    const dx = Math.sin(heading);
    const dz = Math.cos(heading);
    let need = -Infinity;
    let full = -Infinity;
    for (let along = CLIMB_AHEAD.step; along <= reach; along += CLIMB_AHEAD.step) {
      const sample = this.world.sample(this.state.x + dx * along, this.state.z + dz * along);
      const clear = Math.max(sample.height, sample.surface) + floor;
      const climb = along / CRUISE_SPEED * FLAP_CLIMB_RATE;
      need = Math.max(need, clear - climb * CLIMB_AHEAD.climbShare);
      full = Math.max(full, clear - climb);
    }
    return { need, full };
  }

  /** Hold the look-ahead climb for the way ahead, or steer round ground the bird cannot out-climb. */
  private planAhead(desiredHeading: number): void {
    const reach = Math.min(CLIMB_AHEAD.reach,
      Math.hypot(this.target.x - this.state.x, this.target.z - this.state.z) + CLIMB_AHEAD.pastTarget);
    const y = this.state.y;
    const direct = this.climbAlong(desiredHeading, reach);
    if (direct.full <= y - (this.detour === null ? 0 : CLIMB_AHEAD.resume)) {
      this.detour = null;
      this.climbNeed = direct.need;
      return;
    }
    // Try the side of the current detour first, so the bird does not swap sides around a summit.
    const side = this.detour === null ? 1 : Math.sign(wrapAngle(this.detour - desiredHeading)) || 1;
    let best = { heading: desiredHeading, ...direct };
    for (const offset of CLIMB_AHEAD.detours) {
      for (const sign of [side, -side]) {
        const heading = wrapAngle(desiredHeading + sign * offset);
        const path = this.climbAlong(heading, reach);
        if (path.full < best.full) best = { heading, ...path };
        if (path.full <= y) break;
      }
      if (best.full <= y) break;
    }
    this.detour = best.heading === desiredHeading ? null : best.heading;
    this.climbNeed = best.need;
  }

  private steer(headingError: number, dt: number): void {
    this.state.heading = wrapAngle(this.state.heading + clamp(headingError, -MAX_TURN_RATE, MAX_TURN_RATE) * dt);
    const bankStep = (clamp(-headingError * 0.78, -0.48, 0.48) - this.state.bank) * Math.min(1, dt * 2.2);
    this.state.bank += clamp(bankStep, -BANK_RATE * dt, BANK_RATE * dt);
    this.moveAboveTerrain(Math.sin(this.state.heading) * this.airspeed * dt, Math.cos(this.state.heading) * this.airspeed * dt);
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
    const shore = this.world.nearestShore(x, z, RIDGE.lakeBank.max + 80);
    return !!shore && shore.distance >= RIDGE.lakeBank.min && shore.distance <= RIDGE.lakeBank.max
      && Math.cos(face.angle) * shore.normalX + Math.sin(face.angle) * shore.normalZ > 0;
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
    // A dive goes down to the cruise; a ridge on the way does not catch it.
    if (committedSeek || !gate || this.phase === 'dive') {
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

  /** A qualifying crest along a straight axis, close to the bird. The caller checks alignment. */
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

  // Gliding sinks and a dive sinks faster; a flap burst climbs back to the held clearance
  // when the bird drops under it here or ahead.
  private updateHeightEnergy(dt: number, ground: number, lookAheadGround: number): void {
    const floorTrigger = this.holdClearance;
    const clearance = this.state.y - ground;
    const aheadClearance = this.state.y - lookAheadGround;
    if (this.phase === 'dive' && clearance <= floorTrigger) {
      this.phase = 'cruise';
      this.phaseSince = this.totalTime;
    }
    const diving = this.phase === 'dive' && aheadClearance > floorTrigger && this.state.y >= this.climbNeed;
    if (!this.state.flapping && !diving && (clearance < floorTrigger || aheadClearance < floorTrigger || this.state.y < this.climbNeed)) {
      this.state.flapping = true;
      this.flapTimer = FLAP_BURST_SECONDS;
    }
    const climbNudge = this.nudgeInput.climb;
    if (climbNudge > 0 && !this.state.flapping && clearance < this.heightRange.max) {
      this.state.flapping = true;
      this.flapTimer = FLAP_BURST_SECONDS;
    }
    if (climbNudge < 0 && !this.state.flapping && clearance > floorTrigger + 10 && aheadClearance > floorTrigger + 10) {
      this.state.y -= NUDGE.diveSink * dt;
      this.airspeed = Math.min(CRUISE_SPEED * 1.25, this.airspeed + 2 * dt);
    }
    if (this.state.flapping) {
      this.state.y += FLAP_CLIMB_RATE * dt;
      this.flapTimer -= dt;
      if (this.flapTimer <= 0) this.state.flapping = false;
    } else {
      this.state.y -= (diving ? this.diveRate : GLIDE_SINK_RATE) * dt;
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
    // Roll into a circle tangent to the current heading, on the thermal's side, at the arrival speed.
    // The circle then slides onto the core: the bird centres the lift instead of snapping to it.
    const side = inwardThermalBankSign(this.state.heading, this.state.x, this.state.z, this.thermal.x, this.thermal.z) < 0 ? 1 : -1;
    const radius = this.orbitRadius;
    this.circleCentre = { x: this.state.x + Math.cos(this.state.heading) * side * radius,
      z: this.state.z - Math.sin(this.state.heading) * side * radius };
    this.circleAngle = Math.atan2(this.state.z - this.circleCentre.z, this.state.x - this.circleCentre.x);
    const plus = Math.abs(wrapAngle(-this.circleAngle - this.state.heading));
    const minus = Math.abs(wrapAngle(Math.PI - this.circleAngle - this.state.heading));
    this.orbitSign = plus <= minus ? 1 : -1;
    this.circleSpeed = this.airspeed;
  }

  /** The circle radius breathes a little around its eased target. */
  private get orbitRadius(): number {
    return clamp(this.circleRadius + Math.sin(this.totalTime * 0.35) * 2.5, THERMAL_RADIUS_RANGE.min, THERMAL_RADIUS_RANGE.max);
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
    const wind = this.wind;
    const driftX = wind.x * THERMAL_WIND_DRIFT * dt;
    const driftZ = wind.z * THERMAL_WIND_DRIFT * dt;
    this.thermalCore.x += driftX;
    this.thermalCore.z += driftZ;
    // The circle drifts with the air too, so centring closes only the entry offset.
    this.circleCentre.x += driftX;
    this.circleCentre.z += driftZ;
    this.circleSpeed += (THERMAL_CIRCLE_SPEED - this.circleSpeed) * (1 - Math.exp(-dt / 3));
    this.airspeed = this.circleSpeed;
    const driftRadius = 6 + (1 - strengthT) * 4;
    this.thermal.x = this.thermalCore.x + Math.cos(this.circleDrift) * driftRadius;
    this.thermal.z = this.thermalCore.z + Math.sin(this.circleDrift) * driftRadius;

    this.circleRadius += (this.targetRadius - this.circleRadius) * Math.min(1, dt * 0.35);
    const radius = this.orbitRadius;
    const centre = this.circleCentre;
    const core = 1 - Math.exp(-dt / 8);
    centre.x += (this.thermal.x - centre.x) * core;
    centre.z += (this.thermal.z - centre.z) * core;
    // Advance from the bird's own bearing, so moving the circle bends the path instead of adding speed.
    this.circleAngle = Math.atan2(this.state.z - centre.z, this.state.x - centre.x)
      + dt * this.orbitSign * (this.circleSpeed / radius);
    const desiredX = centre.x + Math.cos(this.circleAngle) * radius;
    const desiredZ = centre.z + Math.sin(this.circleAngle) * radius;
    // A blocked step must catch up at flight speed, never in one jump.
    const step = Math.hypot(desiredX - this.state.x, desiredZ - this.state.z);
    const limit = Math.min(1, this.circleSpeed * 1.3 * dt / Math.max(step, 1e-6));
    this.moveAboveTerrain((desiredX - this.state.x) * limit, (desiredZ - this.state.z) * limit);
    const tangent = wrapAngle(this.orbitSign > 0 ? -this.circleAngle : Math.PI - this.circleAngle);
    this.state.heading = wrapAngle(this.state.heading + wrapAngle(tangent - this.state.heading) * Math.min(1, dt * 2.4));

    const span = THERMAL_RADIUS_RANGE.max - THERMAL_RADIUS_RANGE.min;
    const bankSpan = THERMAL_BANK_RANGE.max - THERMAL_BANK_RANGE.min;
    const bankMag = THERMAL_BANK_RANGE.max - ((radius - THERMAL_RADIUS_RANGE.min) / span) * bankSpan
      + Math.sin(this.totalTime * 0.5) * ((1.5 * Math.PI) / 180);
    const bankSign = inwardThermalBankSign(
      this.state.heading, this.state.x, this.state.z, centre.x, centre.z,
    );
    const targetBank = bankSign * clamp(bankMag, THERMAL_BANK_RANGE.min, THERMAL_BANK_RANGE.max);
    const bankStep = (targetBank - this.state.bank) * Math.min(1, dt * 1.4);
    this.state.bank += clamp(bankStep, -BANK_RATE * dt, BANK_RATE * dt);

    // A falling reference must not teleport the bird down when crossing a crest.
    const top = this.thermalTop(ground);
    this.state.y += Math.min(climbRate * dt, Math.max(0, top - this.state.y));
    // Skip the top/weaken exit on the entry tick: gliding can arrive already at the top over low ground,
    // and this guarantees at least one visible thermal-riding tick before assessing it.
    if (this.behaviorTime <= 0) return;
    if (this.state.y >= top - 0.5) {
      this.enterGliding();
    } else if (this.rideLift < THERMAL_WEAK_LIFT) {
      this.enterGliding();
      // Lift that fades well short of the top sends the bird to the next thermal.
      if (this.state.y < top - CYCLE.reseekBelowTop) {
        this.phase = 'cruise';
        this.phaseSince = -Infinity;
      }
    }
  }

  private seekThermal(): void {
    // Two 1.8 km cells give the eagle a 3.6 km thermal search reach.
    const thermals = this.world.nearbyThermals(this.state.x, this.state.z, 2);
    const bearing = this.compassBearing;
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
    if (behavior === 'thermal-riding') this.phase = 'lift';
    else if (previous === 'thermal-riding') this.leaveLift();
    if (behavior !== 'ridge-soaring') this.ridge = null;
    this.ridgeGate = 0;
    // A new leg plans its own way ahead on its first tick.
    this.aheadAge = CLIMB_AHEAD.seconds;
    this.climbNeed = -Infinity;
    this.detour = null;
    if (behavior === 'thermal-riding') this.beginRide();
  }

  private get compassBearing(): number {
    if (this.nudgedBearing) return this.nudgedBearing.bearing;
    if (this.skyGoal !== null) return this.skyGoal;
    return this.seedAngle + fbm1d(this.totalTime / 300, this.world.seed + COMPASS_SEED) * Math.PI / 2;
  }

  private chooseScenicTarget(): void {
    this.target = this.nextShoreTarget() ?? this.scenicCandidate();
  }

  /** Follow actual sea-level shore crossings for a few legs, then resume the compass. */
  private nextShoreTarget(): { x: number; z: number } | null {
    if (!this.shore) {
      const near = this.world.nearestShore(this.state.x, this.state.z, SHORE.reach + 80);
      if (!near || near.distance > SHORE.reach) return null;
      if (this.lastShore && this.totalTime - this.lastShore.time < SHORE.revisitSeconds
        && Math.hypot(near.x - this.lastShore.x, near.z - this.lastShore.z) < SHORE.leg * 4) return null;
      if (hash2(this.scenicIndex, Math.floor(near.x), this.world.seed + 433) > SHORE.odds) return null;
      const sign = -near.normalZ * Math.sin(this.compassBearing) + near.normalX * Math.cos(this.compassBearing) >= 0 ? 1 : -1;
      this.shore = { point: near, sign, legsLeft: 4 };
      this.lastShore = { x: near.x, z: near.z, time: this.totalTime };
    }
    const trace = this.shore;
    if (trace.legsLeft-- <= 0) { this.shore = null; return null; }
    const point = trace.point;
    const next = this.world.nearestShore(point.x - point.normalZ * trace.sign * SHORE.leg,
      point.z + point.normalX * trace.sign * SHORE.leg, SHORE.leg * 2);
    if (!next) { this.shore = null; return null; }
    trace.point = next;
    this.scenicIndex++;
    // Walk outward until the target is genuinely dry, not just tangent-plane dry.
    for (let offset = SHORE.offset; offset <= SHORE.leg; offset += 30) {
      const target = { x: next.x + next.normalX * offset, z: next.z + next.normalZ * offset };
      if (!this.world.sample(target.x, target.z).water) return target;
    }
    this.shore = null;
    return null;
  }

  private scenicCandidate(): { x: number; z: number } {
    this.scenicIndex += 1;
    const bearing = this.compassBearing;
    const local = this.world.sample(this.state.x, this.state.z);
    const mountain = highlandWeight(local.mountainRegion);
    const lakeland = local.biome.lakeland;
    // Keep the long-lived compass through a pass; do not let a thermal's exit yaw
    // turn valley preference into repeated trips around the same basin.
    const routeHeading = bearing;
    let best = { x: this.state.x, z: this.state.z };
    let bestScore = -Infinity;
    for (let candidate = 0; candidate < 6; candidate += 1) {
      const variation = (hash2(this.scenicIndex * 6 + candidate, Math.floor(this.state.x / 400), this.world.seed + 419) - 0.5) * 1.35;
      const distance = 720 + hash2(this.scenicIndex * 6 + candidate, Math.floor(this.state.z / 400), this.world.seed + 421) * (680 + lakeland * 600);
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

/** Wing and tail shape for each behavior. Flapping and a dive tuck blend over these. */
type WingPose = { dihedral: number; sweep: number; splay: number; fan: number; tip: number; tailPitch: number };
const WING_POSES: Record<EagleBehavior, WingPose> = {
  // Golden eagles glide with a shallow dihedral and the wrists slightly back.
  gliding: { dihedral: 0.13, sweep: 0.12, splay: 0.45, fan: 0.15, tip: 0.06, tailPitch: 0 },
  'thermal-seeking': { dihedral: 0.12, sweep: 0.2, splay: 0.35, fan: 0.1, tip: 0.05, tailPitch: 0 },
  // Circling: wings fully spread, fingers splayed, tail fanned and dipped.
  'thermal-riding': { dihedral: 0.17, sweep: -0.03, splay: 1, fan: 0.9, tip: 0.1, tailPitch: -0.06 },
  // Slope soaring in a stronger wind: wrists swept and tail closed.
  'ridge-soaring': { dihedral: 0.11, sweep: 0.24, splay: 0.3, fan: 0.2, tip: 0.05, tailPitch: 0.02 },
};

export class EagleView {
  readonly group = new THREE.Group();
  private readonly bones: THREE.Bone[];
  private readonly pose: WingPose = { ...WING_POSES.gliding };
  private time = 0;
  private last: { x: number; y: number; z: number } | null = null;
  private climbAngle = 0;
  private flapAmount = 0;
  private flapPhase = 0;
  private tuck = 0;

  constructor() {
    const { mesh, bones } = buildEagleMesh();
    mesh.castShadow = true;
    // The bones move the wings outside the rest-pose bounds.
    mesh.frustumCulled = false;
    this.bones = bones;
    this.group.add(mesh);
    this.group.scale.setScalar(1.15);
  }

  update(state: EagleState, deltaSeconds: number): void {
    this.time += deltaSeconds;
    this.updateBody(state, deltaSeconds);
  }

  /**
   * Body language from the flight path. Pitch follows the climb angle, flaps ease in and out
   * at about 2.7 Hz with a swept upstroke, and a fast descent tucks the wings.
   */
  private updateBody(state: EagleState, dt: number): void {
    const last = this.last ?? state;
    const ground = dt > 0 ? Math.hypot(state.x - last.x, state.z - last.z) / dt : 0;
    // A review jump moves the bird far in one frame. It is not a flight path.
    if (dt > 0 && ground < 200) {
      const vertical = (state.y - last.y) / dt;
      const angle = Math.atan2(vertical, Math.max(ground, 8));
      this.climbAngle += (angle - this.climbAngle) * (1 - Math.exp(-dt / 0.6));
      this.tuck += ((vertical < -6 ? clamp((-vertical - 6) / 6, 0, 1) : 0) - this.tuck) * (1 - Math.exp(-dt / 0.8));
    }
    this.last = { x: state.x, y: state.y, z: state.z };
    this.flapAmount += ((state.flapping ? 1 : 0) - this.flapAmount) * (1 - Math.exp(-dt / 0.18));
    this.flapPhase += dt * Math.PI * 2 * (2.7 * this.flapAmount + 0.18 * (1 - this.flapAmount));
    this.group.position.set(state.x, state.y, state.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = state.heading + (state.crab ?? 0);
    // Positive X rotation lowers the bill. A climb lifts it a little; a dive drops it a lot.
    this.group.rotation.x = clamp(-this.climbAngle * 0.8, -0.18, 0.55) + this.tuck * 0.25;
    this.group.rotation.z = state.bank;

    // The behavior's wing shape eases in over about a second.
    const pose = this.pose;
    const target = WING_POSES[state.behavior];
    const ease = 1 - Math.exp(-dt * 1.4);
    for (const key of Object.keys(target) as (keyof WingPose)[]) pose[key] += (target[key] - pose[key]) * ease;
    const flap = this.flapAmount;
    const glide = 1 - flap;
    const tuck = this.tuck;
    // Fast downstroke, slower swept upstroke; a gliding wing holds its dihedral with a slight flex.
    const stroke = Math.sin(this.flapPhase) + 0.22 * Math.sin(this.flapPhase * 2);
    const gust = Math.sin(this.time * 1.15) * 0.02 + Math.sin(this.time * 3.1) * Math.sin(this.time * 1.7) * 0.012;
    const lift = flap * stroke * 0.5 + glide * (pose.dihedral + gust) - tuck * 0.1;
    // The hand lags the beat; the upstroke folds it back at the wrist.
    const hand = pose.tip + Math.sin(this.time * 1.7) * 0.015 + flap * 0.38 * Math.sin(this.flapPhase - 0.9);
    const fold = flap * Math.max(0, Math.cos(this.flapPhase));
    const splay = (glide * pose.splay + flap * 0.75) * (1 - tuck);
    const bones = this.bones;
    for (const sign of [-1, 1]) {
      const side = sideBones(sign);
      // Positive z-rotation raises the right (+x) wing; the left mirrors it.
      bones[side.shoulder]!.rotation.set(0, sign * (glide * pose.sweep * 0.25 + tuck * 0.35), sign * lift);
      bones[side.elbow]!.rotation.set(0, -sign * fold * 0.3, sign * 0.02);
      bones[side.wrist]!.rotation.set(0, sign * (glide * pose.sweep * 0.7 + fold * 0.85 + tuck * 0.9), sign * hand);
      for (let i = 0; i < FINGER_COUNT; i += 1) {
        // Leading fingers swing forward, trailing ones back; outer ones curl up most.
        const spread = (i - 3) * 0.075 * (splay - 0.5) - fold * 0.04 * (i - 3);
        const flicker = Math.sin(this.time * 7 + i * 1.3) * 0.012 * glide;
        bones[side.finger(i)]!.rotation.set(0, sign * spread, sign * (0.03 * (6 - i) * splay + flicker));
      }
    }
    bones[BONE.tail]!.rotation.set(pose.tailPitch, 0, state.bank * 0.35);
    bones[BONE.tailL]!.rotation.y = pose.fan * 0.42 * (1 - tuck);
    bones[BONE.tailR]!.rotation.y = -pose.fan * 0.42 * (1 - tuck);
    // The head turns into the bank.
    bones[BONE.head]!.rotation.set(0, -state.bank * 0.45, 0);
  }
}
