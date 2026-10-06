import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { milkyWayComposite, milkyWayDeclarations, milkyWayFunctions, milkyWayUniforms } from './milky-way';
import './style.css';
import { Soundscape } from './audio';
import { EagleNavigator, EagleView, skyBearing, type FlightPhase, type NudgeStatus } from './eagle';
import { DEFAULT_VISIBILITY, MAX_VISIBILITY, MIN_VISIBILITY, TerrainStream } from './terrain';
import { THERMAL_MARKER_RANGE, ThermalMarker } from './thermal-marker';
import { CloudSea, bindCloudFog } from './cloud-sea';
import { AuroraSchedule, auroraAmount, DAY_SECONDS, daylight, nightCycle, type Daylight } from './sky-cycle';
import { FrameProfiler, type ProfileReport } from './profile';
import { WORLD_CACHE_LIMIT, WorldModel } from './world';
import { PuffClouds, type PuffCloudSnapshot } from './puff-clouds';
import { Trail } from './trail';
import { Minimap } from './minimap';
import { MapPanel } from './map-panel';

type StoredSettings = { ambienceVolume: number; musicVolume: number; muted: boolean; cameraDistance: number; showThermal: boolean };
const CAMERA_DISTANCE = { min: 10, max: 200, default: 100 } as const;
const CAMERA_CLOSE_HEIGHT = 3;
// At full zoom-out the camera sits 36 m above the bird.
const CAMERA_FAR_HEIGHT = 36;
const CHUNK_BUILD_BUDGET_MS = 4;
const RENDER_ORIGIN_DISTANCE = 10_000;
const MAX_RENDER_PIXELS = 2_000_000;
const MAX_PIXEL_RATIO = 1.5;
const SETTINGS_KEY = 'soaring.settings.v1';
const SEED_KEY = 'soaring.world-seed.v1';
const VISIT_KEY = 'soaring.scenic-visit.v1';
const defaultSettings: StoredSettings = { ambienceVolume: 0.52, musicVolume: 0.52, muted: true, cameraDistance: CAMERA_DISTANCE.default, showThermal: true };
const clamp = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

function loadSettings(): StoredSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<StoredSettings> & { volume?: number };
    return {
      ambienceVolume: clamp(saved.ambienceVolume, clamp(saved.volume, defaultSettings.ambienceVolume, 0, 1), 0, 1),
      musicVolume: clamp(saved.musicVolume, clamp(saved.volume, defaultSettings.musicVolume, 0, 1), 0, 1),
      muted: typeof saved.muted === 'boolean' ? saved.muted : defaultSettings.muted,
      cameraDistance: clamp(saved.cameraDistance, defaultSettings.cameraDistance, CAMERA_DISTANCE.min, CAMERA_DISTANCE.max),
      showThermal: typeof saved.showThermal === 'boolean' ? saved.showThermal : defaultSettings.showThermal,
    };
  } catch {
    return { ...defaultSettings };
  }
}

function loadSeed(): number {
  const stored = localStorage.getItem(SEED_KEY);
  const saved = Number(stored);
  if (stored !== null && Number.isInteger(saved) && saved >= 0 && saved <= 0xffff_ffff) return saved;
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const seed = values[0] ?? 1;
  localStorage.setItem(SEED_KEY, String(seed));
  return seed;
}

function nextVisit(): number {
  const visit = (Number(localStorage.getItem(VISIT_KEY)) || 0) + 1;
  localStorage.setItem(VISIT_KEY, String(visit));
  return visit;
}

// Development-only smoke harness uses a smaller software-WebGL render budget and bounded
// terrain visibility.
const smokeMode = import.meta.env.DEV && new URLSearchParams(location.search).has('smoke');
// Development-only `?profile` arms the frame profiler and holds quality steady for held-vantage benches.
const profileMode = import.meta.env.DEV && new URLSearchParams(location.search).has('profile');
const settings = loadSettings();
let qualityStep = 0;
const QUALITY_PIXEL_RATIOS = [MAX_PIXEL_RATIO, 1.25, 1.0] as const;
// Terrain visibility is not a setting and is never saved, so a stale stored value cannot change it.
let terrainVisibility = smokeMode ? MIN_VISIBILITY : DEFAULT_VISIBILITY;

function pixelRatioForStep(step = qualityStep): number {
  if (smokeMode) return 0.25;
  const budgetRatio = Math.sqrt(MAX_RENDER_PIXELS / (innerWidth * innerHeight));
  return Math.min(devicePixelRatio,
    QUALITY_PIXEL_RATIOS[Math.min(step, QUALITY_PIXEL_RATIOS.length - 1)]!, budgetRatio);
}
const world = new WorldModel(loadSeed());
const auroraSchedule = new AuroraSchedule(world.seed);
const visit = nextVisit();
const start = world.scenicStart(visit);
let navigator = new EagleNavigator(world, start);
const eagle = new EagleView();
const soundscape = new Soundscape();
soundscape.setAmbienceVolume(settings.ambienceVolume);
soundscape.setMusicVolume(settings.musicVolume);

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Missing application root');

