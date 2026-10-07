// Whole-tree models: trunk and crown merged in tree space with the origin at the trunk foot,
// so one instance matrix places a whole tree and each tree shape costs one draw call for the ring.
// Near trees build their crowns from alpha-tested leaf cards on a painted atlas. Mid and far trees are
// camera-facing billboards baked from the near models at startup. A `crown` vertex attribute limits the
// instance tint to foliage, so bark keeps its colour.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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

/**
 * Writes the instance matrix of a whole tree and jitters its crown colour in place. Width, height and
 * hue vary per tree, hashed from the world position, so the same tree always looks the same.
 * A billboard takes the same jitter, with its width averaged and no turn, so it can face the camera.
 */
export function placeTree(tree: Tree, matrix: THREE.Matrix4, color: THREE.Color, billboard?: THREE.Vector2): void {
  const ix = Math.round(tree.x), iz = Math.round(tree.z);
  const h = (offset: number) => hash2(ix, iz, 9100 + offset);
  color.offsetHSL((h(1) - 0.5) * 0.035, (h(2) - 0.5) * 0.18, (h(3) - 0.5) * 0.11);
  const width = tree.scale * (0.85 + h(4) * 0.3), height = tree.scale * (0.82 + h(5) * 0.36), depth = tree.scale * (0.85 + h(6) * 0.3);
  dummy.position.set(tree.x, tree.y - 0.4, tree.z);
  if (billboard) {
    const across = billboard.x * (width + depth) / 2;
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(across, billboard.y * height, across);
  } else {
    dummy.rotation.set(0, tree.turn, 0);
    dummy.scale.set(width, height, depth);
  }
  dummy.updateMatrix();
  matrix.copy(dummy.matrix);
}

export class TreeModels {
  /** Near models by `Tree.kind`: conifer, broadleaf, birch. */
  readonly near: THREE.BufferGeometry[];
  /** Unit billboard quads by `Tree.kind`, each mapped to its kind's baked cell. */
  readonly billboards: THREE.BufferGeometry[];
  /** Billboard width and height in tree space by `Tree.kind`, for `placeTree`. */
  readonly billboardSizes: THREE.Vector2[];
  readonly leafMaterial: THREE.MeshStandardMaterial;
  /** Shadow depth with the leaf alpha test, so shadows show gaps between leaves. */
  readonly leafDepthMaterial: THREE.MeshDepthMaterial;
  readonly billboardMaterial: THREE.MeshStandardMaterial;
  private readonly atlas = paintAtlas();
  // The bake keeps colour and normals apart, so billboards take the live scene light like the near trees.
  private readonly baked = { color: bakeTarget(THREE.SRGBColorSpace), normal: bakeTarget(THREE.NoColorSpace) };

  constructor() {
    const random = rng(99);
    this.near = [cardConifer(random), cardBroadleaf(random), cardBroadleaf(random, true)];
    this.billboardSizes = this.near.map((geometry) => {
      const box = geometry.boundingBox!;
      const radius = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) * BAKE.margin;
      return new THREE.Vector2(radius * 2, box.max.y * BAKE.margin);
    });
    this.billboards = this.near.map((_, kind) => billboardQuad(kind));
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
    this.billboardMaterial = billboardMaterial(this.baked.color.texture, this.baked.normal.texture);
  }

  get materials(): THREE.MeshStandardMaterial[] {
    return [this.leafMaterial, this.billboardMaterial];
  }

  /**
   * Renders each near model once, side on, into the billboard cells: unlit colour into one texture, and
   * tree-space normals with the crown mask into another. Needs the live renderer, so it runs at startup.
   */
  bake(renderer: THREE.WebGLRenderer): void {
    const scene = new THREE.Scene();
    const material = bakeMaterial(this.atlas);
    const mesh = new THREE.Mesh(this.near[0], material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const previous = { target: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()),
      alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear };
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    for (const [pass, target] of [this.baked.color, this.baked.normal].entries()) {
      material.uniforms.normalPass!.value = pass;
      renderer.setRenderTarget(target);
      renderer.clear();
      this.near.forEach((geometry, kind) => {
        const { x: width, y: height } = this.billboardSizes[kind]!;
        // Looking along -z: tree-space x is the billboard's right and +z faces the viewer.
        const camera = new THREE.OrthographicCamera(-width / 2, width / 2, height, 0, -width, width);
        mesh.geometry = geometry;
        target.viewport.set(kind * BAKE.cell.x, 0, BAKE.cell.x, BAKE.cell.y);
        target.scissor.copy(target.viewport);
        target.scissorTest = true;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      });
      target.scissorTest = false;
      target.viewport.set(0, 0, target.width, target.height);
    }
    renderer.setRenderTarget(previous.target);
    renderer.setClearColor(previous.clear, previous.alpha);
    renderer.autoClear = previous.autoClear;
    material.dispose();
  }

  dispose(): void {
    for (const geometry of [...this.near, ...this.billboards]) geometry.dispose();
    this.leafMaterial.dispose();
    this.leafDepthMaterial.dispose();
    this.billboardMaterial.dispose();
    this.atlas.dispose();
    this.baked.color.dispose();
    this.baked.normal.dispose();
  }
}

