import * as THREE from "three";
import { bvToRgb } from "../math/color";
import { SUN } from "../math/milkyway";

// Les 109 000 étoiles du catalogue HYG (voisinage du Soleil, jusqu'à ~1 kpc) avec leurs vraies
// positions, magnitudes et couleurs. L'éclat de chaque étoile est recalculé pour la position de la
// caméra : en s'approchant de Sirius, elle grossit ; depuis Véga, le ciel n'a plus la même tête.

const vertex = /* glsl */ `
  attribute float absmag;
  attribute vec3 color;
  uniform float uMagLimit;
  uniform float uAlpha;
  uniform float uMaxPx;
  uniform float uPxRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = length(mv.xyz);
    // L'étoile qui accueille la caméra (système adopté) est dessinée par la vue du système.
    if (d < 0.05 || uAlpha < 0.001) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      return;
    }
    float m = absmag + 5.0 * (log(d) / log(10.0) - 1.0);
    float intensity = pow(10.0, -0.4 * (m - uMagLimit));
    float px = 1.7 * uPxRatio;
    float a = 1.0;
    if (intensity < 1.0) {
      a = intensity;
    } else {
      px *= pow(intensity, 0.2);
    }
    px = min(px, uMaxPx);
    gl_PointSize = px;
    vAlpha = a * uAlpha;
    // Les étoiles très brillantes dépassent 1 : le bloom leur donne leur halo.
    vColor = color * (0.9 + 0.35 * min(log(intensity + 1.0), 5.0));
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
    float core = exp(-r2 * 9.0);
    float halo = exp(-r2 * 2.5) * 0.25;
    gl_FragColor = vec4(vColor * (core + halo) * vAlpha, 1.0);
  }
`;

export interface NamedStar {
  index: number;
  name: string;
  constellation: string;
  hygId: number;
  /** Magnitude apparente vue de la Terre. */
  mag: number;
  /** Position par rapport au Soleil (pc, repère de la galaxie). */
  offset: THREE.Vector3;
  /** Indice de couleur B-V. */
  bv: number;
  absmag: number;
}

export interface ConstellationLabel {
  name: string;
  offset: THREE.Vector3;
}

export class RealStars {
  readonly group = new THREE.Group();
  readonly named: NamedStar[];
  readonly byHyg = new Map<number, NamedStar>();
  readonly constellationLabels: ConstellationLabel[] = [];
  private points: THREE.Points;
  private lines: THREE.LineSegments;
  private uniforms = {
    uMagLimit: { value: 6.5 },
    uAlpha: { value: 1 },
    uMaxPx: { value: 26 },
    uPxRatio: { value: 1 },
  };
  private lineMat: THREE.LineBasicMaterial;
  private constellationsVisible = 0;

  constructor(raw: Int16Array, named: { i: number; n: string; c: string; h: number; m: number }[], constellations: { id: string; name: string; segs: number[] }[]) {
    const count = raw.length / 5;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const abs = new Float32Array(count);
    const bvs = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = raw[i * 5] / 32;
      pos[i * 3 + 1] = raw[i * 5 + 1] / 32;
      pos[i * 3 + 2] = raw[i * 5 + 2] / 32;
      abs[i] = raw[i * 5 + 3] / 100;
      bvs[i] = raw[i * 5 + 4] / 1000;
      const [r, g, b] = bvToRgb(bvs[i]);
      col[i * 3] = r;
      col[i * 3 + 1] = g;
      col[i * 3 + 2] = b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("absmag", new THREE.BufferAttribute(abs, 1));
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
    this.points.renderOrder = 2;

    this.named = named.map((s) => ({
      index: s.i,
      name: s.n,
      constellation: s.c,
      hygId: s.h,
      mag: s.m,
      offset: new THREE.Vector3(pos[s.i * 3], pos[s.i * 3 + 1], pos[s.i * 3 + 2]),
      bv: bvs[s.i],
      absmag: abs[s.i],
    }));
    for (const s of this.named) if (!this.byHyg.has(s.hygId)) this.byHyg.set(s.hygId, s);

    const segs = constellations.flatMap((c) => c.segs);
    const linePos = new Float32Array(segs.length * 3);
    segs.forEach((idx, k) => {
      linePos[k * 3] = pos[idx * 3];
      linePos[k * 3 + 1] = pos[idx * 3 + 1];
      linePos[k * 3 + 2] = pos[idx * 3 + 2];
    });
    for (const c of constellations) {
      if (!c.segs.length) continue;
      // Libellé dans la direction moyenne des étoiles (vue du Soleil), à distance fixe.
      const dir = new THREE.Vector3();
      for (const idx of new Set(c.segs)) dir.add(new THREE.Vector3(pos[idx * 3], pos[idx * 3 + 1], pos[idx * 3 + 2]).normalize());
      this.constellationLabels.push({ name: c.name, offset: dir.normalize().multiplyScalar(60) });
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
    this.lineMat = new THREE.LineBasicMaterial({ color: 0x6d8fd8, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.lines = new THREE.LineSegments(lineGeo, this.lineMat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    this.lines.visible = false;

    this.group.position.set(SUN[0], SUN[1], SUN[2]);
    this.group.add(this.points, this.lines);
  }

  static async load(base: string): Promise<RealStars> {
    const [bin, named, cons] = await Promise.all([
      fetch(`${base}data/stars.bin`).then((r) => {
        if (!r.ok) throw new Error(`stars.bin : ${r.status}`);
        return r.arrayBuffer();
      }),
      fetch(`${base}data/stars-named.json`).then((r) => r.json()),
      fetch(`${base}data/constellations.json`).then((r) => r.json()),
    ]);
    return new RealStars(new Int16Array(bin), named, cons);
  }

  /** Opacité (0..1) du calque de constellations, pour les libellés. */
  get constellationOpacity(): number {
    return this.constellationsVisible;
  }

  update(cameraDistanceToSun: number, pixelRatio: number, showConstellations: boolean, dt: number) {
    // De loin, le voisinage solaire reste visible comme un petit amas, puis disparaît.
    this.uniforms.uMagLimit.value = 6.5 + 3 * THREE.MathUtils.smoothstep(cameraDistanceToSun, 40, 2500);
    this.uniforms.uAlpha.value = 1 - THREE.MathUtils.smoothstep(cameraDistanceToSun, 2500, 7000);
    this.uniforms.uPxRatio.value = pixelRatio;
    this.uniforms.uMaxPx.value = 26 * pixelRatio;

    // Les constellations n'ont de sens que vues depuis les environs du Soleil.
    const target = showConstellations ? 1 - THREE.MathUtils.smoothstep(cameraDistanceToSun, 30, 220) : 0;
    this.constellationsVisible += (target - this.constellationsVisible) * Math.min(1, dt * 4);
    this.lineMat.opacity = this.constellationsVisible * 0.55;
    this.lines.visible = this.constellationsVisible > 0.01;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.lines.geometry.dispose();
    this.lineMat.dispose();
  }
}
