import * as THREE from 'three';

// The Milky Way: a procedural band of star clouds in the night sky, fixed to the world like the stars.

const toRad = THREE.MathUtils.degToRad;
const fromAzEl = (azimuth: number, elevation: number) => new THREE.Vector3(
  Math.sin(toRad(azimuth)) * Math.cos(toRad(elevation)), Math.sin(toRad(elevation)), Math.cos(toRad(azimuth)) * Math.cos(toRad(elevation)));

// The core sits low at azimuth 20 degrees, so the chase camera sees it, and the band climbs steeply from it.
const galacticCentre = fromAzEl(20, 4);
const climb = fromAzEl(-70, 62);
const galacticPole = new THREE.Vector3().crossVectors(galacticCentre, climb).normalize();
galacticCentre.crossVectors(new THREE.Vector3().crossVectors(galacticPole, galacticCentre), galacticPole).normalize();

export const milkyWayUniforms = {
  milkyWayAmount: { value: 0 },
  milkyWayPole: { value: galacticPole },
  milkyWayCentre: { value: galacticCentre },
};

export const milkyWayDeclarations = `uniform float milkyWayAmount;
uniform vec3 milkyWayPole;
uniform vec3 milkyWayCentre;`;

/** Needs starLayer, so insert it after that function. */
export const milkyWayFunctions = `
		float mwHash(vec3 p) {
			p = fract(p * vec3(0.1031, 0.1030, 0.0973));
			p += dot(p, p.yxz + 33.33);
			return fract((p.x + p.y) * p.z);
		}
		float mwNoise(vec3 p) {
			vec3 i = floor(p);
			vec3 f = fract(p);
			vec3 u = f * f * (3.0 - 2.0 * f);
			float a = mix(mwHash(i), mwHash(i + vec3(1.0, 0.0, 0.0)), u.x);
			float b = mix(mwHash(i + vec3(0.0, 1.0, 0.0)), mwHash(i + vec3(1.0, 1.0, 0.0)), u.x);
			float c = mix(mwHash(i + vec3(0.0, 0.0, 1.0)), mwHash(i + vec3(1.0, 0.0, 1.0)), u.x);
			float d = mix(mwHash(i + vec3(0.0, 1.0, 1.0)), mwHash(i + vec3(1.0, 1.0, 1.0)), u.x);
			return mix(mix(a, b, u.y), mix(c, d, u.y), u.z);
		}
		float mwFbm(vec3 p, int octaves) {
			float sum = 0.0;
			float amp = 0.5;
			float norm = 0.0;
			for (int i = 0; i < 5; i++) {
				if (i >= octaves) break;
				sum += mwNoise(p) * amp;
				norm += amp;
				p = p * 2.03 + vec3(17.1, 5.3, 9.7);
				amp *= 0.5;
			}
			return sum / norm;
		}
		vec3 milkyWay(vec3 d) {
			float s = dot(d, milkyWayPole);
			// The band is at most 0.19 wide, so skip the noise for the sky far from it.
			if (abs(s) > 0.45) return vec3(0.0);
			float cd = dot(d, milkyWayCentre);
			float ly = dot(d, cross(milkyWayPole, milkyWayCentre));
			float cosLon = cd * inversesqrt(max(cd * cd + ly * ly, 1e-6));
			float lonFall = 0.45 + 0.55 * (0.5 + 0.5 * cosLon) * (0.5 + 0.5 * cosLon);
			float core = exp((cd - 1.0) * 3.0);
			// Warped five-octave light, a bulge at the core, and dark dust lanes along the plane.
			vec3 warp = vec3(mwNoise(d * 2.0 + 4.0), mwNoise(d * 2.0 + 9.0), mwNoise(d * 2.0 + 15.0)) - 0.5;
			float n = mwFbm(d * 4.5 + warp * 1.2, 5);
			float s2 = s + 0.04 * (mwNoise(d * 2.5 + 21.0) - 0.5);
			float width = 0.09 + 0.07 * core + 0.03 * n;
			float band = exp(-(s2 * s2) / (width * width));
			float bulge = exp((cd - 1.0) * 28.0) * exp(-(s * s) / 0.012);
			float glow = band * lonFall * clamp(0.2 + 1.6 * (n - 0.3), 0.0, 1.6) + bulge * 0.9;
			float dustN = mwFbm(d * 8.0 + warp * 2.0 + 31.0, 4);
			float rift = exp(-((s2 + 0.01) * (s2 + 0.01)) / 0.0016) * smoothstep(-0.5, 0.6, cosLon);
			float dust = clamp(smoothstep(0.33, 0.55, dustN) * rift + smoothstep(0.58, 0.74, dustN) * band * 0.6, 0.0, 1.0);
			dust *= 1.0 - 0.6 * clamp(bulge * 2.0, 0.0, 1.0);
			glow *= 1.0 - 0.8 * dust;
			vec3 color = mix(vec3(0.7, 0.76, 0.95), vec3(0.98, 0.9, 0.78), clamp(core * 1.4 + bulge, 0.0, 1.0));
			color = mix(color, vec3(0.95, 0.72, 0.78), smoothstep(0.62, 0.8, n) * 0.15);
			// Fine stars crowd into the bright band, so it reads as grain, not fog.
			float crowd = clamp(glow * (1.0 - dust), 0.0, 1.0);
			float grain = starLayer(d, 520.0, mix(0.995, 0.8, crowd), 0.28, 0.42);
			return color * glow * 0.08 * (0.75 + 0.5 * mwNoise(d * 60.0)) + vec3(0.85, 0.88, 1.0) * grain * crowd * 0.5;
		}`;

/** Inserted after the stars are added. Fades with dusk, cloud whiteout, moonlight, the moon's glare and painted clouds. */
export const milkyWayComposite = `
			if (milkyWayAmount > 0.0) {
				float mwMoonGlare = max(dot(direction, moonDir), 0.0);
				mwMoonGlare *= mwMoonGlare;
				mwMoonGlare *= mwMoonGlare;
				mwMoonGlare *= mwMoonGlare;
				float mwFade = milkyWayAmount * smoothstep(0.02, 0.12, direction.y)
					* (1.0 - 0.85 * moonLight) * (1.0 - 0.9 * mwMoonGlare * moonUp * moonLit)
					* (1.0 - cloudMask) * (1.0 - moonDisc);
				if (mwFade > 0.0) retColor += milkyWay(direction) * mwFade;
			}`;
