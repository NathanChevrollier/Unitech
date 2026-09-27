// Commandes de haut niveau, partagées par les raccourcis, le lanceur, les panneaux et le menu de
// l'icône de notification.

import { universe } from "../engine/instance";
import type { PickTarget } from "../engine/Universe";
import { nameFromTarget } from "../model/classify";
import * as ops from "../model/ops";
import type { ArmSlot, Target } from "../model/types";
import { bridge, type RecentFile } from "../platform";
import { useUi } from "../store/ui";
import { useWorkspace } from "../store/workspace";

const now = () => Date.now();

export function galaxy() {
  const ws = useWorkspace.getState().ws;
  return ws ? ops.activeGalaxy(ws) : null;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function toastError(prefix: string, e: unknown) {
  useUi.getState().toast({ tone: "error", text: `${prefix} : ${errorText(e)}` });
}

// --- Lancements ---

export async function launchPlanet(planetId: string) {
  const g = galaxy();
  const found = g && ops.findPlanet(g, planetId);
  if (!found) return;
  universe()?.pulsePlanet(planetId);
  try {
    await bridge.launch(found.planet.target);
    useWorkspace.getState().apply((ws) => ops.recordPlanetLaunch(ws, planetId, now()), { undoable: false });
    useUi.getState().toast({ tone: "success", text: `${found.planet.name} lancée` }, 1800);
    void bridge.raiseWallpaper(false);
  } catch (e) {
    toastError(`Impossible de lancer ${found.planet.name}`, e);
  }
}

export async function launchMoon(planetId: string, moonId: string) {
  const g = galaxy();
  const found = g && ops.findPlanet(g, planetId);
  const moon = found?.planet.moons.find((m) => m.id === moonId);
  if (!found || !moon) return;
  try {
    await bridge.launch(moon.target);
    useWorkspace.getState().apply((ws) => ops.recordPlanetLaunch(ws, planetId, now()), { undoable: false });
    useUi.getState().toast({ tone: "success", text: `${moon.name} (${found.planet.name})` }, 1800);
  } catch (e) {
    toastError(`Impossible de lancer ${moon.name}`, e);
  }
}

export async function openFile(file: RecentFile) {
  try {
    await bridge.launch({ kind: file.isDir ? "folder" : "file", value: file.path });
  } catch (e) {
    toastError(`Impossible d'ouvrir ${file.name}`, e);
  }
}

/** Ouvre le dossier qui contient un fichier. */
export async function revealFile(file: RecentFile) {
  const dir = file.path.replace(/[\\/][^\\/]*$/, "");
  try {
    await bridge.launch({ kind: "folder", value: dir || file.path });
  } catch (e) {
    toastError("Impossible d'ouvrir le dossier", e);
  }
}

// --- Navigation ---

export function select(target: PickTarget | null) {
  useUi.getState().select(target);
  universe()?.setSelection(target);
}

export function enterSystem(id: string) {
  select({ kind: "system", id });
  universe()?.enterSystem(id);
}

export function goHome() {
  const g = galaxy();
  if (g) enterSystem(ops.homeOf(g).id);
}

export function overview() {
  select(null);
  universe()?.overview();
}

export function exitToGalaxy() {
  universe()?.exitSystem();
}

export function flyToArm(slot: ArmSlot) {
  select({ kind: "arm", slot });
  universe()?.flyToArm(slot);
}

export function flyToBlackHole() {
  select({ kind: "blackhole" });
  universe()?.flyToBlackHole();
}

export function flyToNebula() {
  select({ kind: "nebula" });
  universe()?.flyToNebula();
}

export function flyToRealStar(hygId: number, name: string) {
  select({ kind: "realStar", hygId, name });
  universe()?.flyToRealStar(hygId);
}

/** Va jusqu'à la planète (en entrant dans son système si besoin) et la cadre. */
export function focusPlanet(planetId: string) {
  const g = galaxy();
  const found = g && ops.findPlanet(g, planetId);
  const u = universe();
  if (!found || !u) return;
  const view = u.view;
  if (view.kind !== "system" || view.systemId !== found.system.id) {
    u.enterSystem(found.system.id);
    // La planète est cadrée une fois la plongée terminée.
    const off = useUi.subscribe((s) => {
      if (s.view.kind === "system" && s.view.systemId === found.system.id) {
        off();
        setTimeout(() => {
          select({ kind: "planet", id: planetId });
          universe()?.focusBody({ type: "planet", id: planetId });
        }, 1600);
      }
    });
    return;
  }
  select({ kind: "planet", id: planetId });
  u.focusBody({ type: "planet", id: planetId });
}

// --- Édition ---

/** Système qui reçoit une nouvelle planète : celui affiché, sinon celui sélectionné, sinon le Soleil. */
export function currentSystemId(): string | null {
  const g = galaxy();
  if (!g) return null;
  const { view, selection } = useUi.getState();
  if (view.kind === "system") return view.systemId;
  if (selection?.kind === "system") return selection.id;
  return ops.homeOf(g).id;
}

export function newPlanet(preset?: { name?: string; target?: Target; icon?: string }, systemId?: string) {
  const sid = systemId ?? currentSystemId();
  if (!sid) return;
  useUi.getState().set({ editor: { type: "planet", systemId: sid, preset }, launcherOpen: false });
}

export function newSystem(preset?: Parameters<typeof ops.addSystem>[1] | Partial<Parameters<typeof ops.addSystem>[1]>) {
  useUi.getState().set({ editor: { type: "system", preset }, launcherOpen: false });
}

export function editSelection() {
  const { selection, set } = useUi.getState();
  const g = galaxy();
  if (!selection || !g) return;
  if (selection.kind === "planet") {
    const found = ops.findPlanet(g, selection.id);
    if (found) set({ editor: { type: "planet", planetId: selection.id, systemId: found.system.id } });
  } else if (selection.kind === "system" || selection.kind === "systemStar") {
    set({ editor: { type: "system", systemId: selection.id } });
  }
}

export function adoptStar(hygId: number, name: string) {
  newSystem({ name, anchor: { kind: "real", hygId, name } });
}

/** Crée des planètes à partir de chemins déposés sur la fenêtre. */
export async function dropPaths(paths: string[], systemId: string) {
  let added = 0;
  for (const path of paths.slice(0, 24)) {
    try {
      const info = await bridge.describePath(path);
      useWorkspace
        .getState()
        .apply((ws) => ops.addPlanet(ws, systemId, { name: info.name || nameFromTarget(info.target), target: info.target, icon: info.icon ?? undefined }, now()).ws);
      added++;
    } catch (e) {
      toastError(`« ${path} » ignoré`, e);
    }
  }
  if (added) {
    const g = galaxy();
    const sys = g && ops.findSystem(g, systemId);
    useUi.getState().toast({ tone: "success", text: `${added} planète${added > 1 ? "s" : ""} ajoutée${added > 1 ? "s" : ""} à ${sys?.name ?? "ce système"}` });
  }
}

// --- Trou noir ---

export function archivePlanet(planetId: string) {
  const g = galaxy();
  const found = g && ops.findPlanet(g, planetId);
  if (!found) return;
  useWorkspace.getState().apply((ws) => ops.archivePlanet(ws, planetId, now()));
  if (useUi.getState().selection?.kind === "planet") select(null);
  useUi.getState().toast({ tone: "info", text: `${found.planet.name} a rejoint le trou noir`, action: { label: "Annuler", run: () => useWorkspace.getState().undo() } });
}

export function archiveSystem(systemId: string) {
  const g = galaxy();
  const s = g && ops.findSystem(g, systemId);
  if (!s) return;
  if (s.anchor.kind === "home") {
    useUi.getState().toast({ tone: "error", text: "Le Soleil est ton système d'accueil : il ne peut pas être archivé." });
    return;
  }
  const u = universe();
  if (u?.view.kind === "system" && u.view.systemId === systemId) u.exitSystem();
  useWorkspace.getState().apply((ws) => ops.archiveSystem(ws, systemId, now()));
  select(null);
  useUi.getState().toast({ tone: "info", text: `${s.name} a été englouti par le trou noir`, action: { label: "Annuler", run: () => useWorkspace.getState().undo() } });
}

export function archiveSelection() {
  const sel = useUi.getState().selection;
  if (sel?.kind === "planet") archivePlanet(sel.id);
  else if (sel?.kind === "system" || sel?.kind === "systemStar") archiveSystem(sel.id);
}

/** Action principale de la sélection (touche Entrée, double-clic). */
export function primaryAction(target: PickTarget | null = useUi.getState().selection) {
  if (!target) return;
  switch (target.kind) {
    case "planet":
      return void launchPlanet(target.id);
    case "moon":
      return void launchMoon(target.planetId, target.id);
    case "system":
      return enterSystem(target.id);
    case "systemStar":
      return universe()?.focusBody({ type: "star", id: target.id });
    case "arm":
      return flyToArm(target.slot);
    case "blackhole":
      return useUi.getState().set({ panel: "blackhole" });
    case "nebula":
      return useUi.getState().set({ panel: "nebula" });
    case "realStar":
      return flyToRealStar(target.hygId, target.name);
    case "comet": {
      const file = useUi.getState().downloads.find((d) => d.path === target.path);
      if (file) void openFile(file);
    }
  }
}

// --- Réglages système ---

export async function setWallpaper(enabled: boolean) {
  try {
    await bridge.setWallpaper(enabled);
    useUi.getState().set({ wallpaper: enabled });
  } catch (e) {
    toastError("Mode fond d'écran", e);
  }
}
