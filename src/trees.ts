// Whole-tree models: trunk and crown merged in tree space with the origin at the trunk foot,
// so one instance matrix places a whole tree and each tree shape costs one draw call for the ring.
// Near trees build their crowns from alpha-tested leaf cards on a painted atlas; mid trees are a
// simple cone or blob. A `crown` vertex attribute limits the instance tint to foliage, so bark keeps its colour.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Tree } from './world';
import { hash2 } from './world-noise';

type Cell = { u: number; v: number; size: number };
type Shade = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color;

const ATLAS = 1024;
// Atlas quarters in uv space. Bark and other solid parts take no atlas cell: their negative uv
// skips the texture, so no mip level can bleed leaf alpha into them or white into leaf edges.
const CELLS = { broadleaf: { u: 0, v: 0.5, size: 0.5 }, conifer: { u: 0.5, v: 0.5, size: 0.5 }, birch: { u: 0, v: 0, size: 0.5 } };
const SOLID = null;
const GUTTER = 0.02;
const BARK = { conifer: new THREE.Color(0x4a3222), broadleaf: new THREE.Color(0x5b4330), birch: new THREE.Color(0xd8d4c8) };

const dummy = new THREE.Object3D();

/** Index of the mid-tier model for a tree kind: conifers keep a cone, broadleaf and birch share a blob. */
export function midModel(kind: number): number {
  return kind === 0 ? 0 : 1;
}

/**
 * Writes the instance matrix of a whole tree and jitters its crown colour in place. Width, height and
 * hue vary per tree, hashed from the world position, so the same tree always looks the same.
 */
export function placeTree(tree: Tree, matrix: THREE.Matrix4, color: THREE.Color): void {
  const ix = Math.round(tree.x), iz = Math.round(tree.z);
  const h = (offset: number) => hash2(ix, iz, 9100 + offset);
  color.offsetHSL((h(1) - 0.5) * 0.035, (h(2) - 0.5) * 0.18, (h(3) - 0.5) * 0.11);
  dummy.position.set(tree.x, tree.y - 0.4, tree.z);
  dummy.rotation.set(0, tree.turn, 0);
  dummy.scale.set(tree.scale * (0.85 + h(4) * 0.3), tree.scale * (0.82 + h(5) * 0.36), tree.scale * (0.85 + h(6) * 0.3));
  dummy.updateMatrix();
  matrix.copy(dummy.matrix);
}

export class TreeModels {
  /** Near models by `Tree.kind`: conifer, broadleaf, birch. */
  readonly near: THREE.BufferGeometry[];
  /** Mid models by `midModel(kind)`. */
  readonly mid: THREE.BufferGeometry[];
  readonly leafMaterial: THREE.MeshStandardMaterial;
  /** Shadow depth with the leaf alpha test, so shadows show gaps between leaves. */
  readonly leafDepthMaterial: THREE.MeshDepthMaterial;
  readonly midMaterial: THREE.MeshStandardMaterial;
  private readonly atlas = paintAtlas();

  constructor() {
    const random = rng(99);
    this.near = [cardConifer(random), cardBroadleaf(random), cardBroadleaf(random, true)];
    this.mid = [midConifer(), midBroadleaf()];
    this.leafMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: this.atlas, alphaTest: 0.5,
      side: THREE.DoubleSide, roughness: 0.92 });
    this.leafMaterial.onBeforeCompile = (shader) => {
      tintCrownOnly(shader);
      solidWithoutMap(shader);
      // Keep the volumetric normal on both faces of a card.
      shader.fragmentShader = shader.fragmentShader.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;');
    };
    this.leafDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.atlas,
      alphaTest: 0.5, side: THREE.DoubleSide });
    this.leafDepthMaterial.onBeforeCompile = solidWithoutMap;
    this.midMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.midMaterial.onBeforeCompile = tintCrownOnly;
  }

  get materials(): THREE.MeshStandardMaterial[] {
    return [this.leafMaterial, this.midMaterial];
  }

  dispose(): void {
    for (const geometry of [...this.near, ...this.mid]) geometry.dispose();
    this.leafMaterial.dispose();
    this.leafDepthMaterial.dispose();
    this.midMaterial.dispose();
    this.atlas.dispose();
  }
}

