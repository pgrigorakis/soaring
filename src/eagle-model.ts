// The golden eagle's mesh: one skinned draw call with a painted feather atlas.
// Bird frame: +z is the bill, +y is up, the wings extend along x. One unit is
// about 10.6 cm on a 2.0 m golden eagle.
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Planform, in wing coordinates: x outward from the shoulder, z forward.

const SHOULDER: THREE.Vector3Tuple = [0.85, 0.15, 0.45];
const ELBOW_X = 1.9;
const WRIST_X = 3.9;
/** Leading edge: a straight arm, the carpal bend, then the swept hand. */
const LEADING: [number, number][] = [[0, 1.0], [1.2, 1.28], [2.6, 1.45], [3.9, 1.42], [5.2, 1.0], [6.4, 0.62], [7.0, 0.4]];
/** Trailing edge: narrow at the body, bulging secondaries, then the inner primaries (an S-curve). */
const TRAILING: [number, number][] = [[0, -1.45], [0.8, -2.15], [1.9, -2.6], [3.0, -2.68], [3.9, -2.45], [4.7, -2.2], [5.6, -1.95], [6.4, -1.75], [7.0, -1.6]];
const HAND_END = 7.0;
/** Seven broad emarginated primaries, P10 (leading) to P4; the slots open over the last quarter of the span. */
const FINGERS: { base: [number, number]; tip: [number, number]; width: number }[] = [
  { base: [6.85, 0.42], tip: [8.0, 0.5], width: 0.42 },
  { base: [6.95, 0.08], tip: [8.65, 0.05], width: 0.5 },
  { base: [6.95, -0.28], tip: [8.9, -0.45], width: 0.55 },
  { base: [6.9, -0.65], tip: [8.75, -1.0], width: 0.55 },
  { base: [6.75, -1.0], tip: [8.3, -1.5], width: 0.55 },
  { base: [6.55, -1.32], tip: [7.75, -1.9], width: 0.52 },
  { base: [6.3, -1.6], tip: [7.1, -2.1], width: 0.5 },
];
export const FINGER_COUNT = FINGERS.length;
const PLAN = { minX: 0, maxX: 9.0, minZ: -3, maxZ: 1.6 } as const;

function along(edge: [number, number][], x: number): number {
  if (x <= edge[0]![0]) return edge[0]![1];
  for (let i = 1; i < edge.length; i += 1) {
    const [x1, z1] = edge[i]!;
    const [x0, z0] = edge[i - 1]!;
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      const s = t * t * (3 - 2 * t);
      return z0 + (z1 - z0) * (0.5 * t + 0.5 * s);
    }
  }
  return edge[edge.length - 1]![1];
}
const le = (x: number) => along(LEADING, x);
const te = (x: number) => along(TRAILING, x);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Finger outline at fraction s from base to tip: emarginated narrowing past 40 %, rounded tip. */
function fingerHalfWidth(width: number, s: number): number {
  const notch = 1 - 0.3 * smooth(0.25, 0.45, s);
  const tipRound = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, s - 0.8) / 0.2, 2)));
  return (width / 2) * notch * (0.8 + 0.2 * (1 - s)) * tipRound;
}

function tailFeather(i: number): { angle: number; length: number; width: number } {
  const side = (i - 5.5) / 5.5;
  return { angle: side * 0.26, length: 2.95 - 0.16 * Math.pow(Math.abs(side), 1.4), width: 0.44 };
}

// ---------------------------------------------------------------------------
// Skinned geometry builder. Untextured parts sample the atlas's white corner.

const WHITE_UV: [number, number] = [0.965, 0.06];
type Skin = [number, number, number]; // bone a, bone b, weight of b

