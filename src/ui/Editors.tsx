import { File, Folder, FolderSearch, Globe, Plus, Rocket, Terminal, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import * as actions from "../app/actions";
import { universe } from "../engine/instance";
import { joinArgs, splitArgs } from "../model/args";
import { nameFromTarget, planetKind } from "../model/classify";
import { ARM_ASTRO_NAMES } from "../model/defaults";
import * as ops from "../model/ops";
import { rank } from "../model/search";
import type { Anchor, ArmSlot, Moon, PlanetKind, SystemStatus, Target, TargetKind } from "../model/types";
import { bridge, isDesktop } from "../platform";
import { useUi } from "../store/ui";
import { useWorkspace } from "../store/workspace";
import { Dialog, Glyph, Seg, TARGET_LABELS, Toggle } from "./common";

const KIND_ICONS: Record<TargetKind, React.ReactNode> = {
  app: <Rocket />,
  file: <File />,
  folder: <Folder />,
  url: <Globe />,
  command: <Terminal />,
};

const PLACEHOLDERS: Record<TargetKind, string> = {
  app: isDesktop ? "/usr/bin/code, C:\\…\\app.exe, /Applications/App.app, firefox" : "Disponible dans l'application de bureau",
  file: "/home/moi/Documents/rapport.pdf",
  folder: "~/Projets",
  url: "https://…",
  command: "pnpm dev",
};

const KIND_LOOKS: Record<Exclude<PlanetKind, "auto">, [string, string]> = {
  rocky: ["Rocheuse", "radial-gradient(circle at 35% 35%, #a89a88, #5b524a 70%)"],
  desert: ["Désert", "radial-gradient(circle at 35% 35%, #f0c27f, #b0652f 70%)"],
  ocean: ["Océan", "radial-gradient(circle at 35% 35%, #7ec8ff, #174f8a 55%, #2d6b2f 90%)"],
  ice: ["Glace", "radial-gradient(circle at 35% 35%, #ffffff, #9cc9e8 70%)"],
  lava: ["Lave", "radial-gradient(circle at 35% 35%, #ff8a3d, #3a1410 60%)"],
  gas: ["Gazeuse", "repeating-linear-gradient(170deg, #e2c49a 0 5px, #a8704e 5px 9px)"],
  toxic: ["Toxique", "radial-gradient(circle at 35% 35%, #e3ef6b, #5c7418 70%)"],
};

function targetError(t: Target): string | null {
  const v = t.value.trim();
  if (!v) return "Indique la cible.";
  if (t.kind === "url" && !/^[a-z][a-z0-9+.-]*:\S+$/i.test(v)) return "Adresse invalide (ex. https://exemple.fr).";
  if (t.kind === "url" && /^(javascript|data|vbscript|file):/i.test(v)) return "Ce type d'adresse n'est pas autorisé.";
  return null;
}

function TargetFields({ target, onChange, argsText, onArgs, compact }: { target: Target; onChange: (t: Target) => void; argsText?: string; onArgs?: (s: string) => void; compact?: boolean }) {
  const browse = async () => {
    try {
      const path = await bridge.pickPath(target.kind === "folder" ? "folder" : target.kind === "app" ? "app" : "file");
      if (path) onChange({ ...target, value: path });
    } catch (e) {
      actions.toastError("Sélection", e);
    }
  };
  const canBrowse = isDesktop && ["app", "file", "folder"].includes(target.kind);
  return (
    <>
      <Seg
        label="Type de cible"
        value={target.kind}
        onChange={(kind) => onChange({ ...target, kind })}
        options={(Object.keys(TARGET_LABELS) as TargetKind[]).map((k) => ({ value: k, label: compact ? "" : TARGET_LABELS[k], icon: KIND_ICONS[k] }))}
      />
      <div className="input-group">
        <input className="input" value={target.value} placeholder={PLACEHOLDERS[target.kind]} onChange={(e) => onChange({ ...target, value: e.target.value })} spellCheck={false} aria-label="Cible" />
        {canBrowse && (
          <button type="button" className="btn" onClick={browse} title="Parcourir…">
            <FolderSearch />
          </button>
        )}
      </div>
      {!compact && (target.kind === "app" || target.kind === "command") && onArgs && (
        <div className="grid-2">
          {target.kind === "app" && (
            <div className="field">
              <label>Arguments</label>
              <input className="input" value={argsText} onChange={(e) => onArgs(e.target.value)} placeholder='--new-window "Mon projet"' spellCheck={false} />
            </div>
          )}
          <div className="field" style={target.kind === "command" ? { gridColumn: "1 / -1" } : undefined}>
            <label>Dossier de travail</label>
            <input className="input" value={target.cwd ?? ""} onChange={(e) => onChange({ ...target, cwd: e.target.value || undefined })} placeholder="(facultatif)" spellCheck={false} />
          </div>
        </div>
      )}
    </>
  );
}

export function Editors() {
  const editor = useUi((s) => s.editor);
  if (!editor) return null;
  return editor.type === "planet" ? <PlanetEditor key={editor.planetId ?? "new"} /> : <SystemEditor key={editor.systemId ?? "new"} />;
}

function PlanetEditor() {
  const editor = useUi((s) => s.editor) as Extract<NonNullable<ReturnType<typeof useUi.getState>["editor"]>, { type: "planet" }>;
  const ws = useWorkspace((s) => s.ws)!;
  const g = ops.activeGalaxy(ws);
  const existing = editor.planetId ? ops.findPlanet(g, editor.planetId)?.planet : undefined;
  const close = () => useUi.getState().set({ editor: null });

  const [name, setName] = useState(existing?.name ?? editor.preset?.name ?? "");
  const [target, setTarget] = useState<Target>(existing?.target ?? editor.preset?.target ?? { kind: isDesktop ? "app" : "url", value: "" });
  const [argsText, setArgsText] = useState(joinArgs(existing?.target.args ?? editor.preset?.target?.args));
  const [icon, setIcon] = useState(existing?.icon ?? editor.preset?.icon ?? "");
  const [kind, setKind] = useState<PlanetKind>(existing?.kind ?? "auto");
  const [ring, setRing] = useState(existing?.ring ?? false);
  const [moons, setMoons] = useState<Moon[]>(existing?.moons ?? []);
  const [systemId, setSystemId] = useState(editor.systemId);
  const [touched, setTouched] = useState(false);

  const fullTarget: Target = { kind: target.kind, value: target.value.trim(), ...(target.kind === "app" && splitArgs(argsText).length ? { args: splitArgs(argsText) } : {}), ...(target.cwd?.trim() ? { cwd: target.cwd.trim() } : {}) };
  const error = targetError(fullTarget) ?? moons.map((m) => targetError(m.target) && `Lune « ${m.name || "sans nom"} » : ${targetError(m.target)}`).find(Boolean) ?? null;
  const preview = planetKind({ id: existing?.id ?? "preview", kind, target: fullTarget });

  const save = () => {
    setTouched(true);
    if (error) return;
    const finalName = name.trim() || nameFromTarget(fullTarget) || "Planète";
    const cleanMoons = moons.map((m) => ({ ...m, name: m.name.trim() || nameFromTarget(m.target) }));
    const patch = { name: finalName, target: fullTarget, icon: icon.trim() || undefined, kind, ring, moons: cleanMoons };
    const apply = useWorkspace.getState().apply;
    if (existing) {
      apply((w) => {
        let next = ops.updatePlanet(w, existing.id, patch);
        if (systemId !== editor.systemId) next = ops.movePlanet(next, existing.id, systemId);
        return next;
      });
      useUi.getState().toast({ tone: "success", text: `${finalName} mise à jour` }, 2000);
    } else {
      apply((w) => ops.addPlanet(w, systemId, patch, Date.now()).ws);
      const sys = ops.findSystem(g, systemId);
      useUi.getState().toast({ tone: "success", text: `${finalName} est en orbite autour de ${sys?.name ?? "son étoile"}` });
    }
    close();
  };

  const onTarget = async (t: Target) => {
    setTarget(t);
    // Chemin choisi : on récupère nom et icône quand c'est possible.
    if (isDesktop && t.value !== target.value && t.value.length > 2 && (t.kind === "app" || t.kind === "file" || t.kind === "folder") && /[\\/]/.test(t.value)) {
      try {
        const info = await bridge.describePath(t.value);
        if (!name.trim()) setName(info.name);
        if (!icon && info.icon) setIcon(info.icon);
      } catch {
        // Chemin en cours de saisie : rien à faire.
      }
    }
  };

  return (
    <Dialog
      title={existing ? `Modifier ${existing.name}` : "Nouvelle planète"}
      subtitle="Une application, un fichier, un dossier, un lien ou une commande, mis en orbite."
      onClose={close}
      footer={
        <>
          {existing && (
            <button
              className="btn btn-danger"
              onClick={() => {
                close();
                actions.archivePlanet(existing.id);
              }}
            >
              <Trash2 /> Trou noir
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={close}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={save}>
            {existing ? "Enregistrer" : "Mettre en orbite"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        style={{ display: "contents" }}
      >
        <div className="field">
          <label htmlFor="pl-name">Nom</label>
          <input id="pl-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={nameFromTarget(fullTarget) || "Visual Studio Code"} maxLength={80} />
        </div>
        <div className="field">
          <span className="field-label">Cible</span>
          <TargetFields target={target} onChange={onTarget} argsText={argsText} onArgs={setArgsText} />
          {touched && error && <span className="field-hint" style={{ color: "var(--danger)" }}>{error}</span>}
          {!isDesktop && target.kind !== "url" && <span className="field-hint">Dans le navigateur, seules les planètes « Lien » se lancent.</span>}
        </div>

        <div className="card">
          <h3>Apparence</h3>
          <div className="kind-grid">
            <button type="button" className={`kind ${kind === "auto" ? "is-on" : ""}`} onClick={() => setKind("auto")}>
              <span className="kind-ball" style={{ background: KIND_LOOKS[preview][1], opacity: 0.8 }} />
              Auto
            </button>
            {(Object.keys(KIND_LOOKS) as (keyof typeof KIND_LOOKS)[]).map((k) => (
              <button type="button" key={k} className={`kind ${kind === k ? "is-on" : ""}`} onClick={() => setKind(k)}>
                <span className="kind-ball" style={{ background: KIND_LOOKS[k][1] }} />
                {KIND_LOOKS[k][0]}
              </button>
            ))}
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="pl-icon">Icône</label>
              <div className="input-group">
                <span className="list-icon" style={{ width: 38, height: 38 }}>
                  <Glyph icon={icon || undefined} kind={fullTarget.kind} size={22} />
                </span>
                {icon.startsWith("data:") ? (
                  <button type="button" className="btn" onClick={() => setIcon("")}>
                    Retirer l'image
                  </button>
                ) : (
                  <input id="pl-icon" className="input" value={icon} onChange={(e) => setIcon(Array.from(e.target.value).slice(0, 4).join(""))} placeholder="Émoji (facultatif)" />
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor="pl-sys">Système</label>
              <select id="pl-sys" className="select" value={systemId} onChange={(e) => setSystemId(e.target.value)}>
                {g.systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Toggle label="Anneaux" hint="Pour distinguer une planète importante" checked={ring} onChange={setRing} />
        </div>

        <div className="card">
          <h3>Lunes · actions secondaires</h3>
          {moons.length === 0 && <span className="field-hint">Ex. pour VS Code : « Ouvrir le projet Zenytt » (dossier), « Nouvelle fenêtre » (application avec argument).</span>}
          {moons.map((m, i) => (
            <div key={m.id} className="card" style={{ padding: 10, gap: 8 }}>
              <div className="input-group">
                <input className="input" value={m.name} placeholder="Nom de l'action" onChange={(e) => setMoons(moons.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} maxLength={80} />
                <button type="button" className="btn btn-ghost" onClick={() => setMoons(moons.filter((_, k) => k !== i))} aria-label="Retirer cette lune">
                  <X />
                </button>
              </div>
              <TargetFields compact target={m.target} onChange={(t) => setMoons(moons.map((x, k) => (k === i ? { ...x, target: t } : x)))} />
            </div>
          ))}
          {moons.length < 8 && (
            <button type="button" className="btn" onClick={() => setMoons([...moons, ops.newMoon("", { kind: "folder", value: "" })])}>
              <Plus /> Ajouter une lune
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

const COLORS = ["#7cc4ff", "#b28cff", "#ff7a59", "#4dd4ac", "#ffd166", "#ff6fb5", "#9bf06b", "#ffffff"];

function SystemEditor() {
  const editor = useUi((s) => s.editor) as Extract<NonNullable<ReturnType<typeof useUi.getState>["editor"]>, { type: "system" }>;
  const ws = useWorkspace((s) => s.ws)!;
  const g = ops.activeGalaxy(ws);
  const existing = editor.systemId ? ops.findSystem(g, editor.systemId) : undefined;
  const preset = editor.preset;
  const close = () => useUi.getState().set({ editor: null });
  const initialAnchor: Anchor = existing?.anchor ?? preset?.anchor ?? { kind: "arm", arm: "perseus", ...ops.freeArmSlot(g, "perseus") };

  const [name, setName] = useState(existing?.name ?? preset?.name ?? "");
  const [anchor, setAnchor] = useState<Anchor>(initialAnchor);
  const [status, setStatus] = useState<SystemStatus>(existing?.status ?? preset?.status ?? "active");
  const [color, setColor] = useState<string | undefined>(existing?.color ?? preset?.color);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [starQuery, setStarQuery] = useState(anchor.kind === "real" ? anchor.name : "");
  const isHome = anchor.kind === "home";

  const stars = useMemo(() => {
    const all = [...(universe()?.namedStars ?? [])];
    const taken = new Set(g.systems.flatMap((s) => (s.anchor.kind === "real" && s.id !== existing?.id ? [s.anchor.hygId] : [])));
    const free = all.filter((s) => !taken.has(s.hygId));
    return starQuery.trim() ? rank(starQuery, free, (s) => s.name).slice(0, 8).map((r) => r.item) : free.slice(0, 8);
  }, [starQuery, g.systems, existing?.id]);

  const setArm = (arm: ArmSlot) => setAnchor({ kind: "arm", arm, ...(existing?.anchor.kind === "arm" && existing.anchor.arm === arm ? existing.anchor : ops.freeArmSlot(g, arm)) });

  const save = () => {
    const finalName = name.trim() || (anchor.kind === "real" ? anchor.name : "Nouveau système");
    const apply = useWorkspace.getState().apply;
    if (existing) {
      apply((w) => ops.updateSystem(w, existing.id, { name: finalName, anchor, status, color, notes }));
      close();
      return;
    }
    let id = "";
    apply((w) => {
      const r = ops.addSystem(w, { name: finalName, anchor, status, color, notes }, Date.now());
      id = r.id;
      return r.ws;
    });
    close();
    useUi.getState().toast({ tone: "success", text: `Le système ${finalName} s'est allumé` });
    // Le moteur reçoit le nouvel état à l'image suivante : on vole ensuite jusqu'au système.
    setTimeout(() => actions.enterSystem(id), 80);
  };

  return (
    <Dialog
      title={existing ? `Modifier ${existing.name}` : "Nouveau système"}
      subtitle="Un projet ou un domaine : une étoile autour de laquelle graviteront ses planètes."
      onClose={close}
      footer={
        <>
          {existing && !isHome && (
            <button
              className="btn btn-danger"
              onClick={() => {
                close();
                actions.archiveSystem(existing.id);
              }}
            >
              <Trash2 /> Trou noir
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={close}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={save} disabled={anchor.kind === "real" && !anchor.hygId}>
            {existing ? "Enregistrer" : "Allumer l'étoile"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        style={{ display: "contents" }}
      >
        <div className="field">
          <label htmlFor="sys-name">Nom</label>
          <input id="sys-name" className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Zenytt, Musique, Études…" maxLength={80} />
        </div>

        {isHome ? (
          <div className="card">
            <h3>Système d'accueil</h3>
            <span className="field-hint">Le Soleil reste à sa place dans le bras d'Orion : c'est ton point de départ et l'emplacement de tes favoris.</span>
          </div>
        ) : (
          <div className="card">
            <h3>Emplacement</h3>
            <Seg
              label="Emplacement"
              value={anchor.kind === "real" ? "real" : "arm"}
              onChange={(v) => (v === "arm" ? setArm(anchor.kind === "arm" ? anchor.arm : "perseus") : setAnchor({ kind: "real", hygId: 0, name: "" }))}
              options={[
                { value: "arm", label: "Sur un bras" },
                { value: "real", label: "Autour d'une vraie étoile" },
              ]}
            />
            {anchor.kind === "arm" && (
              <>
                <div className="field">
                  <label htmlFor="sys-arm">Bras (catégorie)</label>
                  <select id="sys-arm" className="select" value={anchor.arm} onChange={(e) => setArm(e.target.value as ArmSlot)}>
                    {g.arms.map((a) => (
                      <option key={a.slot} value={a.slot}>
                        {a.label} — {ARM_ASTRO_NAMES[a.slot]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sys-t">Position le long du bras</label>
                  <input id="sys-t" type="range" min={0} max={1} step={0.01} value={anchor.t} onChange={(e) => setAnchor({ ...anchor, t: Number(e.target.value) })} />
                  <span className="field-hint" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Près du cœur</span>
                    <span>Vers le bord</span>
                  </span>
                </div>
              </>
            )}
            {anchor.kind === "real" && (
              <div className="field">
                <label htmlFor="sys-star">Étoile du catalogue HYG</label>
                <input id="sys-star" className="input" value={starQuery} onChange={(e) => setStarQuery(e.target.value)} placeholder="Sirius, Véga, Bételgeuse, α Cen…" spellCheck={false} />
                <div className="list">
                  {stars.map((s) => (
                    <button
                      type="button"
                      key={s.hygId}
                      className={`list-item ${anchor.hygId === s.hygId ? "is-active" : ""}`}
                      onClick={() => {
                        setAnchor({ kind: "real", hygId: s.hygId, name: s.name });
                        setStarQuery(s.name);
                        if (!name.trim()) setName(s.name);
                      }}
                    >
                      <span className="list-icon">✦</span>
                      <span className="grow">
                        <b>{s.name}</b>
                        <small>
                          {s.constellation} · {s.offset.length().toFixed(1).replace(".", ",")} pc · magnitude {s.mag.toFixed(1).replace(".", ",")}
                        </small>
                      </span>
                    </button>
                  ))}
                  {stars.length === 0 && <div className="empty">Aucune étoile libre ne correspond.</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {!isHome && (
          <div className="field">
            <span className="field-label">État du projet</span>
            <Seg
              label="État"
              value={status}
              onChange={setStatus}
              options={[
                { value: "active", label: "Actif" },
                { value: "paused", label: "En pause" },
                { value: "dormant", label: "En sommeil" },
              ]}
            />
            <span className="field-hint">Actif : étoile bleue éclatante · en pause : naine rouge · en sommeil : naine blanche.</span>
          </div>
        )}

        <div className="field">
          <span className="field-label">Couleur de l'étoile</span>
          <div className="swatches">
            <button type="button" className={`swatch ${!color ? "is-on" : ""}`} style={{ background: "conic-gradient(#7cc4ff, #ffd166, #ff7a59, #7cc4ff)" }} onClick={() => setColor(undefined)} title="Automatique" />
            {COLORS.map((c) => (
              <button type="button" key={c} className={`swatch ${color === c ? "is-on" : ""}`} style={{ background: c }} onClick={() => setColor(c)} title={c} />
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="sys-notes">Notes</label>
          <textarea id="sys-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} placeholder="Objectifs, liens, rappels…" />
        </div>
      </form>
    </Dialog>
  );
}
