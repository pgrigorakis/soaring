import * as THREE from 'three';
import './style.css';
import { Soundscape } from './audio';
import { DEFAULT_FLIGHT_HEIGHT, EagleNavigator, EagleView, FLIGHT_HEIGHT_LIMITS, normalizeFlightHeight } from './eagle';
import { MAX_VISIBILITY, MIN_VISIBILITY, TerrainStream } from './terrain';
import { ThermalMarker } from './thermal-marker';
import { WorldModel } from './world';

type StoredSettings = { volume: number; muted: boolean; cameraDistance: number; terrainVisibility: number; showThermal: boolean; minFlightHeight: number; maxFlightHeight: number };
const SETTINGS_KEY = 'soaring.settings.v1';
const SEED_KEY = 'soaring.world-seed.v1';
const VISIT_KEY = 'soaring.scenic-visit.v1';
const defaultSettings: StoredSettings = { volume: 0.52, muted: true, cameraDistance: 178, terrainVisibility: MIN_VISIBILITY,
  showThermal: true, minFlightHeight: DEFAULT_FLIGHT_HEIGHT.min, maxFlightHeight: DEFAULT_FLIGHT_HEIGHT.max };
const clamp = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

function loadSettings(): StoredSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<StoredSettings> & { quality?: unknown };
    const height = normalizeFlightHeight(saved.minFlightHeight ?? defaultSettings.minFlightHeight,
      saved.maxFlightHeight ?? defaultSettings.maxFlightHeight);
    return {
      volume: clamp(saved.volume, defaultSettings.volume, 0, 1),
      muted: typeof saved.muted === 'boolean' ? saved.muted : defaultSettings.muted,
      cameraDistance: clamp(saved.cameraDistance, defaultSettings.cameraDistance, 110, 270),
      showThermal: typeof saved.showThermal === 'boolean' ? saved.showThermal : defaultSettings.showThermal,
      // Old saves had a quality preset, not a visibility preference. Keep the old
      // camera and sound preferences and the view distance of the old High preset.
      terrainVisibility: clamp(saved.terrainVisibility, saved.quality === 'high' ? 1080 : defaultSettings.terrainVisibility, MIN_VISIBILITY, MAX_VISIBILITY),
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

const settings = loadSettings();
const world = new WorldModel(loadSeed());
const start = world.scenicStart(nextVisit());
const navigator = new EagleNavigator(world, start, { min: settings.minFlightHeight, max: settings.maxFlightHeight });
const eagle = new EagleView();
const soundscape = new Soundscape();
soundscape.setVolume(settings.volume);

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing application root');

const HORIZON_COLOR = 0xd8d4b3;
const scene = new THREE.Scene();
scene.background = new THREE.Color(HORIZON_COLOR);
const fog = new THREE.Fog(HORIZON_COLOR, MIN_VISIBILITY * 0.5, MIN_VISIBILITY);
scene.fog = fog;

// Only the development smoke harness uses a smaller software-WebGL render budget.
const smokeMode = import.meta.env.DEV && new URLSearchParams(location.search).has('smoke');
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
const SUN_OFFSET = new THREE.Vector3(-420, 190, -300);
const sun = new THREE.DirectionalLight(0xffe1ab, 3.6);
sun.position.copy(SUN_OFFSET);
sun.castShadow = !smokeMode;
sun.shadow.camera.near = 1;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.8;
scene.add(sun, sun.target);

const skyGeometry = new THREE.SphereGeometry(820, 20, 12);
const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    topColor: { value: new THREE.Color(0x6f9fb2) },
    horizonColor: { value: new THREE.Color(HORIZON_COLOR) },
  },
  vertexShader: 'varying float vHeight; void main(){ vHeight = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 topColor; uniform vec3 horizonColor; varying float vHeight; void main(){ float h = smoothstep(-0.12, 0.74, vHeight); gl_FragColor = vec4(mix(horizonColor, topColor, h), 1.0); \n#include <colorspace_fragment>\n}',
});
const sky = new THREE.Mesh(skyGeometry, skyMaterial);
sky.renderOrder = -1;
scene.add(sky);
const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(18, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe5a8, fog: false }));
scene.add(sunDisc);

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
const cameraPosition = new THREE.Vector3(navigator.state.x, navigator.state.y + 70, navigator.state.z - settings.cameraDistance);
const lookAt = new THREE.Vector3();
const shadowCenter = new THREE.Vector3();

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
      <label class="setting">Volume <output id="volume-value">${Math.round(settings.volume * 100)}%</output><input id="volume" type="range" min="0" max="1" step="0.01" value="${settings.volume}"></label>
      <label class="setting">Terrain visibility <output id="visibility-value">${Math.round(settings.terrainVisibility)} m</output><input id="visibility" type="range" min="${MIN_VISIBILITY}" max="${MAX_VISIBILITY}" step="120" value="${settings.terrainVisibility}"></label>
      <label class="setting">Show thermal <input id="show-thermal" type="checkbox" ${settings.showThermal ? 'checked' : ''}></label>
      <label class="setting">Minimum flight height <output id="min-height-value">${settings.minFlightHeight} m</output><input id="min-height" type="range" min="${FLIGHT_HEIGHT_LIMITS.min}" max="${FLIGHT_HEIGHT_LIMITS.max - FLIGHT_HEIGHT_LIMITS.gap}" step="1" value="${settings.minFlightHeight}"></label>
      <label class="setting">Maximum flight height <output id="max-height-value">${settings.maxFlightHeight} m</output><input id="max-height" type="range" min="${FLIGHT_HEIGHT_LIMITS.min + FLIGHT_HEIGHT_LIMITS.gap}" max="${FLIGHT_HEIGHT_LIMITS.max}" step="1" value="${settings.maxFlightHeight}"></label>
      <p class="height-note">Height above local terrain · ${FLIGHT_HEIGHT_LIMITS.gap} m minimum range</p>
      <label class="setting">Camera distance <output id="distance-value">${Math.round(settings.cameraDistance)} m</output><input id="distance" type="range" min="110" max="270" step="1" value="${settings.cameraDistance}"></label>
      <label class="setting"><button class="new-world" id="new-world" type="button">Generate a new world</button></label>
      <p class="audio-note">Sound starts muted. It is generated in your browser; no media is downloaded.</p>
    </section>
  </div>
  <button class="settings-toggle" id="settings-toggle" type="button" aria-label="Open settings" aria-controls="settings-panel" aria-expanded="false">⚙</button>
  <pre class="diagnostics" id="diagnostics" aria-hidden="true"></pre>