function tintCrownOnly(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', 'attribute float crown;\n#include <common>')
    .replace('#include <color_vertex>', `#include <color_vertex>
#ifdef USE_INSTANCING_COLOR
  vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, crown);
#endif`);
}

/** Solid parts carry a negative uv and draw opaque white, which their vertex colour then tints. */
function solidWithoutMap(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
diffuseColor *= vMapUv.x < 0.0 ? vec4(1.0) : texture2D( map, vMapUv );`);
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Converts a part to non-indexed geometry with position, normal, uv, color and crown attributes.
 * Normals bend toward `normalCentre`'s outward direction, so a crown lights as one rounded volume.
 */
function part(source: THREE.BufferGeometry, crown: number, shade: Shade, cell: Cell | null,
  normalCentre?: (p: THREE.Vector3) => THREE.Vector3, bend = 0.65): THREE.BufferGeometry {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  const count = geometry.attributes.position!.count;
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const normal = geometry.attributes.normal as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const colors = new Float32Array(count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(position, i);
    n.fromBufferAttribute(normal, i);
    if (normalCentre) {
      c.subVectors(p, normalCentre(p)).normalize();
      n.lerp(c, bend).normalize();
      normal.setXYZ(i, n.x, n.y, n.z);
    }
    shade(p, n).toArray(colors, i * 3);
    // A gutter inside each cell keeps lower mip levels from bleeding a neighbouring cell into card edges.
    if (cell) uv.setXY(i, cell.u + GUTTER + uv.getX(i) * (cell.size - 2 * GUTTER), cell.v + GUTTER + uv.getY(i) * (cell.size - 2 * GUTTER));
    else uv.setXY(i, -1, -1);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('crown', new THREE.BufferAttribute(new Float32Array(count).fill(crown), 1));
  return geometry;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false)!;
  for (const geometry of parts) geometry.dispose();
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

/** An open trunk with its foot at y = 0, darker toward the ground. */
function trunk(height: number, bottom: number, top: number, bark: THREE.Color, segments = 6): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(top, bottom, height, segments, 1, true);
  geometry.translate(0, height / 2, 0);
  const out = new THREE.Color();
  return part(geometry, 0, (p) => out.copy(bark).multiplyScalar(0.55 + 0.45 * Math.min(1, p.y / height)), SOLID);
}

/** Baked foliage occlusion: a dark underside and core, and a bright sunlit cap. */
function aoShade(bottom: number, top: number, axisRadius: number, floor: number): Shade {
  const out = new THREE.Color();
  return (p) => {
    const h = THREE.MathUtils.clamp((p.y - bottom) / (top - bottom), 0, 1);
    const radial = THREE.MathUtils.clamp(Math.hypot(p.x, p.z) / axisRadius, 0, 1);
    return out.setScalar(THREE.MathUtils.lerp(floor, 1, Math.pow(h, 0.7)) * THREE.MathUtils.lerp(0.72, 1, radial));
  };
}

/** Paints grey leaf clusters, birch leaves and a fir frond; the instance colour tints them. */
function paintAtlas(): THREE.Texture {
  // Unit tests run without a DOM and never draw, so they get an empty texture.
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const g = canvas.getContext('2d')!;
  const random = rng(7);
  const half = ATLAS / 2;
  const leaves = (ox: number, oy: number, count: number, size: number, spread: number) => {
    // Canvas y runs down and texture v runs up, so (ox, oy) is the cell's top-left corner on the canvas.
    const cx = ox + half / 2, cy = oy + half / 2;
    g.strokeStyle = 'rgb(90,80,70)';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = random() * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * half * spread * 0.6, cy + Math.sin(a) * half * spread * 0.6);
      g.stroke();
    }
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2, r = Math.sqrt(random()) * half * spread;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.92;
      // Upper and inner leaves are lighter: they catch more sky.
      const light = 0.8 + random() * 0.12 - (r / (half * spread)) * 0.08 - ((y - oy) / half - 0.5) * 0.25;
      const shade = Math.round(255 * THREE.MathUtils.clamp(light, 0.35, 1));
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.save();
      g.translate(x, y);
      g.rotate(random() * Math.PI);
      g.beginPath();
      g.ellipse(0, 0, size * (0.8 + random() * 0.5), size * (0.42 + random() * 0.2), 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  };
  leaves(0, 0, 2800, 13, 0.46);
  leaves(0, half, 2600, 10, 0.45);
  const needle = (x: number, y: number, angle: number, length: number, light: number) => {
    const shade = Math.round(255 * THREE.MathUtils.clamp(light, 0.3, 1));
    g.strokeStyle = `rgb(${shade},${shade},${shade})`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    g.stroke();
  };
  // A tapered spray along +u with needles on both sides and one level of side branchlets.
  const frond = (x0: number, y0: number, angle: number, length: number, spread: number, depth: number) => {
    const steps = Math.round(length / 3);
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const x = x0 + Math.cos(angle) * length * t, y = y0 + Math.sin(angle) * length * t;
      const reach = spread * (1 - t * 0.85) * (0.75 + random() * 0.5);
      g.lineWidth = depth > 0 ? 5 : 4;
      needle(x, y, angle + 0.95 + (random() - 0.5) * 0.3, reach, 0.55 + random() * 0.4 + t * 0.1);
      needle(x, y, angle - 0.95 + (random() - 0.5) * 0.3, reach, 0.5 + random() * 0.4 + t * 0.1);
      if (depth > 0 && i % 7 === 3 && t < 0.8) {
        const side = (i / 7) % 2 < 1 ? 1 : -1;
        frond(x, y, angle + side * (0.75 + random() * 0.2), length * 0.42 * (1 - t), spread * 0.75, depth - 1);
      }
    }
    g.strokeStyle = 'rgb(105,92,78)';
    g.lineWidth = depth > 0 ? 4 : 2;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 + Math.cos(angle) * length, y0 + Math.sin(angle) * length);
    g.stroke();
  };
  g.lineCap = 'round';
  frond(half + 24, half / 2, 0, half - 48, 70, 1);
  frond(half + 30, half / 2 - 6, -0.3, half * 0.62, 50, 1);
  frond(half + 30, half / 2 + 6, 0.3, half * 0.62, 50, 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A spreading crown, or a tall narrow birch crown, of leaf cards around a dark inner mass. */
function cardBroadleaf(random: () => number, tall = false): THREE.BufferGeometry {
  const bark = tall ? BARK.birch : BARK.broadleaf;
  const parts = [tall ? trunk(16, 0.55, 0.25, bark) : trunk(11, 1.15, 0.5, bark)];
  const radius = tall ? 3.9 : 7.2, centreY = tall ? 18.5 : 14.5, stretch = tall ? 2.3 : 0.82;
  const centre = new THREE.Vector3(0, centreY, 0);
  const toCentre = () => centre;
  const shade = aoShade(centreY - radius * stretch, centreY + radius * stretch, radius, 0.45);
  // The inner mass keeps the crown from reading as see-through litter.
  const core = new THREE.IcosahedronGeometry(radius * 0.85, 0);
  core.scale(1, stretch * (tall ? 0.85 : 1.05), 1);
  core.translate(0, centreY, 0);
  parts.push(part(core, 1, (p, n) => shade(p, n).multiplyScalar(0.62), SOLID, toCentre, 0.8));
  const branchColor = bark.clone().multiplyScalar(0.7);
  for (let i = 0; i < (tall ? 3 : 5); i++) {
    const turn = random() * Math.PI * 2;
    const branch = new THREE.CylinderGeometry(0.12, 0.35, radius * 0.9, 4, 1, true);
    branch.translate(0, radius * 0.45, 0);
    branch.rotateZ(-0.9 - random() * 0.4);
    branch.rotateY(turn);
    branch.translate(0, centreY - radius * stretch * 0.55, 0);
    parts.push(part(branch, 0, () => branchColor, SOLID));
  }
  const cards = tall ? 40 : 46;
  const cell = tall ? CELLS.birch : CELLS.broadleaf;
  const basis = new THREE.Object3D();
  for (let i = 0; i < cards; i++) {
    // A Fibonacci spread on the outer shell of the crown ellipsoid.
    const y = 1 - ((i + 0.5) / cards) * 2;
    const r = Math.sqrt(1 - y * y), a = i * 2.39996 + random() * 0.4;
    const shell = 0.7 + random() * 0.3;
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    basis.position.set(dir.x * radius * shell, centreY + dir.y * radius * stretch * shell, dir.z * radius * shell);
    basis.lookAt(basis.position.clone().addScaledVector(dir, 4)
      .add(new THREE.Vector3(random() - 0.5, random() - 0.3, random() - 0.5).multiplyScalar(4)));
    const size = radius * (tall ? 0.95 : 0.85) * (0.85 + random() * 0.35);
    basis.rotateZ(random() * Math.PI * 2);
    basis.updateMatrix();
    const plane = new THREE.PlaneGeometry(size, size * (tall ? 1.15 : 0.95)).applyMatrix4(basis.matrix);
    parts.push(part(plane, 1, shade, cell, toCentre, 0.85));
  }
  return merge(parts);
}

/** A fir of drooping branch-spray cards in 11 whorls around a narrow dark core cone. */
function cardConifer(random: () => number): THREE.BufferGeometry {
  const parts = [trunk(26, 0.95, 0.15, BARK.conifer)];
  const bottom = 4.5, top = 29;
  const shade = aoShade(bottom - 1, top, 6.3, 0.36);
  const axis = (p: THREE.Vector3) => new THREE.Vector3(0, p.y - 1.5, 0);
  // The core cone gives the tree mass between branch layers.
  const core = new THREE.ConeGeometry(3.3, top - bottom, 7, 1, true);
  core.translate(0, bottom + (top - bottom) / 2, 0);
  parts.push(part(core, 1, (p, n) => shade(p, n).multiplyScalar(0.55), SOLID, axis, 0.4));
  const levels = 11;
  const basis = new THREE.Object3D();
  for (let level = 0; level < levels; level++) {
    const t = level / (levels - 1);
    const y = THREE.MathUtils.lerp(bottom + 0.8, top - 1.2, t);
    const reach = THREE.MathUtils.lerp(6.3, 1.4, Math.pow(t, 0.9)) * (0.9 + random() * 0.2);
    const count = Math.round(THREE.MathUtils.lerp(7, 4, t));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + level * 0.9 + random() * 0.4;
      const droop = 0.35 + random() * 0.25 + (1 - t) * 0.2;
      // The card reaches out along +x from the trunk, lies mostly flat with some tilt, then droops.
      basis.position.set(Math.cos(a) * 0.3, y, Math.sin(a) * 0.3);
      basis.rotation.set(0, -a, 0);
      basis.rotateX(-Math.PI / 2 + (random() - 0.5) * 1.1);
      basis.rotateY(droop);
      basis.updateMatrix();
      const plane = new THREE.PlaneGeometry(reach * 1.25, reach * 0.95).translate(reach * 0.62, 0, 0).applyMatrix4(basis.matrix);
      parts.push(part(plane, 1, shade, CELLS.conifer, axis, 0.75));
    }
  }
  return merge(parts);
}

function midConifer(): THREE.BufferGeometry {
  const cone = new THREE.ConeGeometry(5.6, 23, 6, 1);
  cone.translate(0, 4.5 + 11.5, 0);
  return merge([trunk(7, 0.95, 0.5, BARK.conifer, 4),
    part(cone, 1, aoShade(4, 28, 5.6, 0.45), SOLID, (p) => new THREE.Vector3(0, p.y - 3, 0), 0.4)]);
}

function midBroadleaf(): THREE.BufferGeometry {
  const blob = new THREE.IcosahedronGeometry(6.6, 0);
  blob.scale(1, 0.9, 1);
  blob.translate(0, 14.5, 0);
  const centre = new THREE.Vector3(0, 14.5, 0);
  return merge([trunk(9, 1.1, 0.6, BARK.broadleaf, 4), part(blob, 1, aoShade(8.5, 20.5, 6.6, 0.5), SOLID, () => centre, 0.7)]);
}