const scene = new THREE.Scene();
const worldRoot = new THREE.Group();
const renderOrigin = new THREE.Vector3(navigator.state.x, navigator.state.y, navigator.state.z);
worldRoot.position.copy(renderOrigin).negate();
scene.add(worldRoot);
const puffClouds = new PuffClouds(worldRoot, world.seed, navigator.state);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.5, MAX_VISIBILITY + 500);
const renderer = new THREE.WebGLRenderer({ antialias: !smokeMode, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(pixelRatioForStep());
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.00;
renderer.shadowMap.enabled = !smokeMode;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.setAttribute('aria-label', 'Autonomous golden eagle flying above a temperate wilderness');
app.append(renderer.domElement);

const hemisphere = new THREE.HemisphereLight(0xcfe3f0, 0x5e7a3a, 2.25);
worldRoot.add(hemisphere);
// One shadow caster. Its direction follows whichever body is higher. Both intensities are zero
// on the horizon, so the direction can flip there without a visible shadow pop.
const keyLight = new THREE.DirectionalLight(0xffe1ab, 3.6);
keyLight.castShadow = !smokeMode;
keyLight.shadow.camera.near = 1;
keyLight.shadow.bias = -0.0005;
keyLight.shadow.normalBias = 0.8;
worldRoot.add(keyLight, keyLight.target);

const sky = new Sky();
// Opaque sorting checks renderOrder before material ID. Draw the far-plane sky last so terrain depth rejects hidden fragments.
sky.renderOrder = 1;
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
sky.material.uniforms.auroraAmount = { value: 0 };
sky.material.uniforms.cloudTime = { value: 0 };
sky.material.uniforms.cloudCoverage = { value: 0.5 };
sky.material.uniforms.cloudAbove = { value: 0 };
sky.material.uniforms.cloudWhiteout = { value: 0 };
sky.material.uniforms.deckWhite = { value: new THREE.Color(0xe1e4cb) };
sky.material.uniforms.moonPosition = { value: new THREE.Vector3(0, -1, 0) };
sky.material.uniforms.moonLit = { value: 1 };
sky.material.uniforms.moonSunlight = { value: new THREE.Vector3(0, 1, 0) };
sky.material.uniforms.sunTint = { value: new THREE.Color(1, 1, 1) };
sky.material.uniforms.lowSun = { value: 0 };
sky.material.uniforms.glowAmount = { value: 0 };
sky.material.uniforms.venusAmount = { value: 0 };
sky.material.uniforms.twilightAmount = { value: 0 };
sky.material.uniforms.twilightZenith = { value: new THREE.Color() };
sky.material.uniforms.twilightUpper = { value: new THREE.Color() };
sky.material.uniforms.twilightUpperWarm = { value: new THREE.Color() };
sky.material.uniforms.twilightHorizon = { value: new THREE.Color() };
sky.material.uniforms.twilightHorizonWarm = { value: new THREE.Color() };
Object.assign(sky.material.uniforms, milkyWayUniforms);
sky.material.fragmentShader = sky.material.fragmentShader
  .replace(
    'uniform float mieDirectionalG;',
    'uniform float mieDirectionalG;\nuniform float skyExposure;\nuniform float nightAmount;\nuniform float goldenAmount;\nuniform float blueAmount;\nuniform float starAmount;\nuniform float auroraAmount;\nuniform float cloudTime;\nuniform float cloudCoverage;\nuniform vec3 moonPosition;\nuniform float moonLit;\nuniform vec3 moonSunlight;\nuniform vec3 sunTint;\nuniform float lowSun;\nuniform float glowAmount;\nuniform float venusAmount;\nuniform float twilightAmount;\nuniform vec3 twilightZenith;\nuniform vec3 twilightUpper;\nuniform vec3 twilightUpperWarm;\nuniform vec3 twilightHorizon;\nuniform vec3 twilightHorizonWarm;\nuniform float cloudAbove;\nuniform float cloudWhiteout;\nuniform vec3 deckWhite;',
  )
  .replace(
    'void main() {',
    `float cloudHash(vec2 point) {
			point = fract(point * vec2(123.34, 456.21));
			point += dot(point, point + 45.32);
			return fract(point.x * point.y);
		}
		float cloudNoise(vec2 point) {
			vec2 cell = floor(point);
			vec2 local = fract(point);
			vec2 blend = local * local * (3.0 - 2.0 * local);
			float lower = mix(cloudHash(cell), cloudHash(cell + vec2(1.0, 0.0)), blend.x);
			float upper = mix(cloudHash(cell + vec2(0.0, 1.0)), cloudHash(cell + vec2(1.0, 1.0)), blend.x);
			return mix(lower, upper, blend.y);
		}
		float paintedClouds(vec3 direction) {
			// Project sky directions into broad, stretched cloud bands with moving value noise.
			vec2 point = direction.xz / (max(direction.y, 0.025) + 0.19);
			point = point * vec2(2.8, 6.0) + vec2(cloudTime, 0.0);
			float mass = cloudNoise(point * 0.3 + vec2(3.0, 12.0)) * 0.28;
			mass += cloudNoise(point) * 0.6;
			mass += cloudNoise(point * 2.1 + 8.0) * 0.3;
			mass += cloudNoise(point * 5.8) * 0.16;
			mass += cloudNoise(point * 15.0) * 0.06;
			return mass;
		}
		float starLayer(vec3 direction, float grid, float density, float smallRadius, float largeRadius) {
			// Each lit cell holds one star at its centre. Radii stay under half a cell, so no star is clipped.
			vec3 scaled = direction * grid;
			vec3 cell = floor(scaled);
			float hash = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
			float vary = fract(sin(dot(cell, vec3(269.5, 183.3, 246.1))) * 12543.23);
			float twinkle = 0.8 + 0.2 * sin(cloudTime * 1000.0 * mix(0.7, 1.6, vary) + hash * 60.0);
			float star = step(density, hash) * smoothstep(mix(smallRadius, largeRadius, vary), 0.0, length(scaled - cell - 0.5));
			return star * mix(0.45, 1.7, vary * vary) * twinkle;
		}
		void main() {`,
  )
  .replace(
    'vec3 retColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) );',
    `vec3 dayColor = pow( texColor, vec3( 1.0 / ( 1.2 + ( 1.2 * vSunfade ) ) ) ) * skyExposure;
			float sunFacing = max(dot(direction, vSunDirection), 0.0);
			float sunUp = smoothstep(0.0, 0.06, vSunDirection.y);
			float lowSky = 1.0 - smoothstep(0.0, 0.42, direction.y);
			// Azimuth weights use the world-fixed sun direction, never the camera.
			vec2 flatSun = vSunDirection.xz / max(length(vSunDirection.xz), 0.0001);
			float sunSide = dot(direction.xz / max(length(direction.xz), 0.0001), flatSun);
			float align = max(sunSide, 0.0);
			float anti = max(-sunSide, 0.0);
			// Powers by multiplication: software WebGL in CI pays for every pow and acos on every sky pixel.
			float align3 = align * align * align;
			// Warmth leans toward the sun's azimuth, with a little left on the far side.
			vec3 warmBand = vec3(0.78, 0.4, 0.22);
			dayColor = mix(dayColor, warmBand, clamp(goldenAmount, 0.0, 1.0) * lowSky * mix(0.25, 0.7, align3));
			// Twilight: a painted gradient keyed by sun elevation replaces the Preetham sky, which goes dark before sunset.
			// Warmth climbs higher toward the sun's azimuth, as in FWM.
			if (twilightAmount > 0.0) {
				float skyHeight = max(direction.y, 0.0);
				float facing2 = sunFacing * sunFacing;
				vec3 twilightSide = mix(twilightUpper, twilightUpperWarm, align3 * sqrt(align) * 0.8 + facing2 * facing2 * sunFacing * 0.2);
				vec3 twilightSky = mix(twilightSide, twilightZenith, smoothstep(0.1, 0.85, skyHeight));
				// A little warmth reaches the far side, so the single fog colour, read side-on to the sun, is not grey under an orange sky.
				vec3 twilightLow = mix(twilightHorizon, twilightHorizonWarm, 0.2 + 0.8 * align3 * align * align);
				dayColor = mix(dayColor, mix(twilightLow, twilightSky, smoothstep(0.0, 0.4, skyHeight)), twilightAmount);
			}
			// Dawn and dusk: a thin saturated glow along the sun-side horizon.
			vec3 glowColor = vec3(1.0, 0.24, 0.06);
			if (glowAmount > 0.0) dayColor = mix(dayColor, glowColor, align3 * exp(-abs(direction.y) / 0.07) * glowAmount * 0.8);
			// The belt of Venus: a rose band opposite a low sun, over the earth's blue shadow.
			vec3 venusColor = vec3(0.86, 0.46, 0.52);
			float venusHeight = (direction.y - 0.07) / 0.06;
			float venusShape = exp(-venusHeight * venusHeight);
			dayColor = mix(dayColor, venusColor, anti * anti * venusShape * venusAmount * 0.35);
			float earthShadow = anti * anti * smoothstep(0.06, 0.0, direction.y) * venusAmount;
			dayColor = mix(dayColor, dayColor * vec3(0.78, 0.84, 1.0), earthShadow * 0.5);
			float zenith = smoothstep(0.0, 0.55, direction.y);
			vec3 noonBlue = dayColor * vec3(0.55, 0.78, 1.35) + vec3(0.02, 0.07, 0.22);
			dayColor = mix(dayColor, noonBlue, clamp(blueAmount, 0.0, 1.0) * mix(0.62, 1.0, zenith));
			// The sun: a disc about 3 degrees across, a tight glow, and a broad warm halo while it is low.
			// The disc stays pale yellow, so it reads against the orange glow near the horizon.
			float sunLight = sunFacing * smoothstep(-0.14, 0.02, vSunDirection.y);
			vec3 sunColor = mix(sunTint, glowColor, lowSun * 0.6);
			// The disc edge runs from 0.03 to 0.024 radians from the sun's centre, as cosines.
			float sunDisc = smoothstep(0.99955003, 0.99971201, sunLight);
			float sunLight2 = sunLight * sunLight;
			float sunLight4 = sunLight2 * sunLight2;
			float sunLight15 = sunLight4 * sunLight4 * sunLight4 * sunLight2 * sunLight;
			float sunGlow = sunLight15 * sunLight15 * 0.12 + pow(sunLight, 500.0) * 0.6 + sunLight4 * lowSun * 0.35;
			// The glow fades softly below the horizon, so the haze under it shows no edge. The disc sets sharply.
			dayColor += sunColor * sunGlow * smoothstep(-0.12, 0.02, direction.y) + (sunDisc * mix(1.4, 3.0, lowSun) * smoothstep(-0.02, 0.0, direction.y) * mix(sunTint, vec3(1.0, 0.9, 0.7), 0.5));
			float skyHorizon = pow(1.0 - clamp(direction.y, 0.0, 1.0), 3.0);
			vec3 nightColor = vec3(0.004, 0.007, 0.026) + vec3(0.018, 0.026, 0.048) * skyHorizon;
			// The painted keys carry their own darkening, so night only takes over as the gradient fades out.
			vec3 retColor = mix(dayColor, nightColor, clamp(nightAmount, 0.0, 1.0) * (1.0 - twilightAmount));
			if (auroraAmount > 0.001) {
				float auroraCenter = 0.22 + 0.035 * sin(direction.x * 10.0 + direction.z * 3.0);
				float auroraBand = 1.0 - smoothstep(0.015, 0.09, abs(direction.y - auroraCenter));
				float auroraFold = 0.5 + 0.5 * sin(direction.x * 30.0 + direction.z * 11.0 + sin(direction.z * 9.0) * 2.0);
				float auroraCurtain = auroraBand * (0.24 + 0.76 * auroraFold);
				vec3 auroraColor = mix(vec3(0.04, 0.58, 0.24), vec3(0.12, 0.55, 0.82), smoothstep(0.2, 0.34, direction.y));
				retColor += auroraColor * auroraCurtain * auroraAmount;
			}
			vec3 moonDir = normalize(moonPosition);
			float moonUp = smoothstep(0.02, 0.08, moonDir.y);
			float moonLight = smoothstep(0.02, 0.3, moonDir.y) * nightAmount * moonLit;
			// The disc is about 3.4 degrees across. u and v run across it in units of its radius.
			vec3 moonRight = normalize(cross(moonDir, vec3(0.0, 1.0, 0.0)));
			vec3 moonUpAxis = cross(moonRight, moonDir);
			vec2 moonUv = vec2(dot(direction, moonRight), dot(direction, moonUpAxis)) / 0.0295;
			float moonRadius = length(moonUv);
			float moonDisc = smoothstep(1.06, 0.94, moonRadius) * step(0.0, dot(direction, moonDir)) * moonUp;
			float cloudMass = paintedClouds(direction);
			float cloudThreshold = mix(0.88, 0.52, clamp(cloudCoverage, 0.0, 1.0));
			float nightOpening = smoothstep(0.045, 0.22, direction.y) * nightAmount * 0.3;
			float cloudMask = smoothstep(cloudThreshold + nightOpening, cloudThreshold + 0.2 + nightOpening, cloudMass)
				* smoothstep(0.014, 0.15, direction.y);
			// Coarse stars at least 1.2 px across in the chase view, and a fine layer at half strength.
			// Moonlight, the disc and painted clouds hide them. They fade out above the fog probe's horizon band.
			float stars = starLayer(direction, 100.0, 0.955, 0.26, 0.4) + starLayer(direction, 220.0, 0.965, 0.3, 0.45) * 0.5;
			stars *= smoothstep(0.08, 0.2, direction.y) * (1.0 - 0.45 * moonLight) * (1.0 - cloudMask) * (1.0 - moonDisc);
			retColor += vec3(0.82, 0.88, 1.0) * stars * starAmount;
			// A cool two-term halo out to about 12 degrees carries the moon's glow, so the disc can stay near 1.3.
			float moonFacing = max(dot(direction, moonDir), 0.0);
			retColor += vec3(0.62, 0.72, 1.0) * (pow(moonFacing, 250.0) * 0.35 + pow(moonFacing, 30.0) * 0.06) * moonUp * nightAmount * moonLit * (1.0 - moonDisc);
			float maria = cloudNoise(moonUv * 1.7 + 4.0) * 0.65 + cloudNoise(moonUv * 4.3 + 11.0) * 0.35;
			float moonSurface = (1.0 - 0.38 * smoothstep(0.45, 0.72, maria)) * (1.0 - 0.25 * moonRadius * moonRadius);
			// The phase: light the moon's near face as a sphere. The terminator is soft, with faint earthshine.
			vec3 moonNormal = moonUv.x * moonRight + moonUv.y * moonUpAxis - sqrt(max(1.0 - moonRadius * moonRadius, 0.0)) * moonDir;
			float moonPhase = mix(0.025, 1.0, smoothstep(-0.12, 0.12, dot(moonNormal, moonSunlight)));
			retColor += vec3(0.95, 0.96, 1.0) * 1.35 * moonSurface * moonPhase * moonDisc;
			vec3 cloudLight = mix(vec3(0.76, 0.84, 0.94), vec3(0.98, 0.98, 1.0), sunUp);
			cloudLight = mix(cloudLight, vec3(1.0, 0.49, 0.25), goldenAmount * 0.4);
			// Lit toward the sun, on fire near a low sun, blushing opposite it.
			cloudLight = mix(cloudLight, sunColor, sunLight4 * 0.75);
			cloudLight = mix(cloudLight, glowColor, lowSun * align * sqrt(align) * 0.7);
			cloudLight = mix(cloudLight, mix(cloudLight, venusColor, 0.5), venusAmount * anti * sqrt(anti) * 0.6);
			vec3 cloudShade = mix(vec3(0.32, 0.39, 0.5), vec3(0.52, 0.36, 0.3), goldenAmount * 0.65);
			vec3 dayCloud = mix(cloudShade, cloudLight, smoothstep(0.42, 1.0, cloudMass));
			vec3 nightCloud = mix(vec3(0.012, 0.018, 0.04), vec3(0.06, 0.075, 0.12), smoothstep(0.35, 0.85, cloudMass));
			vec3 cloudColor = mix(dayCloud, nightCloud, nightAmount);
			retColor = mix(retColor, cloudColor, cloudMask * mix(0.84, 0.96, nightAmount));
			// Thin cloud edges near the sun catch a bright rim.
			float cloudEdge = cloudMask * (1.0 - cloudMask) * 4.0;
			retColor += sunColor * cloudEdge * sunLight15 * 0.7 * (1.0 - nightAmount) * smoothstep(0.025, 0.12, direction.y);
			// Shared atmospheric horizon, not a full-screen cloud overlay.
			float deckHorizon = 1.0 - smoothstep(0.0, 0.32, direction.y);
			retColor = mix(retColor, deckWhite, cloudAbove * 0.4 * deckHorizon);
			retColor = mix(retColor, deckWhite, cloudWhiteout * mix(1.0, 0.82, zenith));`,
  )
  .replace('uniform float mieDirectionalG;', `uniform float mieDirectionalG;\n${milkyWayDeclarations}`)
  .replace('void main() {', `${milkyWayFunctions}\n\t\tvoid main() {`)
  .replace('retColor += vec3(0.82, 0.88, 1.0) * stars * starAmount;', `retColor += vec3(0.82, 0.88, 1.0) * stars * starAmount;${milkyWayComposite}`);
scene.add(sky);

// three.js always renders offscreen targets with NoToneMapping, so reproduce the on-screen Neutral curve here.
function neutralToneMap(color: THREE.Color, exposure: number): THREE.Color {
  color.multiplyScalar(exposure);
  const minimum = Math.min(color.r, color.g, color.b);
  const offset = minimum < 0.08 ? minimum - 6.25 * minimum * minimum : 0.04;
  color.addScalar(-offset);
  const peak = Math.max(color.r, color.g, color.b);
  const startCompression = 0.8 - 0.04;
  if (peak < startCompression) return color;
  const compression = 1 - startCompression;
  const newPeak = 1 - compression * compression / (peak + compression - startCompression);
  color.multiplyScalar(newPeak / peak);
  const desaturation = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return color.setRGB(
    THREE.MathUtils.lerp(color.r, newPeak, desaturation),
    THREE.MathUtils.lerp(color.g, newPeak, desaturation),
    THREE.MathUtils.lerp(color.b, newPeak, desaturation),
  );
}

// Sample the sky shader near the horizon so fog follows the clouded sky, not a fixed beige.
// Reused every sample: no per-frame allocation. The probe is a unit box at the origin, so it does not
// follow the sky mesh; shared uniforms carry the current sun and night mix.
const fogProbeScene = new THREE.Scene();
// Probe ordinary air only. Apply the live cloud gate after readback, so crossing
// the deck cannot feed an already-whitened horizon back into the night palette.
// Leave out the Milky Way too, so its low core never tints the fog.
const fogProbeMaterial = new THREE.ShaderMaterial({
  vertexShader: sky.material.vertexShader, fragmentShader: sky.material.fragmentShader,
  side: sky.material.side,
  uniforms: { ...sky.material.uniforms, cloudAbove: { value: 0 }, cloudWhiteout: { value: 0 }, milkyWayAmount: { value: 0 } },
});
const fogProbe = new THREE.Mesh(sky.geometry, fogProbeMaterial);
fogProbeScene.add(fogProbe);
const fogProbeCamera = new THREE.PerspectiveCamera(1, 1, 0.1, 10);
const fogTarget = new THREE.WebGLRenderTarget(1, 1);
const fogPixel = new Uint8Array(4);
const fogSample = new THREE.Color(0x8faeb8);
const fogGoal = new THREE.Color(0x8faeb8);
const horizonLook = new THREE.Vector3();
const fogViewport = new THREE.Vector4();
const fogScissor = new THREE.Vector4();
let fogSampleAge = 999;
let fogInputRevision = 0;
let fogSamplePending = false;
let fogSampleDisposed = false;
let fogSamplingFailed = false;
let fogSampleCount = 0;
let fogReadbackFailures = 0;
type FogReadCompletion = { revision: number; phase: number; samples: number; targetColor: number[]; color: number[]; failures: number };
let fogReadCompletion: FogReadCompletion | null = null;
let fogDiscardedReads = 0;
function sampleHorizonColor(): void {
  if (fogSamplePending || fogSampleDisposed || fogSamplingFailed) return;
  fogSamplePending = true;
  const revision = fogInputRevision;
  const exposure = renderer.toneMappingExposure;
  // Perpendicular to the sun, just above the horizon, so haze matches the sky band and not the solar disc.
  horizonLook.set(-sunDir.z, 0.07, sunDir.x);
  if (horizonLook.x * horizonLook.x + horizonLook.z * horizonLook.z < 1e-4) horizonLook.set(1, 0.07, 0);
  fogProbeCamera.lookAt(horizonLook);

  const previousTarget = renderer.getRenderTarget();
  const previousCubeFace = renderer.getActiveCubeFace();
  const previousMipmapLevel = renderer.getActiveMipmapLevel();
  renderer.getViewport(fogViewport);
  renderer.getScissor(fogScissor);
  const previousScissorTest = renderer.getScissorTest();
  try {
    renderer.setRenderTarget(fogTarget);
    renderer.render(fogProbeScene, fogProbeCamera);
  } catch {
    fogReadbackFailures += 1;
    fogSamplingFailed = true;
    fogSamplePending = false;
    return;
  } finally {
    renderer.setRenderTarget(previousTarget, previousCubeFace, previousMipmapLevel);
    renderer.setViewport(fogViewport);
    renderer.setScissor(fogScissor);
    renderer.setScissorTest(previousScissorTest);
  }

  void renderer.readRenderTargetPixelsAsync(fogTarget, 0, 0, 1, 1, fogPixel).then((pixel) => {
    if (fogSampleDisposed) return;
    if (revision !== fogInputRevision) {
      if (import.meta.env.DEV) fogDiscardedReads += 1;
      return;
    }
    fogSample.setRGB(pixel[0]! / 255, pixel[1]! / 255, pixel[2]! / 255);
    neutralToneMap(fogGoal.copy(fogSample), exposure);
    fogSampleCount += 1;
    if (import.meta.env.DEV) {
      // Latch one coherent successful completion; a continuous sampler need not become idle.
      fogReadCompletion = { revision, phase: skySeconds / DAY_SECONDS, samples: fogSampleCount,
        targetColor: [fogGoal.r, fogGoal.g, fogGoal.b], color: [fog.color.r, fog.color.g, fog.color.b], failures: fogReadbackFailures };
    }
  }).catch(() => {
    if (fogSampleDisposed) return;
    fogReadbackFailures += 1;
    fogSamplingFailed = true;
  }).finally(() => {
    fogSamplePending = false;
  });
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
worldRoot.add(sunFlareAnchor);

worldRoot.add(eagle.group);
// Fog uses view depth, not distance. A point at horizontal distance d can have a depth as small
// as d · cos(half-diagonal FOV), so terrain loads out to visibility / cos(half-diagonal FOV).
// Reach stops growing past 16:9; wider windows get a shorter haze instead of more tiles.
const MAX_REACH_ASPECT = 16 / 9;
function depthPerDistance(aspect: number): number {
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return 1 / Math.hypot(1, tanHalfFov * Math.hypot(1, aspect));
}
function effectiveTerrainVisibility(): number {
  return qualityStep >= 3 ? Math.min(terrainVisibility, 3500) : terrainVisibility;
}
function terrainReach(): number {
  return effectiveTerrainVisibility() / depthPerDistance(Math.min(camera.aspect, MAX_REACH_ASPECT));
}
const terrain = new TerrainStream(worldRoot, world, terrainReach());
const cloudSea = new CloudSea(worldRoot);
terrain.bindCloudFog(cloudSea.fogUniforms);
const birdMaterials = new Set<THREE.Material>();
eagle.group.traverse((object) => {
  if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) birdMaterials.add(material);
});
for (const material of birdMaterials) bindCloudFog(material, cloudSea.fogUniforms, false);
sky.material.uniforms.cloudAbove = cloudSea.fogUniforms.above;
sky.material.uniforms.cloudWhiteout = cloudSea.fogUniforms.whiteout;
sky.material.uniforms.deckWhite = cloudSea.cloudWhite;
const thermalMarker = new ThermalMarker(worldRoot, world);
function applyRenderQuality(): void {
  const pixelRatio = pixelRatioForStep();
  if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
  terrain.setReach(terrainReach());
}
let pixelRatioMedia: MediaQueryList | undefined;
function watchPixelRatioChange(): void {
  pixelRatioMedia?.removeEventListener('change', handlePixelRatioChange);
  pixelRatioMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  pixelRatioMedia.addEventListener('change', handlePixelRatioChange, { once: true });
}
function handlePixelRatioChange(): void {
  applyRenderQuality();
  watchPixelRatioChange();
}
watchPixelRatioChange();
let lastChunkBuilds = terrain.update(navigator.state.x, navigator.state.z - settings.cameraDistance, CHUNK_BUILD_BUDGET_MS);

let orbitYaw = 0;
let orbitPitch = 0;
let heldViewpoint: { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number } | null = null;
let captureClear = false;
let cloudCoverageOverride: number | null = null;
let reviewFlightPaused = false;
let dragging = false;
let dragTravel = 0;
let lastDragEnd = -Infinity;
let resettingOrbit = false;
let pointerX = 0;
let pointerY = 0;
const wrapAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
function followCameraHeight(distance: number): number {
  const progress = (distance - CAMERA_DISTANCE.min) / (CAMERA_DISTANCE.max - CAMERA_DISTANCE.min);
  return CAMERA_CLOSE_HEIGHT + progress * (CAMERA_FAR_HEIGHT - CAMERA_CLOSE_HEIGHT);
}
const cameraPosition = new THREE.Vector3(navigator.state.x, navigator.state.y + followCameraHeight(settings.cameraDistance), navigator.state.z - settings.cameraDistance);
const lookAt = new THREE.Vector3();
const renderLookAt = new THREE.Vector3();
let cameraHeading = navigator.state.heading;
let rideBlend = 0;

renderer.domElement.addEventListener('pointerdown', (event) => {
  dragging = true;
  dragTravel = 0;
  resettingOrbit = false;
  pointerX = event.clientX;
  pointerY = event.clientY;
  renderer.domElement.setPointerCapture(event.pointerId);
  renderer.domElement.classList.add('dragging');
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  dragTravel += Math.abs(event.clientX - pointerX) + Math.abs(event.clientY - pointerY);
  orbitYaw -= (event.clientX - pointerX) * 0.005;
  orbitPitch = Math.max(-0.85, Math.min(0.52, orbitPitch + (event.clientY - pointerY) * 0.0035));
  pointerX = event.clientX;
  pointerY = event.clientY;
});
const releasePointer = (event: PointerEvent) => {
  dragging = false;
  if (dragTravel > 4) lastDragEnd = performance.now();
  if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
  renderer.domElement.classList.remove('dragging');
};
renderer.domElement.addEventListener('pointerup', releasePointer);
renderer.domElement.addEventListener('pointercancel', releasePointer);
renderer.domElement.addEventListener('dblclick', () => {
  // A drag that just ended, or ends this click pair, must not reset the view.
  if (dragTravel > 4 || performance.now() - lastDragEnd < 600) return;
  orbitYaw = wrapAngle(orbitYaw);
  resettingOrbit = true;
});
let zoomTarget = settings.cameraDistance;
renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault();
  const pixels = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 400 : 1);
  zoomTarget = Math.min(CAMERA_DISTANCE.max, Math.max(CAMERA_DISTANCE.min, zoomTarget * Math.exp(pixels * 0.0015)));
}, { passive: false });

