import { useEffect, useRef } from "react";
import * as actions from "../app/actions";
import { setUniverse } from "../engine/instance";
import { Universe, sameTarget } from "../engine/Universe";
import { activeGalaxy } from "../model/ops";
import { useUi } from "../store/ui";
import { useWorkspace } from "../store/workspace";

/** Canevas WebGL et calque d'étiquettes ; relie le moteur aux stores. */
export function Scene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ui = useUi.getState;
    const u = new Universe(canvasRef.current!, labelsRef.current!, {
      hover: (t) => {
        if (!sameTarget(t, ui().hover)) ui().set({ hover: t });
      },
      select: (t, double) => {
        if (double && t) {
          actions.primaryAction(t);
          return;
        }
        actions.select(t);
        // Un clic sur une planète la cadre ; sur un bras ou une étoile réelle, on y vole.
        if (t?.kind === "planet") u.focusBody({ type: "planet", id: t.id });
        if (t?.kind === "moon") u.focusBody({ type: "moon", id: t.id, planetId: t.planetId });
      },
      mode: (view) => {
        ui().set({ view });
        if (view.kind === "system") actions.select({ kind: "system", id: view.systemId });
      },
      transition: () => ui().set({ flash: ui().flash + 1 }),
      stats: (fps, pixelRatio) => ui().set({ fps, pixelRatio }),
      ready: () => ui().set({ galaxyReady: true }),
      error: (message) => ui().toast({ tone: "error", text: message }, 8000),
    });
    setUniverse(u);
    // `?debug` : accès au moteur depuis la console et les scripts de capture.
    if (new URLSearchParams(location.search).has("debug")) {
      u.maxStep = 1;
      Object.assign(window, { __unitech: { universe: u, actions, ui: useUi, workspace: useWorkspace } });
    }
    void u.loadRealStars(import.meta.env.BASE_URL);

    const push = () => {
      const ws = useWorkspace.getState().ws;
      if (ws) u.setState(activeGalaxy(ws), ws.settings);
    };
    push();
    // Première image : on s'approche de la vue d'ensemble.
    u.overview(3.2);

    const offWs = useWorkspace.subscribe((s, prev) => {
      if (s.ws !== prev.ws) push();
    });
    const offUi = useUi.subscribe((s, prev) => {
      if (s.running !== prev.running) u.setRunning(s.running);
      if (s.downloads !== prev.downloads) u.setComets(s.downloads);
      if (s.selection !== prev.selection) u.setSelection(s.selection);
    });
    // Moins d'images quand la fenêtre n'a pas le focus (fond d'écran, autre application devant).
    const onBlur = () => u.setThrottle(useUi.getState().wallpaper ? 24 : 30);
    const onFocus = () => u.setThrottle(0);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);

    return () => {
      offWs();
      offUi();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      setUniverse(null);
      u.dispose();
    };
  }, []);

  return (
    <div className="scene">
      <canvas ref={canvasRef} aria-label="Galaxie Unitech — vue 3D interactive" />
      <div className="labels" ref={labelsRef} />
    </div>
  );
}
