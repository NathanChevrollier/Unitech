import { ArrowRight, CornerDownLeft, FolderOpen, Pencil, Play, Plus, Sparkles, Trash2, X } from "lucide-react";
import * as actions from "../app/actions";
import { universe } from "../engine/instance";
import { ARM_ASTRO_NAMES } from "../model/defaults";
import { activeGalaxy, findPlanet, findSystem, homeOf, movePlanet } from "../model/ops";
import type { Galaxy, Planet, StarSystem } from "../model/types";
import { relativeTime, usageScore } from "../model/usage";
import { bvToTemperature } from "../engine/math/color";
import { useUi } from "../store/ui";
import { useWorkspace } from "../store/workspace";
import { Glyph, Kbd, TARGET_LABELS, formatBytes } from "./common";

const STATUS_LABEL = { active: "Actif · étoile bleue", paused: "En pause · naine rouge", dormant: "En sommeil · naine blanche" } as const;
const LIGHT_YEAR = 3.26156;
const frNum = (n: number, digits: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function Inspector() {
  const ws = useWorkspace((s) => s.ws);
  const selection = useUi((s) => s.selection);
  const view = useUi((s) => s.view);
  if (!ws || !selection) return null;
  const g = activeGalaxy(ws);
  const close = () => actions.select(null);

  let content: React.ReactNode = null;
  switch (selection.kind) {
    case "system":
    case "systemStar": {
      const s = findSystem(g, selection.id);
      if (s) content = <SystemView g={g} s={s} inside={view.kind === "system" && view.systemId === s.id} />;
      break;
    }
    case "planet": {
      const f = findPlanet(g, selection.id);
      if (f) content = <PlanetView g={g} system={f.system} planet={f.planet} />;
      break;
    }
    case "moon": {
      const f = findPlanet(g, selection.planetId);
      const moon = f?.planet.moons.find((m) => m.id === selection.id);
      if (f && moon)
        content = (
          <>
            <Head glyph={<Glyph kind={moon.target.kind} size={22} />} title={moon.name} subtitle={`Lune de ${f.planet.name}`} onClose={close} />
            <div className="inspector-body">
              <div className="target-line">{moon.target.value}</div>
              <div className="row">
                <button className="btn btn-primary" onClick={() => actions.launchMoon(f.planet.id, moon.id)}>
                  <Play /> Lancer
                </button>
                <button className="btn" onClick={() => actions.focusPlanet(f.planet.id)}>
                  {f.planet.name}
                </button>
              </div>
            </div>
          </>
        );
      break;
    }
    case "arm": {
      const arm = g.arms.find((a) => a.slot === selection.slot);
      if (!arm) break;
      const systems = g.systems.filter((s) => s.anchor.kind === "arm" && s.anchor.arm === arm.slot);
      content = (
        <>
          <Head glyph={<span className="arm-dot" style={{ width: 16, height: 16, background: arm.color, boxShadow: `0 0 14px ${arm.color}` }} />} title={arm.label} subtitle={ARM_ASTRO_NAMES[arm.slot]} onClose={close} />
          <div className="inspector-body">
            <SystemList systems={systems} empty="Aucun système sur ce bras pour l'instant." />
            <button className="btn btn-primary" onClick={() => actions.newSystem({ name: "", anchor: { kind: "arm", arm: arm.slot, t: 0.5, offset: 0 } })}>
              <Plus /> Nouveau système sur ce bras
            </button>
          </div>
        </>
      );
      break;
    }
    case "realStar": {
      const star = universe()?.realStar(selection.hygId);
      const adopted = g.systems.find((s) => s.anchor.kind === "real" && s.anchor.hygId === selection.hygId);
      const dist = star ? star.offset.length() : 0;
      content = (
        <>
          <Head glyph={<Sparkles style={{ color: "#cfe0ff" }} />} title={selection.name} subtitle={star ? `Étoile réelle · ${star.constellation}` : "Étoile réelle"} onClose={close} />
          <div className="inspector-body">
            {star && (
              <div className="facts">
                <Fact label="Distance" value={`${frNum(dist, dist < 10 ? 2 : 0)} pc · ${frNum(dist * LIGHT_YEAR, dist < 10 ? 1 : 0)} al`} />
                <Fact label="Magnitude" value={frNum(star.mag, 2)} />
                <Fact label="Température" value={`${frNum(Math.round(bvToTemperature(star.bv) / 100) * 100, 0)} K`} />
                <Fact label="Catalogue" value={`HYG ${star.hygId}`} />
              </div>
            )}
            {adopted ? (
              <button className="btn btn-primary" onClick={() => actions.enterSystem(adopted.id)}>
                <ArrowRight /> Entrer dans « {adopted.name} »
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => actions.adoptStar(selection.hygId, selection.name)}>
                <Plus /> Adopter pour un projet
              </button>
            )}
            <button className="btn" onClick={() => actions.flyToRealStar(selection.hygId, selection.name)}>
              Voler jusqu'à {selection.name}
            </button>
          </div>
        </>
      );
      break;
    }
    case "blackhole":
      content = (
        <>
          <Head glyph={<span style={{ color: "#ffb26b" }}>◉</span>} title="Sagittarius A*" subtitle="Trou noir supermassif · 4 millions de masses solaires" onClose={close} />
          <div className="inspector-body">
            <p style={{ margin: 0, color: "var(--muted)" }}>
              Tout ce que tu archives tombe ici. Rien n'est perdu : un élément englouti peut être restauré à tout moment.
            </p>
            <div className="facts">
              <Fact label="Archivés" value={String(g.archive.length)} />
              <Fact label="Distance au Soleil" value="8,2 kpc" />
            </div>
            <button className="btn btn-primary" onClick={() => useUi.getState().set({ panel: "blackhole" })}>
              Ouvrir les archives
            </button>
          </div>
        </>
      );
      break;
    case "nebula": {
      const n = useUi.getState().downloads.length;
      content = (
        <>
          <Head glyph={<span style={{ color: "#ff8fb8" }}>✦</span>} title="Nébuleuse d'Orion" subtitle="Messier 42 · 412 pc · boîte de réception" onClose={close} />
          <div className="inspector-body">
            <p style={{ margin: 0, color: "var(--muted)" }}>Une pouponnière d'étoiles qui recueille tes téléchargements récents. Autour du Soleil, ils passent en comètes.</p>
            <button className="btn btn-primary" onClick={() => useUi.getState().set({ panel: "nebula" })}>
              Ouvrir la boîte de réception ({n})
            </button>
          </div>
        </>
      );
      break;
    }
    case "comet": {
      const file = useUi.getState().downloads.find((d) => d.path === selection.path);
      if (file)
        content = (
          <>
            <Head glyph={<span>☄</span>} title={file.name} subtitle={`Téléchargé ${relativeTime(file.modified, Date.now())}`} onClose={close} />
            <div className="inspector-body">
              <div className="facts">
                <Fact label="Taille" value={file.isDir ? "Dossier" : formatBytes(file.size)} />
                <Fact label="Date" value={new Date(file.modified).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} />
              </div>
              <div className="row">
                <button className="btn btn-primary" onClick={() => actions.openFile(file)}>
                  <Play /> Ouvrir
                </button>
                <button className="btn" onClick={() => actions.revealFile(file)}>
                  <FolderOpen /> Dossier
                </button>
              </div>
              <button className="btn" onClick={() => actions.newPlanet({ name: file.name, target: { kind: file.isDir ? "folder" : "file", value: file.path } }, homeOf(g).id)}>
                <Plus /> Garder comme planète
              </button>
            </div>
          </>
        );
      break;
    }
  }
  if (!content) return null;
  return (
    <aside className="inspector glass" aria-label="Détails de la sélection">
      {content}
    </aside>
  );
}

