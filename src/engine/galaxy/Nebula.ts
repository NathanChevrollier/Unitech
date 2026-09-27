import * as THREE from "three";
import { gaussian, mulberry32 } from "../math/rng";

// Nébuleuse d'Orion (M42), à sa vraie place à 412 pc du Soleil. Elle accueille la boîte de
// réception (téléchargements récents). Nuage de voiles additifs : hydrogène rose, oxygène
// turquoise, poussière réfléchissante bleue, et les jeunes étoiles du Trapèze au cœur.

const vertex = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uScale;
  uniform float uAlpha;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 1e-3);
    float px = size * uScale / dist;
    float a = uAlpha * smoothstep(0.5, 6.0, dist);
    if (px < 1.5) { a *= px * px / 2.25; px = 1.5; }
    // Voile : plus la particule est grande à l'écran, plus elle est ténue.
    if (px > 24.0) a *= 24.0 / px;
    px = min(px, 480.0);
    gl_PointSize = px;
    // Lente respiration du nuage.
    vColor = color * (0.85 + 0.15 * sin(uTime * 0.3 + position.x * 0.4 + position.y * 0.3));
    vAlpha = a;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c) * 4.0;
    if (r2 > 1.0) discard;
    gl_FragColor = vec4(vColor * exp(-r2 * 3.2) * vAlpha, 1.0);
  }
`;

export class Nebula {
  readonly group = new THREE.Group();
  private uniforms = { uScale: { value: 800 }, uAlpha: { value: 1 }, uTime: { value: 0 } };
  private points: THREE.Points;

  constructor(seed = 42) {
    const rand = mulberry32(seed);
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const palette: [number, number, number][] = [
      [1.0, 0.18, 0.42],
      [0.9, 0.3, 0.7],
      [0.15, 0.8, 0.78],
      [0.25, 0.45, 1.0],
      [1.0, 0.5, 0.3],
    ];
    for (let i = 0; i < n; i++) {
      // Structure en bol ouvert vers le Soleil, avec des filaments.
      const u = rand();
      const r = Math.pow(rand(), 0.85) * 12;
      const th = rand() * Math.PI * 2;
      const ph = Math.acos(2 * rand() - 1);
      let x = r * Math.sin(ph) * Math.cos(th);
      let y = r * Math.cos(ph) * 0.75;
      let z = r * Math.sin(ph) * Math.sin(th);
      const swirl = Math.sin(y * 0.6 + x * 0.25) * 2.2;
      x += swirl + gaussian(rand) * 0.8;
      z += Math.cos(x * 0.5) * 1.8 + gaussian(rand) * 0.8;
      y += gaussian(rand) * 0.6;
      pos.set([x, y, z], i * 3);
      const c = palette[u < 0.45 ? 0 : u < 0.6 ? 1 : u < 0.78 ? 2 : u < 0.93 ? 3 : 4];
      const f = (0.025 + rand() * 0.08) * (0.35 + Math.exp(-r / 6));
      col.set([c[0] * f, c[1] * f, c[2] * f], i * 3);
      size[i] = 2.5 + rand() * 7;
    }
    // Le Trapèze : quatre étoiles bleues brillantes au centre.
    for (let k = 0; k < 4; k++) {
      const i = n - 1 - k;
      pos.set([gaussian(rand) * 0.3, gaussian(rand) * 0.3, gaussian(rand) * 0.3], i * 3);
      col.set([2.2, 2.5, 3.2], i * 3);
      size[i] = 0.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
    this.points = new THREE.Points(
      geo,
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
    this.points.renderOrder = 4;
    this.group.add(this.points);
    this.group.name = "orionNebula";
  }

  update(scale: number, time: number, cameraDistance: number) {
    this.uniforms.uScale.value = scale;
    this.uniforms.uTime.value = time;
    this.uniforms.uAlpha.value = 1 - THREE.MathUtils.smoothstep(cameraDistance, 1500, 5000);
    this.group.visible = this.uniforms.uAlpha.value > 0.001;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
