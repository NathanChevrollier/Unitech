import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import type { Target, Workspace } from "../model/types";
import type { Bridge, DiscoveredApp, LaunchedEvent, LoadResult, PathInfo, RecentFile, Snapshot, Unlisten } from "./bridge";

/** Transforme un abonnement asynchrone en fonction de désabonnement synchrone. */
function sync(p: Promise<() => void>): Unlisten {
  let off: (() => void) | null = null;
  let cancelled = false;
  p.then((fn) => (cancelled ? fn() : (off = fn))).catch(() => {});
  return () => {
    cancelled = true;
    off?.();
  };
}

export const tauriBridge: Bridge = {
  kind: "desktop",
  loadWorkspace: () => invoke<LoadResult>("workspace_load"),
  saveWorkspace: (workspace) => invoke<Workspace>("workspace_save", { workspace }),
  async exportWorkspace(workspace) {
    const path = await save({ title: "Exporter la galaxie", defaultPath: "unitech-galaxie.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path) return false;
    await invoke("workspace_export", { workspace, path });
    return true;
  },
  async importWorkspace() {
    const path = await open({ title: "Importer une galaxie", multiple: false, directory: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!path || Array.isArray(path)) return null;
    return invoke<Workspace>("workspace_import", { path });
  },
  launch: (target: Target) => invoke("launch_target", { target }),
  discoverApps: () => invoke<DiscoveredApp[]>("discover_apps"),
  describePath: (path) => invoke<PathInfo>("describe_path", { path }),
  async pickPath(kind) {
    const path = await open({
      title: kind === "folder" ? "Choisir un dossier" : kind === "app" ? "Choisir une application" : "Choisir un fichier",
      directory: kind === "folder",
      multiple: false,
    });
    return typeof path === "string" ? path : null;
  },
  systemSnapshot: () => invoke<Snapshot>("system_snapshot"),
  runningPlanets: (planets) => invoke<string[]>("running_planets", { planets }),
  recentDownloads: () => invoke<RecentFile[]>("recent_downloads"),
  setShortcut: (accel) => invoke("shortcut_set", { accel }),
  getAutostart: () => invoke<boolean>("autostart_get"),
  setAutostart: (enabled) => invoke("autostart_set", { enabled }),
  setWallpaper: (enabled) => invoke("wallpaper_set", { enabled }),
  raiseWallpaper: (raised) => invoke("wallpaper_raise", { raised }),
  confirm: (message) => ask(message, { title: "Unitech", kind: "warning", okLabel: "Confirmer", cancelLabel: "Annuler" }),
  hide: () => invoke("app_hide"),
  quit: () => invoke("app_quit"),
  onLauncher: (cb) => sync(listen("unitech://launcher", () => cb())),
  onLaunched: (cb) => sync(listen<LaunchedEvent>("unitech://launched", (e) => cb(e.payload))),
  onWallpaper: (cb) => sync(listen<boolean>("unitech://wallpaper", (e) => cb(e.payload))),
  onFileDrop: (cb) =>
    sync(
      getCurrentWebview().onDragDropEvent((e) => {
        const p = e.payload;
        const ratio = window.devicePixelRatio || 1;
        if (p.type === "leave") cb({ type: "leave", paths: [], x: 0, y: 0 });
        else if (p.type === "drop") cb({ type: "drop", paths: p.paths, x: p.position.x / ratio, y: p.position.y / ratio });
        else cb({ type: "hover", paths: p.type === "enter" ? p.paths : [], x: p.position.x / ratio, y: p.position.y / ratio });
      }),
    ),
};
