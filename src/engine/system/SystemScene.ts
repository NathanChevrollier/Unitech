import * as THREE from "three";
import { hash32, planetKind } from "../../model/classify";
import type { Planet, StarSystem } from "../../model/types";
import { usageScore } from "../../model/usage";
import type { RecentFile } from "../../platform/bridge";
import { mulberry32 } from "../math/rng";
import {
  PLANET_KIND_INDEX,
  atmosphereFragment,
  billboardVertex,
  coronaFragment,
  planetFragment,
  planetVertex,
  pulseFragment,
  ringFragment,
  ringVertex,
  starFragment,
  starVertex,
} from "../shaders/bodies";

// Vue rapprochée d'un système : l'étoile du projet, ses planètes (applications, fichiers, liens) en
// orbite, leurs lunes (actions secondaires), les anneaux, une ceinture d'astéroïdes et, autour du
// Soleil, les comètes des téléchargements récents.

export interface BodyRef {
  type: "star" | "planet" | "moon" | "comet";
  id: string;
  /** Planète porteuse d'une lune. */
  planetId?: string;
}

export interface Anchor {
  ref: BodyRef;
  name: string;
  icon?: string;
  radius: number;
  position: THREE.Vector3;
}

type Kind = keyof typeof PLANET_KIND_INDEX;

/** Palette de base de chaque type : couleurs A, B, C et atmosphère. */
const PALETTES: Record<Kind, [number, number, number][]> = {
  rocky: [
    [0.42, 0.38, 0.34],
    [0.62, 0.56, 0.48],
    [0.3, 0.26, 0.24],
    [0.5, 0.55, 0.65],
  ],
  desert: [
    [0.78, 0.5, 0.28],
    [0.93, 0.72, 0.45],
    [0.6, 0.32, 0.18],
    [0.95, 0.65, 0.4],
  ],
  ocean: [
    [0.05, 0.2, 0.5],
    [0.12, 0.5, 0.78],
    [0.28, 0.55, 0.25],
    [0.35, 0.6, 1.0],
  ],
  ice: [
    [0.86, 0.93, 0.98],
    [0.6, 0.78, 0.9],
    [0.2, 0.45, 0.75],
    [0.6, 0.85, 1.0],
  ],
  lava: [
    [0.12, 0.08, 0.07],
    [0.32, 0.2, 0.16],
    [1.0, 0.35, 0.05],
    [1.0, 0.35, 0.15],
  ],
  gas: [
    [0.85, 0.7, 0.52],
    [0.62, 0.42, 0.3],
    [0.95, 0.88, 0.78],
    [0.95, 0.8, 0.6],
  ],
  toxic: [
    [0.62, 0.7, 0.2],
    [0.85, 0.82, 0.35],
    [0.35, 0.45, 0.12],
    [0.75, 0.9, 0.3],
  ],
};

const HAS_ATMOSPHERE: Record<Kind, number> = { rocky: 0.25, desert: 0.5, ocean: 1, ice: 0.6, lava: 0.45, gas: 0.8, toxic: 1 };

/** Légère variation de teinte par planète, dérivée de son identifiant. */
function tint(c: [number, number, number], rand: () => number): THREE.Color {
  const color = new THREE.Color(c[0], c[1], c[2]);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  color.setHSL((hsl.h + (rand() - 0.5) * 0.08 + 1) % 1, Math.min(1, hsl.s * (0.85 + rand() * 0.3)), Math.min(1, hsl.l * (0.9 + rand() * 0.2)));
  return color;
}

interface Pulse {
  mesh: THREE.Mesh;
  uniforms: { uColor: { value: THREE.Color }; uPhase: { value: number }; uStrength: { value: number } };
  t: number;
  loop: boolean;
}

interface MoonNode {
  id: string;
  name: string;
  pivot: THREE.Object3D;
  mesh: THREE.Mesh;
  speed: number;
}

interface PlanetNode {
  planet: Planet;
  pivot: THREE.Object3D;
  holder: THREE.Object3D;
  body: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  ringUniforms?: Record<string, THREE.IUniform>;
  orbitLine: THREE.LineLoop;
  moons: MoonNode[];
  radius: number;
  orbit: number;
  speed: number;
  spin: number;
  running: Pulse;
  launch: Pulse;
}

interface CometNode {
  file: RecentFile;
  head: THREE.Mesh;
  tail: THREE.Points;
  a: number;
  e: number;
  tilt: THREE.Quaternion;
  phase: number;
  speed: number;
}