class Builder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly uvs: number[] = [];
  private readonly skinIndex: number[] = [];
  private readonly skinWeight: number[] = [];
  private readonly indices: number[] = [];

  vertex(p: THREE.Vector3Tuple, color: THREE.Color, uv: [number, number], skin: Skin): number {
    this.positions.push(...p);
    this.colors.push(color.r, color.g, color.b);
    this.uvs.push(...uv);
    this.skinIndex.push(skin[0], skin[1], 0, 0);
    this.skinWeight.push(1 - skin[2], skin[2], 0, 0);
    return this.positions.length / 3 - 1;
  }

  /** Grid of rows x cols vertices; `flip` reverses winding. */
  grid(rows: number, cols: number, make: (r: number, c: number) => number, flip = false): void {
    const ids: number[][] = [];
    for (let r = 0; r < rows; r += 1) {
      ids.push([]);
      for (let c = 0; c < cols; c += 1) ids[r]!.push(make(r, c));
    }
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const a = ids[r]![c]!; const b = ids[r]![c + 1]!; const d = ids[r + 1]![c]!; const e = ids[r + 1]![c + 1]!;
        if (flip) this.indices.push(a, e, b, a, d, e);
        else this.indices.push(a, b, e, a, e, d);
      }
    }
  }

  /** Append another geometry under a transform, with one colour and bone. */
  append(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, color: THREE.Color, skin: Skin): void {
    const position = geometry.getAttribute('position');
    const offset = this.positions.length / 3;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      v.fromBufferAttribute(position, i).applyMatrix4(matrix);
      this.vertex([v.x, v.y, v.z], color, WHITE_UV, skin);
    }
    const index = geometry.index!;
    for (let i = 0; i < index.count; i += 1) this.indices.push(offset + index.getX(i));
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeight, 4));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    return geometry;
  }
}

// ---------------------------------------------------------------------------
// Palette (adult golden eagle).

const C = (hex: number) => new THREE.Color(hex);
const WHITE = C(0xffffff);
const PALETTE = {
  body: C(0x3b2a20), belly: C(0x46301f), mantle: C(0x33251d),
  hackle: C(0xa97e42), crown: C(0x8d6534), face: C(0x3f2d21),
  cere: C(0xd8a640), billBase: C(0x5b5d61), billTip: C(0x1c1b1a), eye: C(0x24160c), brow: C(0x2f2219),
  lesser: C(0x3e2b1f), median: C(0x9d7a4e), greater: C(0x7a5a3b), greaterDark: C(0x5f4530),
  secondary: C(0x3a2c24), secondaryBar: C(0x4f4239), primary: C(0x2a211c),
  underCovert: C(0x35261c), underFlight: C(0x5b524b), underBar: C(0x3a322d),
  tail: C(0x5e5246), tailBar: C(0x3b3029), tailBand: C(0x29211b), trousers: C(0x4e3624),
};
const mix = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, Math.min(1, Math.max(0, t)));

// ---------------------------------------------------------------------------
// Bones: root, head, tail and two tail fans, then per side shoulder, elbow, wrist and seven fingers.

export const BONE = { root: 0, head: 1, tail: 2, tailL: 3, tailR: 4 } as const;
export const sideBones = (sign: number) => {
  const start = sign < 0 ? 5 : 15;
  return { shoulder: start, elbow: start + 1, wrist: start + 2, finger: (i: number) => start + 3 + i };
};

function wingSkin(sign: number, x: number): Skin {
  const bones = sideBones(sign);
  if (x < 1.5) return [bones.shoulder, bones.shoulder, 0];
  if (x < 2.2) return [bones.shoulder, bones.elbow, smooth(1.5, 2.2, x)];
  if (x < 3.6) return [bones.elbow, bones.elbow, 0];
  if (x < 4.2) return [bones.elbow, bones.wrist, smooth(3.6, 4.2, x)];
  return [bones.wrist, bones.wrist, 0];
}

// ---------------------------------------------------------------------------
// Body: a lofted fuselage from the tail root to a hooked bill.

type Station = { z: number; w: number; h: number; y: number };
const STATIONS: Station[] = [
  { z: -2.65, w: 0.3, h: 0.2, y: 0 },
  { z: -1.9, w: 0.6, h: 0.42, y: 0 },
  { z: -0.8, w: 0.92, h: 0.66, y: 0 },
  { z: 0.4, w: 1.02, h: 0.76, y: 0.02 },
  { z: 1.4, w: 0.86, h: 0.68, y: 0.1 },
  { z: 2.1, w: 0.6, h: 0.54, y: 0.2 },
  { z: 2.6, w: 0.54, h: 0.52, y: 0.28 },
  { z: 3.1, w: 0.5, h: 0.48, y: 0.32 },
  { z: 3.5, w: 0.37, h: 0.38, y: 0.28 },
  { z: 3.75, w: 0.22, h: 0.27, y: 0.22 },
  { z: 3.98, w: 0.14, h: 0.21, y: 0.15 },
  { z: 4.16, w: 0.08, h: 0.14, y: 0.04 },
  { z: 4.24, w: 0.03, h: 0.06, y: -0.08 },
];