app.insertAdjacentHTML('beforeend', `
  <div id="veil"></div>
  <div class="intro" id="intro">drag to look around · arrow keys nudge the eagle · press D for flight diagnostics</div>
  <div class="nudge-hint" id="nudge-hint" aria-live="polite"><span class="nudge-keys"><i data-key="left">←</i><i data-key="up">↑</i><i data-key="down">↓</i><i data-key="right">→</i></span><span class="nudge-text"></span></div>
  <div class="controls visible" id="controls">
    <section class="settings-panel" id="settings-panel" aria-label="Settings">
      <h1>Soaring</h1>
      <label class="setting">Fullscreen <button id="fullscreen-toggle" type="button" aria-pressed="false">Enter fullscreen</button></label>
      <label class="setting">Sound <button class="mute-button" id="mute" type="button">Muted</button></label>
      <label class="setting">Ambience <output id="ambience-value">${Math.round(settings.ambienceVolume * 100)}%</output><input id="ambience" type="range" min="0" max="1" step="0.01" value="${settings.ambienceVolume}"></label>
      <label class="setting">Music <output id="music-value">${Math.round(settings.musicVolume * 100)}%</output><input id="music" type="range" min="0" max="1" step="0.01" value="${settings.musicVolume}"></label>
      <label class="setting">Show thermal <input id="show-thermal" type="checkbox" ${settings.showThermal ? 'checked' : ''}></label>
      <label class="setting"><button class="new-world" id="new-world" type="button">Generate a new world</button></label>
      <p class="audio-note" role="status">Sound starts muted. It is generated in your browser; no media is downloaded.</p>
    </section>
  </div>
  <button class="settings-toggle" id="settings-toggle" type="button" aria-label="Open settings" aria-controls="settings-panel" aria-expanded="false">⚙</button>
  <pre class="diagnostics" id="diagnostics" aria-hidden="true"></pre>
`);
// The four-day trail feeds the lower-right minimap and the biome map that M opens.
const trail = new Trail(world.seed);
const minimap = new Minimap(world, trail);
const mapPanel = new MapPanel(world, trail);
app.append(minimap.element, mapPanel.element);

