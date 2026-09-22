import * as THREE from 'three';
import { hash2, Thermal, WorldModel } from './world';

export type EagleBehavior = 'scenic glide' | 'seeking thermal' | 'circling thermal' | 'panoramic cruise';

export type EagleState = {
  x: number;
  y: number;
  z: number;
  heading: number;
  bank: number;
  behavior: EagleBehavior;
};

const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class EagleNavigator {
  readonly state: EagleState;
  private readonly world: WorldModel;
  private behaviorTime = 0;
  private totalTime = 0;
  private target = { x: 0, z: 0 };
  private thermal: Thermal | null = null;
  private scenicIndex = 0;
  private speed = 32;

  constructor(world: WorldModel, start: { x: number; z: number; heading: number }) {
    this.world = world;
    const ground = world.sample(start.x, start.z).height;
    this.state = { x: start.x, y: ground + 105, z: start.z, heading: start.heading, bank: 0, behavior: 'scenic glide' };
    this.chooseScenicTarget();
  }

  get activeThermal(): Thermal | null {
    return this.thermal;
  }

  update(deltaSeconds: number): EagleState {
    const dt = Math.min(deltaSeconds, 0.1);
    this.behaviorTime += dt;
    this.totalTime += dt;
    const ground = this.world.sample(this.state.x, this.state.z).height;
    const altitude = this.state.y - ground;

    if (this.state.behavior === 'circling thermal') {
      this.updateCircle(dt, ground);
    } else {
      if (this.state.behavior === 'seeking thermal' && this.thermal) {
        this.target.x = this.thermal.x;
        this.target.z = this.thermal.z;
        const distance = Math.hypot(this.state.x - this.thermal.x, this.state.z - this.thermal.z);
        if (distance < 70) this.enter('circling thermal');
        else if (this.behaviorTime > 42) this.enterScenic();
      } else if (this.behaviorTime > (this.state.behavior === 'panoramic cruise' ? 22 : 34)) {
        if (altitude < 92 || hash2(Math.floor(this.totalTime / 20), this.scenicIndex, this.world.seed + 401) > 0.64) this.seekThermal();
        else this.enter(this.state.behavior === 'scenic glide' ? 'panoramic cruise' : 'scenic glide');
      }
      this.flyTowardTarget(dt, ground);
    }
    const currentGround = this.world.sample(this.state.x, this.state.z).height;
    this.state.y = Math.max(this.state.y, currentGround + 42);
    return this.state;
  }

  private flyTowardTarget(dt: number, ground: number): void {
    const desiredHeading = Math.atan2(this.target.x - this.state.x, this.target.z - this.state.z);
    const headingError = wrapAngle(desiredHeading - this.state.heading);
    const turnRate = clamp(headingError, -0.48, 0.48);
    this.state.heading = wrapAngle(this.state.heading + turnRate * dt);
    this.state.bank += (clamp(-headingError * 0.78, -0.48, 0.48) - this.state.bank) * Math.min(1, dt * 2.2);
    this.speed += ((this.state.behavior === 'panoramic cruise' ? 38 : 31) - this.speed) * dt * 0.4;
    this.state.x += Math.sin(this.state.heading) * this.speed * dt;
    this.state.z += Math.cos(this.state.heading) * this.speed * dt;

    const lookAhead = this.world.sample(this.state.x + Math.sin(this.state.heading) * 105, this.state.z + Math.cos(this.state.heading) * 105).height;
    const desiredClearance = this.state.behavior === 'panoramic cruise' ? 155 : 86;
    const targetY = Math.max(ground, lookAhead) + desiredClearance + Math.sin(this.totalTime * 0.13) * 10;
    this.state.y += clamp(targetY - this.state.y, -7, 13) * dt * 0.34;

    if (Math.hypot(this.target.x - this.state.x, this.target.z - this.state.z) < 150) {
      if (this.state.behavior === 'seeking thermal') this.seekThermal();
      else this.chooseScenicTarget();
    }
  }

  private updateCircle(dt: number, ground: number): void {
    if (!this.thermal) {
      this.enterScenic();
      return;
    }
    const angle = Math.atan2(this.state.z - this.thermal.z, this.state.x - this.thermal.x) + dt * 0.34;
    const radius = 56;
    const desiredX = this.thermal.x + Math.cos(angle) * radius;
    const desiredZ = this.thermal.z + Math.sin(angle) * radius;
    this.state.x += (desiredX - this.state.x) * Math.min(1, dt * 2.3);
    this.state.z += (desiredZ - this.state.z) * Math.min(1, dt * 2.3);
    this.state.heading = wrapAngle(-angle);
    this.state.bank += (-0.42 - this.state.bank) * Math.min(1, dt * 2);
    this.state.y += this.thermal.strength * dt * 3.1;
    this.state.y = Math.max(this.state.y, ground + 55);
    if (this.behaviorTime > 19 || this.state.y - ground > 205) {
      this.thermal = null;
      this.enter('panoramic cruise');
      this.chooseScenicTarget();
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
      this.enterScenic();
      return;
    }
    this.target = { x: this.thermal.x, z: this.thermal.z };
    this.enter('seeking thermal');
  }

  private enterScenic(): void {
    this.thermal = null;
    this.enter('scenic glide');
    this.chooseScenicTarget();
  }

  private enter(behavior: EagleBehavior): void {
    this.state.behavior = behavior;
    this.behaviorTime = 0;
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

export class EagleView {
  readonly group = new THREE.Group();
  private readonly leftWing = new THREE.Group();
  private readonly rightWing = new THREE.Group();
  private time = 0;

  constructor() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x3d2a1c, roughness: 0.9, flatShading: true });
    const warm = new THREE.MeshStandardMaterial({ color: 0x76502b, roughness: 0.92, flatShading: true });
    const gold = new THREE.MeshStandardMaterial({ color: 0xa87935, roughness: 0.85, flatShading: true });
    const beak = new THREE.MeshStandardMaterial({ color: 0xd5a83e, roughness: 0.75, flatShading: true });

    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), dark);
    body.scale.set(1.15, 0.92, 2.65);
    body.rotation.x = -0.12;
    this.group.add(body);

    const chest = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 5), warm);
    chest.position.set(0, 0.18, 1.85);
    chest.scale.set(0.83, 0.72, 1.12);
    this.group.add(chest);

    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), gold);
    head.position.set(0, 0.34, 2.75);
    head.scale.set(0.88, 0.82, 1);
    this.group.add(head);

    const bill = new THREE.Mesh(new THREE.ConeGeometry(0.31, 0.82, 5), beak);
    bill.rotation.x = Math.PI / 2;
    bill.position.set(0, 0.23, 3.55);
    this.group.add(bill);

    this.leftWing.position.set(-0.75, 0.05, 0.45);
    this.rightWing.position.set(0.75, 0.05, 0.45);
    this.leftWing.add(this.makeWing(dark, warm, false));
    this.rightWing.add(this.makeWing(dark, warm, true));
    this.group.add(this.leftWing, this.rightWing);

    const tail = new THREE.Mesh(new THREE.ConeGeometry(1.35, 2.9, 5), warm);
    tail.rotation.x = -Math.PI / 2;
    tail.position.set(0, 0, -2.65);
    tail.scale.set(1, 0.25, 1);
    this.group.add(tail);

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
    const flap = state.behavior === 'circling thermal' ? Math.sin(this.time * 3.2) * 0.08 : Math.sin(this.time * 1.15) * 0.025;
    this.leftWing.rotation.z = -flap;
    this.rightWing.rotation.z = flap;
  }

  private makeWing(dark: THREE.Material, warm: THREE.Material, mirrored: boolean): THREE.Group {
    const wing = new THREE.Group();
    const sign = mirrored ? 1 : -1;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.5);
    shape.lineTo(sign * 2.3, 1.25);
    shape.lineTo(sign * 5.6, 0.45);
    shape.lineTo(sign * 4.35, -0.25);
    shape.lineTo(sign * 1.2, -0.55);
    shape.closePath();
    const main = new THREE.Mesh(new THREE.ShapeGeometry(shape), dark);
    main.rotation.x = -Math.PI / 2;
    wing.add(main);
    for (let feather = 0; feather < 4; feather += 1) {
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.4 - feather * 0.22, 4), warm);
      blade.rotation.set(Math.PI / 2, 0, sign * (0.22 + feather * 0.06));
      blade.position.set(sign * (3.65 + feather * 0.5), 0, -0.35 - feather * 0.08);
      wing.add(blade);
    }
    return wing;
  }
}
