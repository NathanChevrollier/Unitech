import { defaultWorkspace } from "../model/defaults";
import { normalizeWorkspace } from "../model/normalize";
import type { Workspace } from "../model/types";
import type { Bridge, DiscoveredApp, Snapshot } from "./bridge";

// Mode navigateur : l'espace de travail vit dans le stockage local, seules les URL se lancent.

const KEY = "unitech.workspace.v1";
const DESKTOP_ONLY = "Disponible dans l'application de bureau Unitech.";

function read(): Workspace | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeWorkspace(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const WEB_APPS: [string, string, string[]][] = [
  ["GitHub", "https://github.com", ["Development"]],
  ["Stack Overflow", "https://stackoverflow.com", ["Development"]],
  ["MDN Web Docs", "https://developer.mozilla.org", ["Development"]],
  ["YouTube", "https://www.youtube.com", ["AudioVideo"]],
  ["Figma", "https://www.figma.com", ["Graphics"]],
  ["Spotify", "https://open.spotify.com", ["Audio"]],
  ["Gmail", "https://mail.google.com", ["Email"]],
  ["Wikipédia", "https://fr.wikipedia.org", ["Network"]],
  ["Steam", "https://store.steampowered.com", ["Game"]],
  ["NASA", "https://www.nasa.gov", ["Utility"]],
];

const started = Date.now();

export const webBridge: Bridge = {
  kind: "web",
  async loadWorkspace() {
    const ws = read();
    return { workspace: ws ?? defaultWorkspace(), created: !ws, recovered: false };
  },
  async saveWorkspace(ws) {
    const clean = normalizeWorkspace(ws);
    try {
      localStorage.setItem(KEY, JSON.stringify(clean));
    } catch {
      // Stockage indisponible (navigation privée) : la session reste utilisable, sans persistance.
    }
    return clean;
  },
  async exportWorkspace(ws) {
    const blob = new Blob([JSON.stringify(ws, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "unitech-galaxie.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return true;
  },
  importWorkspace() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        try {
          resolve(normalizeWorkspace(JSON.parse(await file.text())));
        } catch {
          resolve(null);
        }
      };
      input.click();
    });
  },
  async launch(target) {
    if (target.kind !== "url") throw new Error(DESKTOP_ONLY);
    if (!/^(https?|mailto):/i.test(target.value)) throw new Error("Adresse refusée dans le navigateur.");
    window.open(target.value, "_blank", "noopener,noreferrer");
  },
  async discoverApps(): Promise<DiscoveredApp[]> {
    return WEB_APPS.map(([name, value, categories]) => ({ name, target: { kind: "url", value }, categories }));
  },
  async describePath() {
    throw new Error(DESKTOP_ONLY);
  },
  async pickPath() {
    throw new Error(DESKTOP_ONLY);
  },
  async systemSnapshot(): Promise<Snapshot> {
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    return {
      cpu: NaN,
      cores: navigator.hardwareConcurrency || 0,
      memoryUsed: mem?.usedJSHeapSize ?? 0,
      memoryTotal: mem?.jsHeapSizeLimit ?? 0,
      uptime: Math.round((Date.now() - started) / 1000),
      host: location.hostname || "navigateur",
      os: navigator.platform || "Web",
    };
  },
  async runningPlanets() {
    return [];
  },
  async recentDownloads() {
    return [];
  },
  async setShortcut() {},
  async getAutostart() {
    return false;
  },
  async setAutostart() {
    throw new Error(DESKTOP_ONLY);
  },
  async setWallpaper() {
    throw new Error(DESKTOP_ONLY);
  },
  async raiseWallpaper() {},
  async confirm(message) {
    return window.confirm(message);
  },
  async hide() {},
  async quit() {},
  onLauncher: () => () => {},
  onLaunched: () => () => {},
  onWallpaper: () => () => {},
  onFileDrop: () => () => {},
};