function station(z: number): Station {
  for (let i = 1; i < STATIONS.length; i += 1) {
    const a = STATIONS[i - 1]!; const b = STATIONS[i]!;
    if (z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      const s = t * t * (3 - 2 * t);
      return { z, w: a.w + (b.w - a.w) * s, h: a.h + (b.h - a.h) * s, y: a.y + (b.y - a.y) * s };
    }
  }
  return STATIONS[STATIONS.length - 1]!;
}

function bodyColor(z: number, up: number, side: number): THREE.Color {
  // up: -1 belly .. 1 back; side: 0 centre .. 1 flank.
  if (z > 3.62) {
    const bill = mix(PALETTE.billBase, PALETTE.billTip, smooth(3.9, 4.15, z));
    return z < 3.86 && up > -0.3 ? PALETTE.cere : bill;
  }
  let color = mix(PALETTE.body, PALETTE.belly, smooth(0.2, -0.8, up));
  // Golden hackles over the nape and crown; the face stays dark.
  const nape = smooth(1.3, 2.3, z) * smooth(-0.35, 0.35, up) * (1 - smooth(3.15, 3.45, z));
  color = mix(color, z > 2.9 ? PALETTE.crown : PALETTE.hackle, nape * (0.85 + 0.15 * (1 - side)));
  if (z > 3.2) color = mix(color, PALETTE.face, smooth(3.2, 3.45, z) * smooth(0.6, -0.2, up));
  return color;
}

function bodySkin(z: number): Skin {
  if (z > 2.6) return [BONE.head, BONE.head, 0];
  if (z > 2.0) return [BONE.root, BONE.head, smooth(2.0, 2.6, z)];
  return [BONE.root, BONE.root, 0];
}

function buildBody(b: Builder): void {
  const rings = 34; const segments = 20;
  const first = STATIONS[0]!.z; const last = STATIONS[STATIONS.length - 1]!.z;
  b.grid(rings, segments + 1, (r, c) => {
    const z = first + (last - first) * (r / (rings - 1));
    const s = station(z);
    const angle = (c / segments) * Math.PI * 2;
    const sin = Math.sin(angle); const cos = Math.cos(angle);
    // Flatten the back slightly and keep a fuller chest below.
    const y = s.y + s.h * sin * (sin > 0 ? 0.92 : 1.05);
    return b.vertex([s.w * cos, y, z], bodyColor(z, sin, Math.abs(cos)), WHITE_UV, bodySkin(z));
  });
  // Eyes under a heavy brow ridge give the golden eagle's frowning look.
  const sphere = new THREE.SphereGeometry(1, 10, 8);
  for (const side of [-1, 1]) {
    b.append(sphere, new THREE.Matrix4().compose(new THREE.Vector3(side * 0.37, 0.43, 3.33),
      new THREE.Quaternion(), new THREE.Vector3(0.085, 0.085, 0.085)), PALETTE.eye, bodySkin(3.3));
    b.append(sphere, new THREE.Matrix4().compose(new THREE.Vector3(side * 0.33, 0.55, 3.3),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, side * 0.25, 0)), new THREE.Vector3(0.12, 0.06, 0.22)), PALETTE.brow, bodySkin(3.3));
    // Feathered "trousers" tucked under the belly; the feet lie under the tail coverts.
    b.append(sphere, new THREE.Matrix4().compose(new THREE.Vector3(side * 0.32, -0.55, -1.2),
      new THREE.Quaternion(), new THREE.Vector3(0.28, 0.24, 0.6)), PALETTE.trousers, bodySkin(-1.2));
  }
  sphere.dispose();
}

// ---------------------------------------------------------------------------
// Painted feather atlas, drawn in planform space.
// Rows: upper wing [0, 0.44), under wing [0.44, 0.88), tail feathers [0.88, 0.98), white corner.

const ATLAS = 1024;
const PX = ATLAS / 2048;
const ROW = { upper: 0, under: 0.44, tail: 0.88, height: 0.44 } as const;
let atlasTexture: THREE.CanvasTexture | null = null;

