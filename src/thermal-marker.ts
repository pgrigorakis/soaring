import * as THREE from 'three';
import type { Thermal, WorldModel } from './world';

const HEIGHT = 260;

/** One reusable, open-sided column for the eagle's current thermal. */
export class ThermalMarker {
  readonly mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private readonly time = { value: 0 };
  private targetX: number | null = null;
  private targetZ: number | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly world: WorldModel) {
    const geometry = new THREE.CylinderGeometry(62, 62, HEIGHT, 48, 1, true);
    const material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), time: this.time },
      fog: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      vertexShader: `
        #include <fog_pars_vertex>
        varying vec2 vUv;
        varying float vFacing;
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vFacing = dot(normalize(normalMatrix * normal), normalize(-mvPosition.xyz));
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform float time;
        varying vec2 vUv;
        varying float vFacing;
        void main() {
          float fade = smoothstep(0.0, 0.14, vUv.y) * (1.0 - smoothstep(0.74, 1.0, vUv.y));
          float wave = sin(vUv.y * 33.0 - time * 2.1 + vUv.x * 19.0);
          float shimmer = 0.5 + 0.5 * sin(vUv.y * 58.0 + vUv.x * 33.0 - time * 3.2);
          float alpha = fade * smoothstep(0.0, 0.4, abs(vFacing)) * (0.065 + 0.14 * pow(shimmer, 8.0) + 0.025 * wave);
          gl_FragColor = vec4(mix(vec3(1.0, 0.12, 0.0), vec3(1.0, 0.3, 0.015), shimmer), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
          #ifdef USE_FOG
            gl_FragColor.a *= 1.0 - fogFactor;
          #endif
        }
      `,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    scene.add(this.mesh);
  }

  update(thermal: Thermal | null, enabled: boolean, elapsedSeconds: number): void {
    this.mesh.visible = enabled && thermal !== null;
    if (!this.mesh.visible || !thermal) return;
    if (thermal.x !== this.targetX || thermal.z !== this.targetZ) {
      this.targetX = thermal.x;
      this.targetZ = thermal.z;
      const ground = this.world.sample(thermal.x, thermal.z).height;
      this.mesh.position.set(thermal.x, ground + HEIGHT / 2 + 3, thermal.z);
    }
    this.time.value = elapsedSeconds;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
