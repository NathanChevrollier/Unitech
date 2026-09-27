import { useEffect } from "react";
import * as actions from "./app/actions";
import { useHotkeys } from "./hooks/useHotkeys";
import { universe } from "./engine/instance";
import { activeGalaxy, recordPlanetLaunch } from "./model/ops";
import { bridge } from "./platform";
import { useUi } from "./store/ui";
import { useWorkspace } from "./store/workspace";
import { Editors } from "./ui/Editors";
import { Hud } from "./ui/Hud";
import { Inspector } from "./ui/Inspector";
import { Launcher } from "./ui/Launcher";
import { Boot, DropOverlay, Flash, Toasts } from "./ui/Overlays";
import { Panels } from "./ui/Panels";
import { Scene } from "./ui/Scene";

/** Interroge périodiquement la plateforme (widgets, applications ouvertes, téléchargements). */
function usePolling() {
  useEffect(() => {
    let alive = true;
    const snapshot = () => bridge.systemSnapshot().then((s) => alive && useUi.getState().set({ snapshot: s }), () => {});
    const downloads = () =>
      bridge.recentDownloads().then((d) => {
        if (!alive) return;
        const prev = useUi.getState().downloads;
        if (JSON.stringify(prev) !== JSON.stringify(d)) useUi.getState().set({ downloads: d });
      }, () => {});
    const running = () => {
      const ws = useWorkspace.getState().ws;
      if (!ws || document.hidden) return;
      const probes = activeGalaxy(ws).systems.flatMap((s) => s.planets.filter((p) => p.target.kind === "app").map((p) => ({ id: p.id, target: p.target })));
      bridge.runningPlanets(probes).then((ids) => {
        if (!alive) return;
        const prev = useUi.getState().running;
        if (ids.length !== prev.size || ids.some((id) => !prev.has(id))) useUi.getState().set({ running: new Set(ids) });
      }, () => {});
    };
    void snapshot();
    void downloads();
    const t1 = setInterval(() => !document.hidden && snapshot(), 2000);
    const t2 = setInterval(running, 3000);
    const t3 = setInterval(downloads, 60_000);
    const t4 = setTimeout(running, 800);
    return () => {
      alive = false;
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
      clearTimeout(t4);
    };
  }, []);
}

/** Événements venus de l'application de bureau : raccourci global, menu, fichiers déposés. */
function useDesktopEvents() {
  useEffect(() => {
    const offs = [
      bridge.onLauncher(() => useUi.getState().set({ launcherOpen: true })),
      bridge.onLaunched((e) => {
        if (e.ok) {
          // Un lancement depuis le menu de notification compte comme un usage.
          useWorkspace.getState().apply((ws) => recordPlanetLaunch(ws, e.planetId, Date.now()), { undoable: false });
          universe()?.pulsePlanet(e.planetId);
        } else if (e.error) useUi.getState().toast({ tone: "error", text: e.error });
      }),
      bridge.onWallpaper((enabled) => useUi.getState().set({ wallpaper: enabled })),
      bridge.onFileDrop((e) => {
        if (e.type === "hover") useUi.getState().set({ drop: { x: e.x, y: e.y } });
        else if (e.type === "leave") useUi.getState().set({ drop: null });
        else {
          useUi.getState().set({ drop: null });
          const sid = actions.currentSystemId();
          if (sid) void actions.dropPaths(e.paths, sid);
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}

export function App() {
  const status = useWorkspace((s) => s.status);
  const recovered = useWorkspace((s) => s.recovered);
  const saveError = useWorkspace((s) => s.saveError);
  const onboarded = useWorkspace((s) => s.ws?.settings.onboarded);
  const galaxyReady = useUi((s) => s.galaxyReady);

  useEffect(() => {
    void useWorkspace.getState().load();
    // Dernière sauvegarde avant fermeture de la fenêtre.
    const flush = () => void useWorkspace.getState().flush();
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, []);
  useEffect(() => {
    if (recovered) useUi.getState().toast({ tone: "error", text: "Le fichier de l'espace de travail était abîmé : la copie de sécurité a été restaurée." }, 10000);
  }, [recovered]);
  useEffect(() => {
    if (saveError) useUi.getState().toast({ tone: "error", text: `Sauvegarde impossible : ${saveError}` }, 8000);
  }, [saveError]);
  // Premier lancement : accueil et import des applications, une fois la galaxie formée.
  useEffect(() => {
    if (status === "ready" && galaxyReady && onboarded === false) {
      const t = setTimeout(() => useUi.getState().set({ panel: "import" }), 3600);
      return () => clearTimeout(t);
    }
  }, [status, galaxyReady, onboarded]);

  useHotkeys();
  usePolling();
  useDesktopEvents();

  return (
    <>
      {status === "ready" && <Scene />}
      {status === "ready" && (
        <>
          <Hud />
          <Inspector />
          <Launcher />
          <Editors />
          <Panels />
          <DropOverlay />
        </>
      )}
      <Flash />
      <Toasts />
      <Boot />
    </>
  );
}
