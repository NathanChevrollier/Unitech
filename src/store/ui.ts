import { create } from "zustand";
import type { PickTarget, ViewMode } from "../engine/Universe";
import type { PlanetInput, SystemInput } from "../model/ops";
import type { DiscoveredApp, RecentFile, Snapshot } from "../platform";

export type Panel = "settings" | "blackhole" | "nebula" | "help" | "import" | null;

export type Editor =
  | { type: "planet"; planetId?: string; systemId: string; preset?: Partial<PlanetInput> }
  | { type: "system"; systemId?: string; preset?: Partial<SystemInput> }
  | null;

export interface Toast {
  id: number;
  tone: "info" | "success" | "error";
  text: string;
  action?: { label: string; run: () => void };
}

interface UiState {
  view: ViewMode;
  selection: PickTarget | null;
  hover: PickTarget | null;
  panel: Panel;
  launcherOpen: boolean;
  editor: Editor;
  toasts: Toast[];
  running: Set<string>;
  snapshot: Snapshot | null;
  downloads: RecentFile[];
  discovered: DiscoveredApp[] | null;
  fps: number;
  pixelRatio: number;
  galaxyReady: boolean;
  flash: number;
  wallpaper: boolean;
  drop: { x: number; y: number } | null;
  set(patch: Partial<UiState>): void;
  select(target: PickTarget | null): void;
  openPanel(panel: Panel): void;
  toast(t: Omit<Toast, "id">, ms?: number): void;
  dismiss(id: number): void;
}

let toastId = 0;

export const useUi = create<UiState>((set, get) => ({
  view: { kind: "galaxy" },
  selection: null,
  hover: null,
  panel: null,
  launcherOpen: false,
  editor: null,
  toasts: [],
  running: new Set(),
  snapshot: null,
  downloads: [],
  discovered: null,
  fps: 0,
  pixelRatio: 1,
  galaxyReady: false,
  flash: 0,
  wallpaper: false,
  drop: null,
  set: (patch) => set(patch),
  select: (selection) => set({ selection }),
  openPanel: (panel) => set({ panel: get().panel === panel ? null : panel }),
  toast(t, ms = 4200) {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismiss(id), t.action ? Math.max(ms, 7000) : ms);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