function wingUv(x: number, z: number, row: 'upper' | 'under'): [number, number] {
  const u = (x - PLAN.minX) / (PLAN.maxX - PLAN.minX);
  const v = (PLAN.maxZ - z) / (PLAN.maxZ - PLAN.minZ);
  return [u, 1 - (ROW[row] + v * ROW.height)];
}
function tailUv(i: number, s: number, across: number): [number, number] {
  // Feather i owns a 1/12 column of the tail row; across is -1..1, s is 0 (root) .. 1 (tip).
  const u = (i + 0.5 + across * 0.45) / 12 * 0.9;
  return [u, 1 - (ROW.tail + s * 0.1)];
}

/** The shared atlas, painted once. Node unit tests have no canvas, so they get none. */
function featherAtlas(): THREE.CanvasTexture | null {
  if (atlasTexture || typeof document === 'undefined') return atlasTexture;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS; canvas.height = ATLAS;
  const ctx = canvas.getContext('2d')!;
  const css = (color: THREE.Color, shade = 1) => `rgb(${Math.round(Math.min(1, color.r * shade) * 255)},${Math.round(Math.min(1, color.g * shade) * 255)},${Math.round(Math.min(1, color.b * shade) * 255)})`;
  // Canvas colours are sRGB; the texture is tagged sRGB below.
  const srgb = (color: THREE.Color) => color.clone().convertLinearToSRGB();
  const toPx = (x: number, z: number, row: 'upper' | 'under'): [number, number] => {
    const [u, v] = wingUv(x, z, row);
    return [u * ATLAS, (1 - v) * ATLAS];
  };
  let seed = 1;
  const rand = () => hash(seed++);

  // One feather: a tapered vane from base to tip, a darker shaft, optional bars and a pale fringe.
  const feather = (row: 'upper' | 'under', base: [number, number], tip: [number, number], width: number, color: THREE.Color,
    options: { bars?: THREE.Color; barCount?: number; fringe?: THREE.Color; emarginate?: boolean; band?: THREE.Color } = {}) => {
    const [bx, bz] = base; const [tx, tz] = tip;
    const length = Math.hypot(tx - bx, tz - bz);
    const dx = (tx - bx) / length; const dz = (tz - bz) / length;
    const path = new Path2D();
    const steps = 16;
    const left: [number, number][] = []; const right: [number, number][] = [];
    for (let k = 0; k <= steps; k += 1) {
      const s = k / steps;
      const half = options.emarginate ? fingerHalfWidth(width, s)
        : width / 2 * (s > 0.8 ? Math.sqrt(Math.max(0, 1 - Math.pow((s - 0.8) / 0.2, 2))) : 1);
      const cx = bx + dx * length * s; const cz = bz + dz * length * s;
      left.push(toPx(cx - dz * half, cz + dx * half, row));
      right.push(toPx(cx + dz * half, cz - dx * half, row));
    }
    const outline = [...left, ...right.reverse()];
    path.moveTo(...outline[0]!);
    for (const p of outline.slice(1)) path.lineTo(...p);
    path.closePath();
    const [p0x, p0y] = toPx(bx, bz, row); const [p1x, p1y] = toPx(tx, tz, row);
    const shade = 0.92 + rand() * 0.16;
    const gradient = ctx.createLinearGradient(p0x, p0y, p1x, p1y);
    gradient.addColorStop(0, css(srgb(color), shade * 1.08));
    gradient.addColorStop(1, css(srgb(color), shade * 0.86));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fill(path);
    ctx.clip(path);
    if (options.bars) {
      const count = options.barCount ?? 6;
      ctx.strokeStyle = css(srgb(options.bars));
      ctx.globalAlpha = 0.55;
      for (let k = 1; k <= count; k += 1) {
        const s = k / (count + 1) * 0.85;
        const [cx, cy] = toPx(bx + dx * length * s, bz + dz * length * s, row);
        const [ax, ay] = toPx(bx + dx * length * s - dz * width, bz + dz * length * s + dx * width, row);
        ctx.lineWidth = (length / (count + 1)) / (PLAN.maxX - PLAN.minX) * ATLAS * 0.32;
        ctx.beginPath(); ctx.moveTo(2 * cx - ax, 2 * cy - ay); ctx.lineTo(ax, ay); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (options.band) {
      // Dark trailing band on the tip third.
      const [cx, cy] = toPx(bx + dx * length * 0.78, bz + dz * length * 0.78, row);
      const g = ctx.createLinearGradient(cx, cy, p1x, p1y);
      g.addColorStop(0, css(srgb(options.band)).replace('rgb', 'rgba').replace(')', ',0)'));
      g.addColorStop(0.25, css(srgb(options.band)));
      ctx.fillStyle = g;
      ctx.fill(path);
    }
    // Shaft and edge shading.
    ctx.strokeStyle = 'rgba(15,10,6,0.55)';
    ctx.lineWidth = 3 * PX;
    ctx.stroke(path);
    ctx.strokeStyle = options.fringe ? css(srgb(options.fringe)) : 'rgba(255,240,215,0.10)';
    ctx.lineWidth = (options.fringe ? 5 : 2) * PX;
    ctx.globalAlpha = options.fringe ? 0.7 : 1;
    ctx.beginPath(); ctx.moveTo(...right[right.length - 1]!);
    for (const p of right.slice().reverse().slice(Math.floor(steps * 0.55))) ctx.lineTo(...p);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = row === 'upper' ? 'rgba(200,185,160,0.35)' : 'rgba(200,185,160,0.15)';
    ctx.lineWidth = 2 * PX;
    ctx.beginPath(); ctx.moveTo(p0x, p0y);
    const [mx, my] = toPx(bx + dx * length * 0.92, bz + dz * length * 0.92, row);
    ctx.lineTo(mx, my); ctx.stroke();
    ctx.restore();
  };

  for (const row of ['upper', 'under'] as const) {
    const upper = row === 'upper';
    const flight = upper ? PALETTE.secondary : PALETTE.underFlight;
    const bars = upper ? PALETTE.secondaryBar : PALETTE.underBar;
    // Primaries at their rest positions; the skeleton splays the finger strips that sample them.
    [...FINGERS].reverse().forEach((finger) => {
      const base: [number, number] = [finger.base[0] - 0.9, finger.base[1] + 0.25];
      feather(row, base, finger.tip, finger.width, upper ? PALETTE.primary : PALETTE.underFlight,
        { emarginate: true, bars: upper ? undefined : PALETTE.underBar, barCount: 5, band: upper ? undefined : PALETTE.primary });
    });
    // Inner primaries and secondaries along the trailing edge, outermost first.
    for (let i = 20; i >= 0; i -= 1) {
      const x = 0.15 + i * 0.335;
      const back = te(x) - 0.14;
      feather(row, [x + 0.15, le(x) - 0.7], [x - 0.02, back], 0.5, flight,
        { bars, barCount: 6, band: upper ? undefined : PALETTE.underBar });
    }
    if (upper) {
      // Greater coverts with the pale tawny bar, then median and lesser coverts, then marginals.
      for (let i = 17; i >= 0; i -= 1) {
        const x = 0.1 + i * 0.4;
        if (x > 6.7) continue;
        const chord = le(x) - te(x);
        feather(row, [x + 0.12, le(x) - 0.35], [x - 0.04, le(x) - chord * 0.52], 0.5, i % 3 ? PALETTE.greater : PALETTE.greaterDark,
          { fringe: PALETTE.median });
      }
      for (let i = 20; i >= 0; i -= 1) {
        const x = 0.05 + i * 0.32;
        if (x > 6.6) continue;
        const chord = le(x) - te(x);
        feather(row, [x + 0.1, le(x) - 0.15], [x - 0.02, le(x) - chord * 0.32], 0.38, x < 4 ? PALETTE.median : PALETTE.lesser,
          { fringe: x < 4 ? C(0xc29a63) : undefined });
      }
      for (let i = 30; i >= 0; i -= 1) {
        const x = 0.02 + i * 0.23;
        if (x > 6.8) continue;
        feather(row, [x + 0.06, le(x) + 0.05], [x, le(x) - (x < 3.9 ? 0.42 : 0.75)], 0.3, mix(PALETTE.lesser, PALETTE.mantle, rand()));
      }
    } else {
      // Dark underwing coverts over the pale flight feathers.
      for (let i = 25; i >= 0; i -= 1) {
        const x = 0.05 + i * 0.27;
        if (x > 6.7) continue;
        const chord = le(x) - te(x);
        feather(row, [x + 0.08, le(x) + 0.05], [x, le(x) - chord * (x < 4 ? 0.45 : 0.3)], 0.36, mix(PALETTE.underCovert, PALETTE.body, rand()));
      }
    }
  }
  // Twelve tail feathers, one column each.
  for (let i = 0; i < 12; i += 1) {
    const x0 = (i / 12) * 0.9 * ATLAS; const w = 0.9 * ATLAS / 12;
    const top = ROW.tail * ATLAS; const height = 0.1 * ATLAS;
    const path = new Path2D();
    const half = w * 0.45;
    path.moveTo(x0 + w / 2 - half * 0.85, top);
    path.lineTo(x0 + w / 2 + half * 0.85, top);
    path.lineTo(x0 + w / 2 + half, top + height * 0.86);
    path.quadraticCurveTo(x0 + w / 2 + half, top + height, x0 + w / 2, top + height * 0.995);
    path.quadraticCurveTo(x0 + w / 2 - half, top + height, x0 + w / 2 - half, top + height * 0.86);
    path.closePath();
    ctx.save();
    ctx.fillStyle = css(srgb(PALETTE.tail), 0.95 + hash(i) * 0.1);
    ctx.fill(path);
    ctx.clip(path);
    ctx.fillStyle = css(srgb(PALETTE.tailBar));
    ctx.globalAlpha = 0.7;
    for (let k = 0; k < 5; k += 1) {
      const y = top + height * (0.08 + k * 0.12 + hash(i * 7 + k) * 0.02);
      ctx.beginPath();
      ctx.ellipse(x0 + w / 2, y, w * 0.6, height * 0.025, (hash(i + k) - 0.5) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(srgb(PALETTE.tailBand));
    ctx.fillRect(x0, top + height * 0.68, w, height * 0.33);
    ctx.strokeStyle = 'rgba(200,185,160,0.35)';
    ctx.lineWidth = 2 * PX;
    ctx.beginPath(); ctx.moveTo(x0 + w / 2, top); ctx.lineTo(x0 + w / 2, top + height * 0.95); ctx.stroke();
    ctx.strokeStyle = 'rgba(15,10,6,0.6)';
    ctx.lineWidth = 3 * PX;
    ctx.stroke(path);
    ctx.restore();
  }
  // Opaque white corner for the body, eyes and bill, which take their colour from vertices.
  ctx.fillStyle = '#fff';
  ctx.fillRect(ATLAS * 0.93, ATLAS * 0.9, ATLAS * 0.07, ATLAS * 0.08);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  atlasTexture = texture;
  return texture;
}

// ---------------------------------------------------------------------------
// Wings and tail. The atlas alpha cuts each feather's outline out of the oversized surfaces.

function buildWing(b: Builder, sign: number): void {
  const [sx, sy, sz] = SHOULDER;
  const P = (x: number, y: number, z: number): THREE.Vector3Tuple => [sign * (sx + x), sy + y, sz + z];
  const spans = 44; const chords = 14;
  const flip = sign < 0;
  // Upper and lower cambered surfaces. Thickness is greatest behind the leading edge and thins
  // toward the hand; the surface reaches past the trailing edge so painted feather tips can show.
  for (const upper of [true, false]) {
    b.grid(spans, chords, (r, c) => {
      const x = (r / (spans - 1)) * HAND_END;
      const v = c / (chords - 1);
      const front = le(x); const back = te(x) - 0.32;
      const z = front + (back - front) * v;
      const thickness = (0.16 - 0.08 * (x / HAND_END)) * Math.sqrt(Math.max(0, v)) * (1 - v) * 2.4;
      const camber = 0.12 * Math.sin(Math.PI * Math.min(1, v * 1.1)) * (1 - 0.4 * x / HAND_END);
      const y = camber + (upper ? thickness * 0.6 : -thickness * 0.4);
      return b.vertex(P(x, y, z), WHITE, wingUv(x, z, upper ? 'upper' : 'under'), wingSkin(sign, x));
    }, upper !== flip);
  }
  // Emarginated primaries as separate blades so each finger can splay and curl.
  FINGERS.forEach((finger, i) => {
    const bones = sideBones(sign);
    const bx = finger.base[0] - 0.9; const bz = finger.base[1] + 0.25;
    const [tx, tz] = finger.tip;
    const length = Math.hypot(tx - bx, tz - bz);
    const dx = (tx - bx) / length; const dz = (tz - bz) / length;
    const steps = 10;
    for (const upper of [true, false]) {
      b.grid(steps + 1, 3, (r, c) => {
        const s = r / steps;
        const across = c - 1;
        const half = finger.width * 0.62;
        const cx = bx + dx * length * s; const cz = bz + dz * length * s;
        const x = cx - dz * half * across; const z = cz + dx * half * across;
        const thick = (1 - Math.abs(across)) * 0.03 * (1 - s);
        const y = 0.02 + 0.3 * s * s + (upper ? thick : -thick) - 0.01 * i;
        const skin: Skin = s < 0.2 ? [bones.wrist, bones.finger(i), smooth(0, 0.2, s)] : [bones.finger(i), bones.finger(i), 0];
        return b.vertex(P(x, y, z), WHITE, wingUv(x, z, upper ? 'upper' : 'under'), skin);
      }, upper === flip);
    }
  });
}

function buildTail(b: Builder): void {
  for (let i = 0; i < 12; i += 1) {
    const { angle, length, width } = tailFeather(i);
    const side = (i - 5.5) / 5.5;
    const skin: Skin = side < 0 ? [BONE.tail, BONE.tailL, -side] : [BONE.tail, BONE.tailR, side];
    const lift = -0.12 - Math.abs(i - 5.5) * 0.006 + (i % 2) * 0.012;
    for (const upper of [true, false]) {
      b.grid(9, 3, (r, c) => {
        const s = r / 8; const across = c - 1;
        const along = -s * length; const off = across * width * 0.62;
        const y = lift + (1 - Math.abs(across)) * 0.03 * (upper ? 1 : -1) - 0.08 * s * s;
        return b.vertex([Math.sin(angle) * -along + Math.cos(angle) * off, y, -2.15 + Math.cos(angle) * along + Math.sin(angle) * off],
          WHITE, tailUv(i, s, across * 1.1), skin);
      }, !upper);
    }
  }
}

/** Builds the eagle as one skinned mesh. Bone indices follow `BONE` and `sideBones`. */
export function buildEagleMesh(): { mesh: THREE.SkinnedMesh; bones: THREE.Bone[] } {
  const b = new Builder();
  buildBody(b);
  for (const sign of [-1, 1]) buildWing(b, sign);
  buildTail(b);

  // Skeleton in rest pose: joints lie near the leading edge, fingers at their bases.
  const bones: THREE.Bone[] = [];
  const bone = (parent: THREE.Bone | null, name: string, x: number, y: number, z: number) => {
    const node = new THREE.Bone();
    node.name = name;
    node.position.set(x, y, z);
    parent?.add(node);
    bones.push(node);
    return node;
  };
  const root = bone(null, 'root', 0, 0, 0);
  bone(root, 'head', 0, 0.3, 2.3);
  const tail = bone(root, 'tail', 0, -0.05, -2.15);
  bone(tail, 'tail-left', 0, 0, 0);
  bone(tail, 'tail-right', 0, 0, 0);
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    const shoulder = bone(root, `${side}-shoulder`, sign * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    const elbow = bone(shoulder, `${side}-elbow`, sign * ELBOW_X, 0, 0.6);
    const wrist = bone(elbow, `${side}-wrist`, sign * (WRIST_X - ELBOW_X), 0, 0.4);
    FINGERS.forEach((finger, i) => bone(wrist, `${side}-finger-${i}`, sign * (finger.base[0] - WRIST_X), 0, finger.base[1] - 1.0));
  }
  const map = featherAtlas();
  const material = new THREE.MeshStandardMaterial({
    map, vertexColors: true, roughness: 0.9, alphaTest: map ? 0.5 : 0, alphaToCoverage: map !== null,
  });
  const mesh = new THREE.SkinnedMesh(b.geometry(), material);
  mesh.add(root);
  mesh.bind(new THREE.Skeleton(bones));
  return { mesh, bones };
}
