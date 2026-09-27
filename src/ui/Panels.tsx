import { Check, Download, ExternalLink, FolderOpen, Plus, RotateCcw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as actions from "../app/actions";
import { QUALITY_LABELS } from "../engine/quality";
import { importApps, suggestArm } from "../app/importApps";
import { ARM_ASTRO_NAMES, DEFAULT_SHORTCUT } from "../model/defaults";
import * as ops from "../model/ops";
import type { ArmSlot, Quality, Settings } from "../model/types";
import { relativeTime } from "../model/usage";
import { bridge, isDesktop, type DiscoveredApp } from "../platform";
import { useUi } from "../store/ui";
import { useWorkspace } from "../store/workspace";
import { Dialog, Glyph, Kbd, MOD, Seg, Sheet, TARGET_LABELS, Toggle, formatBytes } from "./common";

export function Panels() {
  const panel = useUi((s) => s.panel);
  switch (panel) {
    case "settings":
      return <SettingsPanel />;
    case "blackhole":
      return <BlackHolePanel />;
    case "nebula":
      return <NebulaPanel />;
    case "help":
      return <HelpPanel />;
    case "import":
      return <ImportPanel />;
    default:
      return null;
  }
}

const closePanel = () => useUi.getState().set({ panel: null });

function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  useWorkspace.getState().apply((w) => ({ ...w, settings: { ...w.settings, [key]: value } }), { undoable: false });
}

// --- Paramètres ---

