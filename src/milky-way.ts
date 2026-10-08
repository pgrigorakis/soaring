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
		vec3 mwTintedStars(vec3 d, float grid, float density) {
			// Fine stars with a colour per star, from blue-white to orange, like a long exposure.
			vec3 scaled = d * grid;
			vec3 cell = floor(scaled);
			float hash = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
			float vary = fract(sin(dot(cell, vec3(269.5, 183.3, 246.1))) * 12543.23);
			float star = step(density, hash) * smoothstep(mix(0.28, 0.42, vary), 0.0, length(scaled - cell - 0.5));
			vec3 tint = mix(vec3(0.66, 0.78, 1.0), vec3(1.0, 0.74, 0.48), fract(vary * 7.31));
			return tint * star * mix(0.45, 1.7, vary * vary);
		}
		// The Great Rift, after photos of the core over Paranal: a cream bulge, cool arms,
		// a dark rift that splits the band, and thin winding dust lanes.
		vec3 milkyWay(vec3 d) {
			float s = dot(d, milkyWayPole);
			// The band is at most about 0.19 wide, so skip the noise for the sky far from it.
			if (abs(s) > 0.4) return vec3(0.0);
			float cd = dot(d, milkyWayCentre);
			float ly = dot(d, cross(milkyWayPole, milkyWayCentre));
			float cosLon = cd * inversesqrt(max(cd * cd + ly * ly, 1e-6));
			float toward = 0.5 + 0.5 * cosLon;
			float core = exp((cd - 1.0) * 4.0);
			// Stretch the noise along the band, so star clouds and dust run along it, not as round blobs.
			vec3 q = d + milkyWayPole * s * 1.2;
			vec3 warp = vec3(mwNoise(q * 2.2 + 4.0), mwNoise(q * 2.2 + 9.0), mwNoise(q * 2.2 + 15.0)) - 0.5;
			float n = mwFbm(q * 5.0 + warp * 1.1, 5);
			float s2 = s + 0.035 * (warp.x + 0.5 * warp.y);
			float width = 0.06 + 0.1 * core + 0.025 * n;
			float band = exp(-(s2 * s2) / (width * width));
			float lonFall = 0.45 + 0.55 * toward * toward;
			float bulge = exp((cd - 1.0) * 14.0) * exp(-(s * s) / 0.016);
			// Star clouds: lumpy bright patches broken into small knots.
			float fine = mwFbm(q * 22.0 + warp * 3.0, 3);
			float clouds = clamp(2.4 * (n - 0.34), 0.0, 2.0) * (0.45 + 1.1 * fine);
			float glow = band * lonFall * clouds + bulge * (0.8 + 0.8 * n) * (0.75 + 0.5 * fine);
			// Dust: the rift runs from the core outward, thin lanes follow the contour lines of a warped field,
			// and a few dark clouds sit on the band.
			float dn = mwFbm(q * 7.0 + warp * 2.2 + 31.0, 5);
			float riftLine = s2 + 0.01 + 0.03 * (n - 0.5) + 0.015 * (dn - 0.5);
			float rift = exp(-(riftLine * riftLine) / mix(0.00008, 0.0004, core)) * smoothstep(-0.4, 0.6, cosLon);
			float lanes = smoothstep(0.04, 0.0, abs(dn - 0.5 + 0.06 * (fine - 0.5))) * smoothstep(0.4, 0.65, mwNoise(q * 3.0 + 13.0));
			float darkClouds = smoothstep(0.64, 0.72, dn);
			float dust = rift * smoothstep(0.3, 0.5, dn + 0.15 * n) + (lanes * 0.85 + darkClouds * 0.7) * band;
			dust = clamp(dust, 0.0, 1.0) * (1.0 - 0.3 * clamp(bulge * 1.5, 0.0, 1.0));
			// Dust is an optical depth that dims blue most, so lane edges turn brown, not grey.
			vec3 transmit = exp(-dust * 2.6 * vec3(0.88, 1.0, 1.15));
			vec3 color = mix(vec3(0.759, 0.826, 1.0), vec3(0.964, 0.936, 0.893), smoothstep(0.1, 0.7, toward));
			color = mix(color, vec3(1.0, 0.866, 0.677), clamp(core * 1.3 + bulge, 0.0, 1.0));
			// Small pink knots of glowing hydrogen along the bright side of the band.
			float knot = smoothstep(0.8, 0.95, mwNoise(q * 30.0 + 50.0)) * band * smoothstep(0.2, 0.9, toward);
			color = mix(color, vec3(1.0, 0.4, 0.55), knot * 0.35);
			vec3 light = color * glow * transmit * (0.8 + 0.4 * mwNoise(d * 70.0));
			// Most of the light is fine stars: two grids, crowding where the band is bright and the dust thin.
			float crowd = clamp(glow * transmit.g * 0.8, 0.0, 1.0);
			vec3 grain = mwTintedStars(d, 520.0, mix(1.0, 0.66, crowd)) + mwTintedStars(d, 780.0, mix(1.0, 0.72, crowd)) * 0.6;
			grain = mix(vec3(dot(grain, vec3(0.3333))), grain, 0.67);
			return light * 0.0825 + grain * (0.35 + 0.55 * crowd) * 0.9;
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