const controls = document.querySelector<HTMLElement>('#controls')!;
const panel = document.querySelector<HTMLElement>('#settings-panel')!;
const toggle = document.querySelector<HTMLButtonElement>('#settings-toggle')!;
const fullscreenToggle = document.querySelector<HTMLButtonElement>('#fullscreen-toggle')!;
const muteButton = document.querySelector<HTMLButtonElement>('#mute')!;
const ambienceInput = document.querySelector<HTMLInputElement>('#ambience')!;
const ambienceValue = document.querySelector<HTMLOutputElement>('#ambience-value')!;
const musicInput = document.querySelector<HTMLInputElement>('#music')!;
const musicValue = document.querySelector<HTMLOutputElement>('#music-value')!;
const audioNote = document.querySelector<HTMLElement>('.audio-note')!;
const showThermalInput = document.querySelector<HTMLInputElement>('#show-thermal')!;
const diagnostics = document.querySelector<HTMLElement>('#diagnostics')!;

let controlsTimer = 0;
let cursorTimer = 0;
function showControls(): void {
  controls.classList.add('visible');
  window.clearTimeout(controlsTimer);
  controlsTimer = window.setTimeout(() => {
    if (!panel.classList.contains('open')) controls.classList.remove('visible');
  }, 3000);
}
function showPointerActivity(): void {
  document.body.classList.remove('cursor-hidden');
  window.clearTimeout(cursorTimer);
  cursorTimer = window.setTimeout(() => document.body.classList.add('cursor-hidden'), 3000);
  showControls();
}
window.addEventListener('pointermove', showPointerActivity, { passive: true });
window.addEventListener('keydown', showControls);
showControls();
cursorTimer = window.setTimeout(() => document.body.classList.add('cursor-hidden'), 3000);
window.setTimeout(() => document.querySelector('#intro')?.classList.add('hidden'), 7000);