function makeStarfield(): THREE.Points {
  const rand = mulberry32(99);
  const n = 4000;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos.set([s * Math.cos(th) * 2000, u * 2000, s * Math.sin(th) * 2000], i * 3);
    const b = Math.pow(rand(), 6) * 2.2 + 0.25;
    const warm = rand();
    col.set([b * (0.85 + warm * 0.15), b * 0.9, b * (1.05 - warm * 0.25)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
  points.renderOrder = -1;
  points.frustumCulled = false;
  return points;
}

export interface SystemBuildInput {
  system: StarSystem;
  armColor: string;
  starColor: [number, number, number];
  starRadius: number;
  comets: RecentFile[];
  now: number;
}

export class SystemScene {
  readonly scene = new THREE.Scene();
  starRadius = 5;
  outerRadius = 60;
  systemId: string | null = null;
  private root = new THREE.Group();
  private star!: THREE.Mesh;
  private starUniforms = { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uIntensity: { value: 2.2 } };
  private coronaUniforms = { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uIntensity: { value: 0.5 } };
  private planets = new Map<string, PlanetNode>();
  private comets: CometNode[] = [];
  private belt: THREE.Points | null = null;
  /** Phases orbitales conservées d'une reconstruction à l'autre (pas de saut à l'ajout d'une planète). */
  private phases = new Map<string, number>();
  private signature = "";
  private sphere: THREE.SphereGeometry;
  private sphereLow: THREE.SphereGeometry;
  private quad = new THREE.PlaneGeometry(2, 2);
  private detail: number;
  /** Ciel étoilé de secours, pour les systèmes loin du Soleil (hors du catalogue d'étoiles réelles). */
  private starfield: THREE.Points;

  constructor(quality: { segments: number; octaves: number }) {
    this.sphere = new THREE.SphereGeometry(1, quality.segments, Math.round(quality.segments / 2));
    this.sphereLow = new THREE.SphereGeometry(1, 24, 12);
    this.detail = quality.octaves;
    this.starfield = makeStarfield();
    this.scene.add(this.root, this.starfield);
  }

  setStarfield(visible: boolean) {
    this.starfield.visible = visible;
  }

  /** Reconstruit la scène si le système a changé (planètes, apparence, usage). */
  build(input: SystemBuildInput) {
    const { system } = input;
    const sig = JSON.stringify([
      system.id,
      system.status,
      system.color,
      input.starColor,
      input.starRadius,
      input.armColor,
      system.planets.map((p) => [p.id, p.name, p.kind, p.ring, p.icon, p.moons.map((m) => m.id + m.name), Math.round(usageScore(p.usage, input.now) * 20)]),
      input.comets.map((c) => c.path + c.modified),
    ]);
    if (sig === this.signature) return;
    this.signature = sig;
    this.clear();
    this.systemId = system.id;
    this.starRadius = input.starRadius;

    // Étoile et couronne.
    this.starUniforms.uColor.value.setRGB(...input.starColor);
    this.coronaUniforms.uColor.value.setRGB(...input.starColor);
    const starBright = system.status === "dormant" ? 0.85 : system.status === "paused" ? 0.95 : 1.05;
    this.starUniforms.uIntensity.value = starBright;
    this.star = new THREE.Mesh(this.sphere, new THREE.ShaderMaterial({ uniforms: this.starUniforms, vertexShader: starVertex, fragmentShader: starFragment }));
    this.star.scale.setScalar(input.starRadius);
    this.star.userData.ref = { type: "star", id: system.id } satisfies BodyRef;
    const corona = new THREE.Mesh(
      this.quad,
      new THREE.ShaderMaterial({
        uniforms: this.coronaUniforms,
        vertexShader: billboardVertex,
        fragmentShader: coronaFragment,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      }),
    );
    corona.scale.setScalar(input.starRadius * 4.2);
    corona.renderOrder = 2;
    this.root.add(this.star, corona);

    const light = new THREE.Color(...input.starColor).lerp(new THREE.Color(1, 1, 1), 0.55);
    const armColor = new THREE.Color(input.armColor);

    // Orbites : chaque planète prend la place de sa taille (anneaux et lunes compris).
    let orbit = input.starRadius * 2.4 + 6;
    const beltAfter = system.planets.length >= 4 ? Math.floor(system.planets.length / 2) - 1 : -1;
    system.planets.forEach((planet, index) => {
      const score = usageScore(planet.usage, input.now);
      const fresh = input.now - planet.createdAt < 7 * 86_400_000 ? 1 : 0;
      const radius = 0.9 + 1.7 * Math.sqrt(score) + (planetKind(planet) === "gas" ? 0.5 : 0);
      const extent = radius * (planet.ring ? 2.4 : 1) + (planet.moons.length ? radius * 1.8 + planet.moons.length * 0.7 : 0);
      orbit += extent + (index === 0 ? 0 : 3.5);
      const node = this.addPlanet(planet, orbit, radius, Math.max(score, fresh * 0.5), light, armColor);
      this.planets.set(planet.id, node);
      orbit += extent;
      if (index === beltAfter) {
        this.addBelt(orbit + 5, orbit + 11, hash32(system.id));
        orbit += 14;
      }
    });
    this.outerRadius = Math.max(orbit + 10, input.starRadius * 9);
    input.comets.forEach((file, i) => this.addComet(file, i, input.comets.length));
  }

  private addPlanet(planet: Planet, orbit: number, radius: number, vitality: number, light: THREE.Color, armColor: THREE.Color): PlanetNode {
    const kind = planetKind(planet);
    const rand = mulberry32(hash32(planet.id));
    const pal = PALETTES[kind];
    const uniforms: Record<string, THREE.IUniform> = {
      uKind: { value: PLANET_KIND_INDEX[kind] },
      uA: { value: tint(pal[0], rand) },
      uB: { value: tint(pal[1], rand) },
      uC: { value: tint(pal[2], rand) },
      uAtmo: { value: tint(pal[3], rand).multiplyScalar(HAS_ATMOSPHERE[kind]) },
      uSeed: { value: rand() * 10 },
      uTime: { value: 0 },
      uStarPos: { value: new THREE.Vector3() },
      uStarColor: { value: light },
      uVitality: { value: 0.45 + 0.55 * Math.min(1, vitality * 2.2) },
      uHighlight: { value: 0 },
      uDetail: { value: this.detail },
    };
    const pivot = new THREE.Object3D();
    // Plans orbitaux légèrement inclinés, comme dans un vrai système.
    pivot.rotation.x = (rand() - 0.5) * 0.14;
    pivot.rotation.z = (rand() - 0.5) * 0.14;
    const holder = new THREE.Object3D();
    holder.position.x = orbit;
    pivot.add(holder);
    const body = new THREE.Mesh(this.sphere, new THREE.ShaderMaterial({ uniforms, vertexShader: planetVertex, fragmentShader: planetFragment }));
    body.scale.setScalar(radius);
    body.rotation.z = (rand() - 0.5) * 0.6;
    body.userData.ref = { type: "planet", id: planet.id } satisfies BodyRef;
    holder.add(body);

    if (HAS_ATMOSPHERE[kind] > 0.3) {
      const atmo = new THREE.Mesh(
        this.sphere,
        new THREE.ShaderMaterial({
          uniforms: { uAtmo: uniforms.uAtmo, uStarPos: uniforms.uStarPos, uStrength: { value: 0.7 } },
          vertexShader: planetVertex,
          fragmentShader: atmosphereFragment,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
        }),
      );
      atmo.scale.setScalar(radius * 1.05);
      holder.add(atmo);
    }

    let ringUniforms: Record<string, THREE.IUniform> | undefined;
    if (planet.ring) {
      ringUniforms = {
        uA: { value: tint([0.93, 0.85, 0.7], rand) },
        uB: { value: tint([0.62, 0.52, 0.42], rand) },
        uInner: { value: radius * 1.45 },
        uOuter: { value: radius * 2.35 },
        uSeed: { value: rand() * 100 },
        uStarColor: { value: light },
        uVitality: uniforms.uVitality,
      };
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 1.45, radius * 2.35, 128, 1),
        new THREE.ShaderMaterial({ uniforms: ringUniforms, vertexShader: ringVertex, fragmentShader: ringFragment, side: THREE.DoubleSide, transparent: true, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2 + 0.35;
      ring.rotation.y = 0.2;
      holder.add(ring);
    }

    const moons: MoonNode[] = planet.moons.map((m, k) => {
      const mp = new THREE.Object3D();
      mp.rotation.x = (rand() - 0.5) * 0.8;
      const mesh = new THREE.Mesh(
        this.sphereLow,
        new THREE.ShaderMaterial({
          uniforms: { ...uniforms, uKind: { value: 0 }, uA: { value: new THREE.Color(0.5, 0.5, 0.52) }, uB: { value: new THREE.Color(0.75, 0.74, 0.72) }, uC: { value: new THREE.Color(0.35, 0.35, 0.36) }, uAtmo: { value: new THREE.Color(0, 0, 0) }, uSeed: { value: rand() * 10 }, uHighlight: { value: 0 } },
          vertexShader: planetVertex,
          fragmentShader: planetFragment,
        }),
      );
      const moonRadius = 0.22 + rand() * 0.14;
      mesh.scale.setScalar(moonRadius);
      mesh.position.x = radius * 1.8 + k * 0.7 + 0.6;
      mesh.userData.ref = { type: "moon", id: m.id, planetId: planet.id } satisfies BodyRef;
      mp.add(mesh);
      mp.rotation.y = rand() * Math.PI * 2;
      holder.add(mp);
      return { id: m.id, name: m.name, pivot: mp, mesh, speed: 0.6 + rand() * 0.6 };
    });

    const orbitLine = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 160 }, (_, i) => new THREE.Vector3(Math.cos((i / 160) * Math.PI * 2) * orbit, 0, Math.sin((i / 160) * Math.PI * 2) * orbit))),
      new THREE.LineBasicMaterial({ color: armColor, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    pivot.add(orbitLine);

    // Période képlérienne (T ∝ a^1,5), ramenée à quelques minutes pour les orbites lointaines.
    const period = 50 * Math.pow(orbit / 20, 1.5);
    const phase = this.phases.get(planet.id) ?? rand() * Math.PI * 2;
    pivot.rotation.y = phase;
    this.root.add(pivot);

    const makePulse = (color: THREE.Color, loop: boolean): Pulse => {
      const u = { uColor: { value: color }, uPhase: { value: 0 }, uStrength: { value: 0 } };
      const mesh = new THREE.Mesh(this.quad, new THREE.ShaderMaterial({ uniforms: u, vertexShader: billboardVertex, fragmentShader: pulseFragment, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      mesh.scale.setScalar(radius * 3.2);
      mesh.visible = false;
      mesh.renderOrder = 3;
      holder.add(mesh);
      return { mesh, uniforms: u, t: 0, loop };
    };

    return {
      planet,
      pivot,
      holder,
      body,
      uniforms,
      ringUniforms,
      orbitLine,
      moons,
      radius,
      orbit,
      speed: (Math.PI * 2) / period,
      spin: 0.1 + rand() * 0.25,
      running: makePulse(new THREE.Color(0.35, 1.0, 0.6), true),
      launch: makePulse(new THREE.Color(0.6, 0.85, 1.0).multiplyScalar(1.6), false),
    };
  }

  private addBelt(inner: number, outer: number, seed: number) {
    const rand = mulberry32(seed);
    const n = 1600;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = inner + (outer - inner) * rand();
      const a = rand() * Math.PI * 2;
      pos.set([Math.cos(a) * r, (rand() - 0.5) * 1.2, Math.sin(a) * r], i * 3);
      const g = 0.35 + rand() * 0.3;
      col.set([g, g * 0.95, g * 0.9], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.belt = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false }));
    this.root.add(this.belt);
  }

  private addComet(file: RecentFile, i: number, total: number) {
    const rand = mulberry32(hash32(file.path));
    const a = this.outerRadius * (0.55 + 0.35 * (i / Math.max(1, total)));
    const e = 0.55 + rand() * 0.25;
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 1.2, rand() * Math.PI * 2, (rand() - 0.5) * 0.8));
    const head = new THREE.Mesh(this.sphereLow, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.9, 2.2) }));
    head.scale.setScalar(0.35);
    head.userData.ref = { type: "comet", id: file.path } satisfies BodyRef;
    const n = 60;
    const tailGeo = new THREE.BufferGeometry();
    tailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const f = Math.pow(1 - k / n, 1.6) * 1.2;
      col.set([0.55 * f, 0.8 * f, 1.0 * f], k * 3);
    }
    tailGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const tail = new THREE.Points(tailGeo, new THREE.PointsMaterial({ size: 0.55, vertexColors: true, sizeAttenuation: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    tail.frustumCulled = false;
    this.root.add(head, tail);
    this.comets.push({ file, head, tail, a, e, tilt, phase: rand() * Math.PI * 2, speed: 0.05 + rand() * 0.04 });
  }

  update(dt: number, time: number, orbitMotion: boolean) {
    this.starUniforms.uTime.value = time;
    this.coronaUniforms.uTime.value = time;
    const move = orbitMotion ? dt : 0;
    for (const node of this.planets.values()) {
      node.pivot.rotation.y += node.speed * move;
      this.phases.set(node.planet.id, node.pivot.rotation.y);
      node.body.rotation.y += node.spin * move;
      node.uniforms.uTime.value = time;
      for (const m of node.moons) m.pivot.rotation.y += m.speed * move;
      for (const p of [node.running, node.launch]) {
        if (!p.mesh.visible) continue;
        p.t += dt;
        const period = p.loop ? 2.2 : 1.4;
        if (!p.loop && p.t > period) {
          p.mesh.visible = false;
          continue;
        }
        const phase = (p.t % period) / period;
        p.uniforms.uPhase.value = 0.3 + phase * 0.7;
        p.uniforms.uStrength.value = p.loop ? 0.9 : 2.2;
      }
    }
    if (this.belt) this.belt.rotation.y += 0.01 * move;
    for (const c of this.comets) {
      c.phase += c.speed * move * (1.6 - c.e);
      // Anomalie excentrique approchée : la comète accélère près de l'étoile.
      const E = c.phase + c.e * Math.sin(c.phase);
      const x = c.a * (Math.cos(E) - c.e);
      const z = c.a * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
      c.head.position.set(x, 0, z).applyQuaternion(c.tilt);
      const r = c.head.position.length();
      const away = c.head.position.clone().normalize();
      const length = THREE.MathUtils.clamp(260 / r, 3, 24);
      const attr = c.tail.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let k = 0; k < attr.count; k++) {
        const f = (k / attr.count) * length;
        attr.setXYZ(k, c.head.position.x + away.x * f + Math.sin(k * 1.7 + time) * 0.02 * k, c.head.position.y + away.y * f, c.head.position.z + away.z * f);
      }
      attr.needsUpdate = true;
    }
  }

  setHighlights(hovered: string | null, selected: string | null) {
    for (const [id, node] of this.planets) {
      node.uniforms.uHighlight.value = id === selected ? 0.8 : id === hovered ? 0.45 : 0;
      (node.orbitLine.material as THREE.LineBasicMaterial).opacity = id === selected ? 0.45 : id === hovered ? 0.3 : 0.16;
    }
  }

  setRunning(ids: ReadonlySet<string>) {
    for (const [id, node] of this.planets) {
      const on = ids.has(id);
      if (on && !node.running.mesh.visible) node.running.t = 0;
      node.running.mesh.visible = on;
    }
  }

  /** Onde de choc au lancement d'une planète. */
  pulse(planetId: string) {
    const node = this.planets.get(planetId);
    if (!node) return;
    node.launch.t = 0;
    node.launch.mesh.visible = true;
  }

  hasPlanet(id: string) {
    return this.planets.has(id);
  }

  planetRadius(id: string): number {
    return this.planets.get(id)?.radius ?? 1;
  }

  /** Position monde d'une planète, d'une lune ou de l'étoile. */
  positionOf(ref: BodyRef, out: THREE.Vector3): THREE.Vector3 {
    if (ref.type === "planet") this.planets.get(ref.id)?.body.getWorldPosition(out);
    else if (ref.type === "moon") this.planets.get(ref.planetId ?? "")?.moons.find((m) => m.id === ref.id)?.mesh.getWorldPosition(out);
    else if (ref.type === "comet") this.comets.find((c) => c.file.path === ref.id)?.head.getWorldPosition(out);
    else out.set(0, 0, 0);
    return out;
  }

  pickables(): THREE.Object3D[] {
    const out: THREE.Object3D[] = this.star ? [this.star] : [];
    for (const n of this.planets.values()) out.push(n.body, ...n.moons.map((m) => m.mesh));
    for (const c of this.comets) out.push(c.head);
    return out;
  }

  anchors(): Anchor[] {
    const out: Anchor[] = [];
    for (const n of this.planets.values()) {
      out.push({ ref: { type: "planet", id: n.planet.id }, name: n.planet.name, icon: n.planet.icon, radius: n.radius, position: n.body.getWorldPosition(new THREE.Vector3()) });
      for (const m of n.moons) out.push({ ref: { type: "moon", id: m.id, planetId: n.planet.id }, name: m.name, radius: 0.3, position: m.mesh.getWorldPosition(new THREE.Vector3()) });
    }
    for (const c of this.comets) out.push({ ref: { type: "comet", id: c.file.path }, name: c.file.name, radius: 0.35, position: c.head.getWorldPosition(new THREE.Vector3()) });
    return out;
  }

  private clear() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
      if (m.geometry && m.geometry !== this.sphere && m.geometry !== this.sphereLow && m.geometry !== this.quad) m.geometry.dispose();
    });
    this.root.clear();
    this.planets.clear();
    this.comets = [];
    this.belt = null;
  }

  /** Oublie la scène courante : le prochain `build` reconstruit tout. */
  reset() {
    this.signature = "";
  }

  dispose() {
    this.clear();
    this.starfield.geometry.dispose();
    (this.starfield.material as THREE.Material).dispose();
    this.sphere.dispose();
    this.sphereLow.dispose();
    this.quad.dispose();
  }
}
