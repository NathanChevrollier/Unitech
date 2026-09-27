import * as THREE from "three";

// Étoiles des systèmes de l'utilisateur, vues depuis la galaxie. Chacune garde une taille minimale
// à l'écran pour rester repérable à l'échelle galactique, avec des aigrettes de diffraction et un
// anneau quand elle est survolée ou sélectionnée.

const vertex = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float state;
  uniform float uScale;
  uniform float uPxRatio;
  uniform float uTime;
  varying vec3 vColor;
  varying float vState;
  varying float vPx;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 1e-3);
    float px = max(size * uScale / dist, 12.0 * uPxRatio);
    px = min(px, 140.0 * uPxRatio);
    // Survol ou sélection : légère pulsation.
    px *= 1.0 + 0.12 * step(0.5, state) * (0.6 + 0.4 * sin(uTime * 3.0));
    gl_PointSize = px;
    vColor = color;
    vState = state;
    vPx = px;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vState;
  varying float vPx;
  void main() {
    vec2 c = (gl_PointCoord - 0.5) * 2.0;
    float r = length(c);
    if (r > 1.0) discard;
    float core = exp(-r * r * 60.0) * 3.0;
    float glow = exp(-r * r * 9.0) * 0.8;
    // Aigrettes : croix fine qui s'estompe vers le bord.
    float spikes = (exp(-abs(c.x) * 40.0) + exp(-abs(c.y) * 40.0)) * (1.0 - r) * 0.9;
    float ring = vState > 0.5 ? smoothstep(0.08, 0.0, abs(r - 0.78)) * (vState > 1.5 ? 1.0 : 0.55) : 0.0;
    vec3 col = vColor * (core + glow + spikes) + vec3(0.75, 0.88, 1.0) * ring;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface MarkerSpec {
  id: string;
  position: THREE.Vector3;
  color: [number, number, number];
  /** Taille en parsecs (à distance, la taille minimale en pixels l'emporte). */
  size: number;
}

export class Markers {
  readonly points: THREE.Points;
  specs: MarkerSpec[] = [];
  private uniforms = { uScale: { value: 800 }, uPxRatio: { value: 1 }, uTime: { value: 0 } };
  private geo = new THREE.BufferGeometry();

  constructor() {
    this.points = new THREE.Points(
      this.geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: vertex,
        fragmentShader: fragment,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        transparent: true,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  set(specs: MarkerSpec[]) {
    this.specs = specs;
    const n = specs.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    specs.forEach((s, i) => {
      pos.set([s.position.x, s.position.y, s.position.z], i * 3);
      col.set(s.color, i * 3);
      size[i] = s.size;
    });
    this.geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
    this.geo.setAttribute("state", new THREE.BufferAttribute(new Float32Array(n), 1));
    this.geo.setDrawRange(0, n);
  }

  /** État visuel : 0 normal, 1 survolé, 2 sélectionné. */
  setStates(hovered: string | null, selected: string | null) {
    const attr = this.geo.getAttribute("state") as THREE.BufferAttribute | undefined;
    if (!attr) return;
    this.specs.forEach((s, i) => attr.setX(i, s.id === selected ? 2 : s.id === hovered ? 1 : 0));
    attr.needsUpdate = true;
  }

  update(scale: number, pixelRatio: number, time: number) {
    this.uniforms.uScale.value = scale;
    this.uniforms.uPxRatio.value = pixelRatio;
    this.uniforms.uTime.value = time;
  }

  dispose() {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
