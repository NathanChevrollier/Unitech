import { create } from "zustand";
import { bridge } from "../platform";
import type { Workspace } from "../model/types";

// Espace de travail : source de vérité de l'interface. Chaque modification passe par `apply`,
// qui l'historise (annuler / rétablir) et programme une sauvegarde groupée.

const HISTORY = 60;
const SAVE_DELAY = 350;

interface WorkspaceState {
  ws: Workspace | null;
  status: "loading" | "ready" | "error";
  error: string | null;
  storagePath: string | null;
  /** Le fichier principal était illisible et la copie de sécurité a été utilisée. */
  recovered: boolean;
  past: Workspace[];
  future: Workspace[];
  saveError: string | null;
  load(): Promise<void>;
  apply(fn: (ws: Workspace) => Workspace, options?: { undoable?: boolean }): void;
  replace(ws: Workspace): void;
  undo(): boolean;
  redo(): boolean;
  flush(): Promise<void>;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;
let revision = 0;

export const useWorkspace = create<WorkspaceState>((set, get) => {
  const schedule = () => {
    revision++;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void save();
    }, SAVE_DELAY);
  };

  const save = async () => {
    // Une seule écriture à la fois ; la dernière version gagne.
    while (saving) await saving;
    const ws = get().ws;
    if (!ws) return;
    const rev = revision;
    saving = (async () => {
      try {
        const clean = await bridge.saveWorkspace(ws);
        // Rust peut corriger des valeurs : on reprend sa version si rien n'a changé entre-temps.
        if (rev === revision && JSON.stringify(clean) !== JSON.stringify(ws)) set({ ws: clean });
        if (get().saveError) set({ saveError: null });
      } catch (e) {
        set({ saveError: e instanceof Error ? e.message : String(e) });
      }
    })();
    await saving;
    saving = null;
  };

  return {
    ws: null,
    status: "loading",
    error: null,
    storagePath: null,
    recovered: false,
    past: [],
    future: [],
    saveError: null,

    async load() {
      try {
        const r = await bridge.loadWorkspace();
        set({ ws: r.workspace, status: "ready", storagePath: r.path ?? null, recovered: r.recovered, error: null });
      } catch (e) {
        set({ status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },

    apply(fn, options) {
      const current = get().ws;
      if (!current) return;
      const next = fn(current);
      if (next === current) return;
      const undoable = options?.undoable ?? true;
      set({
        ws: next,
        past: undoable ? [...get().past.slice(-HISTORY + 1), current] : get().past,
        future: undoable ? [] : get().future,
      });
      schedule();
    },

    replace(ws) {
      set({ ws, past: [], future: [] });
      schedule();
    },

    undo() {
      const { past, ws } = get();
      if (!past.length || !ws) return false;
      set({ ws: past[past.length - 1], past: past.slice(0, -1), future: [ws, ...get().future].slice(0, HISTORY) });
      schedule();
      return true;
    },

    redo() {
      const { future, ws } = get();
      if (!future.length || !ws) return false;
      set({ ws: future[0], future: future.slice(1), past: [...get().past, ws].slice(-HISTORY) });
      schedule();
      return true;
    },

    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        await save();
      }
      while (saving) await saving;
    },
  };
});
