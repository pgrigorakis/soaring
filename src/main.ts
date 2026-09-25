import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { Sky } from 'three/addons/objects/Sky.js';
import './style.css';
import { Soundscape } from './audio';
import { DEFAULT_FLIGHT_HEIGHT, EagleNavigator, EagleView, FLIGHT_HEIGHT_LIMITS, normalizeFlightHeight } from './eagle';
import { DEFAULT_VISIBILITY, MAX_VISIBILITY, MIN_VISIBILITY, TerrainStream } from './terrain';
import { THERMAL_MARKER_RANGE, ThermalMarker } from './thermal-marker';
import { DAY_SECONDS, daylight, type Daylight } from './sky-cycle';
import { WorldModel } from './world';

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
// terrain visibility so CI never has to stream toward the 5 km product default. Test-only, not a
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
// One shadow caster. Its direction follows whichever body is higher. Both intensities are zero
// on the horizon, so the direction can flip there without a visible shadow pop.
const keyLight = new THREE.DirectionalLight(0xffe1ab, 3.6);
keyLight.castShadow = !smokeMode;
keyLight.shadow.camera.near = 1;
keyLight.shadow.bias = -0.0005;
keyLight.shadow.normalBias = 0.8;
scene.add(keyLight, keyLight.target);

const sky = new Sky();
sky.scale.setScalar(450000);
sky.material.uniforms.turbidity!.value = 2.4;
sky.material.uniforms.rayleigh!.value = 2.6;
sky.material.uniforms.mieCoefficient!.value = 0.004;
sky.material.uniforms.mieDirectionalG!.value = 0.78;
// The Preetham model's near-horizon radiance saturates well above 1.0 regardless of the uniforms
// above (it is driven by a fixed sun-intensity constant baked into the shader), which clips the
// horizon band to flat white under the renderer's normal tone-mapping exposure. Scale the sky's
// own linear output before tone mapping so it stays a gradient instead of a flat clip - independent
// of renderer.toneMappingExposure, which stays tuned for the terrain.
// sunPosition must be large: the shader's sunset fade divides Y by 450000. A unit vector never leaves full day.
sky.material.uniforms.skyExposure = { value: 0.16 };
sky.material.uniforms.nightAmount = { value: 0 };
sky.material.uniforms.goldenAmount = { value: 0 };
sky.material.uniforms.blueAmount = { value: 0 };
sky.material.uniforms.starAmount = { value: 0 };
sky.material.uniforms.moonPosition = { value: new THREE.Vector3(0, -1, 0) };
sky.material.fragmentShader = sky.material.fragmentShader
  .replace(
    'uniform float mieDirectionalG;',
    'uniform float mieDirectionalG;\nuniform float skyExposure;\nuniform float nightAmount;\nuniform float goldenAmount;\nuniform float blueAmount;\nuniform float starAmount;\nuniform vec3 moonPosition;',
  )
  .replace(
    'vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );',
    `vec3 dayColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) ) * skyExposure;
			float sunFacing = max(dot(direction, vSunDirection), 0.0);
			float sunUp = smoothstep(0.0, 0.06, vSunDirection.y);
			float sunDisc = smoothstep(0.99962, 0.99984, sunFacing);
			float lowSky = 1.0 - smoothstep(0.0, 0.42, direction.y);
			vec3 warmBand = vec3(0.78, 0.4, 0.22);
			dayColor = mix(dayColor, warmBand, clamp(goldenAmount, 0.0, 1.0) * lowSky * 0.62);
			dayColor = mix(dayColor, dayColor * vec3(0.58, 0.8, 1.32), clamp(blueAmount, 0.0, 1.0) * smoothstep(0.04, 0.5, direction.y) * 0.7);
			dayColor += vec3(1.2, 0.55, 0.18) * sunDisc * 0.55 * sunUp;
			float skyHorizon = pow(1.0 - clamp(direction.y, 0.0, 1.0), 3.0);
			vec3 nightColor = vec3(0.004, 0.007, 0.026) + vec3(0.018, 0.026, 0.048) * skyHorizon;
			vec3 retColor = mix(dayColor, nightColor, clamp(nightAmount, 0.0, 1.0));
			float starGrid = 260.0;
			vec3 starScaled = direction * starGrid;
			vec3 starCell = floor(starScaled);
			float starHash = fract(sin(dot(starCell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
			float starVary = fract(sin(dot(starCell, vec3(269.5, 183.3, 246.1))) * 12543.23);
			float star = step(0.965, starHash) * smoothstep(mix(0.08, 0.2, starVary), 0.0, length(starScaled - starCell - 0.5));
			star *= mix(0.22, 1.0, starVary * starVary) * smoothstep(0.02, 0.18, direction.y);
			retColor += vec3(0.82, 0.88, 1.0) * star * starAmount * 1.6;
			vec3 moonDir = normalize(moonPosition);
			float moonDot = dot(direction, moonDir);
			float moonDisc = smoothstep(0.99942, 0.9997, moonDot);
			float moonLimb = smoothstep(0.9986, 0.99945, moonDot);
			retColor += vec3(0.93, 0.95, 1.0) * (moonDisc * 4.5 + moonLimb * 0.12) * smoothstep(0.02, 0.08, moonDir.y);`,
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

// Sample the sky shader itself near the horizon so fog/haze reads as the same color, not a fixed beige.
// Reused every sample: no per-frame allocation. The probe is a unit box at the origin, so it does not
// follow the sky mesh; shared uniforms carry the current sun and night mix.
const fogProbeScene = new THREE.Scene();
const fogProbe = new THREE.Mesh(sky.geometry, sky.material);
fogProbeScene.add(fogProbe);
const fogProbeCamera = new THREE.PerspectiveCamera(1, 1, 0.1, 10);
const fogTarget = new THREE.WebGLRenderTarget(1, 1);
const fogPixel = new Uint8Array(4);
const fogSample = new THREE.Color();
const horizonLook = new THREE.Vector3();
function sampleHorizonColor(): THREE.Color {
  // Perpendicular to the sun, just above the horizon, so haze matches the sky band and not the solar disc.
  horizonLook.set(-sunDir.z, 0.07, sunDir.x);
  if (horizonLook.x * horizonLook.x + horizonLook.z * horizonLook.z < 1e-4) horizonLook.set(1, 0.07, 0);
  fogProbeCamera.lookAt(horizonLook);
  renderer.setRenderTarget(fogTarget);
  renderer.render(fogProbeScene, fogProbeCamera);
  renderer.readRenderTargetPixels(fogTarget, 0, 0, 1, 1, fogPixel);
  renderer.setRenderTarget(null);
  fogSample.setRGB(fogPixel[0]! / 255, fogPixel[1]! / 255, fogPixel[2]! / 255);
  return acesFilmicToneMap(fogSample, renderer.toneMappingExposure);
}
const fog = new THREE.Fog(0x8faeb8, MIN_VISIBILITY * 0.5, MIN_VISIBILITY);
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
const flareGlowElement = new LensflareElement(flareGlow, 220, 0);
const flareRingElement = new LensflareElement(flareRing, 60, 0.6);
lensflare.addElement(flareGlowElement);
lensflare.addElement(flareRingElement);
// The flare used to be a child of the shadow light. That light sits ~900 m from the camera so the
// shadow frustum stays small, and the flare parallaxed across the sky as the camera orbited.
// An anchor at camera + sunDirection stays on the same infinite direction as the sky disc.
const sunFlareAnchor = new THREE.Object3D();
sunFlareAnchor.add(lensflare);
scene.add(sunFlareAnchor);

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
  orbitPitch = Math.max(-0.85, Math.min(0.52, orbitPitch + (event.clientY - pointerY) * 0.0035));
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
  thermalMarker.update(navigator.state, navigator.activeThermal, settings.showThermal, performance.now() / 1000);
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
let hazeStart = 0.82;
function updateFog(): void {
  const coveredDepth = terrain.coveredDistance(cameraPosition.x, cameraPosition.z) * depthPerDistance(camera.aspect);
  fog.far = Math.min(settings.terrainVisibility, coveredDepth);
  fog.near = fog.far * hazeStart;
}
// A fixed range around the camera, independent of terrain visibility, keeps the shadow camera's
// size (and so its texel size) constant, which is required for the texel snapping below.
const SHADOW_EXTENT = 600;
const SHADOW_MAP_SIZE = Math.min(2048, renderer.capabilities.maxTextureSize);
const SHADOW_TEXEL_SIZE = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE;
keyLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
keyLight.shadow.camera.left = keyLight.shadow.camera.bottom = -SHADOW_EXTENT;
keyLight.shadow.camera.right = keyLight.shadow.camera.top = SHADOW_EXTENT;
keyLight.shadow.camera.far = (SHADOW_EXTENT + 300) * 2;
keyLight.shadow.camera.updateProjectionMatrix();
terrain.setShadowFadeRange(SHADOW_EXTENT * 0.7, SHADOW_EXTENT * 0.95);

// The basis follows the dominant body. It changes slowly through the day, so texel snapping still
// stops the high-frequency shimmer of a shadow camera that tracks the eagle. The basis is rebuilt
// in place; the up axis is never parallel to the light because the arc stays off zenith.
const shadowBasis = new THREE.Matrix4();
const shadowRight = new THREE.Vector3();
const shadowUp = new THREE.Vector3();
const shadowOrigin = new THREE.Vector3();
const shadowUpAxis = new THREE.Vector3(0, 1, 0);
const shadowOffset = new THREE.Vector3();
function updateShadowBasis(direction: THREE.Vector3): void {
  shadowOffset.copy(direction).multiplyScalar(SHADOW_EXTENT + 300);
  shadowBasis.lookAt(shadowOffset, shadowOrigin, shadowUpAxis);
  shadowRight.setFromMatrixColumn(shadowBasis, 0);
  shadowUp.setFromMatrixColumn(shadowBasis, 1);
}
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
// Real time, not the flight time scale, so a 15-minute day stays 15 minutes during accelerated tests.
let skySeconds = 0.36 * DAY_SECONDS;
let skyPaused = false;
let skyLook: 'sun' | 'moon' | 'horizon' | null = null;
let fogSampleAge = 999;
const sunDir = new THREE.Vector3();
const moonDir = new THREE.Vector3();
const skyAim = new THREE.Vector3();
const keyDir = new THREE.Vector3();
const fogGoal = new THREE.Color(0x8faeb8);
const veil = document.querySelector<HTMLElement>('#veil')!;
const smooth01 = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function applyDaylight(body: Daylight, delta: number, forceFog: boolean): void {
  sunDir.set(body.sun.x, body.sun.y, body.sun.z);
  moonDir.set(body.moon.x, body.moon.y, body.moon.z);
  const high = smooth01(0.12, 0.72, Math.max(0, body.sun.y));
  const day = 1 - body.night;
  sky.material.uniforms.sunPosition!.value.copy(sunDir).multiplyScalar(450000);
  sky.material.uniforms.moonPosition!.value.copy(moonDir);
  sky.material.uniforms.turbidity!.value = 9.5 - high * 8.2;
  sky.material.uniforms.rayleigh!.value = 2.4 + high * 1.6;
  sky.material.uniforms.mieCoefficient!.value = 0.016 - high * 0.0145;
  sky.material.uniforms.mieDirectionalG!.value = 0.93 - high * 0.18;
  sky.material.uniforms.skyExposure!.value = 0.16 + high * 0.04;
  sky.material.uniforms.nightAmount!.value = body.night;
  sky.material.uniforms.goldenAmount!.value = 1 - high;
  sky.material.uniforms.blueAmount!.value = high;
  hazeStart = 0.4 + high * 0.5;
  sky.material.uniforms.starAmount!.value = smooth01(0.0, -0.12, body.sun.y);
  // Keep the sky box around the camera. The sun uniform is a direction, so moving the mesh
  // does not drag the sun; it only stops the box from being left behind on a long flight.
  sky.position.copy(camera.position);

  const dominantSun = body.dominant === 'sun';
  keyDir.copy(dominantSun ? sunDir : moonDir);
  const keyColor = dominantSun ? body.sunColor : body.moonColor;
  const keyIntensity = dominantSun ? body.sunIntensity : body.moonIntensity;
  keyLight.color.setRGB(keyColor.r, keyColor.g, keyColor.b);
  keyLight.intensity = keyIntensity;
  hemisphere.color.setRGB(0.16 + day * 0.68, 0.2 + day * 0.68, 0.36 + day * 0.5);
  hemisphere.groundColor.setRGB(0.08 + day * 0.27, 0.09 + day * 0.3, 0.08 + day * 0.2);
  hemisphere.intensity = 1.15 + day * 1.05;
  renderer.toneMappingExposure = 1.06 + body.night * 0.12;

  const flare = smooth01(0, 0.12, body.sun.y);
  const low = 1 - high;
  flareGlowElement.size = 42 + low * 16;
  flareRingElement.size = 36;
  flareGlowElement.color.setRGB(flare, flare * (0.72 + high * 0.22), flare * (0.38 + high * 0.4));
  flareRingElement.color.setRGB(flare * 0.55, flare * 0.62, flare * 0.8);
  sunFlareAnchor.visible = flare > 0.01;
  if (sunFlareAnchor.visible) {
    sunFlareAnchor.position.copy(camera.position).addScaledVector(sunDir, camera.far * 0.82);
  }

  veil.style.setProperty('--veil-top', 'rgba(0, 0, 0, 0)');
  veil.style.setProperty('--veil-bottom', 'rgba(20, 32, 40, 0.03)');

  fogSampleAge += delta;
  if (forceFog || fogSampleAge > 0.35) {
    fogSampleAge = 0;
    fogGoal.copy(sampleHorizonColor());
    fog.color.copy(fogGoal);
  } else {
    fog.color.lerp(fogGoal, 1 - Math.exp(-Math.max(delta, 0.016) * 4));
  }
}

function currentDaylight(): Daylight {
  return daylight(skySeconds);
}

function frame(now: number): void {
  const rawDelta = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  const delta = rawDelta * timeScale;
  const substeps = Math.ceil(delta / 0.1);
  let state = navigator.state;
  for (let step = 0; step < substeps; step += 1) state = navigator.update(delta / substeps);
  eagle.update(state, delta);
  thermalMarker.update(state, navigator.activeThermal, settings.showThermal, now / 1000);
  soundscape.update(state.behavior, state.flapping);

  if (skyLook) {
    const sky = currentDaylight();
    if (skyLook === 'horizon') skyAim.set(-sky.sun.z, 0.1, sky.sun.x).normalize();
    else skyAim.set(sky[skyLook].x, sky[skyLook].y, sky[skyLook].z);
    cameraPosition.set(state.x, state.y + 16, state.z).addScaledVector(skyAim, -36);
    cameraPosition.y = Math.max(cameraPosition.y, world.sample(cameraPosition.x, cameraPosition.z).height + 8);
    lookAt.copy(cameraPosition).addScaledVector(skyAim, 280);
  } else {
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
    const lookAhead = 38 - rideBlend * 22;
    lookAt.set(state.x + Math.sin(cameraHeading) * lookAhead, state.y - 9 - orbitPitch * 24, state.z + Math.cos(cameraHeading) * lookAhead);
  }
  camera.position.copy(cameraPosition);
  camera.lookAt(lookAt);
  terrain.update(cameraPosition.x, cameraPosition.z);
  updateFog();
  if (!skyPaused) skySeconds += rawDelta;
  const body = currentDaylight();
  applyDaylight(body, rawDelta, false);

  keyLight.target.position.set(camera.position.x, world.sample(camera.position.x, camera.position.z).height, camera.position.z);
  updateShadowBasis(keyDir);
  snapToShadowGrid(keyLight.target.position);
  keyLight.position.copy(keyDir).multiplyScalar(SHADOW_EXTENT + 300).add(keyLight.target.position);
  keyLight.target.updateMatrixWorld();

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
      `markers      ${thermalMarker.count} within ${THERMAL_MARKER_RANGE} m`,
      `nearby       ${nearby}`,
      `time of day  ${body.phase.toFixed(3)} ${body.dominant}`,
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
  lensflare.dispose();
  fogTarget.dispose();
  thermalMarker.dispose();
  terrain.dispose();
});