function SettingsPanel() {
  const ws = useWorkspace((s) => s.ws)!;
  const storagePath = useWorkspace((s) => s.storagePath);
  const wallpaper = useUi((s) => s.wallpaper);
  const st = ws.settings;
  const g = ops.activeGalaxy(ws);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [shortcut, setShortcut] = useState(st.globalShortcut);
  const [capturing, setCapturing] = useState(false);
  const [newGalaxy, setNewGalaxy] = useState("");

  useEffect(() => {
    if (isDesktop) bridge.getAutostart().then(setAutostart, () => setAutostart(null));
  }, []);

  const applyShortcut = async (accel: string) => {
    try {
      await bridge.setShortcut(accel);
      setSetting("globalShortcut", accel);
      setShortcut(accel);
      useUi.getState().toast({ tone: "success", text: `Raccourci global : ${accel}` }, 2500);
    } catch (e) {
      setShortcut(st.globalShortcut);
      actions.toastError("Raccourci", e);
    }
  };

  // Capture d'un raccourci au clavier, converti dans la syntaxe de Tauri.
  const onCapture = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") return setCapturing(false);
    if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (!parts.length) return;
    const code = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : e.code;
    setCapturing(false);
    void applyShortcut([...parts, code].join("+"));
  };

  return (
    <Sheet title="Paramètres" subtitle="Rendu, bureau, galaxies et données" onClose={closePanel}>
      <div className="card">
        <h3>Rendu</h3>
        <div className="field">
          <span className="field-label">Qualité</span>
          <Seg<Quality> label="Qualité" value={st.quality} onChange={(q) => setSetting("quality", q)} options={(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => ({ value: q, label: QUALITY_LABELS[q] }))} />
          <span className="field-hint">La résolution s'adapte aussi toute seule si l'ordinateur peine à suivre.</span>
        </div>
        <div>
          <Toggle label="Halo lumineux (bloom)" checked={st.bloom} onChange={(v) => setSetting("bloom", v)} />
          <Toggle label="Étiquettes" hint="Touche L" checked={st.showLabels} onChange={(v) => setSetting("showLabels", v)} />
          <Toggle label="Constellations" hint="Visibles depuis les environs du Soleil · touche C" checked={st.showConstellations} onChange={(v) => setSetting("showConstellations", v)} />
          <Toggle label="Rotation de la galaxie" hint="Un tour par jour, calé sur l'heure réelle" checked={st.galaxyRotation} onChange={(v) => setSetting("galaxyRotation", v)} />
          <Toggle label="Mouvement orbital" checked={st.orbitMotion} onChange={(v) => setSetting("orbitMotion", v)} />
          <Toggle label="Réduire les animations" checked={st.reducedMotion} onChange={(v) => setSetting("reducedMotion", v)} />
        </div>
      </div>

      <div className="card">
        <h3>Bureau</h3>
        <div className="field">
          <span className="field-label">Raccourci global du lanceur</span>
          <div className="input-group">
            <input
              className="input"
              readOnly
              value={capturing ? "Appuie sur la combinaison…" : shortcut}
              onKeyDown={capturing ? onCapture : undefined}
              onFocus={() => setCapturing(true)}
              onBlur={() => setCapturing(false)}
              disabled={!isDesktop}
            />
            <button className="btn" disabled={!isDesktop || shortcut === DEFAULT_SHORTCUT} onClick={() => applyShortcut(DEFAULT_SHORTCUT)}>
              Défaut
            </button>
          </div>
          <span className="field-hint">Fonctionne même quand Unitech est en arrière-plan. Dans la fenêtre : {MOD} K.</span>
        </div>
        <div>
          <Toggle label="Mode fond d'écran" hint="Plein écran, derrière toutes les fenêtres ; le raccourci global le ramène devant" checked={wallpaper} disabled={!isDesktop} onChange={(v) => actions.setWallpaper(v)} />
          <Toggle label="Réduire dans la zone de notification à la fermeture" checked={st.closeToTray} disabled={!isDesktop} onChange={(v) => setSetting("closeToTray", v)} />
          <Toggle
            label="Lancer au démarrage de la session"
            checked={!!autostart}
            disabled={!isDesktop || autostart === null}
            onChange={async (v) => {
              try {
                await bridge.setAutostart(v);
                setAutostart(v);
              } catch (e) {
                actions.toastError("Démarrage automatique", e);
              }
            }}
          />
        </div>
        <button className="btn" onClick={() => useUi.getState().set({ panel: "import" })}>
          <Download /> Importer des applications installées
        </button>
      </div>

      <div className="card">
        <h3>Catégories (bras de {g.name})</h3>
        {g.arms.map((a) => (
          <div key={a.slot} className="input-group" style={{ alignItems: "center" }}>
            <input type="color" value={a.color} onChange={(e) => useWorkspace.getState().apply((w) => ops.updateArm(w, a.slot, { color: e.target.value }))} style={{ width: 34, height: 34, border: 0, background: "none", padding: 0 }} aria-label={`Couleur de ${a.label}`} />
            <input className="input" value={a.label} maxLength={40} onChange={(e) => useWorkspace.getState().apply((w) => ops.updateArm(w, a.slot, { label: e.target.value }))} aria-label={ARM_ASTRO_NAMES[a.slot]} title={ARM_ASTRO_NAMES[a.slot]} />
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Galaxies (profils)</h3>
        <div className="list">
          {ws.galaxies.map((gal) => (
            <div key={gal.id} className={`list-item ${gal.id === ws.activeGalaxy ? "is-active" : ""}`}>
              <span className="list-icon">🌌</span>
              <input className="input" value={gal.name} maxLength={80} onChange={(e) => useWorkspace.getState().apply((w) => ops.renameGalaxy(w, gal.id, e.target.value))} style={{ flex: 1 }} aria-label="Nom de la galaxie" />
              {gal.id !== ws.activeGalaxy && (
                <button
                  className="btn btn-small"
                  onClick={() => {
                    actions.select(null);
                    useWorkspace.getState().apply((w) => ops.setActiveGalaxy(w, gal.id), { undoable: false });
                  }}
                >
                  Ouvrir
                </button>
              )}
              {ws.galaxies.length > 1 && (
                <button
                  className="btn btn-small btn-danger"
                  onClick={() => {
                    void bridge.confirm(`Supprimer la galaxie « ${gal.name} » et tout son contenu ?`).then((ok) => ok && useWorkspace.getState().apply((w) => ops.removeGalaxy(w, gal.id)));
                  }}
                  aria-label={`Supprimer ${gal.name}`}
                >
                  <Trash2 />
                </button>
              )}
            </div>
          ))}
        </div>
        <form
          className="input-group"
          onSubmit={(e) => {
            e.preventDefault();
            actions.select(null);
            useWorkspace.getState().apply((w) => ops.addGalaxy(w, newGalaxy || "Travail", Date.now()).ws);
            setNewGalaxy("");
          }}
        >
          <input className="input" value={newGalaxy} onChange={(e) => setNewGalaxy(e.target.value)} placeholder="Travail, Études…" maxLength={80} />
          <button className="btn" type="submit">
            <Plus /> Créer
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Données</h3>
        <div className="row">
          <button className="btn" onClick={() => bridge.exportWorkspace(ws).catch((e) => actions.toastError("Export", e))}>
            <Upload /> Exporter
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                const imported = await bridge.importWorkspace();
                if (!imported) return;
                if (!(await bridge.confirm("Remplacer tout l'espace de travail actuel par le fichier importé ?"))) return;
                actions.select(null);
                useWorkspace.getState().replace(imported);
                useUi.getState().toast({ tone: "success", text: "Espace de travail importé" });
              } catch (e) {
                actions.toastError("Import", e);
              }
            }}
          >
            <Download /> Importer
          </button>
        </div>
        {storagePath && <div className="target-line">{storagePath}</div>}
        <span className="field-hint">Sauvegarde automatique, avec copie de sécurité du fichier précédent.</span>
      </div>

      <div className="card">
        <h3>À propos</h3>
        <span className="field-hint">
          Unitech {__APP_VERSION__} · étoiles réelles : catalogue HYG v4.1 (David Nash, CC BY-SA 4.0) · constellations : d3-celestial (Olaf Frohn, BSD) · bruit procédural : webgl-noise (Ashima Arts, MIT) · rendu : three.js (MIT).
        </span>
      </div>
    </Sheet>
  );
}