function Head({ glyph, title, subtitle, onClose }: { glyph: React.ReactNode; title: string; subtitle?: string; onClose: () => void }) {
  return (
    <header className="inspector-head">
      <div className="inspector-glyph">{glyph}</div>
      <div className="inspector-title">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <button className="icon-btn" onClick={onClose} aria-label="Fermer">
        <X />
      </button>
    </header>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="fact">
      <small>{label}</small>
      <span title={value}>{value}</span>
    </div>
  );
}

function SystemList({ systems, empty }: { systems: StarSystem[]; empty: string }) {
  if (!systems.length) return <div className="empty">{empty}</div>;
  return (
    <div className="list">
      {systems.map((s) => (
        <button key={s.id} className="list-item" onClick={() => actions.enterSystem(s.id)}>
          <span className="list-icon">✦</span>
          <span className="grow">
            <b>{s.name}</b>
            <small>
              {s.planets.length} planète{s.planets.length > 1 ? "s" : ""}
            </small>
          </span>
          <ArrowRight style={{ width: 14, height: 14, color: "var(--faint)" }} />
        </button>
      ))}
    </div>
  );
}

function SystemView({ g, s, inside }: { g: Galaxy; s: StarSystem; inside: boolean }) {
  const arm = s.anchor.kind === "arm" ? g.arms.find((a) => s.anchor.kind === "arm" && a.slot === s.anchor.arm) : undefined;
  const where = s.anchor.kind === "home" ? "Système d'accueil" : s.anchor.kind === "real" ? `Étoile réelle · ${s.anchor.name}` : `${arm?.label} · ${arm ? ARM_ASTRO_NAMES[arm.slot] : ""}`;
  const running = useUi((st) => st.running);
  return (
    <>
      <Head glyph={<span style={{ color: s.anchor.kind === "home" ? "#ffd27a" : "#cfe0ff" }}>{s.anchor.kind === "home" ? "☀" : "✦"}</span>} title={s.name} subtitle={where} onClose={() => actions.select(null)} />
      <div className="inspector-body">
        <div className="facts">
          <Fact label="État" value={s.anchor.kind === "home" ? "Accueil" : STATUS_LABEL[s.status]} />
          <Fact label="Planètes" value={String(s.planets.length)} />
        </div>
        {s.notes && <p style={{ margin: 0, color: "var(--muted)", whiteSpace: "pre-wrap", userSelect: "text" }}>{s.notes}</p>}
        {!inside && (
          <button className="btn btn-primary" onClick={() => actions.enterSystem(s.id)}>
            <ArrowRight /> Entrer dans le système <Kbd>↵</Kbd>
          </button>
        )}
        <div className="section-title">Planètes</div>
        {s.planets.length ? (
          <div className="list">
            {s.planets.map((p) => (
              <button key={p.id} className="list-item" onClick={() => actions.focusPlanet(p.id)} onDoubleClick={() => actions.launchPlanet(p.id)}>
                <span className="list-icon">
                  <Glyph icon={p.icon} kind={p.target.kind} />
                </span>
                <span className="grow">
                  <b>{p.name}</b>
                  <small>{running.has(p.id) ? "● ouverte" : `${TARGET_LABELS[p.target.kind]} · ${relativeTime(p.usage.lastLaunched, Date.now())}`}</small>
                </span>
                <Play style={{ width: 14, height: 14, color: "var(--faint)" }} onClick={(e) => (e.stopPropagation(), actions.launchPlanet(p.id))} />
              </button>
            ))}
          </div>
        ) : (
          <div className="empty">Aucune planète. Ajoute une application, un dossier ou un lien — ou dépose un fichier sur la fenêtre.</div>
        )}
        <div className="row">
          <button className="btn" onClick={() => actions.newPlanet(undefined, s.id)}>
            <Plus /> Planète
          </button>
          <button className="btn" onClick={() => useUi.getState().set({ editor: { type: "system", systemId: s.id } })}>
            <Pencil /> Modifier
          </button>
        </div>
        {s.anchor.kind !== "home" && (
          <button className="btn btn-danger" onClick={() => actions.archiveSystem(s.id)}>
            <Trash2 /> Envoyer au trou noir
          </button>
        )}
      </div>
    </>
  );
}