`);

const controls = document.querySelector<HTMLElement>('#controls')!;
const panel = document.querySelector<HTMLElement>('#settings-panel')!;
const toggle = document.querySelector<HTMLButtonElement>('#settings-toggle')!;
const muteButton = document.querySelector<HTMLButtonElement>('#mute')!;
const volumeInput = document.querySelector<HTMLInputElement>('#volume')!;
const volumeValue = document.querySelector<HTMLOutputElement>('#volume-value')!;
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
window.addEventListener('pointerdown', async () => {
  if (!settings.muted) {
    await soundscape.setMuted(false);
    muteButton.textContent = 'On';
  }
}, { once: true });
muteButton.addEventListener('click', async () => {
  settings.muted = !soundscape.isMuted;
  await soundscape.setMuted(settings.muted);
  muteButton.textContent = soundscape.isMuted ? 'Muted' : 'On';
  saveSettings();
  showControls();
});
volumeInput.addEventListener('input', () => {
  settings.volume = Number(volumeInput.value);
  volumeValue.value = `${Math.round(settings.volume * 100)}%`;
  soundscape.setVolume(settings.volume);
  saveSettings();
});
visibilityInput.addEventListener('input', () => {
  settings.terrainVisibility = Number(visibilityInput.value);
  visibilityValue.value = `${Math.round(settings.terrainVisibility)} m`;
  terrain.setReach(terrainReach());
  updateShadowArea();
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
  minHeightInput.max = String(settings.maxFlightHeight - FLIGHT_HEIGHT_LIMITS.gap);
  maxHeightInput.min = String(settings.minFlightHeight + FLIGHT_HEIGHT_LIMITS.gap);
  minHeightValue.value = `${settings.minFlightHeight} m`;
  maxHeightValue.value = `${settings.maxFlightHeight} m`;
  navigator.setFlightHeightRange({ min: settings.minFlightHeight, max: settings.maxFlightHeight });
  saveSettings();
}
minHeightInput.max = String(settings.maxFlightHeight - FLIGHT_HEIGHT_LIMITS.gap);
maxHeightInput.min = String(settings.minFlightHeight + FLIGHT_HEIGHT_LIMITS.gap);
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
// Use selected visibility so streaming does not resize the shadow area each frame.
// Longer distances use a larger map to keep texels at or below about 1.8 m.
function updateShadowArea(): void {
  const extent = settings.terrainVisibility;
  const size = Math.min(extent > 1800 ? 4096 : 2048, renderer.capabilities.maxTextureSize);
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    sun.shadow.mapSize.set(size, size);
  }
  sun.shadow.camera.left = sun.shadow.camera.bottom = -extent;
  sun.shadow.camera.right = sun.shadow.camera.top = extent;
  sun.shadow.camera.far = (extent + 300) * 2;
  sun.shadow.camera.updateProjectionMatrix();
}
updateShadowArea();

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
  soundscape.update(state.behavior);

  if (!dragging) {
    const returnRate = 1 - Math.exp(-rawDelta * 0.42);
    orbitYaw += (0 - orbitYaw) * returnRate;
    orbitPitch += (0 - orbitPitch) * returnRate;
  }
  const backward = new THREE.Vector3(-Math.sin(state.heading), 0, -Math.cos(state.heading));
  const side = new THREE.Vector3(Math.cos(state.heading), 0, -Math.sin(state.heading));
  const distance = settings.cameraDistance;
  const desired = new THREE.Vector3(state.x, state.y, state.z)
    .addScaledVector(backward, Math.cos(orbitYaw) * distance)
    .addScaledVector(side, Math.sin(orbitYaw) * distance)
    .add(new THREE.Vector3(0, distance * (0.31 + orbitPitch), 0));
  cameraPosition.lerp(desired, 1 - Math.exp(-rawDelta * 2.1));
  cameraPosition.y = Math.max(cameraPosition.y, world.sample(cameraPosition.x, cameraPosition.z).height + 14);
  camera.position.copy(cameraPosition);
  lookAt.set(state.x + Math.sin(state.heading) * 38, state.y - 9 - orbitPitch * 24, state.z + Math.cos(state.heading) * 38);
  camera.lookAt(lookAt);
  terrain.update(cameraPosition.x, cameraPosition.z);
  updateFog();

  sky.position.set(state.x, state.y - 40, state.z);
  sunDisc.position.copy(SUN_OFFSET).setLength(700).add(eagle.group.position);
  camera.getWorldDirection(shadowCenter).setY(0).setLength(settings.terrainVisibility * 0.5).add(camera.position);
  sun.target.position.set(shadowCenter.x, world.sample(shadowCenter.x, shadowCenter.z).height, shadowCenter.z);
  sun.position.copy(SUN_OFFSET).setLength(settings.terrainVisibility + 300).add(sun.target.position);
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
      `visibility   ${fog.far.toFixed(0)} / ${settings.terrainVisibility.toFixed(0)} m`,
      `draw calls   ${renderer.info.render.calls}`,
      `geometries   ${renderer.info.memory.geometries}`,
      `behavior     ${state.behavior}`,
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
      snapshot: () => { seed: number; chunks: number; pending: number; visibleDistance: number; requestedDistance: number; cameraDistance: number; behavior: string; position: number[]; geometries: number; activeThermal: number[] | null; marker: number[] | null };
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
    position: [navigator.state.x, navigator.state.y, navigator.state.z],
    geometries: renderer.info.memory.geometries,
    activeThermal: navigator.activeThermal ? [navigator.activeThermal.x, navigator.activeThermal.z] : null,
    marker: thermalMarker.mesh.visible ? [thermalMarker.mesh.position.x, thermalMarker.mesh.position.z] : null,
  }),
  setTimeScale: (scale: number) => { timeScale = Math.max(1, Math.min(12, scale)); },
};
