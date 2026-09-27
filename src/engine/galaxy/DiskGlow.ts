import * as THREE from "three";

// Lueur diffuse du disque vue de haut : la lumière des milliards d'étoiles non résolues, qui lie
// les particules entre elles. Plan horizontal additif, effacé quand la caméra entre dans le disque
// (un plan vu par la tranche n'a plus de sens).

const vertex = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform float uAlpha;
  uniform float uBarAngle;
  varying vec2 vPos;
  void main() {
    float r = length(vPos);
    // Coordonnées dans le repère de la barre, pour un bulbe allongé.
    float c = cos(uBarAngle), s = sin(uBarAngle);
    vec2 b = vec2(c * vPos.x + s * vPos.y, -s * vPos.x + c * vPos.y);
    float bar = exp(-length(b / vec2(2600.0, 1100.0)) * 2.2);
    float disk = exp(-r / 4200.0) * 0.22;
    float core = exp(-r / 700.0) * 0.9;
    vec3 col = vec3(1.0, 0.78, 0.52) * (core + bar * 0.5) + vec3(0.7, 0.75, 0.95) * disk;
    gl_FragColor = vec4(col * uAlpha * (1.0 - smoothstep(15000.0, 19000.0, r)), 1.0);
  }
`;

export class DiskGlow {
  readonly mesh: THREE.Mesh;
  private uniforms = { uAlpha: { value: 1 }, uBarAngle: { value: 0 } };

  constructor(barAngle: number) {
    // Direction de la barre (azimut β) exprimée dans le plan local du maillage : (x, z) → (x, −y).
    this.uniforms.uBarAngle.value = Math.atan2(-Math.cos(barAngle), -Math.sin(barAngle));
    const geo = new THREE.PlaneGeometry(40000, 40000, 1, 1);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: vertex,
        fragmentShader: fragment,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        side: THREE.DoubleSide,
      }),
    );
    // Le plan XY de la géométrie devient le plan galactique XZ.
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  update(camera: THREE.Camera, galaxyCenter: THREE.Vector3) {
    const cam = camera.getWorldPosition(new THREE.Vector3()).sub(galaxyCenter);
    const height = Math.abs(cam.y);
    const dist = cam.length();
    // Visible de haut et de loin ; s'efface en approchant du plan ou en entrant dans le disque.
    const fromAbove = THREE.MathUtils.smoothstep(height / Math.max(dist, 1), 0.12, 0.4);
    const far = THREE.MathUtils.smoothstep(dist, 5000, 14000);
    this.uniforms.uAlpha.value = 0.55 * fromAbove * far;
    this.mesh.visible = this.uniforms.uAlpha.value > 0.002;
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
