import type { Target, Workspace } from "../model/types";

// Contrat entre l'interface et la plateforme. Deux implémentations : l'application de bureau
// (commandes Tauri) et le navigateur (démonstration, développement de l'interface, tests visuels).

export interface LoadResult {
  workspace: Workspace;
  created: boolean;
  recovered: boolean;
  path?: string;
}

export interface DiscoveredApp {
  name: string;
  target: Target;
  icon?: string;
  categories: string[];
}

export interface PathInfo {
  name: string;
  target: Target;
  icon?: string | null;
}

export interface Snapshot {
  cpu: number;
  cores: number;
  memoryUsed: number;
  memoryTotal: number;
  uptime: number;
  host: string;
  os: string;
}

export interface RecentFile {
  name: string;
  path: string;
  size: number;
  modified: number;
  isDir: boolean;
}

export interface LaunchedEvent {
  planetId: string;
  ok: boolean;
  error?: string | null;
}

export type Unlisten = () => void;

export interface Bridge {
  readonly kind: "desktop" | "web";
  loadWorkspace(): Promise<LoadResult>;
  saveWorkspace(ws: Workspace): Promise<Workspace>;
  exportWorkspace(ws: Workspace): Promise<boolean>;
  importWorkspace(): Promise<Workspace | null>;
  launch(target: Target): Promise<void>;
  discoverApps(): Promise<DiscoveredApp[]>;
  describePath(path: string): Promise<PathInfo>;
  pickPath(kind: "file" | "folder" | "app"): Promise<string | null>;
  systemSnapshot(): Promise<Snapshot | null>;
  runningPlanets(probes: { id: string; target: Target }[]): Promise<string[]>;
  recentDownloads(): Promise<RecentFile[]>;
  setShortcut(accel: string): Promise<void>;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<void>;
  setWallpaper(enabled: boolean): Promise<void>;
  raiseWallpaper(raised: boolean): Promise<void>;
  /** Demande de confirmation native. */
  confirm(message: string): Promise<boolean>;
  hide(): Promise<void>;
  quit(): Promise<void>;
  onLauncher(cb: () => void): Unlisten;
  onLaunched(cb: (e: LaunchedEvent) => void): Unlisten;
  onWallpaper(cb: (enabled: boolean) => void): Unlisten;
  /** Fichiers glissés depuis le système. `hover` signale le survol (sans chemins sous certains systèmes). */
  onFileDrop(cb: (e: { type: "hover" | "drop" | "leave"; paths: string[]; x: number; y: number }) => void): Unlisten;
}
