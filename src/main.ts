import * as THREE from 'three';
import './style.css';
import { Soundscape } from './audio';
import { EagleNavigator, EagleView } from './eagle';
import { CHUNK_SIZE, QUALITY, QualityName, TerrainStream } from './terrain';
import { WorldModel } from './world';

type StoredSettings = { ambienceVolume: number; musicVolume: number; muted: boolean; quality: QualityName; cameraDistance: number };
const SETTINGS_KEY = 'soaring.settings.v1';
const SEED_KEY = 'soaring.world-seed.v1';
const VISIT_KEY = 'soaring.scenic-visit.v1';
const defaultSettings: StoredSettings = { ambienceVolume: 0.52, musicVolume: 0.52, muted: true, quality: 'medium', cameraDistance: 178 };

function level(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function loadSettings(): StoredSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<StoredSettings> & { volume?: number };
    return {
      ambienceVolume: level(saved.ambienceVolume, level(saved.volume, defaultSettings.ambienceVolume)),
      musicVolume: level(saved.musicVolume, level(saved.volume, defaultSettings.musicVolume)),
      muted: typeof saved.muted === 'boolean' ? saved.muted : defaultSettings.muted,
      quality: saved.quality && saved.quality in QUALITY ? saved.quality : defaultSettings.quality,
      cameraDistance: typeof saved.cameraDistance === 'number' && Number.isFinite(saved.cameraDistance)
        ? Math.max(110, Math.min(270, saved.cameraDistance)) : defaultSettings.cameraDistance,
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
const navigator = new EagleNavigator(world, start);
const eagle = new EagleView();
const soundscape = new Soundscape();
soundscape.setAmbienceVolume(settings.ambienceVolume);
soundscape.setMusicVolume(settings.musicVolume);

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing application root');

const HORIZON_COLOR = 0xd8d4b3;
const scene = new THREE.Scene();
scene.background = new THREE.Color(HORIZON_COLOR);
const fog = new THREE.Fog(HORIZON_COLOR, 360, 720);
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.5, 1700);
const renderer = new THREE.WebGLRenderer({ antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[settings.quality].pixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = settings.quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('aria-label', 'Autonomous golden eagle flying above a temperate wilderness');
app.append(renderer.domElement);

const hemisphere = new THREE.HemisphereLight(0xd9e6e1, 0x596448, 2.25);
scene.add(hemisphere);
const SUN_OFFSET = new THREE.Vector3(-420, 190, -300);
const sun = new THREE.DirectionalLight(0xffe1ab, 3.6);
sun.position.copy(SUN_OFFSET);
sun.castShadow = settings.quality !== 'low';
sun.shadow.mapSize.set(2048, 2048);
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
const terrain = new TerrainStream(scene, world, settings.quality);
terrain.update(navigator.state.x, navigator.state.z, Infinity);

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
      <label class="setting">Ambience <output id="ambience-value">${Math.round(settings.ambienceVolume * 100)}%</output><input id="ambience" type="range" min="0" max="1" step="0.01" value="${settings.ambienceVolume}"></label>
      <label class="setting">Music <output id="music-value">${Math.round(settings.musicVolume * 100)}%</output><input id="music" type="range" min="0" max="1" step="0.01" value="${settings.musicVolume}"></label>
      <label class="setting">Graphics <select id="quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
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
const qualityInput = document.querySelector<HTMLSelectElement>('#quality')!;
const distanceInput = document.querySelector<HTMLInputElement>('#distance')!;
const distanceValue = document.querySelector<HTMLOutputElement>('#distance-value')!;
const diagnostics = document.querySelector<HTMLElement>('#diagnostics')!;
qualityInput.value = settings.quality;

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
window.addEventListener('pointerdown', async (event) => {
  if (!settings.muted && event.target !== muteButton) {
    const started = await soundscape.setMuted(false);
    muteButton.textContent = soundscape.isMuted ? 'Muted' : 'On';
    if (!started) audioNote.textContent = 'Audio could not start in this browser. Try enabling sound again.';
  }
}, { once: true });
muteButton.addEventListener('click', async () => {
  const started = await soundscape.setMuted(!soundscape.isMuted);
  settings.muted = soundscape.isMuted;
  muteButton.textContent = settings.muted ? 'Muted' : 'On';
  audioNote.textContent = started ? 'Sound is generated in your browser; no media is downloaded.' : 'Audio could not start in this browser. Try enabling sound again.';
  saveSettings();
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
qualityInput.addEventListener('change', () => {
  settings.quality = qualityInput.value as QualityName;
  terrain.setQuality(settings.quality);
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[settings.quality].pixelRatio));
  renderer.shadowMap.enabled = settings.quality !== 'low';
  sun.castShadow = settings.quality !== 'low';
  updateFog();
  saveSettings();
});
distanceInput.addEventListener('input', () => {
  settings.cameraDistance = Number(distanceInput.value);
  distanceValue.value = `${Math.round(settings.cameraDistance)} m`;
  saveSettings();
});
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
  fog.far = QUALITY[settings.quality].radius * CHUNK_SIZE;
  fog.near = fog.far * 0.5;
  camera.far = Math.max(fog.far, 820) + 400;
  camera.updateProjectionMatrix();
  sun.shadow.camera.left = sun.shadow.camera.bottom = -fog.far;
  sun.shadow.camera.right = sun.shadow.camera.top = fog.far;
  sun.shadow.camera.far = (fog.far + 300) * 2;
  sun.shadow.camera.updateProjectionMatrix();
}
updateFog();

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
  terrain.update(state.x, state.z);
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

  sky.position.set(state.x, state.y - 40, state.z);
  sunDisc.position.copy(SUN_OFFSET).setLength(700).add(eagle.group.position);
  camera.getWorldDirection(shadowCenter).setY(0).setLength(fog.far * 0.5).add(camera.position);
  sun.target.position.set(shadowCenter.x, world.sample(shadowCenter.x, shadowCenter.z).height, shadowCenter.z);
  sun.position.copy(SUN_OFFSET).setLength(fog.far + 300).add(sun.target.position);
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
      `chunks       ${terrain.chunkCount}`,
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
});

window.addEventListener('beforeunload', () => terrain.dispose());

declare global {
  interface Window {
    __SOARING__: {
      snapshot: () => { seed: number; chunks: number; behavior: string; position: number[]; geometries: number };
      setTimeScale: (scale: number) => void;
    };
  }
}
window.__SOARING__ = {
  snapshot: () => ({
    seed: world.seed,
    chunks: terrain.chunkCount,
    behavior: navigator.state.behavior,
    position: [navigator.state.x, navigator.state.y, navigator.state.z],
    geometries: renderer.info.memory.geometries,
  }),
  setTimeScale: (scale: number) => { timeScale = Math.max(1, Math.min(12, scale)); },
};