// --- Trou noir ---

function BlackHolePanel() {
  const ws = useWorkspace((s) => s.ws)!;
  const g = ops.activeGalaxy(ws);
  const apply = useWorkspace((s) => s.apply);
  return (
    <Sheet
      title="Trou noir"
      subtitle={`Sagittarius A* · ${g.archive.length} élément${g.archive.length > 1 ? "s" : ""} archivé${g.archive.length > 1 ? "s" : ""}`}
      onClose={closePanel}
      footer={
        g.archive.length > 0 ? (
          <button
            className="btn btn-danger"
            onClick={() => {
              void bridge.confirm("Effacer définitivement toutes les archives de cette galaxie ?").then((ok) => ok && apply((w) => ops.purgeArchived(w, "all")));
            }}
          >
            <Trash2 /> Tout effacer
          </button>
        ) : undefined
      }
    >
      {g.archive.length === 0 ? (
        <div className="empty">Le trou noir est vide. Sélectionne une planète ou un système puis appuie sur Suppr pour l'y envoyer.</div>
      ) : (
        <div className="list">
          {g.archive.map((a) => {
            const p = a.payload;
            const title = p.type === "system" ? p.system.name : p.planet.name;
            const sub = p.type === "system" ? `Système · ${p.system.planets.length} planète${p.system.planets.length > 1 ? "s" : ""}` : `Planète · ${TARGET_LABELS[p.planet.target.kind]}`;
            return (
              <div key={a.id} className="list-item">
                <span className="list-icon">{p.type === "system" ? "✦" : <Glyph icon={p.planet.icon} kind={p.planet.target.kind} />}</span>
                <span className="grow">
                  <b>{title}</b>
                  <small>
                    {sub} · englouti {relativeTime(a.archivedAt, Date.now())}
                  </small>
                </span>
                <button className="btn btn-small" onClick={() => apply((w) => ops.restoreArchived(w, a.id))} title="Restaurer">
                  <RotateCcw />
                </button>
                <button className="btn btn-small btn-danger" onClick={() => apply((w) => ops.purgeArchived(w, a.id))} title="Effacer définitivement" aria-label={`Effacer ${title}`}>
                  <Trash2 />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

// --- Nébuleuse (téléchargements) ---

function NebulaPanel() {
  const downloads = useUi((s) => s.downloads);
  const ws = useWorkspace((s) => s.ws)!;
  const home = ops.homeOf(ops.activeGalaxy(ws));
  return (
    <Sheet title="Nébuleuse d'Orion" subtitle="Boîte de réception · téléchargements des trois derniers jours" onClose={closePanel}>
      {downloads.length === 0 ? (
        <div className="empty">{isDesktop ? "Aucun téléchargement récent." : "Les téléchargements apparaissent dans l'application de bureau."}</div>
      ) : (
        <div className="list">
          {downloads.map((f) => (
            <div key={f.path} className="list-item">
              <span className="list-icon">{f.isDir ? <FolderOpen /> : "☄"}</span>
              <span className="grow">
                <b title={f.path}>{f.name}</b>
                <small>
                  {f.isDir ? "Dossier" : formatBytes(f.size)} · {relativeTime(f.modified, Date.now())}
                </small>
              </span>
              <button className="btn btn-small" onClick={() => actions.openFile(f)} title="Ouvrir">
                <ExternalLink />
              </button>
              <button className="btn btn-small" onClick={() => actions.revealFile(f)} title="Ouvrir le dossier">
                <FolderOpen />
              </button>
              <button className="btn btn-small" onClick={() => actions.newPlanet({ name: f.name, target: { kind: f.isDir ? "folder" : "file", value: f.path } }, home.id)} title="Garder comme planète">
                <Plus />
              </button>
            </div>
          ))}
        </div>
      )}
      <span className="field-hint">Autour du Soleil, chaque téléchargement récent passe en comète : clique-la pour l'ouvrir.</span>
    </Sheet>
  );
}

// --- Aide ---

function HelpPanel() {
  const shortcuts: [string, React.ReactNode][] = [
    ["Lanceur", <Kbd key="k">{MOD} K</Kbd>],
    ["Lanceur (partout)", <Kbd key="g">{useWorkspace.getState().ws?.settings.globalShortcut.replace("CommandOrControl", MOD)}</Kbd>],
    ["Lancer / entrer", <Kbd key="e">Entrée</Kbd>],
    ["Double-clic", "lancer ou entrer"],
    ["Retour / désélection", <Kbd key="x">Échap</Kbd>],
    ["Vue d'ensemble", <Kbd key="h">H</Kbd>],
    ["Soleil (accueil)", <Kbd key="s">S</Kbd>],
    ["Bras 1 à 5", <Kbd key="1">1 – 5</Kbd>],
    ["Nouvelle planète", <Kbd key="n">N</Kbd>],
    ["Nouveau système", <Kbd key="ns">⇧ N</Kbd>],
    ["Modifier la sélection", <Kbd key="ed">E</Kbd>],
    ["Envoyer au trou noir", <Kbd key="d">Suppr</Kbd>],
    ["Annuler / rétablir", <Kbd key="z">{MOD} Z · {MOD} ⇧ Z</Kbd>],
    ["Trou noir / nébuleuse", <Kbd key="bi">B · I</Kbd>],
    ["Constellations / étiquettes", <Kbd key="cl">C · L</Kbd>],
    ["Paramètres", <Kbd key="p">{MOD} ,</Kbd>],
  ];
  const legend: [string, string, string][] = [
    ["🌌", "Galaxie", "Un profil complet : Perso, Travail, Études…"],
    ["〰", "Bras spiraux", "Tes catégories, portées par les vrais bras de la Voie lactée."],
    ["✦", "Système", "Un projet ou un domaine. Bleu : actif · rouge : en pause · blanc : en sommeil."],
    ["🪐", "Planète", "Une application, un fichier, un dossier, un lien ou une commande. Plus tu l'utilises, plus elle grossit et brille."],
    ["🌙", "Lune", "Une action secondaire de sa planète."],
    ["☄", "Comète", "Un téléchargement récent, en orbite autour du Soleil."],
    ["✺", "Nébuleuse d'Orion", "La boîte de réception."],
    ["◉", "Sagittarius A*", "Le trou noir central : les archives, restaurables."],
    ["☀", "Soleil", "Ton système d'accueil, au milieu de 109 000 vraies étoiles."],
  ];
  return (
    <Dialog title="Guide de la galaxie" subtitle="Raccourcis et légende" onClose={closePanel} wide>
      <div className="help-grid">
        <div>
          {shortcuts.map(([label, key]) => (
            <div key={label} className="shortcut">
              <span>{label}</span>
              <span>{key}</span>
            </div>
          ))}
        </div>
        <div className="legend">
          {legend.map(([icon, title, text]) => (
            <div key={title} style={{ display: "contents" }}>
              <span>{icon}</span>
              <div>
                <b>{title}</b>
                <br />
                <span>{text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="field-hint">
        Souris : glisser pour tourner, clic droit ou Maj pour déplacer, molette pour zoomer. Au bout de la molette, on plonge dans un système ou on en ressort. Dépose des fichiers sur la fenêtre pour créer des planètes.
      </span>
    </Dialog>
  );
}

// --- Import des applications installées (et accueil du premier lancement) ---

function ImportPanel() {
  const ws = useWorkspace((s) => s.ws)!;
  const discovered = useUi((s) => s.discovered);
  const first = !ws.settings.onboarded;
  const [picked, setPicked] = useState<Map<string, ArmSlot>>(new Map());
  const [filter, setFilter] = useState("");
  const g = ops.activeGalaxy(ws);

  useEffect(() => {
    if (!discovered) bridge.discoverApps().then((apps) => useUi.getState().set({ discovered: apps }), () => useUi.getState().set({ discovered: [] }));
  }, [discovered]);

  const known = useMemo(() => new Set(g.systems.flatMap((s) => s.planets.map((p) => p.target.value))), [g.systems]);
  const apps = useMemo(() => (discovered ?? []).filter((a) => !known.has(a.target.value) && a.name.toLowerCase().includes(filter.toLowerCase())), [discovered, known, filter]);

  const finish = (doImport: boolean) => {
    const picks = [...picked.entries()].flatMap(([value, arm]) => {
      const app = discovered?.find((a) => a.target.value === value);
      return app ? [{ app, arm }] : [];
    });
    useWorkspace.getState().apply((w) => {
      let next = doImport && picks.length ? importApps(w, picks, Date.now()) : w;
      if (!next.settings.onboarded) next = { ...next, settings: { ...next.settings, onboarded: true } };
      return next;
    });
    closePanel();
    if (doImport && picks.length) useUi.getState().toast({ tone: "success", text: `${picks.length} application${picks.length > 1 ? "s" : ""} mise${picks.length > 1 ? "s" : ""} en orbite` });
  };

  const toggle = (app: DiscoveredApp) => {
    const next = new Map(picked);
    if (next.has(app.target.value)) next.delete(app.target.value);
    else next.set(app.target.value, suggestArm(app));
    setPicked(next);
  };

  return (
    <Dialog
      title={first ? "Bienvenue dans Unitech" : "Importer des applications"}
      subtitle={first ? "Ton bureau est désormais une galaxie." : "Choisis les applications à mettre en orbite, et leur bras."}
      onClose={() => finish(false)}
      wide
      footer={
        <>
          <span className="field-hint" style={{ marginRight: "auto" }}>
            {picked.size} sélectionnée{picked.size > 1 ? "s" : ""}
          </span>
          <button className="btn btn-ghost" onClick={() => finish(false)}>
            {first ? "Commencer sans importer" : "Annuler"}
          </button>
          <button className="btn btn-primary" onClick={() => finish(true)} disabled={!picked.size}>
            Mettre en orbite
          </button>
        </>
      }
    >
      {first && (
        <>
          <div className="hero">
            <h1>Une Voie lactée pour bureau</h1>
            <p>Les bras spiraux sont tes catégories, les étoiles tes projets, les planètes tes applications, fichiers et liens. Autour du Soleil gravitent tes favoris, parmi 109 000 étoiles réelles.</p>
          </div>
          <div className="metaphor">
            <div>
              <b>
                <Kbd>{MOD} K</Kbd> pour tout
              </b>
              Chercher, lancer, voler vers un système ou une étoile.
            </div>
            <div>
              <b>Double-clic</b>
              Sur une planète pour la lancer, sur une étoile pour y plonger.
            </div>
            <div>
              <b>Glisser-déposer</b>
              Un fichier sur la fenêtre devient une planète.
            </div>
          </div>
        </>
      )}
      <div className="input-group">
        <input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrer les applications…" />
        <button className="btn" onClick={() => setPicked(new Map(apps.map((a) => [a.target.value, suggestArm(a)])))} disabled={!apps.length}>
          Tout sélectionner
        </button>
      </div>
      {!discovered ? (
        <div className="empty">Recherche des applications installées…</div>
      ) : apps.length === 0 ? (
        <div className="empty">Aucune nouvelle application trouvée.</div>
      ) : (
        <div className="app-grid">
          {apps.map((app) => {
            const arm = picked.get(app.target.value);
            return (
              <div key={app.target.value} className={`app-pick ${arm ? "is-on" : ""}`} onClick={() => toggle(app)} role="checkbox" aria-checked={!!arm} tabIndex={0} onKeyDown={(e) => e.key === " " && (e.preventDefault(), toggle(app))}>
                <span className="check">{arm && <Check />}</span>
                <span className="list-icon">
                  <Glyph icon={app.icon} kind={app.target.kind} />
                </span>
                <span className="grow">
                  <b title={app.target.value}>{app.name}</b>
                </span>
                {arm && (
                  <select
                    className="select"
                    value={arm}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setPicked(new Map(picked).set(app.target.value, e.target.value as ArmSlot))}
                    aria-label={`Bras de ${app.name}`}
                  >
                    {g.arms.map((a) => (
                      <option key={a.slot} value={a.slot}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
