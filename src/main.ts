import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { Sky } from 'three/addons/objects/Sky.js';
import './style.css';
import { Soundscape } from './audio';
import { DEFAULT_FLIGHT_HEIGHT, EagleNavigator, EagleView, FLIGHT_HEIGHT_LIMITS, normalizeFlightHeight } from './eagle';
import { DEFAULT_VISIBILITY, MAX_VISIBILITY, MIN_VISIBILITY, TerrainStream } from './terrain';
import { ThermalMarker } from './thermal-marker';
import { SUN_OFFSET as SUN_VECTOR, WorldModel } from './world';

type StoredSettings = { ambienceVolume: number; musicVolume: number; muted: boolean; cameraDistance: number; terrainVisibility: number; showThermal: boolean; minFlightHeight: number; maxFlightHeight: number };
const SETTINGS_KEY = 'soaring.settings.v1';
const SEED_KEY = 'soaring.world-seed.v1';
const VISIT_KEY = 'soaring.scenic-visit.v1';
const defaultSettings: StoredSettings = { ambienceVolume: 0.52, musicVolume: 0.52, muted: true, cameraDistance: 178, terrainVisibility: DEFAULT_VISIBILITY,
  showThermal: true, minFlightHeight: DEFAULT_FLIGHT_HEIGHT.min, maxFlightHeight: DEFAULT_FLIGHT_HEIGHT.max };
const clamp = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

function loadSettings(): StoredSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<StoredSettings> & { volume?: number };
    const height = normalizeFlightHeight(saved.minFlightHeight ?? defaultSettings.minFlightHeight,
      saved.maxFlightHeight ?? defaultSettings.maxFlightHeight);
    return {
      ambienceVolume: clamp(saved.ambienceVolume, clamp(saved.volume, defaultSettings.ambienceVolume, 0, 1), 0, 1),
      musicVolume: clamp(saved.musicVolume, clamp(saved.volume, defaultSettings.musicVolume, 0, 1), 0, 1),
      muted: typeof saved.muted === 'boolean' ? saved.muted : defaultSettings.muted,
      cameraDistance: clamp(saved.cameraDistance, defaultSettings.cameraDistance, 110, 270),
      showThermal: typeof saved.showThermal === 'boolean' ? saved.showThermal : defaultSettings.showThermal,
      terrainVisibility: clamp(saved.terrainVisibility, defaultSettings.terrainVisibility, MIN_VISIBILITY, MAX_VISIBILITY),
      minFlightHeight: height.min,
      maxFlightHeight: height.max,
    };
  } catch {
    return { ...defaultSettings };
  }
}

function loadSeed(): number {
  const saved = Number(localStorage.getItem(SEED_KEY));
  if (Number.isInteger(saved) && saved !== 0) return saved | 0;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const seed = (values[0] ?? 1) | 0 || 1;
  localStorage.setItem(SEED_KEY, String(seed));
  return seed;
}

function nextVisit(): number {
  const visit = (Number(localStorage.getItem(VISIT_KEY)) || 0) + 1;
  localStorage.setItem(VISIT_KEY, String(visit));
  return visit;
}

