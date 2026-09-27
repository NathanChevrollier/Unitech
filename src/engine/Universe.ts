import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ARM_ASTRO_NAMES } from "../model/defaults";
import { findSystem } from "../model/ops";
import type { ArmSlot, Galaxy, Settings, StarSystem } from "../model/types";
import type { RecentFile } from "../platform/bridge";
import { BlackHole } from "./galaxy/BlackHole";
import { DiskGlow } from "./galaxy/DiskGlow";
import { GalaxyField } from "./galaxy/GalaxyField";
import type { GalaxyData } from "./galaxy/generate";
import { Markers, type MarkerSpec } from "./galaxy/Markers";
import { Nebula } from "./galaxy/Nebula";
import { RealStars, type NamedStar } from "./galaxy/RealStars";
import { Flight } from "./camera/Flight";
import { Labels, type LabelSpec } from "./labels/Labels";
import { STATUS_BV, bvToRgb, hexToRgb } from "./math/color";
import { BAR_ANGLE, ORION_NEBULA, SUN, armPoint } from "./math/milkyway";
import { hash32 } from "../model/classify";
import { QUALITY, type QualityProfile } from "./quality";
import { SystemScene, type BodyRef } from "./system/SystemScene";

// Chef d'orchestre du rendu : deux échelles (la galaxie en parsecs, un système en unités locales),
// transitions entre elles, caméra, sélection, étiquettes, post-traitement et boucle d'animation.

export type PickTarget =
  | { kind: "system"; id: string }
  | { kind: "arm"; slot: ArmSlot }
  | { kind: "planet"; id: string }
  | { kind: "moon"; id: string; planetId: string }
  | { kind: "comet"; path: string }
  | { kind: "realStar"; hygId: number; name: string }
  | { kind: "blackhole" }
  | { kind: "nebula" }
  | { kind: "systemStar"; id: string };

export type ViewMode = { kind: "galaxy" } | { kind: "system"; systemId: string };

export interface UniverseEvents {
  hover(target: PickTarget | null): void;
  select(target: PickTarget | null, double: boolean): void;
  mode(view: ViewMode): void;
  /** Début d'une transition d'échelle (éclair à l'écran). */
  transition(): void;
  stats(fps: number, pixelRatio: number): void;
  ready(): void;
  error(message: string): void;
}

const OVERVIEW_DIR = new THREE.Vector3(0, 0.78, 0.63).normalize();
const OVERVIEW_DISTANCE = 36000;
const DAY_MS = 86_400_000;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