// One cell per tree kind, side by side. The margin keeps leaf tips off the cell edge.
const BAKE = { cell: new THREE.Vector2(256, 512), margin: 1.04 };

function bakeTarget(colorSpace: THREE.ColorSpace): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(BAKE.cell.x * 3, BAKE.cell.y, { generateMipmaps: true, depthBuffer: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  target.texture.colorSpace = colorSpace;
  return target;
}

/** A unit quad standing on its foot at the origin, with uv on one kind's baked cell. */
function billboardQuad(kind: number): THREE.BufferGeometry {
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const uv = quad.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (kind + uv.getX(i)) / 3);
  // White vertex colour, so the instance tint reaches the fragment stage as vColor.
  quad.setAttribute('color', new THREE.BufferAttribute(new Float32Array(uv.count * 3).fill(1), 3));
  quad.computeBoundingSphere();
  return quad;
}

/** Writes unlit near-tree colour, or tree-space normal and crown mask, with the near trees' alpha test. */
function bakeMaterial(atlas: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { atlas: { value: atlas }, normalPass: { value: 0 } },
    side: THREE.DoubleSide,
    vertexShader: `
attribute vec3 color;
attribute float crown;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vTreeNormal;
varying float vCrown;
void main() {
  vUv = uv;
  vColor = color;
  vTreeNormal = normal;
  vCrown = crown;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `
uniform sampler2D atlas;
uniform int normalPass;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vTreeNormal;
varying float vCrown;
void main() {
  vec4 leaf = vUv.x < 0.0 ? vec4(1.0) : texture2D(atlas, vUv);
  if (leaf.a < 0.5) discard;
  gl_FragColor = normalPass == 1 ? vec4(normalize(vTreeNormal) * 0.5 + 0.5, vCrown) : vec4(vColor * leaf.rgb, 1.0);
}`,
  });
}

/**
 * Camera-facing quads lit as the near trees: the baked normal turns with the quad, so sun, sky and night
 * light it from the right side. Empty texels are black and clear, so the filtered colour, normal and crown
 * mask are divided by the filtered coverage to stay true at every mip level.
 */
function billboardMaterial(color: THREE.Texture, normal: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: color, alphaTest: 0.4, roughness: 0.92 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bakedNormal = { value: normal };
    const facing = `
vec3 billboardRight = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]) + vec3(1e-5, 0.0, 0.0));
vec3 billboardBack = cross(billboardRight, vec3(0.0, 1.0, 0.0));`;
    // The instance matrix only moves and scales, with equal x and z scale, so turning the quad in
    // instance space keeps the stock projection, fog and cloud-fog chunks valid.
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `${facing}
vec3 transformed = vec3(billboardRight.x * position.x, position.y, billboardRight.z * position.x);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D bakedNormal;')
      .replace('#include <map_fragment>', `
vec4 bakedColor = texture2D( map, vMapUv );
vec4 bakedTreeNormal = texture2D( bakedNormal, vMapUv ) / max( bakedColor.a, 1e-3 );
diffuseColor.rgb *= bakedColor.rgb / max( bakedColor.a, 1e-3 ) * mix( vec3( 1.0 ), vColor, bakedTreeNormal.a );
diffuseColor.a *= bakedColor.a;`)
      .replace('#include <color_fragment>', '')
      .replace('#include <normal_fragment_maps>', `${facing}
vec3 treeNormal = bakedTreeNormal.xyz * 2.0 - 1.0;
normal = normalize( ( viewMatrix * vec4( billboardRight * treeNormal.x + vec3( 0.0, treeNormal.y, 0.0 ) + billboardBack * treeNormal.z, 0.0 ) ).xyz );`);
  };
  return material;
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

/** Merges parts and shares identical vertices, so software WebGL shades about 40% fewer vertices. */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const joined = mergeGeometries(parts, false)!;
  const merged = mergeVertices(joined, 1e-4);
  joined.dispose();
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