// Development-only smoke harness uses a smaller software-WebGL render budget: a bounded default
// terrain visibility so CI never has to stream toward the 10 km product default. Test-only, not a
// product setting; a saved value (set explicitly by a test) always wins.
const smokeMode = import.meta.env.DEV && new URLSearchParams(location.search).has('smoke');
const hasSavedSettings = localStorage.getItem(SETTINGS_KEY) != null;
const settings = loadSettings();
if (smokeMode && !hasSavedSettings) settings.terrainVisibility = MIN_VISIBILITY;
const world = new WorldModel(loadSeed());
const start = world.scenicStart(nextVisit());
const navigator = new EagleNavigator(world, start, { min: settings.minFlightHeight, max: settings.maxFlightHeight });
const eagle = new EagleView();
const soundscape = new Soundscape();
soundscape.setAmbienceVolume(settings.ambienceVolume);
soundscape.setMusicVolume(settings.musicVolume);

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing application root');

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.5, MAX_VISIBILITY + 500);
const renderer = new THREE.WebGLRenderer({ antialias: !smokeMode, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(smokeMode ? 0.75 : Math.min(devicePixelRatio, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = !smokeMode;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('aria-label', 'Autonomous golden eagle flying above a temperate wilderness');
app.append(renderer.domElement);

const hemisphere = new THREE.HemisphereLight(0xd9e6e1, 0x596448, 2.25);
scene.add(hemisphere);
// Fixed mid-afternoon sun; no time-of-day cycle. Shadows and the Sky/Lensflare below all share this direction.
const SUN_OFFSET = new THREE.Vector3(SUN_VECTOR.x, SUN_VECTOR.y, SUN_VECTOR.z);
const sunDirection = SUN_OFFSET.clone().normalize();
const sun = new THREE.DirectionalLight(0xffe1ab, 3.6);
sun.position.copy(SUN_OFFSET);
sun.castShadow = !smokeMode;
sun.shadow.camera.near = 1;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.8;
scene.add(sun, sun.target);

const sky = new Sky();
sky.scale.setScalar(450000);
sky.material.uniforms.sunPosition!.value.copy(sunDirection);
sky.material.uniforms.turbidity!.value = 3;
sky.material.uniforms.rayleigh!.value = 3;
sky.material.uniforms.mieCoefficient!.value = 0.003;
sky.material.uniforms.mieDirectionalG!.value = 0.8;
// The Preetham model's near-horizon radiance saturates well above 1.0 regardless of the uniforms
// above (it is driven by a fixed sun-intensity constant baked into the shader), which clips the
// horizon band to flat white under the renderer's normal tone-mapping exposure. Scale the sky's
// own linear output before tone mapping so it stays a gradient instead of a flat clip - independent
// of scene.toneMappingExposure, which stays tuned for the terrain.
sky.material.uniforms.skyExposure = { value: 0.35 };
sky.material.fragmentShader = sky.material.fragmentShader
  .replace('uniform float mieDirectionalG;', 'uniform float mieDirectionalG;\nuniform float skyExposure;')
  .replace(
    'vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );',
    'vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) ) * skyExposure;',
  );
scene.add(sky);

// three.js always renders offscreen targets with NoToneMapping, so reproduce the on-screen ACES curve here.
function acesFilmicToneMap(color: THREE.Color, exposure: number): THREE.Color {
  const rrtAndOdtFit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.43295) + 0.238081);
  const scale = exposure / 0.6;
  const ix = rrtAndOdtFit((0.59719 * color.r + 0.35458 * color.g + 0.04823 * color.b) * scale);
  const iy = rrtAndOdtFit((0.076 * color.r + 0.90834 * color.g + 0.01566 * color.b) * scale);
  const iz = rrtAndOdtFit((0.0284 * color.r + 0.13383 * color.g + 0.83777 * color.b) * scale);
  return color.setRGB(
    THREE.MathUtils.clamp(1.60475 * ix - 0.53108 * iy - 0.07367 * iz, 0, 1),
    THREE.MathUtils.clamp(-0.10208 * ix + 1.10813 * iy - 0.00605 * iz, 0, 1),
    THREE.MathUtils.clamp(-0.00327 * ix - 0.07276 * iy + 1.07602 * iz, 0, 1),
  );
}

// Sample the sky shader itself near the horizon so fog/haze reads as the same blue-grey, not a fixed beige.
function skyHorizonColor(): THREE.Color {
  const probe = new THREE.Mesh(sky.geometry, sky.material);
  const probeScene = new THREE.Scene();
  probeScene.add(probe);
  const probeCamera = new THREE.PerspectiveCamera(1, 1, 0.1, 10);
  probeCamera.lookAt(0.35, 0.05, -0.9);
  const target = new THREE.WebGLRenderTarget(1, 1);
  renderer.setRenderTarget(target);
  renderer.render(probeScene, probeCamera);
  const pixel = new Uint8Array(4);
  renderer.readRenderTargetPixels(target, 0, 0, 1, 1, pixel);
  renderer.setRenderTarget(null);
  target.dispose();
  const color = new THREE.Color(pixel[0]! / 255, pixel[1]! / 255, pixel[2]! / 255);
  return acesFilmicToneMap(color, renderer.toneMappingExposure);
}
const fog = new THREE.Fog(skyHorizonColor(), MIN_VISIBILITY * 0.5, MIN_VISIBILITY);
scene.fog = fog;

// Small procedural flare textures - no bundled image assets needed.
function flareTexture(size: number, stops: [number, string][]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
const flareGlow = flareTexture(256, [[0, 'rgba(255,246,222,0.85)'], [0.4, 'rgba(255,228,180,0.3)'], [1, 'rgba(255,228,180,0)']]);
const flareRing = flareTexture(128, [[0, 'rgba(210,225,255,0)'], [0.55, 'rgba(210,225,255,0.14)'], [0.75, 'rgba(210,225,255,0)'], [1, 'rgba(210,225,255,0)']]);
const lensflare = new Lensflare();
lensflare.addElement(new LensflareElement(flareGlow, 220, 0));
lensflare.addElement(new LensflareElement(flareRing, 60, 0.6));
sun.add(lensflare);

scene.add(eagle.group);
// Fog uses view depth, not distance. A point at horizontal distance d can have a depth as small
// as d · cos(half-diagonal FOV), so terrain loads out to visibility / cos(half-diagonal FOV).
// Reach stops growing past 16:9; wider windows get a shorter haze instead of more tiles.
const MAX_REACH_ASPECT = 16 / 9;
function depthPerDistance(aspect: number): number {
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return 1 / Math.hypot(1, tanHalfFov * Math.hypot(1, aspect));
}
function terrainReach(): number {
  return settings.terrainVisibility / depthPerDistance(Math.min(camera.aspect, MAX_REACH_ASPECT));
}
const terrain = new TerrainStream(scene, world, terrainReach());
const thermalMarker = new ThermalMarker(scene, world);
terrain.update(navigator.state.x, navigator.state.z - settings.cameraDistance, 49);

let orbitYaw = 0;
let orbitPitch = 0;
let dragging = false;
let pointerX = 0;
let pointerY = 0;
const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
const cameraPosition = new THREE.Vector3(navigator.state.x, navigator.state.y + 70, navigator.state.z - settings.cameraDistance);
const lookAt = new THREE.Vector3();
let cameraHeading = navigator.state.heading;
let rideBlend = 0;

renderer.domElement.addEventListener('pointerdown', (event) => {
  dragging = true;
  pointerX = event.clientX;
  pointerY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
  renderer.domElement.classList.add('dragging');
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  orbitYaw -= (event.clientX - pointerX) * 0.005;
  orbitPitch = Math.max(-0.3, Math.min(0.52, orbitPitch + (event.clientY - pointerY) * 0.0035));
  pointerX = event.clientX;
  pointerY = event.clientY;
});
const releasePointer = (event: PointerEvent) => {
  dragging = false;
  if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
  renderer.domElement.classList.remove('dragging');
};
renderer.domElement.addEventListener('pointerup', releasePointer);
renderer.domElement.addEventListener('pointercancel', releasePointer);

app.insertAdjacentHTML('beforeend', `
  <div id="veil"></div>
  <div class="intro" id="intro">drag to look around · press D for flight diagnostics</div>
  <div class="controls visible" id="controls">
    <section class="settings-panel" id="settings-panel" aria-label="Settings">
      <h1>Soaring</h1>
      <label class="setting">Sound <button class="mute-button" id="mute" type="button">Muted</button></label>
      <label class="setting">Ambience <output id="ambience-value">${Math.round(settings.ambienceVolume * 100)}%</output><input id="ambience" type="range" min="0" max="1" step="0.01" value="${settings.ambienceVolume}"></label>
      <label class="setting">Music <output id="music-value">${Math.round(settings.musicVolume * 100)}%</output><input id="music" type="range" min="0" max="1" step="0.01" value="${settings.musicVolume}"></label>
      <label class="setting">Terrain visibility <output id="visibility-value">${Math.round(settings.terrainVisibility)} m</output><input id="visibility" type="range" min="${MIN_VISIBILITY}" max="${MAX_VISIBILITY}" step="120" value="${settings.terrainVisibility}"></label>
      <label class="setting">Show thermal <input id="show-thermal" type="checkbox" ${settings.showThermal ? 'checked' : ''}></label>
      <label class="setting">Minimum flight height <output id="min-height-value">${settings.minFlightHeight} m</output><input id="min-height" type="range" min="${FLIGHT_HEIGHT_LIMITS.min}" max="${FLIGHT_HEIGHT_LIMITS.max - FLIGHT_HEIGHT_LIMITS.gap}" step="1" value="${settings.minFlightHeight}"></label>
      <label class="setting">Maximum flight height <output id="max-height-value">${settings.maxFlightHeight} m</output><input id="max-height" type="range" min="${FLIGHT_HEIGHT_LIMITS.min + FLIGHT_HEIGHT_LIMITS.gap}" max="${FLIGHT_HEIGHT_LIMITS.max}" step="1" value="${settings.maxFlightHeight}"></label>
      <p class="height-note">Height above local terrain · ${FLIGHT_HEIGHT_LIMITS.gap} m minimum range</p>
      <label class="setting">Camera distance <output id="distance-value">${Math.round(settings.cameraDistance)} m</output><input id="distance" type="range" min="110" max="270" step="1" value="${settings.cameraDistance}"></label>
      <label class="setting"><button class="new-world" id="new-world" type="button">Generate a new world</button></label>
      <p class="audio-note" role="status">Sound starts muted. It is generated in your browser; no media is downloaded.</p>
    </section>
  </div>
  <button class="settings-toggle" id="settings-toggle" type="button" aria-label="Open settings" aria-controls="settings-panel" aria-expanded="false">⚙</button>
  <pre class="diagnostics" id="diagnostics" aria-hidden="true"></pre>
`);

const controls = document.querySelector<HTMLElement>('#controls')!;
const panel = document.querySelector<HTMLElement>('#settings-panel')!;
const toggle = document.querySelector<HTMLButtonElement>('#settings-toggle')!;
const muteButton = document.querySelector<HTMLButtonElement>('#mute')!;
const ambienceInput = document.querySelector<HTMLInputElement>('#ambience')!;
const ambienceValue = document.querySelector<HTMLOutputElement>('#ambience-value')!;
const musicInput = document.querySelector<HTMLInputElement>('#music')!;
const musicValue = document.querySelector<HTMLOutputElement>('#music-value')!;
const audioNote = document.querySelector<HTMLElement>('.audio-note')!;
const visibilityInput = document.querySelector<HTMLInputElement>('#visibility')!;
const visibilityValue = document.querySelector<HTMLOutputElement>('#visibility-value')!;
const showThermalInput = document.querySelector<HTMLInputElement>('#show-thermal')!;
const distanceInput = document.querySelector<HTMLInputElement>('#distance')!;
const distanceValue = document.querySelector<HTMLOutputElement>('#distance-value')!;
const minHeightInput = document.querySelector<HTMLInputElement>('#min-height')!;
const maxHeightInput = document.querySelector<HTMLInputElement>('#max-height')!;
const minHeightValue = document.querySelector<HTMLOutputElement>('#min-height-value')!;
const maxHeightValue = document.querySelector<HTMLOutputElement>('#max-height-value')!;
const diagnostics = document.querySelector<HTMLElement>('#diagnostics')!;

let controlsTimer = 0;
function showControls(): void {
  controls.classList.add('visible');
  window.clearTimeout(controlsTimer);
  controlsTimer = window.setTimeout(() => {
    if (!panel.classList.contains('open')) controls.classList.remove('visible');
  }, 2700);
}
window.addEventListener('pointermove', showControls, { passive: true });
window.addEventListener('keydown', showControls);
showControls();
window.setTimeout(() => document.querySelector('#intro')?.classList.add('hidden'), 7000);

toggle.addEventListener('click', () => {
  const open = panel.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close settings' : 'Open settings');
  showControls();
});
let muteRevision = 0;
async function changeMute(muted: boolean, persist: boolean): Promise<void> {
  const revision = ++muteRevision;
  settings.muted = muted;
  const started = await soundscape.setMuted(muted);
  if (revision !== muteRevision) return;
  settings.muted = soundscape.isMuted;
  muteButton.textContent = settings.muted ? 'Muted' : 'On';
  audioNote.textContent = started ? 'Sound is generated in your browser; no media is downloaded.' : 'Audio could not start in this browser. Try enabling sound again.';
  if (persist || !started) saveSettings();
}
window.addEventListener('pointerdown', (event) => {
  if (!settings.muted && event.target !== muteButton) void changeMute(false, false);
}, { once: true });
muteButton.addEventListener('click', () => {
  void changeMute(!settings.muted, true);
  showControls();
});
ambienceInput.addEventListener('input', () => {
  settings.ambienceVolume = Number(ambienceInput.value);
  ambienceValue.value = `${Math.round(settings.ambienceVolume * 100)}%`;
  soundscape.setAmbienceVolume(settings.ambienceVolume);
  saveSettings();
});
musicInput.addEventListener('input', () => {
  settings.musicVolume = Number(musicInput.value);
  musicValue.value = `${Math.round(settings.musicVolume * 100)}%`;
  soundscape.setMusicVolume(settings.musicVolume);
  saveSettings();
});
visibilityInput.addEventListener('input', () => {
  settings.terrainVisibility = Number(visibilityInput.value);
  visibilityValue.value = `${Math.round(settings.terrainVisibility)} m`;
  terrain.setReach(terrainReach());
  saveSettings();
});
showThermalInput.addEventListener('change', () => {
  settings.showThermal = showThermalInput.checked;
  thermalMarker.update(navigator.activeThermal, settings.showThermal, performance.now() / 1000);
  saveSettings();
});
distanceInput.addEventListener('input', () => {
  settings.cameraDistance = Number(distanceInput.value);
  distanceValue.value = `${Math.round(settings.cameraDistance)} m`;
  saveSettings();
});
minHeightInput.addEventListener('input', () => {
  settings.minFlightHeight = Math.min(Number(minHeightInput.value), settings.maxFlightHeight - FLIGHT_HEIGHT_LIMITS.gap);
  updateFlightHeight();
});
maxHeightInput.addEventListener('input', () => {
  settings.maxFlightHeight = Math.max(Number(maxHeightInput.value), settings.minFlightHeight + FLIGHT_HEIGHT_LIMITS.gap);
  updateFlightHeight();
});
function updateFlightHeight(): void {
  minHeightInput.value = String(settings.minFlightHeight);
  maxHeightInput.value = String(settings.maxFlightHeight);
  minHeightValue.value = `${settings.minFlightHeight} m`;
  maxHeightValue.value = `${settings.maxFlightHeight} m`;
  navigator.setFlightHeightRange({ min: settings.minFlightHeight, max: settings.maxFlightHeight });
  saveSettings();
}
document.querySelector('#new-world')?.addEventListener('click', () => {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  localStorage.setItem(SEED_KEY, String((values[0] ?? 1) | 0 || 1));
  localStorage.setItem(VISIT_KEY, '0');
  location.reload();
});
function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function updateFog(): void {
  const coveredDepth = terrain.coveredDistance(cameraPosition.x, cameraPosition.z) * depthPerDistance(camera.aspect);
  fog.far = Math.min(settings.terrainVisibility, coveredDepth);
  fog.near = fog.far * 0.5;
}
// A fixed range around the camera, independent of terrain visibility, keeps the shadow camera's
// size (and so its texel size) constant, which is required for the texel snapping below.
const SHADOW_EXTENT = 600;
const SHADOW_MAP_SIZE = Math.min(2048, renderer.capabilities.maxTextureSize);
const SHADOW_TEXEL_SIZE = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE;
sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
sun.shadow.camera.left = sun.shadow.camera.bottom = -SHADOW_EXTENT;
sun.shadow.camera.right = sun.shadow.camera.top = SHADOW_EXTENT;
sun.shadow.camera.far = (SHADOW_EXTENT + 300) * 2;
sun.shadow.camera.updateProjectionMatrix();
terrain.setShadowFadeRange(SHADOW_EXTENT * 0.7, SHADOW_EXTENT * 0.95);

// The shadow camera's basis (its right/up axes) is constant because the sun always sits at a
// fixed offset direction from its target. Precomputing it lets the snap below stay a dot product.
const shadowBasis = new THREE.Matrix4().lookAt(SUN_OFFSET, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
const shadowRight = new THREE.Vector3().setFromMatrixColumn(shadowBasis, 0);
const shadowUp = new THREE.Vector3().setFromMatrixColumn(shadowBasis, 1);
// Snaps a world point to the shadow map's texel grid so the shadow only moves in whole-texel
// steps, which stops the sub-pixel shimmer of a smoothly following shadow camera.
function snapToShadowGrid(point: THREE.Vector3): void {
  const right = point.dot(shadowRight);
  const up = point.dot(shadowUp);
  point.addScaledVector(shadowRight, Math.round(right / SHADOW_TEXEL_SIZE) * SHADOW_TEXEL_SIZE - right);
  point.addScaledVector(shadowUp, Math.round(up / SHADOW_TEXEL_SIZE) * SHADOW_TEXEL_SIZE - up);
}

let diagnosticsVisible = false;
window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() !== 'd' || event.repeat) return;
  diagnosticsVisible = !diagnosticsVisible;
  diagnostics.classList.toggle('visible', diagnosticsVisible);
  diagnostics.setAttribute('aria-hidden', String(!diagnosticsVisible));
});

let timeScale = 1;
let lastTime = performance.now();
let fpsSmoothed = 60;
let diagnosticsElapsed = 0;

function frame(now: number): void {
  const rawDelta = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const delta = rawDelta * timeScale;
  const substeps = Math.ceil(delta / 0.1);
  let state = navigator.state;
  for (let step = 0; step < substeps; step += 1) state = navigator.update(delta / substeps);
  eagle.update(state, delta);
  thermalMarker.update(navigator.activeThermal, settings.showThermal, now / 1000);
  soundscape.update(state.behavior, state.flapping);

  if (!dragging) {
    const returnRate = 1 - Math.exp(-rawDelta * 0.42);
    orbitYaw += (0 - orbitYaw) * returnRate;
    orbitPitch += (0 - orbitPitch) * returnRate;
  }
  // Thermal-riding: follow more loosely and yaw slower than the eagle so it moves around the frame.
  rideBlend += ((state.behavior === 'thermal-riding' ? 1 : 0) - rideBlend) * (1 - Math.exp(-rawDelta * 0.65));
  cameraHeading += wrapAngle(state.heading - cameraHeading) * (1 - Math.exp(-rawDelta * (2.6 - rideBlend * 2.1)));
  const backward = new THREE.Vector3(-Math.sin(cameraHeading), 0, -Math.cos(cameraHeading));
  const side = new THREE.Vector3(Math.cos(cameraHeading), 0, -Math.sin(cameraHeading));
  const distance = settings.cameraDistance;
  const desired = new THREE.Vector3(state.x, state.y, state.z)
    .addScaledVector(backward, Math.cos(orbitYaw) * distance)
    .addScaledVector(side, Math.sin(orbitYaw) * distance)
    .add(new THREE.Vector3(0, distance * (0.31 + orbitPitch), 0));
  cameraPosition.lerp(desired, 1 - Math.exp(-rawDelta * (2.1 - rideBlend * 1.35)));
  cameraPosition.y = Math.max(cameraPosition.y, world.sample(cameraPosition.x, cameraPosition.z).height + 14);
  camera.position.copy(cameraPosition);
  const lookAhead = 38 - rideBlend * 22;
  lookAt.set(state.x + Math.sin(cameraHeading) * lookAhead, state.y - 9 - orbitPitch * 24, state.z + Math.cos(cameraHeading) * lookAhead);
  camera.lookAt(lookAt);
  terrain.update(cameraPosition.x, cameraPosition.z);
  updateFog();

  sun.target.position.set(camera.position.x, world.sample(camera.position.x, camera.position.z).height, camera.position.z);
  snapToShadowGrid(sun.target.position);
  sun.position.copy(SUN_OFFSET).setLength(SHADOW_EXTENT + 300).add(sun.target.position);
  sun.target.updateMatrixWorld();

  renderer.render(scene, camera);
  fpsSmoothed += ((rawDelta > 0 ? 1 / rawDelta : 60) - fpsSmoothed) * 0.05;
  diagnosticsElapsed += rawDelta;
  if (diagnosticsVisible && diagnosticsElapsed > 0.22) {
    diagnosticsElapsed = 0;
    const nearby = world.nearbyThermals(state.x, state.z, 1)
      .sort((a, b) => Math.hypot(a.x - state.x, a.z - state.z) - Math.hypot(b.x - state.x, b.z - state.z))
      .slice(0, 4).map((thermal) => `${thermal.x.toFixed(0)},${thermal.z.toFixed(0)}`).join(' · ');
    diagnostics.textContent = [
      `FPS          ${fpsSmoothed.toFixed(0)}`,
      `chunks       ${terrain.chunkCount} (${terrain.pendingCount} pending)`,
      `LOD          near ${terrain.tierCounts.near} · mid ${terrain.tierCounts.mid} · far ${terrain.tierCounts.far}`,
      `visibility   ${fog.far.toFixed(0)} / ${settings.terrainVisibility.toFixed(0)} m`,
      `draw calls   ${renderer.info.render.calls}`,
      `geometries   ${renderer.info.memory.geometries}`,
      `behavior     ${state.behavior}${state.flapping ? ' (flapping)' : ''}`,
      `clearance    ${(state.y - world.sample(state.x, state.z).height).toFixed(0)} m`,
      `position     ${state.x.toFixed(0)}, ${state.z.toFixed(0)}`,
      `thermal      ${navigator.activeThermal ? `${navigator.activeThermal.x.toFixed(0)}, ${navigator.activeThermal.z.toFixed(0)}` : 'none selected'}`,
      `nearby       ${nearby}`,
      `time scale   ${timeScale.toFixed(1)}×`,
    ].join('\n');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  terrain.setReach(terrainReach());
});

window.addEventListener('beforeunload', () => {
  thermalMarker.dispose();
  terrain.dispose();
});

declare global {
  interface Window {
    __SOARING__: {
      snapshot: () => { seed: number; chunks: number; pending: number; visibleDistance: number; requestedDistance: number; cameraDistance: number; behavior: string; flapping: boolean; bank: number; heading: number; position: number[]; geometries: number; activeThermal: number[] | null; marker: number[] | null; tiers: { near: number; mid: number; far: number } };
      setTimeScale: (scale: number) => void;
    };
  }
}
window.__SOARING__ = {
  snapshot: () => ({
    seed: world.seed,
    chunks: terrain.chunkCount,
    pending: terrain.pendingCount,
    visibleDistance: fog.far,
    requestedDistance: settings.terrainVisibility,
    cameraDistance: settings.cameraDistance,
    behavior: navigator.state.behavior,
    flapping: navigator.state.flapping,
    bank: navigator.state.bank,
    heading: navigator.state.heading,
    position: [navigator.state.x, navigator.state.y, navigator.state.z],
    geometries: renderer.info.memory.geometries,
    activeThermal: navigator.activeThermal ? [navigator.activeThermal.x, navigator.activeThermal.z] : null,
    marker: thermalMarker.mesh.visible ? [thermalMarker.mesh.position.x, thermalMarker.mesh.position.z] : null,
    tiers: terrain.tierCounts,
  }),
  setTimeScale: (scale: number) => { timeScale = Math.max(1, Math.min(12, scale)); },
};