declare global {
  interface Window {
    __SOARING__: {
      snapshot: () => { seed: number; chunks: number; pending: number; visibleDistance: number; requestedDistance: number; cameraDistance: number; behavior: string; flapping: boolean; bank: number; heading: number; position: number[]; geometries: number; activeThermal: number[] | null; marker: number[] | null; markerRange: number; markers: number[][]; thermalCandidates: number[][]; tiers: { near: number; mid: number; far: number }; timeOfDay: number; sunElevation: number; moonElevation: number };
      setTimeScale: (scale: number) => void;
      setTimeOfDay: (phase: number) => void;
      lookAtBody: (body: 'sun' | 'moon' | 'horizon' | 'chase') => void;
    };
  }
}
window.__SOARING__ = {
  snapshot: () => {
    const placed = thermalMarker.placements();
    const activeMarker = placed.find((marker) => marker.active);
    const body = currentDaylight();
    return {
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
      marker: activeMarker ? [activeMarker.x, activeMarker.z] : null,
      markerRange: THERMAL_MARKER_RANGE,
      markers: placed.map((marker) => [marker.x, marker.z, marker.active ? 1 : 0]),
      // Wider than the marker window so smoke tests can see thermals the marker must exclude.
      thermalCandidates: world.nearbyThermals(navigator.state.x, navigator.state.z, 6).map((thermal) => [thermal.x, thermal.z]),
      tiers: terrain.tierCounts,
      timeOfDay: body.phase,
      sunElevation: body.sun.y,
      moonElevation: body.moon.y,
    };
  },
  setTimeScale: (scale: number) => { timeScale = Math.max(1, Math.min(12, scale)); },
  setTimeOfDay: (phase: number) => {
    const wrapped = ((phase % 1) + 1) % 1;
    skySeconds = wrapped * DAY_SECONDS;
    skyPaused = true;
    fogSampleAge = 999;
  },
  lookAtBody: (body: 'sun' | 'moon' | 'horizon' | 'chase') => {
    skyLook = body === 'chase' ? null : body;
  },
};