function setSettingsOpen(open: boolean): void {
  panel.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close settings' : 'Open settings');
}
toggle.addEventListener('click', () => {
  setSettingsOpen(!panel.classList.contains('open'));
  showControls();
});
function updateFullscreenToggle(): void {
  const isFullscreen = document.fullscreenElement === app;
  fullscreenToggle.textContent = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';
  fullscreenToggle.setAttribute('aria-pressed', String(isFullscreen));
  if (isFullscreen) setSettingsOpen(false);
}
async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement === app) await document.exitFullscreen();
    else if (!document.fullscreenElement && app) await app.requestFullscreen();
  } catch {
    // The browser may deny fullscreen requests, for example when the page is embedded.
  }
}
document.addEventListener('fullscreenchange', updateFullscreenToggle);
fullscreenToggle.addEventListener('click', () => {
  void toggleFullscreen();
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
showThermalInput.addEventListener('change', () => {
  settings.showThermal = showThermalInput.checked;
  thermalMarker.update(navigator.state, navigator.activeThermal, settings.showThermal, performance.now() / 1000);
  saveSettings();
});
function setCameraDistance(distance: number): void {
  settings.cameraDistance = distance;
  saveSettings();
}
function easeCameraDistance(seconds: number): void {
  if (settings.cameraDistance === zoomTarget) return;
  const gap = zoomTarget - settings.cameraDistance;
  setCameraDistance(Math.abs(gap) < 0.05 ? zoomTarget : settings.cameraDistance + gap * (1 - Math.exp(-seconds * 9)));
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
  fog.far = Math.min(terrainVisibility, coveredDepth);
  fog.near = fog.far * hazeStart;
  if (captureClear) {
    fog.near = Math.max(fog.far, 4200);
    fog.far = fog.near + 800;
  }
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
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === 'f') {
    if (event.ctrlKey || event.metaKey || event.altKey
      || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
    event.preventDefault();
    void toggleFullscreen();
    return;
  }
  if (key === 'm') {
    if (event.ctrlKey || event.metaKey || event.altKey
      || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return;
    if (mapPanel.isOpen) mapPanel.close();
    else void mapPanel.open('trail', navigator.state);
    return;
  }
  if (key === 'escape' && mapPanel.isOpen) mapPanel.close();
  if (key !== 'd') return;
  diagnosticsVisible = !diagnosticsVisible;
  diagnostics.classList.toggle('visible', diagnosticsVisible);
  diagnostics.setAttribute('aria-hidden', String(!diagnosticsVisible));
});

let timeScale = 1;
let lastTime = performance.now();
let lastProcessedFrame: number | null = null;
let windowFocused = document.hasFocus() && !document.hidden;
let cacheTrimElapsed = 0;
let clampNextSimulationDelta = false;
let soundWasEnabledBeforeHidden = false;
let fpsSmoothed = 60;
let diagnosticsElapsed = 0;
let lowFrameRateSeconds = 0;
let headroomSeconds = 0;
function resetQualityTimers(): void {
  lowFrameRateSeconds = 0;
  headroomSeconds = 0;
}
function currentFrameCap(): 30 | null {
  return windowFocused ? null : 30;
}
function setWindowFocused(focused: boolean): void {
  if (windowFocused === focused) return;
  windowFocused = focused;
  resetQualityTimers();
}
function nextQualityStep(): number {
  const currentRatio = pixelRatioForStep();
  for (let step = qualityStep + 1; step < QUALITY_PIXEL_RATIOS.length; step += 1) {
    if (pixelRatioForStep(step) < currentRatio) return step;
  }
  return 3;
}
function previousQualityStep(): number {
  if (qualityStep === 3) return 2;
  const currentRatio = pixelRatioForStep();
  for (let step = qualityStep - 1; step >= 0; step -= 1) {
    if (pixelRatioForStep(step) > currentRatio) return step;
  }
  return 0;
}
function updateAdaptiveQuality(elapsed: number): void {
  if (profileMode) return;
  if (fpsSmoothed < 40) {
    headroomSeconds = 0;
    if (qualityStep >= 3) return;
    lowFrameRateSeconds += elapsed;
    if (lowFrameRateSeconds >= 10) {
      lowFrameRateSeconds = 0;
      qualityStep = nextQualityStep();
      applyRenderQuality();
    }
    return;
  }
  lowFrameRateSeconds = 0;
  if (qualityStep === 0) return;
  headroomSeconds += elapsed;
  if (headroomSeconds >= 60) {
    headroomSeconds = 0;
    qualityStep = previousQualityStep();
    applyRenderQuality();
  }
}
window.addEventListener('blur', () => setWindowFocused(false));
window.addEventListener('focus', () => setWindowFocused(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    setWindowFocused(false);
    soundWasEnabledBeforeHidden = !soundscape.isMuted;
    soundscape.suspendForPageHide();
    return;
  }
  setWindowFocused(document.hasFocus());
  lastTime = performance.now();
  lastProcessedFrame = null;
  clampNextSimulationDelta = true;
  if (soundWasEnabledBeforeHidden) soundscape.resumeForPageShow();
  soundWasEnabledBeforeHidden = false;
});
// Real time, not the flight time scale, so a 15-minute day stays 15 minutes during accelerated tests.
let skySeconds = visit === 1 ? 0.25 * DAY_SECONDS - 15 : 0.36 * DAY_SECONDS;
let skyPaused = false;
let skyLook: 'sun' | 'moon' | 'horizon' | null = null;
const sunDir = new THREE.Vector3();
const moonDir = new THREE.Vector3();
const puffSkyLight = new THREE.Color();
const puffNightLight = new THREE.Color(0.16, 0.2, 0.3);
const puffKeyLight = new THREE.Color();
const skyAim = new THREE.Vector3();
const keyDir = new THREE.Vector3();
const veil = document.querySelector<HTMLElement>('#veil')!;
const smooth01 = (edge0: number, edge1: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// FWM's dusk keys (main.js:255-273 at aca247b), placed by sun elevation in degrees: late afternoon,
// sunset, civil dusk and nautical dusk. Dawn uses the same keys, mirrored by the sun's height.
const twilightKeys = [
  [6, 0x3f7fae, 0x7ca4c2, 0xc4b8a0, 0xa4b4ba, 0xf4c584],
  [1, 0x2f4a82, 0x6c7aa0, 0xe09a78, 0x9aa0b0, 0xffa040],
  [-5, 0x172850, 0x394272, 0xa06a82, 0x6c6480, 0xf07a3a],
  [-11, 0x060c22, 0x0e1838, 0x101838, 0x243050, 0x3d3452],
].map(([elevation, ...colors]) => ({ elevation: elevation!, colors: colors.map((hex) => new THREE.Color(hex)) }));
const twilightColor = new THREE.Color();
const twilightNames = ['twilightZenith', 'twilightUpper', 'twilightUpperWarm', 'twilightHorizon', 'twilightHorizonWarm'] as const;

function applyTwilight(sunY: number): void {
  const elevation = THREE.MathUtils.radToDeg(Math.asin(sunY));
  // Full from sunset to nautical dusk, gone by +6 and -12 degrees.
  sky.material.uniforms.twilightAmount!.value = smooth01(6, 1, elevation) * smooth01(-12, -10, elevation);
  let index = 0;
  while (index < twilightKeys.length - 2 && twilightKeys[index + 1]!.elevation > elevation) index += 1;
  const from = twilightKeys[index]!;
  const to = twilightKeys[index + 1]!;
  const blend = smooth01(from.elevation, to.elevation, elevation);
  twilightNames.forEach((name, slot) => {
    sky.material.uniforms[name]!.value.copy(twilightColor.copy(from.colors[slot]!).lerp(to.colors[slot]!, blend));
  });
}

function applyDaylight(body: Daylight, delta: number): void {
  sunDir.set(body.sun.x, body.sun.y, body.sun.z);
  moonDir.set(body.moon.x, body.moon.y, body.moon.z);
  cloudSea.update(navigator.state.x, navigator.state.z, cameraPosition.y, navigator.flightSeconds,
    sunDir, moonDir, body.sunColor, fogSample, renderOrigin, body.moonLit);
  const high = smooth01(0.12, 0.72, Math.max(0, body.sun.y));
  const day = 1 - body.night;
  sky.material.uniforms.sunPosition!.value.copy(sunDir).multiplyScalar(450000);
  sky.material.uniforms.moonPosition!.value.copy(moonDir);
  sky.material.uniforms.moonLit!.value = body.moonLit;
  sky.material.uniforms.moonSunlight!.value.set(body.moonSunlight.x, body.moonSunlight.y, body.moonSunlight.z);
  sky.material.uniforms.turbidity!.value = 9.5 - high * 8.5;
  sky.material.uniforms.rayleigh!.value = 2.4 + high * 1.6;
  sky.material.uniforms.mieCoefficient!.value = 0.016 - high * 0.015;
  sky.material.uniforms.mieDirectionalG!.value = 0.93 - high * 0.18;
  sky.material.uniforms.skyExposure!.value = 0.16 + high * 0.06;
  sky.material.uniforms.nightAmount!.value = body.night;
  sky.material.uniforms.goldenAmount!.value = 1 - high;
  sky.material.uniforms.blueAmount!.value = high;
  sky.material.uniforms.sunTint!.value.setRGB(body.sunColor.r, body.sunColor.g, body.sunColor.b);
  // FWM's low-sun weights by sun height: a horizon sun, the sun-side glow band, and the rose belt.
  sky.material.uniforms.lowSun!.value = Math.exp(-((body.sun.y / 0.14) ** 2));
  sky.material.uniforms.glowAmount!.value = smooth01(-0.22, -0.04, body.sun.y) * (1 - smooth01(0.12, 0.32, body.sun.y));
  sky.material.uniforms.venusAmount!.value = Math.exp(-(((body.sun.y + 0.03) / 0.09) ** 2));
  applyTwilight(body.sun.y);
  // Keep more clouds near dawn and dusk, and let the layer drift on real time.
  sky.material.uniforms.cloudCoverage!.value = cloudCoverageOverride ?? 0.22 + (1 - high) * 0.5;
  sky.material.uniforms.cloudTime!.value = navigator.flightSeconds * 0.001;
  hazeStart = 0.4 + high * 0.5;
  // Stars fade in from about -2 degrees and are full by -6 degrees, while the afterglow is still bright.
  sky.material.uniforms.starAmount!.value = smooth01(-0.035, -0.105, body.sun.y)
    * (1 - cloudSea.fogUniforms.whiteout.value);
  // The Milky Way needs a darker sky: it starts near -6 degrees and is full by -17 degrees.
  sky.material.uniforms.milkyWayAmount!.value = smooth01(-0.1, -0.3, body.sun.y)
    * (1 - cloudSea.fogUniforms.whiteout.value);
  sky.material.uniforms.auroraAmount!.value = auroraAmount(body,
    auroraSchedule.hasAurora(nightCycle(skySeconds)));
  // Keep the sky box around the camera. The sun uniform is a direction, so moving the mesh
  // does not drag the sun; it only stops the box from being left behind on a long flight.
  sky.position.copy(camera.position);

  const dominantSun = body.dominant === 'sun';
  keyDir.copy(dominantSun ? sunDir : moonDir);
  const keyColor = dominantSun ? body.sunColor : body.moonColor;
  const keyIntensity = dominantSun ? body.sunIntensity : body.moonIntensity;
  terrain.setWaterLighting(keyDir, body.sun.y, body.moon.y, body.moonShine, dominantSun, delta, renderOrigin);
  keyLight.color.setRGB(keyColor.r, keyColor.g, keyColor.b);
  keyLight.intensity = keyIntensity;
  puffKeyLight.setRGB(keyColor.r, keyColor.g, keyColor.b).multiplyScalar(keyIntensity / Math.PI);
  hemisphere.color.setRGB(0.16 + day * 0.68, 0.2 + day * 0.68, 0.36 + day * 0.5);
  hemisphere.groundColor.setRGB(0.08 + day * 0.27, 0.09 + day * 0.3, 0.08 + day * 0.2);
  hemisphere.intensity = 0.65 + day * 1.55;
  // FWM dims exposure by 12% above the deck. Night exposure keeps the sky's own rule.
  renderer.toneMappingExposure = (1.00 - body.night * 0.2) * (1 - 0.12 * cloudSea.fogUniforms.above.value);
  // Puff tops use the same warm-to-cool sky light as the painted cloud layer,
  // not an unlit white face that remains bright after sunset.
  puffSkyLight.setRGB(1, 0.49 + high * 0.49, 0.25 + high * 0.75)
    .lerp(puffNightLight, body.night);

  const flare = smooth01(0, 0.12, body.sun.y);
  const low = 1 - high;
  flareGlowElement.size = 42 + low * 16;
  flareRingElement.size = 36;
  flareGlowElement.color.setRGB(flare, flare * (0.72 + high * 0.22), flare * (0.38 + high * 0.4));
  flareRingElement.color.setRGB(flare * 0.55, flare * 0.62, flare * 0.8);
  sunFlareAnchor.visible = flare > 0.01;
  if (sunFlareAnchor.visible) {
    sunFlareAnchor.position.copy(cameraPosition).addScaledVector(sunDir, camera.far * 0.82);
  }

  veil.style.setProperty('--veil-top', 'rgba(0, 0, 0, 0)');
  veil.style.setProperty('--veil-bottom', 'rgba(20, 32, 40, 0.03)');

  fogSampleAge += delta;
  if (fogSampleAge > 0.35 && !fogSamplePending) {
    fogSampleAge = 0;
    sampleHorizonColor();
  }
  fogGoal.copy(fogSample).lerp(cloudSea.cloudWhite.value, cloudSea.fogUniforms.above.value * 0.4)
    .lerp(cloudSea.cloudWhite.value, cloudSea.fogUniforms.whiteout.value);
  neutralToneMap(fogGoal, renderer.toneMappingExposure);
  fog.color.lerp(fogGoal, 1 - Math.exp(-Math.max(delta, 0.016) * 4));
}

function currentDaylight(): Daylight {
  return daylight(skySeconds);
}

// Arrow keys nudge the autopilot. Focused form controls keep their own arrow keys.
const heldArrows = new Set<string>();
const ARROWS: Record<string, string> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
window.addEventListener('keydown', (event) => {
  if (!ARROWS[event.key] || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, button')) return;
  event.preventDefault();
  heldArrows.add(ARROWS[event.key]!);
});
window.addEventListener('keyup', (event) => { if (ARROWS[event.key]) heldArrows.delete(ARROWS[event.key]!); });
window.addEventListener('blur', () => heldArrows.clear());
const nudgeHint = document.querySelector<HTMLElement>('#nudge-hint')!;
const nudgeText = nudgeHint.querySelector<HTMLElement>('.nudge-text')!;
let nudgeHintText = '';
function updateNudgeHint(): void {
  const status = navigator.nudgeStatus;
  for (const key of nudgeHint.querySelectorAll<HTMLElement>('[data-key]')) key.classList.toggle('held', heldArrows.has(key.dataset.key!));
  let text = '';
  if (status.turn || status.climb) {
    const parts = [status.turn < 0 ? 'bearing left' : status.turn > 0 ? 'bearing right' : '',
      status.climb > 0 ? 'climbing' : status.climb < 0 ? 'diving' : ''].filter(Boolean);
    text = parts.join(' · ');
  } else if (status.resumeIn > 0) text = `autopilot takes over in ${Math.ceil(status.resumeIn)} s`;
  else if (status.adopted > 0) text = `holding your course · ${Math.floor(status.adopted / 60)}:${String(Math.floor(status.adopted % 60)).padStart(2, '0')}`;
  nudgeHint.classList.toggle('visible', text !== '');
  if (text && text !== nudgeHintText) nudgeText.textContent = text;
  nudgeHintText = text;
}

function updateFlight(delta: number, now: number): void {
  const substeps = Math.ceil(delta / 0.1);
  let state = navigator.state;
  navigator.setNudge({ turn: (heldArrows.has('right') ? 1 : 0) - (heldArrows.has('left') ? 1 : 0),
    climb: (heldArrows.has('up') ? 1 : 0) - (heldArrows.has('down') ? 1 : 0) });
  if (!reviewFlightPaused) {
    for (let step = 0; step < substeps; step += 1) {
      state = navigator.update(delta / substeps);
      trail.tick(state.x, state.z, delta / substeps);
    }
  }
  eagle.update(state, delta);
  updateNudgeHint();
  thermalMarker.update(state, navigator.activeThermal, settings.showThermal, now / 1000);
  const audioBiome = soundscape.isMuted ? undefined : world.sample(state.x, state.z).biome;
  soundscape.update(state.behavior, state.flapping, audioBiome);
}

let renderedFrames = 0;
// The fog probe also renders, so keep the scene's own count for diagnostics and smoke checks.
let sceneDrawCalls = 0;
const profiler = profileMode ? new FrameProfiler(renderer) : null;
let smokeFrameIndex = 0;
function frame(now: number): void {
  const cap = currentFrameCap();
  if (cap !== null && lastProcessedFrame !== null && now - lastProcessedFrame < 1000 / cap) {
    requestAnimationFrame(frame);
    return;
  }
  profiler?.frameBegin(now);
  const elapsed = Math.max(0, (now - lastTime) / 1000);
  const rawDelta = Math.min(0.1, elapsed);
  lastTime = now;
  lastProcessedFrame = now;
  const delta = clampNextSimulationDelta ? Math.min(rawDelta * timeScale, 0.1) : rawDelta * timeScale;
  clampNextSimulationDelta = false;
  updateFlight(delta, now);
  const state = navigator.state;
  if (Math.hypot(state.x - renderOrigin.x, state.y - renderOrigin.y, state.z - renderOrigin.z) > RENDER_ORIGIN_DISTANCE) {
    renderOrigin.set(state.x, state.y, state.z);
    // One parent translation rebases every world object together; the camera is rebased below.
    worldRoot.position.copy(renderOrigin).negate();
  }

  if (skyLook) {
    const sky = currentDaylight();
    if (skyLook === 'horizon') skyAim.set(-sky.sun.z, 0.1, sky.sun.x).normalize();
    else skyAim.set(sky[skyLook].x, sky[skyLook].y, sky[skyLook].z);
    cameraPosition.set(state.x, state.y + 16, state.z).addScaledVector(skyAim, -36);
    cameraPosition.y = Math.max(cameraPosition.y, world.sample(cameraPosition.x, cameraPosition.z).height + 8);
    lookAt.copy(cameraPosition).addScaledVector(skyAim, 280);
  } else if (heldViewpoint) {
    cameraPosition.set(heldViewpoint.x, heldViewpoint.y, heldViewpoint.z);
    lookAt.set(heldViewpoint.lookX, heldViewpoint.lookY, heldViewpoint.lookZ);
  } else {
    if (resettingOrbit) {
      const resetRate = 1 - Math.exp(-rawDelta * 4);
      orbitYaw += (0 - orbitYaw) * resetRate;
      orbitPitch += (0 - orbitPitch) * resetRate;
      if (Math.abs(orbitYaw) < 0.002 && Math.abs(orbitPitch) < 0.002) {
        orbitYaw = 0;
        orbitPitch = 0;
        resettingOrbit = false;
      }
    }
    // Thermal-riding: follow more loosely and yaw slower than the eagle so it moves around the frame.
    rideBlend += ((state.behavior === 'thermal-riding' ? 1 : 0) - rideBlend) * (1 - Math.exp(-rawDelta * 0.65));
    cameraHeading += wrapAngle(state.heading - cameraHeading) * (1 - Math.exp(-rawDelta * (2.6 - rideBlend * 2.1)));
    const backward = new THREE.Vector3(-Math.sin(cameraHeading), 0, -Math.cos(cameraHeading));
    const side = new THREE.Vector3(Math.cos(cameraHeading), 0, -Math.sin(cameraHeading));
    easeCameraDistance(rawDelta);
    const distance = settings.cameraDistance;
    const desired = new THREE.Vector3(state.x, state.y, state.z)
      .addScaledVector(backward, Math.cos(orbitYaw) * distance)
      .addScaledVector(side, Math.sin(orbitYaw) * distance)
      .add(new THREE.Vector3(0, followCameraHeight(distance) + distance * orbitPitch, 0));
    cameraPosition.lerp(desired, 1 - Math.exp(-rawDelta * (2.1 - rideBlend * 1.35)));
    cameraPosition.y = Math.max(cameraPosition.y, world.sample(cameraPosition.x, cameraPosition.z).height + 14);
    const lookAhead = 38 - rideBlend * 22;
    lookAt.set(state.x + Math.sin(cameraHeading) * lookAhead, state.y - 9 - orbitPitch * 24, state.z + Math.cos(cameraHeading) * lookAhead);
  }
  camera.position.copy(cameraPosition).sub(renderOrigin);
  camera.lookAt(renderLookAt.copy(lookAt).sub(renderOrigin));
  lastChunkBuilds = terrain.update(cameraPosition.x, cameraPosition.z, CHUNK_BUILD_BUDGET_MS);
  updateFog();
  if (!skyPaused) skySeconds += rawDelta;
  minimap.update(state.x, state.z, state.heading, rawDelta);
  const body = currentDaylight();
  applyDaylight(body, rawDelta);
  navigator.setSkyBearing(skyBearing(body, sky.material.uniforms.milkyWayAmount!.value, milkyWayUniforms.milkyWayCentre.value));
  puffClouds.update(state, navigator.wind, reviewFlightPaused ? 0 : delta, cameraPosition, { horizon: fogGoal,
    skyLight: puffSkyLight, keyDir, keyLight: puffKeyLight, bodies: cloudSea.snapshot().bodies,
    whiteout: cloudSea.fogUniforms.whiteout.value });
  thermalMarker.setWhiteout(cloudSea.fogUniforms.whiteout.value);

  keyLight.target.position.set(cameraPosition.x, world.sample(cameraPosition.x, cameraPosition.z).height, cameraPosition.z);
  updateShadowBasis(keyDir);
  snapToShadowGrid(keyLight.target.position);
  keyLight.position.copy(keyDir).multiplyScalar(SHADOW_EXTENT + 300).add(keyLight.target.position);
  keyLight.target.updateMatrixWorld();

  cacheTrimElapsed += rawDelta;
  if (cacheTrimElapsed >= 1) {
    cacheTrimElapsed -= 1;
    world.trim(WORLD_CACHE_LIMIT);
  }
  // Keep input, streaming and simulation responsive between costly software-WebGL draws.
  // The scene and shaders stay real; only the dev-only smoke render cadence changes.
  if (!smokeMode || smokeFrameIndex++ % 4 === 0) {
    profiler?.renderBegin();
    renderer.render(scene, camera);
    sceneDrawCalls = renderer.info.render.calls;
    profiler?.renderEnd();
    renderedFrames += 1;
  }
  const measuredFps = elapsed > 0 ? 1 / elapsed : 60;
  fpsSmoothed += (measuredFps - fpsSmoothed) * (1 - Math.exp(-elapsed / 0.5));
  updateAdaptiveQuality(elapsed);
  diagnosticsElapsed += rawDelta;
  if (diagnosticsVisible && diagnosticsElapsed > 0.22) {
    diagnosticsElapsed = 0;
    const nearby = world.nearbyThermals(state.x, state.z, 1)
      .sort((a, b) => Math.hypot(a.x - state.x, a.z - state.z) - Math.hypot(b.x - state.x, b.z - state.z))
      .slice(0, 4).map((thermal) => `${thermal.x.toFixed(0)},${thermal.z.toFixed(0)}`).join(' · ');
    diagnostics.textContent = [
      `FPS          ${fpsSmoothed.toFixed(0)}`,
      `chunks       ${terrain.chunkCount} (${terrain.pendingCount} pending)`,
      `build ms     ${terrain.buildTiming.meanMs.toFixed(2)} mean · ${terrain.buildTiming.maxMs.toFixed(2)} max`,
      `stream ms    ${terrain.buildTiming.maxUpdateMs.toFixed(2)} update max · ${terrain.buildTiming.maxSliceMs.toFixed(2)} slice max`,
      `buffers      ${terrain.buildTiming.allocated} allocated · ${terrain.buildTiming.reused} reused`,
      `biome        ${Object.entries(world.sample(state.x, state.z).biome).map(([name, weight]) => `${name} ${weight.toFixed(2)}`).join(' · ')}`,
      `LOD          near ${terrain.tierCounts.near} · mid ${terrain.tierCounts.mid} · far ${terrain.tierCounts.far}`,
      `visibility   ${fog.far.toFixed(0)} / ${effectiveTerrainVisibility().toFixed(0)} m`,
      `cap          ${currentFrameCap() === null ? 'uncapped' : `${currentFrameCap()} fps`}`,
      `quality step ${qualityStep}/3 · pixel ${renderer.getPixelRatio().toFixed(2)}`,
      `render       ${renderer.domElement.width} × ${renderer.domElement.height} · ${renderer.domElement.width * renderer.domElement.height} px`,
      `draw calls   ${sceneDrawCalls}`,
      `puff clouds  ${puffClouds.count} clouds · ${puffClouds.spriteCount} sprites · 1 draw call`,
      `geometries   ${renderer.info.memory.geometries}`,
      `behavior     ${state.behavior}${state.flapping ? ' (flapping)' : ''}`,
      `wind         ${navigator.wind.x.toFixed(1)}, ${navigator.wind.z.toFixed(1)} m/s (${navigator.wind.speed.toFixed(1)} m/s)`,
      `ridge lift   ${navigator.ridgeLift.toFixed(2)} m/s`,
      `clearance    ${(state.y - world.sample(state.x, state.z).height).toFixed(0)} m`,
      `position     ${state.x.toFixed(0)}, ${state.z.toFixed(0)}`,
      `render origin ${renderOrigin.x.toFixed(0)}, ${renderOrigin.y.toFixed(0)}, ${renderOrigin.z.toFixed(0)}`,
      `thermal      ${navigator.activeThermal ? `${navigator.activeThermal.x.toFixed(0)}, ${navigator.activeThermal.z.toFixed(0)}` : 'none selected'}`,
      `markers      ${thermalMarker.count} within ${THERMAL_MARKER_RANGE} m`,
      `nearby       ${nearby}`,
      `time of day  ${body.phase.toFixed(3)} ${body.dominant}`,
      `time scale   ${timeScale.toFixed(1)}×`,
    ].join('\n');
  }
  profiler?.frameEnd();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyRenderQuality();
  renderer.setSize(innerWidth, innerHeight);
});

window.addEventListener('beforeunload', () => {
  trail.save();
  lensflare.dispose();
  fogSampleDisposed = true;
  profiler?.dispose();
  fogTarget.dispose();
  fogProbeMaterial.dispose();
  thermalMarker.dispose();
  puffClouds.dispose();
  cloudSea.dispose();
  terrain.dispose();
});

declare global {
  interface Window {
    __SOARING__: {
      snapshot: () => { buildTiming: { chunks: number; meanMs: number; maxMs: number; maxSliceMs: number; maxUpdateMs: number; allocated: number; reused: number }; renderedFrames: number; seed: number; chunks: number; pending: number; ground: string; visibleDistance: number; requestedDistance: number; cameraDistance: number; cameraHeight: number; orbitYaw: number; orbitPitch: number; behavior: string; flapping: boolean; bank: number; heading: number; position: number[]; renderOrigin: number[]; geometries: number; activeThermal: number[] | null; marker: number[] | null; markerRange: number; markers: number[][]; thermalCandidates: number[][]; tiers: { near: number; mid: number; far: number }; timeOfDay: number; sunElevation: number; moonElevation: number; sunDirection: number[]; moonDirection: number[]; moonLit: number; moonIntensity: number; dominant: 'sun' | 'moon'; starAmount: number; milkyWayAmount: number; twilightAmount: number; exposure: number; hemisphereIntensity: number; auroraAmount: number; cloudCoverage: number; cloudTime: number; drawCalls: number; frameCap: 30 | null; chunkBuildBudget: number; lastChunkBuilds: number; qualityStep: number; pixelRatio: number; renderWidth: number; renderHeight: number; renderPixels: number; shadowsEnabled: boolean; fog: { color: number[]; targetColor: number[]; readPending: boolean; samples: number; failures: number }; cloudLayer: ReturnType<CloudSea['snapshot']>; nudge: NudgeStatus; cycle: { phase: FlightPhase; top: number; cruise: number } };
      puffCloudSnapshot: () => PuffCloudSnapshot;
      fogSamples?: () => { revision: number; discarded: number; completion: FogReadCompletion | null };
      advanceSimulation?: (seconds: number) => void;
      profile?: { begin: () => void; end: () => void; report: () => ProfileReport };
      reviewFlight?: (start: { x: number; y?: number; z: number; heading: number } | null) => void;
      pauseFlight: () => void;
      setCapturePixelRatio: (ratio: number) => void;
      setTimeScale: (scale: number) => void;
      setTimeOfDay: (phase: number, day?: number) => void;
      lookAtBody: (body: 'sun' | 'moon' | 'horizon' | 'chase') => void;
      landmark: () => { x: number; z: number; surface: number; lake: boolean } | null;
      sample: (x: number, z: number) => { water: boolean; river: boolean; height: number; surface: number };
      setViewpoint: (pose: { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number }) => void;
      clearViewpoint: () => void;
      setPuffCloudsVisible: (visible: boolean) => void;
      setEagleVisible: (visible: boolean) => void;
      setCaptureClear: (on: boolean) => void;
      setCloudCoverage: (coverage: number | null) => void;
      setVisibility: (meters: number) => void;
      reviewSpots: () => { coast: { x: number; z: number; surface: number }; lake: { x: number; z: number; surface: number }; basin: { x: number; z: number; surface: number; heading: number }; islands: { x: number; z: number; surface: number } };
    };
  }
}
if (import.meta.env.DEV) window.__SOARING__ = {
  ...(profiler ? { profile: { begin: () => profiler.begin(), end: () => profiler.end(), report: () => profiler.report() } } : {}),
  ...(import.meta.env.DEV ? {
    fogSamples: () => ({ revision: fogInputRevision, discarded: fogDiscardedReads, completion: fogReadCompletion }),
    // Freeze only navigation for repeatable lighting comparisons. The normal
    // chase camera, renderer, streaming and light loop remain unchanged.
    reviewFlight: (pose: { x: number; y?: number; z: number; heading: number } | null) => {
      reviewFlightPaused = pose !== null;
      if (!pose) return;
      navigator = new EagleNavigator(world, pose);
      if (pose.y !== undefined) navigator.state.y = pose.y;
      cameraHeading = pose.heading;
      orbitYaw = 0;
      orbitPitch = 0;
      resettingOrbit = false;
      rideBlend = 0;
      skyLook = null;
      heldViewpoint = null;
      cameraPosition.set(navigator.state.x - Math.sin(pose.heading) * settings.cameraDistance,
        navigator.state.y + followCameraHeight(settings.cameraDistance),
        navigator.state.z - Math.cos(pose.heading) * settings.cameraDistance);
      terrain.clear();
    },
  } : {}),
  ...(smokeMode ? {
    advanceSimulation: (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 300) throw new RangeError('Expected 0–300 simulated seconds');
      const substeps = Math.ceil(seconds / 0.1);
      for (let step = 0; step < substeps; step += 1) updateFlight(seconds / substeps, performance.now());
    },
  } : {}),
  snapshot: () => {
    const placed = thermalMarker.placements();
    const activeMarker = placed.find((marker) => marker.active);
    const body = currentDaylight();
    return {
      renderedFrames,
      buildTiming: terrain.buildTiming,
      drawCalls: sceneDrawCalls,
      seed: world.seed,
      chunks: terrain.chunkCount,
      pending: terrain.pendingCount,
      ground: terrain.groundState,
      lastChunkBuilds,
      visibleDistance: fog.far,
      requestedDistance: terrainVisibility,
      cameraDistance: settings.cameraDistance,
      orbitYaw,
      orbitPitch,
      frameCap: currentFrameCap(),
      chunkBuildBudget: CHUNK_BUILD_BUDGET_MS,
      qualityStep,
      pixelRatio: renderer.getPixelRatio(),
      renderWidth: renderer.domElement.width,
      renderHeight: renderer.domElement.height,
      renderPixels: renderer.domElement.width * renderer.domElement.height,
      shadowsEnabled: renderer.shadowMap.enabled,
      cameraHeight: cameraPosition.y - navigator.state.y,
      behavior: navigator.state.behavior,
      flapping: navigator.state.flapping,
      bank: navigator.state.bank,
      heading: navigator.state.heading,
      nudge: navigator.nudgeStatus,
      cycle: navigator.cycle,
      position: [navigator.state.x, navigator.state.y, navigator.state.z],
      renderOrigin: [renderOrigin.x, renderOrigin.y, renderOrigin.z],
      geometries: renderer.info.memory.geometries,
      activeThermal: navigator.activeThermal ? [navigator.activeThermal.x, navigator.activeThermal.z] : null,
      marker: activeMarker ? [activeMarker.x, activeMarker.z] : null,
      markerRange: THERMAL_MARKER_RANGE,
      markers: placed.map((marker) => [marker.x, marker.z, marker.active ? 1 : 0]),
      // Wider than the marker window so smoke tests can see thermals the marker must exclude.
      thermalCandidates: world.nearbyThermals(navigator.state.x, navigator.state.z, 6).map((thermal) => [thermal.x, thermal.z]),
      tiers: terrain.tierCounts,
      pools: terrain.poolUsage,
      timeOfDay: body.phase,
      sunElevation: body.sun.y,
      moonElevation: body.moon.y,
      sunDirection: [body.sun.x, body.sun.y, body.sun.z],
      moonDirection: [body.moon.x, body.moon.y, body.moon.z],
      moonLit: body.moonLit,
      moonIntensity: body.moonIntensity,
      dominant: body.dominant,
      starAmount: sky.material.uniforms.starAmount!.value,
      milkyWayAmount: sky.material.uniforms.milkyWayAmount!.value,
      twilightAmount: sky.material.uniforms.twilightAmount!.value,
      auroraAmount: auroraAmount(body, auroraSchedule.hasAurora(nightCycle(skySeconds))),
      exposure: renderer.toneMappingExposure,
      hemisphereIntensity: hemisphere.intensity,
      cloudCoverage: sky.material.uniforms.cloudCoverage!.value,
      cloudTime: sky.material.uniforms.cloudTime!.value,
      fog: {
        color: [fog.color.r, fog.color.g, fog.color.b],
        targetColor: [fogGoal.r, fogGoal.g, fogGoal.b],
        readPending: fogSamplePending,
        samples: fogSampleCount,
        failures: fogReadbackFailures,
      },
      cloudLayer: cloudSea.snapshot(),
    };
  },
  puffCloudSnapshot: () => puffClouds.snapshot(),
  pauseFlight: () => { reviewFlightPaused = true; },
  setCapturePixelRatio: (ratio: number) => {
    if (!Number.isFinite(ratio)) throw new RangeError('Expected a finite capture pixel ratio');
    renderer.setPixelRatio(THREE.MathUtils.clamp(ratio, 0.25, 2));
  },
  setTimeScale: (scale: number) => { timeScale = Math.max(1, Math.min(12, scale)); },
  setTimeOfDay: (phase: number, day = 0) => {
    skySeconds = (day + phase) * DAY_SECONDS;
    skyPaused = true;
    fogInputRevision += 1;
    fogSampleAge = 999;
  },
  lookAtBody: (body: 'sun' | 'moon' | 'horizon' | 'chase') => {
    skyLook = body === 'chase' ? null : body;
  },
  landmark: () => world.landmarkNear(navigator.state.x, navigator.state.z),
  sample: (x: number, z: number) => world.sample(x, z),
  setViewpoint: (pose) => { heldViewpoint = pose; },
  clearViewpoint: () => { heldViewpoint = null; },
  setPuffCloudsVisible: (visible: boolean) => puffClouds.setVisible(visible),
  setEagleVisible: (visible: boolean) => { eagle.group.visible = visible; },
  setCaptureClear: (on: boolean) => { captureClear = on; },
  setCloudCoverage: (coverage: number | null) => { cloudCoverageOverride = coverage; },
  setVisibility: (meters: number) => {
    terrainVisibility = meters;
    terrain.setReach(terrainReach());
  },
  reviewSpots: () => world.reviewSpots(),
};
