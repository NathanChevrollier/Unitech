import * as THREE from "three";

// Étiquettes HTML posées sur la scène 3D. Projetées à chaque image, elles se masquent quand elles
// sont derrière la caméra, trop loin ou quand une étiquette plus importante occupe déjà la place.

export interface LabelSpec {
  key: string;
  text: string;
  sub?: string;
  icon?: string;
  /** Couleur d'accent (pastille). */
  color?: string;
  kind: "system" | "arm" | "special" | "planet" | "moon" | "comet" | "star" | "constellation";
  priority: number;
  /** Position monde (appelée à chaque image). */
  position: (out: THREE.Vector3) => THREE.Vector3;
  /** Distance caméra au-delà de laquelle l'étiquette disparaît. */
  maxDistance?: number;
  minDistance?: number;
  /** Décalage vertical en pixels (au-dessus de l'objet). */
  lift?: number;
  opacity?: () => number;
  clickable?: boolean;
}

interface Entry {
  spec: LabelSpec;
  el: HTMLElement;
  shown: boolean;
}

const v = new THREE.Vector3();
const camPos = new THREE.Vector3();

export class Labels {
  private entries = new Map<string, Entry>();
  private order: Entry[] = [];
  hidden = false;
  highlighted: string | null = null;

  constructor(
    private root: HTMLElement,
    private onClick: (key: string, e: MouseEvent) => void,
    private onHover: (key: string | null) => void,
  ) {}

  set(specs: LabelSpec[]) {
    const keep = new Set(specs.map((s) => s.key));
    for (const [key, e] of this.entries) {
      if (!keep.has(key)) {
        e.el.remove();
        this.entries.delete(key);
      }
    }
    for (const spec of specs) {
      let e = this.entries.get(spec.key);
      if (!e) {
        const el = document.createElement(spec.clickable === false ? "div" : "button");
        el.className = `label label-${spec.kind}`;
        el.dataset.key = spec.key;
        if (el instanceof HTMLButtonElement) {
          el.type = "button";
          el.tabIndex = -1;
          el.addEventListener("click", (ev) => this.onClick(spec.key, ev));
          el.addEventListener("dblclick", (ev) => this.onClick(spec.key, ev));
          el.addEventListener("pointerenter", () => this.onHover(spec.key));
          el.addEventListener("pointerleave", () => this.onHover(null));
        }
        el.style.display = "none";
        this.root.appendChild(el);
        e = { spec, el, shown: false };
        this.entries.set(spec.key, e);
      }
      e.spec = spec;
      this.render(e);
    }
    this.order = [...this.entries.values()].sort((a, b) => b.spec.priority - a.spec.priority);
  }

  private render(e: Entry) {
    const { spec, el } = e;
    const sig = [spec.text, spec.sub, spec.icon, spec.color].join("\u0000");
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.replaceChildren();
    if (spec.color) {
      const dot = document.createElement("span");
      dot.className = "label-dot";
      dot.style.background = spec.color;
      dot.style.boxShadow = `0 0 10px ${spec.color}`;
      el.appendChild(dot);
    }
    if (spec.icon) {
      const icon = spec.icon.startsWith("data:") ? document.createElement("img") : document.createElement("span");
      icon.className = "label-icon";
      if (icon instanceof HTMLImageElement) {
        icon.src = spec.icon;
        icon.alt = "";
        icon.draggable = false;
      } else icon.textContent = spec.icon;
      el.appendChild(icon);
    }
    const text = document.createElement("span");
    text.className = "label-text";
    const name = document.createElement("span");
    name.className = "label-name";
    name.textContent = spec.text;
    text.appendChild(name);
    if (spec.sub) {
      const sub = document.createElement("span");
      sub.className = "label-sub";
      sub.textContent = spec.sub;
      text.appendChild(sub);
    }
    el.appendChild(text);
  }

  update(camera: THREE.PerspectiveCamera, width: number, height: number) {
    camera.getWorldPosition(camPos);
    const placed: [number, number, number, number][] = [];
    const order = this.highlighted ? [...this.order].sort((a, b) => Number(b.spec.key === this.highlighted) - Number(a.spec.key === this.highlighted)) : this.order;
    for (const e of order) {
      const s = e.spec;
      let visible = !this.hidden;
      let x = 0;
      let y = 0;
      let alpha = 1;
      if (visible) {
        s.position(v);
        const dist = v.distanceTo(camPos);
        if ((s.maxDistance != null && dist > s.maxDistance) || (s.minDistance != null && dist < s.minDistance)) visible = false;
        alpha = s.opacity ? s.opacity() : 1;
        if (alpha < 0.05) visible = false;
        if (visible) {
          v.project(camera);
          if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) visible = false;
          x = (v.x * 0.5 + 0.5) * width;
          y = (-v.y * 0.5 + 0.5) * height - (s.lift ?? 14);
        }
      }
      if (visible) {
        // Évitement : rectangle approximatif, centré horizontalement au-dessus du point. L'étiquette
        // de la sélection est toujours affichée, et réserve sa place.
        const w = Math.min(260, s.text.length * 7.5 + (s.icon ? 26 : 0) + (s.color ? 14 : 0) + 18);
        const h = s.sub ? 34 : 22;
        const rect: [number, number, number, number] = [x - w / 2, y - h, x + w / 2, y];
        const selected = e.spec.key === this.highlighted;
        if (!selected && placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1])) visible = false;
        else placed.push(rect);
      }
      if (visible !== e.shown) {
        e.el.style.display = visible ? "" : "none";
        e.shown = visible;
      }
      if (visible) {
        e.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
        e.el.style.opacity = alpha.toFixed(2);
        e.el.classList.toggle("is-highlighted", e.spec.key === this.highlighted);
      }
    }
  }

  clear() {
    for (const e of this.entries.values()) e.el.remove();
    this.entries.clear();
    this.order = [];
  }
}
