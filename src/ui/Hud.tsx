import { ChevronRight, CircleHelp, Compass, Inbox, Orbit, Search, Settings, Sun, Target } from "lucide-react";
import { useEffect, useState } from "react";
import * as actions from "../app/actions";
import { ARM_ASTRO_NAMES } from "../model/defaults";
import { activeGalaxy, findSystem, homeOf } from "../model/ops";
import { useUi } from "../store/ui";
import { useWorkspace } from "../store/workspace";
import { Kbd, Logo, MOD, formatBytes, formatUptime } from "./common";

export function Hud() {
  const ws = useWorkspace((s) => s.ws);
  const view = useUi((s) => s.view);
  const selection = useUi((s) => s.selection);
  const panel = useUi((s) => s.panel);
  const downloads = useUi((s) => s.downloads);
  const fps = useUi((s) => s.fps);
  const set = useUi((s) => s.set);
  const openPanel = useUi((s) => s.openPanel);
  if (!ws) return null;
  const g = activeGalaxy(ws);
  const system = view.kind === "system" ? findSystem(g, view.systemId) : undefined;
  const arm = system?.anchor.kind === "arm" ? g.arms.find((a) => system.anchor.kind === "arm" && a.slot === system.anchor.arm) : undefined;
  const selectedArm = selection?.kind === "arm" ? selection.slot : null;

  return (
    <>
      <header className="hud-top">
        <button className="brand" onClick={() => actions.overview()} title="Vue d'ensemble (H)">
          <Logo />
          <span className="brand-name">UNITECH</span>
        </button>
        <nav className="crumbs glass" aria-label="Position">
          <button className="crumb" onClick={() => actions.overview()}>
            {g.name} · Voie lactée
          </button>
          {system && (
            <>
              {arm && (
                <>
                  <ChevronRight className="crumb-sep" />
                  <button className="crumb" onClick={() => actions.flyToArm(arm.slot)}>
                    {arm.label}
                  </button>
                </>
              )}
              <ChevronRight className="crumb-sep" />
              <button className="crumb" onClick={() => actions.select({ kind: "system", id: system.id })}>
                {system.name}
              </button>
            </>
          )}
        </nav>
        <button className="search-btn glass" onClick={() => set({ launcherOpen: true })}>
          <Search />
          <span>Rechercher, lancer, naviguer…</span>
          <Kbd>{MOD} K</Kbd>
        </button>
        <div className="top-actions glass">
          <button className={`icon-btn ${panel === "nebula" ? "is-active" : ""}`} onClick={() => openPanel("nebula")} title="Nébuleuse — boîte de réception (I)">
            <Inbox />
            {downloads.length > 0 && <span className="badge">{downloads.length}</span>}
          </button>
          <button className={`icon-btn ${panel === "blackhole" ? "is-active" : ""}`} onClick={() => openPanel("blackhole")} title="Trou noir — archives (B)">
            <Orbit />
            {g.archive.length > 0 && <span className="badge">{g.archive.length}</span>}
          </button>
          <button className={`icon-btn ${panel === "settings" ? "is-active" : ""}`} onClick={() => openPanel("settings")} title={`Paramètres (${MOD} ,)`}>
            <Settings />
          </button>
          <button className={`icon-btn ${panel === "help" ? "is-active" : ""}`} onClick={() => openPanel("help")} title="Aide (?)">
            <CircleHelp />
          </button>
        </div>
      </header>

      <aside className="armbar glass" aria-label="Catégories">
        <div className="armbar-title">Bras · catégories</div>
        {g.arms.map((a, i) => {
          const count = g.systems.filter((s) => s.anchor.kind === "arm" && s.anchor.arm === a.slot).length;
          return (
            <button key={a.slot} className={`arm-item ${selectedArm === a.slot ? "is-active" : ""}`} onClick={() => actions.flyToArm(a.slot)} title={`${ARM_ASTRO_NAMES[a.slot]} (${i + 1})`}>
              <span className="arm-dot" style={{ background: a.color, boxShadow: `0 0 10px ${a.color}` }} />
              <span className="arm-name">
                <b>{a.label}</b>
                <small>
                  {count} système{count > 1 ? "s" : ""}
                </small>
              </span>
              <Kbd>{i + 1}</Kbd>
            </button>
          );
        })}
        <div className="arm-sep" />
        <button className={`arm-item ${view.kind === "system" && system?.id === homeOf(g).id ? "is-active" : ""}`} onClick={() => actions.goHome()} title="Système d'accueil (S)">
          <Sun style={{ width: 12, height: 12, color: "#ffd27a" }} />
          <span className="arm-name">
            <b>Soleil</b>
            <small>{homeOf(g).planets.length} favoris</small>
          </span>
          <Kbd>S</Kbd>
        </button>
      </aside>

      <Station />

      {system && system.planets.length === 0 && (
        <div className="empty-hint glass">
          <b>{system.name} n'a encore aucune planète.</b>
          <span>
            <Kbd>N</Kbd> pour en ajouter une, ou dépose un fichier, un dossier ou une application sur la fenêtre.
          </span>
          <button className="btn btn-primary btn-small" onClick={() => actions.newPlanet(undefined, system.id)}>
            Nouvelle planète
          </button>
        </div>
      )}

      <div className="navpad glass">
        {fps > 0 && <span className="fps">{fps} i/s</span>}
        <button className="icon-btn" onClick={() => actions.overview()} title="Vue d'ensemble (H)">
          <Compass />
        </button>
        <button className="icon-btn" onClick={() => actions.goHome()} title="Soleil (S)">
          <Sun />
        </button>
        {view.kind === "system" && (
          <button className="icon-btn" onClick={() => actions.exitToGalaxy()} title="Revenir à la galaxie (Échap)">
            <Target />
          </button>
        )}
      </div>
    </>
  );
}

function Station() {
  const snapshot = useUi((s) => s.snapshot);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const cpu = snapshot && Number.isFinite(snapshot.cpu) ? snapshot.cpu : null;
  const mem = snapshot && snapshot.memoryTotal ? snapshot.memoryUsed / snapshot.memoryTotal : null;
  return (
    <section className="station glass" aria-label="Station — widgets">
      <div className="station-clock">
        <span className="station-time">{now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
        <span className="station-date">
          {now.toLocaleDateString("fr-FR", { weekday: "long" })}
          <br />
          {now.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
        </span>
      </div>
      <div className="meter" title="Processeur">
        <span>CPU</span>
        <div className="meter-bar">
          <div className="meter-fill" style={{ width: `${Math.min(100, cpu ?? 0)}%` }} />
        </div>
        <span className="meter-value">{cpu == null ? "—" : `${Math.round(cpu)} %`}</span>
      </div>
      <div className="meter" title={snapshot && mem != null ? `${formatBytes(snapshot.memoryUsed)} / ${formatBytes(snapshot.memoryTotal)}` : "Mémoire"}>
        <span>RAM</span>
        <div className="meter-bar">
          <div className="meter-fill" style={{ width: `${Math.round((mem ?? 0) * 100)}%` }} />
        </div>
        <span className="meter-value">{mem == null ? "—" : `${Math.round(mem * 100)} %`}</span>
      </div>
      <div className="station-foot">
        <span title={snapshot?.os}>{snapshot?.host || "—"}</span>
        <span>{snapshot ? `actif ${formatUptime(snapshot.uptime)}` : ""}</span>
      </div>
    </section>
  );
}
