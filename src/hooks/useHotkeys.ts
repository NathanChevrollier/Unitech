import { useEffect } from "react";
import * as actions from "../app/actions";
import { universe } from "../engine/instance";
import { ARM_SLOTS } from "../model/types";
import { useUi } from "../store/ui";
import { useWorkspace } from "../store/workspace";

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

function toggleSetting(key: "showConstellations" | "showLabels") {
  useWorkspace.getState().apply((w) => ({ ...w, settings: { ...w.settings, [key]: !w.settings[key] } }), { undoable: false });
}

/** Raccourcis clavier globaux de la fenêtre. */
export function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && (key === "k" || e.code === "Space")) {
        e.preventDefault();
        ui.set({ launcherOpen: !ui.launcherOpen });
        return;
      }
      if (mod && key === ",") {
        e.preventDefault();
        ui.openPanel("settings");
        return;
      }
      const modal = ui.launcherOpen || ui.editor || ui.panel;
      if (typing(e.target) || modal) return;

      if (mod && key === "z") {
        e.preventDefault();
        const ok = e.shiftKey ? useWorkspace.getState().redo() : useWorkspace.getState().undo();
        if (ok) ui.toast({ tone: "info", text: e.shiftKey ? "Rétabli" : "Annulé" }, 1500);
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        useWorkspace.getState().redo();
        return;
      }
      if (mod || e.altKey) return;

      switch (e.key) {
        case "Escape":
          if (ui.selection && ui.view.kind === "galaxy") actions.select(null);
          else if (ui.view.kind === "system") {
            if (ui.selection?.kind === "planet" || ui.selection?.kind === "moon" || ui.selection?.kind === "comet") {
              actions.select({ kind: "system", id: ui.view.systemId });
              universe()?.focusBody({ type: "star", id: ui.view.systemId });
            } else actions.exitToGalaxy();
          }
          return;
        case "Enter":
          // Un bouton qui a le focus traite déjà sa propre touche Entrée.
          if ((e.target as HTMLElement | null)?.closest?.("button, a, [role=checkbox]")) return;
          actions.primaryAction();
          return;
        case "Delete":
        case "Backspace":
          actions.archiveSelection();
          return;
        case "?":
          ui.openPanel("help");
          return;
      }
      switch (key) {
        case "h":
          actions.overview();
          break;
        case "s":
          actions.goHome();
          break;
        case "n":
          if (e.shiftKey) actions.newSystem();
          else actions.newPlanet();
          break;
        case "e":
          actions.editSelection();
          break;
        case "b":
          ui.openPanel("blackhole");
          break;
        case "i":
          ui.openPanel("nebula");
          break;
        case "c":
          toggleSetting("showConstellations");
          break;
        case "l":
          toggleSetting("showLabels");
          break;
        default:
          if (/^[1-5]$/.test(e.key)) actions.flyToArm(ARM_SLOTS[Number(e.key) - 1]);
          else return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