export function sameTarget(a: PickTarget | null, b: PickTarget | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

export class Universe {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private galaxyPass: RenderPass;
  private systemPass: RenderPass;
  private bloom: UnrealBloomPass;
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400000);
  private bgCamera = new THREE.PerspectiveCamera(55, 1, 0.01, 400000);
  readonly controls: OrbitControls;

  private galaxyScene = new THREE.Scene();
  private galaxyGroup = new THREE.Group();
  private field: GalaxyField | null = null;
  private real: RealStars | null = null;
  private blackHole = new BlackHole();
  private nebula = new Nebula();
  private markers = new Markers();
  private diskGlow = new DiskGlow(BAR_ANGLE);
  private system: SystemScene;
  private labels: Labels;

  private mode: ViewMode = { kind: "galaxy" };
  private flight: Flight | null = null;
  /** Objet suivi en vue galaxie (repère local de la galaxie, qui tourne). */
  private followLocal: THREE.Vector3 | null = null;
  private followWorld = new THREE.Vector3();
  /** Corps suivi en vue système, et son dernier azimut autour de l'étoile. */
  private followBody: BodyRef | null = null;
  private followAngle = 0;

  private galaxy: Galaxy | null = null;
  private settings: Settings | null = null;
  private profile: QualityProfile = QUALITY.medium;
  private comets: RecentFile[] = [];
  private running = new Set<string>();
  private hovered: PickTarget | null = null;
  private selected: PickTarget | null = null;

  private worker: Worker | null = null;
  private fieldKey = "";
  private requestId = 0;
  private timer = new THREE.Timer();
  private time = 0;
  private raf = 0;
  private disposed = false;
  private width = 1;
  private height = 1;
  private dynamicScale = 1;
  private frameTimes: number[] = [];
  private lastAdapt = 0;
  private fpsFrames = 0;
  private fpsSince = performance.now();
  private throttleFps = 0;
  private lastRender = 0;
  private visible = true;
  private resizeObserver: ResizeObserver;
  private pointer = { x: 0, y: 0, downX: 0, downY: 0, down: false, moved: false, dirty: false, inside: false };
  private lastClick = { at: 0, key: "" };

  constructor(
    private canvas: HTMLCanvasElement,
    labelRoot: HTMLElement,
    private events: UniverseEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance", stencil: false });
    this.renderer.setClearColor(0x010207, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.composer = new EffectComposer(this.renderer);
    this.galaxyPass = new RenderPass(this.galaxyScene, this.camera);
    this.systemPass = new RenderPass(new THREE.Scene(), this.camera);
    this.systemPass.clear = false;
    this.systemPass.clearDepth = true;
    this.systemPass.enabled = false;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.4, 0.32);
    this.composer.addPass(this.galaxyPass);
    this.composer.addPass(this.systemPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.zoomSpeed = 1.1;
    this.controls.rotateSpeed = 0.55;
    this.controls.panSpeed = 0.8;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 90000;
    this.controls.addEventListener("start", () => this.cancelFlight());

    this.galaxyScene.add(this.galaxyGroup);
    this.galaxyGroup.add(this.diskGlow.mesh, this.blackHole.group, this.markers.points);
    this.nebula.group.position.set(...ORION_NEBULA);
    this.galaxyGroup.add(this.nebula.group);

    this.system = new SystemScene({ segments: this.profile.planetSegments, octaves: this.profile.noiseOctaves });
    this.systemPass.scene = this.system.scene;

    this.labels = new Labels(
      labelRoot,
      (key, e) => this.onLabelClick(key, e),
      (key) => this.setHover(key ? this.targetFromKey(key) : null),
    );

    // Point de départ : très loin, puis approche vers la vue d'ensemble.
    this.camera.position.copy(OVERVIEW_DIR).multiplyScalar(90000);
    this.controls.target.set(0, 0, 0);
    this.camera.lookAt(0, 0, 0);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.bindPointer();
    document.addEventListener("visibilitychange", this.onVisibility);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.raf = requestAnimationFrame(this.frame);
  }

  // --- Chargement ---

  async loadRealStars(base: string) {
    try {
      this.real = await RealStars.load(base);
      if (this.disposed) return;
      this.galaxyGroup.add(this.real.group);
      this.refreshGalaxyContent();
    } catch (e) {
      this.events.error(`Étoiles réelles indisponibles : ${e instanceof Error ? e.message : e}`);
    }
  }

  private generateField(seed: number, particles: number) {
    const key = `${seed}:${particles}`;
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    const id = ++this.requestId;
    this.worker ??= new Worker(new URL("./galaxy/galaxy.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<{ id: number; data: GalaxyData }>) => {
      if (e.data.id !== this.requestId || this.disposed) return;
      const next = new GalaxyField(e.data.data.light, e.data.data.dust);
      if (this.field) {
        this.galaxyGroup.remove(this.field.group);
        this.field.dispose();
      }
      this.field = next;
      this.galaxyGroup.add(next.group);
      this.events.ready();
    };
    this.worker.onerror = (e) => this.events.error(`Génération de la galaxie : ${e.message}`);
    this.worker.postMessage({ seed, total: particles, id });
  }

  // --- État venu de l'interface ---

  setState(galaxy: Galaxy, settings: Settings) {
    const qualityChanged = !this.settings || this.settings.quality !== settings.quality;
    this.galaxy = galaxy;
    this.settings = settings;
    if (qualityChanged) {
      this.profile = QUALITY[settings.quality];
      // Anticrénelage multi-échantillons des cibles de rendu (bords des planètes, anneaux, orbites).
      for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        rt.samples = this.profile.msaa;
        rt.dispose();
      }
      this.system.dispose();
      this.system = new SystemScene({ segments: this.profile.planetSegments, octaves: this.profile.noiseOctaves });
      this.systemPass.scene = this.system.scene;
      this.resize();
    }
    this.bloom.enabled = settings.bloom;
    this.generateField(galaxy.seed, this.profile.particles);
    if (this.mode.kind === "system" && !findSystem(galaxy, this.mode.systemId)) this.exitSystem();
    this.refreshGalaxyContent();
    this.refreshSystemContent();
  }

  setComets(files: RecentFile[]) {
    this.comets = files;
    this.refreshSystemContent();
  }

  setRunning(ids: Set<string>) {
    this.running = ids;
    this.system.setRunning(ids);
  }

  setSelection(target: PickTarget | null) {
    this.selected = target;
    this.applyHighlights();
  }

  setHover(target: PickTarget | null) {
    if (sameTarget(target, this.hovered)) return;
    this.hovered = target;
    this.applyHighlights();
    this.canvas.style.cursor = target ? "pointer" : "";
    this.events.hover(target);
  }

  pulsePlanet(id: string) {
    this.system.pulse(id);
  }

  get view(): ViewMode {
    return this.mode;
  }

  /** Vol de caméra en cours (utile aux captures automatiques). */
  get flying(): boolean {
    return !!this.flight;
  }

  /** Pas de temps maximal par image : relevé pour les captures en rendu logiciel, très lent. */
  maxStep = 0.1;

  /** Étoiles réelles nommées (vide tant que le catalogue n'est pas chargé). */
  get namedStars(): readonly NamedStar[] {
    return this.real?.named ?? [];
  }

  realStar(hygId: number): NamedStar | undefined {
    return this.real?.byHyg.get(hygId);
  }

  // --- Positions ---

  /** Position d'un système dans le repère local de la galaxie. */
  systemLocal(s: StarSystem): THREE.Vector3 | null {
    const a = s.anchor;
    if (a.kind === "home") return new THREE.Vector3(...SUN);
    if (a.kind === "arm") {
      const h = ((hash32(s.id) % 1000) / 1000 - 0.5) * 80;
      return new THREE.Vector3(...armPoint(a.arm, a.t, a.offset, h));
    }
    const star = this.real?.byHyg.get(a.hygId);
    return star ? new THREE.Vector3(...SUN).add(star.offset) : null;
  }

  private systemStarColor(s: StarSystem): [number, number, number] {
    if (s.color) return hexToRgb(s.color);
    // Le vrai Soleil (B-V 0,65) paraît blanc ; on force un peu le doré pour le distinguer au premier coup d'œil.
    if (s.anchor.kind === "home") return bvToRgb(0.95);
    if (s.anchor.kind === "real") {
      const star = this.real?.byHyg.get(s.anchor.hygId);
      if (star) return bvToRgb(star.bv);
    }
    return bvToRgb(STATUS_BV[s.status]);
  }

  private systemStarRadius(s: StarSystem): number {
    if (s.anchor.kind === "real") {
      const star = this.real?.byHyg.get(s.anchor.hygId);
      if (star) return THREE.MathUtils.clamp(5 * Math.pow(10, -0.08 * (star.absmag - 4.8)), 2.5, 11);
    }
    return s.status === "dormant" ? 2 : s.status === "paused" ? 3.4 : 5;
  }

  private armColor(slot: ArmSlot | null): string {
    return this.galaxy?.arms.find((a) => a.slot === slot)?.color ?? "#9fb4ff";
  }

  private systemArm(s: StarSystem): ArmSlot | null {
    return s.anchor.kind === "arm" ? s.anchor.arm : s.anchor.kind === "home" ? null : "orion";
  }

  // --- Contenu ---

  private refreshGalaxyContent() {
    const g = this.galaxy;
    if (!g) return;
    const specs: MarkerSpec[] = [];
    for (const s of g.systems) {
      const pos = this.systemLocal(s);
      if (!pos) continue;
      const [r, gg, b] = this.systemStarColor(s);
      const k = s.status === "dormant" ? 0.8 : 1.6;
      specs.push({ id: s.id, position: pos, color: [r * k, gg * k, b * k], size: s.anchor.kind === "home" ? 3 : 2.4 });
    }
    this.markers.set(specs);
    this.applyHighlights();
    if (this.mode.kind === "galaxy") this.labels.set(this.galaxyLabels());
  }

  private refreshSystemContent() {
    const g = this.galaxy;
    if (!g || this.mode.kind !== "system") return;
    const s = findSystem(g, this.mode.systemId);
    if (!s) return;
    this.system.build({
      system: s,
      armColor: this.armColor(this.systemArm(s)),
      starColor: this.systemStarColor(s),
      starRadius: this.systemStarRadius(s),
      comets: s.anchor.kind === "home" ? this.comets : [],
      now: Date.now(),
    });
    this.system.setRunning(this.running);
    const local = this.systemLocal(s);
    this.system.setStarfield(!local || local.distanceTo(v1.set(...SUN)) > 1500);
    this.controls.maxDistance = this.system.outerRadius * 3;
    this.labels.set(this.systemLabels(s));
    this.applyHighlights();
  }

  private toWorld(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).applyMatrix4(this.galaxyGroup.matrixWorld);
  }

  private galaxyLabels(): LabelSpec[] {
    const g = this.galaxy!;
    const out: LabelSpec[] = [];
    const cam = () => this.camera.position;
    for (const s of g.systems) {
      const local = this.systemLocal(s);
      if (!local) continue;
      const arm = g.arms.find((a) => a.slot === this.systemArm(s));
      const n = s.planets.length;
      out.push({
        key: `sys:${s.id}`,
        kind: "system",
        text: s.name,
        sub: s.anchor.kind === "home" ? `Accueil · ${n} planète${n > 1 ? "s" : ""}` : `${arm?.label ?? "Étoile réelle"} · ${n} planète${n > 1 ? "s" : ""}`,
        color: s.anchor.kind === "home" ? "#ffd27a" : (arm?.color ?? "#cfe0ff"),
        priority: s.anchor.kind === "home" ? 70 : 60,
        position: (o) => this.toWorld(local, o),
        maxDistance: 80000,
        lift: 16,
      });
    }
    for (const arm of g.arms) {
      const local = new THREE.Vector3(...armPoint(arm.slot, arm.slot === "orion" ? 0.25 : 0.62, 1.4));
      out.push({
        key: `arm:${arm.slot}`,
        kind: "arm",
        text: arm.label,
        sub: ARM_ASTRO_NAMES[arm.slot],
        color: arm.color,
        priority: 40,
        position: (o) => this.toWorld(local, o),
        // Visibles seulement quand on regarde la galaxie de haut, pas depuis l'intérieur du disque.
        opacity: () => THREE.MathUtils.smoothstep(this.camera.position.distanceTo(this.controls.target), arm.slot === "orion" ? 2500 : 6000, arm.slot === "orion" ? 4000 : 10000),
      });
    }
    out.push({
      key: "bh",
      kind: "special",
      text: "Sagittarius A*",
      sub: `Trou noir · ${g.archive.length} archivé${g.archive.length > 1 ? "s" : ""}`,
      icon: "◉",
      priority: 50,
      position: (o) => this.toWorld(v2.set(0, 0, 0), o),
      lift: 22,
    });
    out.push({
      key: "neb",
      kind: "special",
      text: "Nébuleuse d'Orion",
      sub: "Boîte de réception",
      icon: "✦",
      priority: 48,
      position: (o) => this.toWorld(v2.set(...ORION_NEBULA), o),
      maxDistance: 7000,
    });
    if (this.real) {
      const sunLocal = new THREE.Vector3(...SUN);
      const nearSun = () => {
        const d = this.toWorld(sunLocal, v2).distanceTo(cam());
        return 1 - THREE.MathUtils.smoothstep(d, 25, 90);
      };
      const adopted = new Set(g.systems.flatMap((s) => (s.anchor.kind === "real" ? [s.anchor.hygId] : [])));
      const placed: THREE.Vector3[] = [];
      for (const star of this.real.named) {
        if (adopted.has(star.hygId) || star.mag > 1.6) continue;
        // Étoiles doubles (α Centauri A et B…) : une seule étiquette, celle de la plus brillante.
        if (placed.some((p) => p.distanceTo(star.offset) < 0.5)) continue;
        placed.push(star.offset);
        const local = sunLocal.clone().add(star.offset);
        out.push({
          key: `star:${star.hygId}`,
          kind: "star",
          text: star.name,
          priority: 20 - star.mag,
          position: (o) => this.toWorld(local, o),
          opacity: nearSun,
          lift: 10,
        });
      }
      for (const [i, c] of this.real.constellationLabels.entries()) {
        const local = sunLocal.clone().add(c.offset);
        out.push({
          key: `con:${i}`,
          kind: "constellation",
          text: c.name,
          priority: 5,
          position: (o) => this.toWorld(local, o),
          opacity: () => this.real!.constellationOpacity,
          clickable: false,
          lift: 0,
        });
      }
    }
    return out;
  }

  private systemLabels(s: StarSystem): LabelSpec[] {
    const out: LabelSpec[] = [];
    out.push({
      key: `st:${s.id}`,
      kind: "system",
      text: s.name,
      sub: s.anchor.kind === "real" ? s.anchor.name : undefined,
      color: `#${new THREE.Color(...this.systemStarColor(s)).getHexString()}`,
      priority: 70,
      position: (o) => o.set(0, this.system.starRadius * 1.7, 0),
      lift: 8,
    });
    for (const a of this.system.anchors()) {
      const ref = a.ref;
      const planet = ref.type === "planet" ? s.planets.find((p) => p.id === ref.id) : undefined;
      out.push({
        key: ref.type === "planet" ? `pl:${ref.id}` : ref.type === "moon" ? `mo:${ref.planetId}:${ref.id}` : `co:${ref.id}`,
        kind: ref.type === "planet" ? "planet" : ref.type === "moon" ? "moon" : "comet",
        text: a.name,
        icon: ref.type === "comet" ? "☄" : a.icon,
        sub: planet && this.running.has(planet.id) ? "● ouverte" : undefined,
        priority: ref.type === "planet" ? 50 : ref.type === "moon" ? 25 : 15,
        position: (o) => this.system.positionOf(ref, o).add(v2.set(0, a.radius * 1.15, 0)),
        maxDistance: ref.type === "planet" ? undefined : ref.type === "moon" ? 45 : 160,
        lift: 6,
      });
    }
    return out;
  }

  private applyHighlights() {
    const sel = this.selected;
    const hov = this.hovered;
    this.markers.setStates(hov?.kind === "system" ? hov.id : null, sel?.kind === "system" ? sel.id : null);
    this.system.setHighlights(hov?.kind === "planet" ? hov.id : null, sel?.kind === "planet" ? sel.id : null);
    this.labels.highlighted = sel ? this.keyFromTarget(sel) : null;
  }

  // --- Navigation ---

  private cancelFlight() {
    this.flight?.cancel();
    this.flight = null;
  }

  private fly(opts: ConstructorParameters<typeof Flight>[2]) {
    this.cancelFlight();
    this.flight = new Flight(this.camera, this.controls.target, opts);
  }

  private currentDir(): THREE.Vector3 {
    return v1.copy(this.camera.position).sub(this.controls.target).normalize().clone();
  }

  /** Direction de visée agréable : on garde l'azimut courant mais on remonte au-dessus du plan. */
  private elevated(minY: number): THREE.Vector3 {
    const d = this.currentDir();
    if (d.y < minY) {
      d.y = minY;
      d.normalize();
    }
    return d;
  }

  overview(duration = 2.2) {
    if (this.mode.kind === "system") this.exitSystem(false);
    this.followLocal = null;
    this.fly({ target: () => new THREE.Vector3(), distance: OVERVIEW_DISTANCE, direction: OVERVIEW_DIR, duration });
  }

  flyToArm(slot: ArmSlot) {
    if (this.mode.kind === "system") this.exitSystem(false);
    const local = new THREE.Vector3(...armPoint(slot, slot === "orion" ? 0.5 : 0.45));
    this.followLocal = local;
    this.fly({ target: () => this.toWorld(local), distance: slot === "orion" ? 2600 : 6500, direction: this.elevated(0.55), duration: 2 });
  }

  flyToBlackHole() {
    if (this.mode.kind === "system") this.exitSystem(false);
    const local = new THREE.Vector3();
    this.followLocal = local;
    this.fly({ target: () => this.toWorld(local), distance: 230, direction: new THREE.Vector3(0.2, 0.28, 1).normalize(), duration: 2.4, fovKick: 10 });
  }

  flyToNebula() {
    if (this.mode.kind === "system") this.exitSystem(false);
    const local = new THREE.Vector3(...ORION_NEBULA);
    this.followLocal = local;
    this.fly({ target: () => this.toWorld(local), distance: 48, direction: this.elevated(0.2), duration: 2.2, fovKick: 10 });
  }

  flyToRealStar(hygId: number) {
    const star = this.real?.byHyg.get(hygId);
    if (!star) return;
    if (this.mode.kind === "system") this.exitSystem(false);
    const local = new THREE.Vector3(...SUN).add(star.offset);
    this.followLocal = local;
    this.fly({ target: () => this.toWorld(local), distance: 3, duration: 2, fovKick: 12 });
  }

  /** Vol jusqu'au système puis plongée dans sa vue rapprochée. */
  enterSystem(id: string) {
    const s = this.galaxy && findSystem(this.galaxy, id);
    if (!s) return;
    if (this.mode.kind === "system") {
      if (this.mode.systemId === id) return;
      this.exitSystem(false);
    }
    const local = this.systemLocal(s);
    if (!local) return;
    this.followLocal = local;
    const distance = this.toWorld(local, v2).distanceTo(this.camera.position);
    this.fly({
      target: () => this.toWorld(local),
      distance: 0.5,
      direction: this.elevated(0.3),
      duration: THREE.MathUtils.clamp(0.9 + Math.log10(Math.max(distance, 1)) * 0.45, 1, 3),
      fovKick: 16,
      onDone: () => this.switchToSystem(id),
    });
  }

  private switchToSystem(id: string) {
    this.events.transition();
    const dir = this.elevated(0.35);
    this.mode = { kind: "system", systemId: id };
    this.flight = null;
    this.followLocal = this.galaxy ? this.systemLocal(findSystem(this.galaxy, id)!) : null;
    this.followBody = null;
    this.galaxyPass.camera = this.bgCamera;
    this.systemPass.enabled = true;
    this.system.reset();
    this.refreshSystemContent();
    this.camera.near = 0.05;
    this.camera.far = 6000;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = 0.8;
    const outer = this.system.outerRadius;
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir).multiplyScalar(outer * 3.2);
    this.fly({ target: () => new THREE.Vector3(), distance: this.systemViewDistance(), direction: dir, duration: 1.5 });
    this.events.mode(this.mode);
  }

  /** Retour à la galaxie, en reculant depuis le système. */
  exitSystem(animate = true) {
    if (this.mode.kind !== "system" || !this.galaxy) return;
    const s = findSystem(this.galaxy, this.mode.systemId);
    const local = s ? this.systemLocal(s) : null;
    this.events.transition();
    const dir = this.currentDir();
    this.mode = { kind: "galaxy" };
    this.followBody = null;
    this.galaxyPass.camera = this.camera;
    this.systemPass.enabled = false;
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 90000;
    const world = local ? this.toWorld(local) : new THREE.Vector3();
    this.followLocal = local;
    this.controls.target.copy(world);
    this.camera.position.copy(world).addScaledVector(dir, 0.6);
    this.cancelFlight();
    this.labels.set(this.galaxyLabels());
    this.applyHighlights();
    if (animate) this.fly({ target: () => (local ? this.toWorld(local) : new THREE.Vector3()), distance: 420, direction: this.elevated(0.35), duration: 1.8 });
    this.events.mode(this.mode);
  }

  /** Recul qui montre tout le système sans que l'étoile écrase l'image. */
  private systemViewDistance(): number {
    return Math.max(this.system.outerRadius * 1.3, this.system.starRadius * 16);
  }

  /** En vue système : cadre un corps et le suit dans son orbite. */
  focusBody(ref: BodyRef) {
    if (this.mode.kind !== "system") return;
    const radius = ref.type === "planet" ? this.system.planetRadius(ref.id) : ref.type === "star" ? this.system.starRadius : 0.4;
    this.followBody = ref.type === "star" ? null : ref;
    let direction = this.elevated(0.25);
    if (ref.type !== "star") {
      // On se place du côté jour, de trois quarts : la planète apparaît éclairée, avec son terminateur.
      const pos = this.system.positionOf(ref, new THREE.Vector3());
      const toStar = pos.clone().negate().setY(0).normalize();
      const tangent = new THREE.Vector3(-toStar.z, 0, toStar.x);
      direction = toStar.multiplyScalar(0.7).addScaledVector(tangent, 0.55).add(new THREE.Vector3(0, 0.38, 0)).normalize();
      this.followAngle = Math.atan2(pos.z, pos.x);
    }
    this.fly({
      target: () => this.system.positionOf(ref, new THREE.Vector3()),
      distance: ref.type === "star" ? this.systemViewDistance() : radius * 7 + 3,
      direction,
      duration: 1.3,
    });
  }

  // --- Sélection à la souris ---

  private bindPointer() {
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => {
      this.pointer.down = true;
      this.pointer.moved = false;
      this.pointer.downX = e.clientX;
      this.pointer.downY = e.clientY;
    });
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect();
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
      this.pointer.dirty = true;
      this.pointer.inside = true;
      if (this.pointer.down && Math.hypot(e.clientX - this.pointer.downX, e.clientY - this.pointer.downY) > 5) this.pointer.moved = true;
    });
    c.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
      this.setHover(null);
    });
    c.addEventListener("pointerup", (e) => {
      const wasClick = this.pointer.down && !this.pointer.moved && e.button === 0;
      this.pointer.down = false;
      if (!wasClick) return;
      const r = c.getBoundingClientRect();
      const target = this.pickAt(e.clientX - r.left, e.clientY - r.top);
      this.handleClick(target);
    });
    c.addEventListener(
      "wheel",
      (e) => {
        // Molette au bout de la course : on change d'échelle.
        const d = this.camera.position.distanceTo(this.controls.target);
        if (this.mode.kind === "system" && e.deltaY > 0 && d >= this.controls.maxDistance * 0.97 && !this.flight) this.exitSystem();
        else if (this.mode.kind === "galaxy" && e.deltaY < 0 && d <= 0.9 && !this.flight) {
          const sel = this.selected;
          if (sel?.kind === "system") this.enterSystem(sel.id);
        }
      },
      { passive: true },
    );
  }

  private handleClick(target: PickTarget | null) {
    const key = target ? this.keyFromTarget(target) : "";
    const now = performance.now();
    const double = key !== "" && key === this.lastClick.key && now - this.lastClick.at < 350;
    this.lastClick = { at: double ? 0 : now, key };
    this.events.select(target, double);
  }

  private onLabelClick(key: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dblclick") return;
    this.handleClick(this.targetFromKey(key));
  }

  keyFromTarget(t: PickTarget): string {
    switch (t.kind) {
      case "system":
        return this.mode.kind === "system" ? `st:${t.id}` : `sys:${t.id}`;
      case "systemStar":
        return `st:${t.id}`;
      case "arm":
        return `arm:${t.slot}`;
      case "planet":
        return `pl:${t.id}`;
      case "moon":
        return `mo:${t.planetId}:${t.id}`;
      case "comet":
        return `co:${t.path}`;
      case "realStar":
        return `star:${t.hygId}`;
      case "blackhole":
        return "bh";
      case "nebula":
        return "neb";
    }
  }

  private targetFromKey(key: string): PickTarget | null {
    const [kind, ...rest] = key.split(":");
    const id = rest.join(":");
    switch (kind) {
      case "sys":
        return { kind: "system", id };
      case "st":
        return { kind: "systemStar", id };
      case "arm":
        return { kind: "arm", slot: id as ArmSlot };
      case "pl":
        return { kind: "planet", id };
      case "mo": {
        const [planetId, ...moon] = rest;
        return { kind: "moon", id: moon.join(":"), planetId };
      }
      case "co":
        return { kind: "comet", path: id };
      case "star": {
        const star = this.real?.byHyg.get(Number(id));
        return star ? { kind: "realStar", hygId: star.hygId, name: star.name } : null;
      }
      case "bh":
        return { kind: "blackhole" };
      case "neb":
        return { kind: "nebula" };
    }
    return null;
  }

  /** Objet sous un point de l'écran (coordonnées CSS relatives au canevas). */
  pickAt(x: number, y: number): PickTarget | null {
    if (this.mode.kind === "system") return this.pickSystem(x, y);
    return this.pickGalaxy(x, y);
  }

  private project(world: THREE.Vector3): { x: number; y: number } | null {
    v1.copy(world).project(this.camera);
    if (v1.z > 1 || v1.z < -1) return null;
    return { x: (v1.x * 0.5 + 0.5) * this.width, y: (-v1.y * 0.5 + 0.5) * this.height };
  }

  private pickGalaxy(x: number, y: number): PickTarget | null {
    const g = this.galaxy;
    if (!g) return null;
    let best: PickTarget | null = null;
    let bestD = Infinity;
    const consider = (world: THREE.Vector3, radius: number, target: PickTarget) => {
      const p = this.project(world);
      if (!p) return;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < radius && d < bestD) {
        bestD = d;
        best = target;
      }
    };
    for (const s of g.systems) {
      const local = this.systemLocal(s);
      if (local) consider(this.toWorld(local, v2), 18, { kind: "system", id: s.id });
    }
    const camDist = this.camera.position.distanceTo(this.toWorld(v2.set(0, 0, 0)));
    if (camDist < 9000) consider(this.toWorld(v2.set(0, 0, 0)), 26, { kind: "blackhole" });
    const nebWorld = this.toWorld(v2.set(...ORION_NEBULA));
    if (nebWorld.distanceTo(this.camera.position) < 7000) consider(nebWorld, 26, { kind: "nebula" });
    if (this.real && !best) {
      const sun = new THREE.Vector3(...SUN);
      for (const star of this.real.named) {
        const world = this.toWorld(v1.copy(sun).add(star.offset), new THREE.Vector3());
        const d = world.distanceTo(this.camera.position);
        const apparent = star.absmag + 5 * (Math.log10(Math.max(d, 0.01)) - 1);
        if (apparent < 4.5) consider(world, 12, { kind: "realStar", hygId: star.hygId, name: star.name });
      }
    }
    return best;
  }

  private raycaster = new THREE.Raycaster();

  private pickSystem(x: number, y: number): PickTarget | null {
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.system.pickables(), false);
    const toTarget = (ref: BodyRef): PickTarget =>
      ref.type === "planet" ? { kind: "planet", id: ref.id } : ref.type === "moon" ? { kind: "moon", id: ref.id, planetId: ref.planetId! } : ref.type === "comet" ? { kind: "comet", path: ref.id } : { kind: "systemStar", id: ref.id };
    if (hits.length) return toTarget(hits[0].object.userData.ref as BodyRef);
    // Petits corps : tolérance de quelques pixels autour de leur position projetée.
    let best: PickTarget | null = null;
    let bestD = 14;
    for (const a of this.system.anchors()) {
      const p = this.project(a.position);
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = toTarget(a.ref);
      }
    }
    return best;
  }

  // --- Boucle ---

  private onVisibility = () => {
    this.visible = document.visibilityState === "visible";
    if (this.visible) this.timer.reset();
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
    this.events.error("Le processeur graphique a été réinitialisé : recharge la fenêtre si l'affichage ne revient pas.");
  };

  /** Limite la cadence (fenêtre en arrière-plan, mode fond d'écran). 0 = pas de limite. */
  setThrottle(fps: number) {
    this.throttleFps = fps;
  }

  resize() {
    const parent = this.canvas.parentElement ?? this.canvas;
    this.width = Math.max(1, parent.clientWidth);
    this.height = Math.max(1, parent.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.profile.maxPixelRatio) * this.dynamicScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(this.width, this.height);
    this.bloom.resolution.set(this.width * ratio * this.profile.bloomScale, this.height * ratio * this.profile.bloomScale);
    for (const c of [this.camera, this.bgCamera]) {
      c.aspect = this.width / this.height;
      c.updateProjectionMatrix();
    }
  }

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    if (!this.visible) return;
    if (this.throttleFps > 0 && now - this.lastRender < 1000 / this.throttleFps - 2) return;
    const frameStart = performance.now();
    this.lastRender = now;
    this.timer.update(now);
    const dt = Math.min(this.maxStep, this.timer.getDelta());
    const s = this.settings;
    const motion = !s?.reducedMotion;
    this.time += dt;

    // Rotation de la galaxie calée sur l'heure réelle : un tour par jour.
    if (s?.galaxyRotation && motion) {
      const d = new Date();
      const ms = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) * 1000 + d.getMilliseconds();
      this.galaxyGroup.rotation.y = -(ms / DAY_MS) * Math.PI * 2;
    }
    this.galaxyGroup.updateMatrixWorld(true);

    // Suivi de l'objet visé, entraîné par la rotation galactique ou son orbite.
    if (this.mode.kind === "galaxy" && this.followLocal && !this.flight) {
      this.toWorld(this.followLocal, v1);
      if (this.followWorld.lengthSq() > 0) {
        v2.subVectors(v1, this.followWorld);
        if (v2.lengthSq() < 1e6) {
          this.camera.position.add(v2);
          this.controls.target.add(v2);
        }
      }
      this.followWorld.copy(v1);
    } else if (this.mode.kind === "galaxy" && this.followLocal) {
      this.toWorld(this.followLocal, this.followWorld);
    }

    if (this.mode.kind === "system") this.system.update(dt, this.time, !!s?.orbitMotion && motion);
    if (this.mode.kind === "system" && this.followBody && !this.flight) {
      // Suivi dans le repère qui tourne avec la planète : l'éclairage vu de la caméra ne change pas.
      this.system.positionOf(this.followBody, v1);
      const angle = Math.atan2(v1.z, v1.x);
      const delta = angle - this.followAngle;
      this.followAngle = angle;
      v2.subVectors(this.camera.position, this.controls.target).applyAxisAngle(Y_AXIS, -delta);
      this.controls.target.copy(v1);
      this.camera.position.copy(v1).add(v2);
    } else if (this.mode.kind === "system" && this.followBody) {
      this.system.positionOf(this.followBody, v1);
      this.followAngle = Math.atan2(v1.z, v1.x);
    }

    if (this.flight) {
      this.flight.step(dt, this.controls.target);
      if (this.flight?.done) this.flight = null;
      if (this.mode.kind === "galaxy" && this.followLocal) this.toWorld(this.followLocal, this.followWorld);
    } else {
      this.controls.update(dt);
    }

    const camDist = this.camera.position.distanceTo(this.controls.target);
    if (this.mode.kind === "galaxy") {
      this.camera.near = THREE.MathUtils.clamp(camDist * 0.002, 0.0005, 5);
      this.camera.far = 400000;
      this.camera.updateProjectionMatrix();
    }

    // Caméra de fond : la galaxie vue depuis la position du système, dans la même direction.
    let viewCam = this.camera;
    if (this.mode.kind === "system" && this.followLocal) {
      this.toWorld(this.followLocal, this.bgCamera.position);
      this.bgCamera.quaternion.copy(this.camera.quaternion);
      this.bgCamera.fov = this.camera.fov;
      this.bgCamera.near = 0.01;
      this.bgCamera.updateProjectionMatrix();
      this.bgCamera.updateMatrixWorld();
      viewCam = this.bgCamera;
    }
    this.updateGalaxyUniforms(viewCam, dt);

    if (this.pointer.dirty && this.pointer.inside && !this.pointer.down) {
      this.pointer.dirty = false;
      this.setHover(this.pickAt(this.pointer.x, this.pointer.y));
    }
    this.labels.hidden = s ? !s.showLabels : false;
    this.labels.update(this.camera, this.width, this.height);
    this.composer.render(dt);
    this.measure(now, performance.now() - frameStart);
  };

  private updateGalaxyUniforms(cam: THREE.PerspectiveCamera, dt: number) {
    const ratio = this.renderer.getPixelRatio();
    const scale = (this.height * ratio) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    const camWorld = cam.getWorldPosition(v1);
    const sunWorld = this.toWorld(v2.set(...SUN));
    const dSun = camWorld.distanceTo(sunWorld);
    this.field?.update(scale, 160 * ratio, ratio, dSun);
    this.real?.update(dSun, ratio, !!this.settings?.showConstellations && this.mode.kind === "galaxy", dt);
    this.diskGlow.update(cam, this.toWorld(v2.set(0, 0, 0)));
    const dCore = camWorld.length();
    this.blackHole.update(this.time, cam, dCore);
    const nebWorld = this.toWorld(new THREE.Vector3(...ORION_NEBULA));
    this.nebula.update(scale, this.time, camWorld.distanceTo(nebWorld));
    this.markers.update(scale, ratio, this.time);
    this.markers.points.visible = this.mode.kind === "galaxy";
  }

  /** Mesure la cadence et ajuste la résolution si l'appareil peine. */
  private measure(now: number, cpuMs: number) {
    this.fpsFrames++;
    this.frameTimes.push(cpuMs);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (now - this.fpsSince >= 1000) {
      const fps = (this.fpsFrames * 1000) / (now - this.fpsSince);
      this.events.stats(Math.round(fps), this.renderer.getPixelRatio());
      this.fpsFrames = 0;
      this.fpsSince = now;
      if (this.throttleFps === 0 && now - this.lastAdapt > 3000) {
        if (fps < 42 && this.dynamicScale > 0.6) {
          this.dynamicScale = Math.max(0.6, this.dynamicScale - 0.1);
          this.lastAdapt = now;
          this.resize();
        } else if (fps > 57 && this.dynamicScale < 1) {
          this.dynamicScale = Math.min(1, this.dynamicScale + 0.05);
          this.lastAdapt = now;
          this.resize();
        }
      }
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.worker?.terminate();
    this.controls.dispose();
    this.labels.clear();
    this.field?.dispose();
    this.real?.dispose();
    this.blackHole.dispose();
    this.nebula.dispose();
    this.markers.dispose();
    this.diskGlow.dispose();
    this.system.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
