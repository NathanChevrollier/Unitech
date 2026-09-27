import * as THREE from "three";
import type { Layer } from "./generate";

// Rendu des nuages de particules procéduraux.
//
// Taille à l'écran = taille en parsecs × échelle de projection / distance. Sous 1,5 pixel, la
// particule garde 1,5 pixel mais perd de l'éclat en proportion de sa surface : pas de scintillement
// quand on s'éloigne. Les particules trop proches de la caméra s'effacent (on ne traverse pas des
// « bulles » de lumière) : de près, ce sont les vraies étoiles et les systèmes qui prennent le relais.

const vertex = /* glsl */ `
  attribute float size;
  attribute vec3 color;
  uniform float uScale;
  uniform float uMaxPx;
  uniform float uNear0;
  uniform float uNear1;
  uniform float uIntensity;
  uniform float uSoftPx;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 1e-3);
    float px = size * uScale / dist;
    float a = smoothstep(uNear0, uNear1, dist);
    if (px < 1.5) {
      a *= (px * px) / 2.25;
      px = 1.5;
    }
    // Énergie conservée : une particule qui grossit à l'écran s'étale en voile diffus au lieu de
    // devenir une bulle lumineuse. Vu de l'intérieur, c'est ce qui dessine la bande laiteuse.
    if (px > uSoftPx) a *= (uSoftPx * uSoftPx) / (px * px);
    px = min(px, uMaxPx);
    gl_PointSize = px;
    vColor = color * uIntensity;
    vAlpha = a;
    gl_Position = projectionMatrix * mv;
    if (a < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;

const fragmentLight = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c) * 4.0;
    if (r2 > 1.0) discard;
    float f = exp(-r2 * 4.5);
    gl_FragColor = vec4(vColor * f * vAlpha, 1.0);
  }
`;

// La poussière assombrit : opacité douce, teinte brune. Son opacité suit la luminance encodée.
const fragmentDust = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c) * 4.0;
    if (r2 > 1.0) discard;
    float f = exp(-r2 * 3.0);
    float o = clamp(dot(vColor, vec3(3.3)) * f * vAlpha * uOpacity, 0.0, 0.85);
    gl_FragColor = vec4(vColor * 0.6, o);
  }
`;

function geometry(l: Layer): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(l.positions, 3));
  g.setAttribute("color", new THREE.BufferAttribute(l.colors, 3));
  g.setAttribute("size", new THREE.BufferAttribute(l.sizes, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 30000);
  return g;
}

export class GalaxyField {
  readonly group = new THREE.Group();
  private light: THREE.Points;
  private dust: THREE.Points;
  private uniforms = {
    uScale: { value: 800 },
    uMaxPx: { value: 48 },
    uNear0: { value: 150 },
    uNear1: { value: 700 },
    uIntensity: { value: 0.55 },
    uSoftPx: { value: 4 },
    uOpacity: { value: 1 },
  };

  constructor(light: Layer, dust: Layer) {
    const lightMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertex,
      fragmentShader: fragmentLight,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    const dustMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertex,
      fragmentShader: fragmentDust,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    this.light = new THREE.Points(geometry(light), lightMat);
    this.dust = new THREE.Points(geometry(dust), dustMat);
    this.light.frustumCulled = false;
    this.dust.frustumCulled = false;
    this.light.renderOrder = 0;
    this.dust.renderOrder = 1;
    this.group.add(this.light, this.dust);
  }

  /** `scale` : pixels par unité à distance 1 (hauteur du canevas / (2 tan(fov/2))). */
  update(scale: number, maxPx: number, pixelRatio: number, cameraDistanceToSun: number) {
    this.uniforms.uScale.value = scale;
    this.uniforms.uMaxPx.value = maxPx;
    this.uniforms.uSoftPx.value = 4 * pixelRatio;
    // Près du Soleil, les particules s'effacent plus tôt : le ciel appartient aux vraies étoiles.
    const local = THREE.MathUtils.smoothstep(cameraDistanceToSun, 300, 3000);
    this.uniforms.uNear0.value = THREE.MathUtils.lerp(260, 60, local);
    this.uniforms.uNear1.value = THREE.MathUtils.lerp(1400, 400, local);
    // La poussière se voit de loin (bandes sombres) mais ne doit pas voiler le ciel de l'intérieur.
    this.uniforms.uOpacity.value = THREE.MathUtils.lerp(0.35, 1, local);
  }

  dispose() {
    for (const p of [this.light, this.dust]) {
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
  }
}