function PlanetView({ g, system, planet }: { g: Galaxy; system: StarSystem; planet: Planet }) {
  const running = useUi((s) => s.running.has(planet.id));
  const score = usageScore(planet.usage, Date.now());
  return (
    <>
      <Head glyph={<Glyph icon={planet.icon} kind={planet.target.kind} size={28} />} title={planet.name} subtitle={`${TARGET_LABELS[planet.target.kind]} · ${system.name}${running ? " · ouverte" : ""}`} onClose={() => actions.select(null)} />
      <div className="inspector-body">
        <button className="btn btn-primary" onClick={() => actions.launchPlanet(planet.id)}>
          <Play /> Lancer <Kbd>↵</Kbd>
        </button>
        <div className="target-line" title={planet.target.value}>
          {planet.target.value}
          {planet.target.args?.length ? ` ${planet.target.args.join(" ")}` : ""}
        </div>
        <div className="facts">
          <Fact label="Lancements" value={String(planet.usage.launchCount)} />
          <Fact label="Dernier usage" value={relativeTime(planet.usage.lastLaunched, Date.now())} />
          <Fact label="Éclat" value={`${Math.round(score * 100)} %`} />
          <Fact label="Lunes" value={String(planet.moons.length)} />
        </div>
        {planet.moons.length > 0 && (
          <>
            <div className="section-title">Lunes · actions</div>
            <div className="list">
              {planet.moons.map((m) => (
                <button key={m.id} className="list-item" onClick={() => actions.launchMoon(planet.id, m.id)}>
                  <span className="list-icon">
                    <Glyph kind={m.target.kind} />
                  </span>
                  <span className="grow">
                    <b>{m.name}</b>
                    <small>{m.target.value}</small>
                  </span>
                  <CornerDownLeft style={{ width: 14, height: 14, color: "var(--faint)" }} />
                </button>
              ))}
            </div>
          </>
        )}
        <div className="field">
          <label htmlFor="move-to">Système</label>
          <select id="move-to" className="select" value={system.id} onChange={(e) => useWorkspace.getState().apply((ws) => movePlanet(ws, planet.id, e.target.value))}>
            {g.systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button className="btn" onClick={() => useUi.getState().set({ editor: { type: "planet", planetId: planet.id, systemId: system.id } })}>
            <Pencil /> Modifier
          </button>
          <button className="btn btn-danger" onClick={() => actions.archivePlanet(planet.id)}>
            <Trash2 /> Trou noir
          </button>
        </div>
      </div>
    </>
  );
}
