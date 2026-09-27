import { ArrowRight, Compass, Download, Eye, Inbox, Layers, Monitor, Orbit, Plus, Rocket, Search, Settings, Sparkles, Sun, Tag } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as actions from "../app/actions";
import { universe } from "../engine/instance";
import { activeGalaxy } from "../model/ops";
import { rank, type Match } from "../model/search";
import { usageScore } from "../model/usage";
import { bridge, isDesktop } from "../platform";
import { useUi } from "../store/ui";
import { useWorkspace } from "../store/workspace";
import { Glyph, Kbd, MOD, TARGET_LABELS, useEscape } from "./common";

interface Entry {
  key: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: ReactNode;
  /** Action principale (Entrée). */
  run: () => void;
  /** Action secondaire (Maj + Entrée). */
  alt?: { label: string; run: () => void };
  hint: string;
  boost?: number;
}

function Highlight({ text, match }: { text: string; match?: Match }) {
  if (!match?.positions.length) return <>{text}</>;
  const set = new Set(match.positions);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>,
      )}
    </>
  );
}

export function Launcher() {
  const open = useUi((s) => s.launcherOpen);
  if (!open) return null;
  return <LauncherInner />;
}

function LauncherInner() {
  const ws = useWorkspace((s) => s.ws)!;
  const set = useUi((s) => s.set);
  const discovered = useUi((s) => s.discovered);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => {
    set({ launcherOpen: false });
    void bridge.raiseWallpaper(false);
  };
  useEscape(close);

  useEffect(() => {
    inputRef.current?.focus();
    // Les applications installées sont découvertes une fois, à la première ouverture.
    if (!useUi.getState().discovered) bridge.discoverApps().then((apps) => useUi.getState().set({ discovered: apps }), () => useUi.getState().set({ discovered: [] }));
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const g = activeGalaxy(ws);
    const now = Date.now();
    const out: Entry[] = [];
    const run = (fn: () => void) => () => {
      close();
      fn();
    };
    for (const s of g.systems) {
      for (const p of s.planets) {
        out.push({
          key: `p:${p.id}`,
          group: "Planètes",
          title: p.name,
          subtitle: `${TARGET_LABELS[p.target.kind]} · ${s.name}`,
          icon: <Glyph icon={p.icon} kind={p.target.kind} />,
          run: run(() => actions.launchPlanet(p.id)),
          alt: { label: "Y aller", run: run(() => actions.focusPlanet(p.id)) },
          hint: "Lancer",
          boost: usageScore(p.usage, now) * 120,
        });
        for (const m of p.moons)
          out.push({
            key: `m:${m.id}`,
            group: "Lunes",
            title: `${p.name} › ${m.name}`,
            subtitle: m.target.value,
            icon: <Glyph kind={m.target.kind} />,
            run: run(() => actions.launchMoon(p.id, m.id)),
            hint: "Lancer",
          });
      }
      out.push({
        key: `s:${s.id}`,
        group: "Systèmes",
        title: s.name,
        subtitle: s.anchor.kind === "home" ? "Système d'accueil" : `${s.planets.length} planète${s.planets.length > 1 ? "s" : ""}`,
        icon: s.anchor.kind === "home" ? <Sun /> : <Sparkles />,
        run: run(() => actions.enterSystem(s.id)),
        hint: "Entrer",
        boost: 10,
      });
    }
    for (const a of g.arms)
      out.push({ key: `a:${a.slot}`, group: "Bras", title: a.label, icon: <Tag style={{ color: a.color }} />, run: run(() => actions.flyToArm(a.slot)), hint: "Voler" });

    const command = (key: string, title: string, icon: ReactNode, fn: () => void, subtitle?: string) =>
      out.push({ key: `c:${key}`, group: "Actions", title, subtitle, icon, run: run(fn), hint: "Exécuter", boost: -20 });
    command("new-planet", "Nouvelle planète", <Plus />, () => actions.newPlanet(), "Application, fichier, dossier, lien ou commande");
    command("new-system", "Nouveau système", <Sparkles />, () => actions.newSystem(), "Un projet, sur un bras ou autour d'une vraie étoile");
    command("overview", "Vue d'ensemble de la galaxie", <Compass />, () => actions.overview());
    command("home", "Aller au Soleil", <Sun />, () => actions.goHome());
    command("blackhole", "Trou noir — archives", <Orbit />, () => set({ panel: "blackhole" }));
    command("nebula", "Nébuleuse — téléchargements récents", <Inbox />, () => set({ panel: "nebula" }));
    command("import", "Importer des applications installées", <Download />, () => set({ panel: "import" }));
    command("constellations", ws.settings.showConstellations ? "Masquer les constellations" : "Afficher les constellations", <Eye />, () =>
      useWorkspace.getState().apply((w) => ({ ...w, settings: { ...w.settings, showConstellations: !w.settings.showConstellations } }), { undoable: false }),
    );
    command("settings", "Paramètres", <Settings />, () => set({ panel: "settings" }));
    if (isDesktop) command("wallpaper", useUi.getState().wallpaper ? "Quitter le mode fond d'écran" : "Mode fond d'écran", <Monitor />, () => actions.setWallpaper(!useUi.getState().wallpaper));
    for (const other of ws.galaxies)
      if (other.id !== ws.activeGalaxy)
        command(`galaxy:${other.id}`, `Changer de galaxie : ${other.name}`, <Layers />, () => {
          actions.select(null);
          useWorkspace.getState().apply((w) => ({ ...w, activeGalaxy: other.id }), { undoable: false });
        });

    // Applications installées pas encore en orbite : un Entrée les ajoute et les lance.
    const known = new Set(g.systems.flatMap((s) => s.planets.map((p) => p.target.value)));
    for (const app of discovered ?? []) {
      if (known.has(app.target.value)) continue;
      out.push({
        key: `d:${app.target.value}`,
        group: "Applications installées",
        title: app.name,
        subtitle: "Pas encore dans ta galaxie",
        icon: <Glyph icon={app.icon} kind="app" />,
        run: run(() => bridge.launch(app.target).catch((e) => actions.toastError(app.name, e))),
        alt: { label: "Ajouter", run: run(() => actions.newPlanet({ name: app.name, target: app.target, icon: app.icon })) },
        hint: "Lancer",
        boost: -40,
      });
    }
    return out;
  }, [ws, discovered]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      // Sans recherche : favoris, puis actions utiles.
      const planets = entries.filter((e) => e.group === "Planètes").sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0)).slice(0, 8);
      const cmds = entries.filter((e) => e.group === "Actions").slice(0, 6);
      return [...planets.map((e) => ({ entry: { ...e, group: "Favoris" }, match: undefined })), ...cmds.map((e) => ({ entry: e, match: undefined }))];
    }
    const ranked = rank(q, entries, (e) => e.title, (e) => e.boost ?? 0).map((r) => ({ entry: r.item, match: r.match as Match | undefined }));
    // Étoiles réelles : seulement quand on les cherche vraiment (3 lettres ou plus).
    if (q.length >= 3) {
      const stars = rank(q, [...(universe()?.namedStars ?? [])], (s) => s.name, (s) => -10 - s.mag)
        .slice(0, 5)
        .map((r) => ({
          entry: {
            key: `star:${r.item.hygId}`,
            group: "Étoiles réelles",
            title: r.item.name,
            subtitle: `${r.item.constellation} · ${r.item.offset.length().toFixed(1).replace(".", ",")} pc`,
            icon: <Sparkles style={{ color: "#cfe0ff" }} />,
            run: () => {
              close();
              actions.flyToRealStar(r.item.hygId, r.item.name);
            },
            alt: {
              label: "Adopter",
              run: () => {
                close();
                actions.adoptStar(r.item.hygId, r.item.name);
              },
            },
            hint: "Voler",
          } satisfies Entry,
          match: r.match as Match | undefined,
        }));
      ranked.push(...stars);
      ranked.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0));
    }
    // Ajout rapide d'une URL tapée telle quelle.
    if (/^https?:\/\/\S+\.\S+/.test(q)) {
      ranked.unshift({
        entry: {
          key: "url",
          group: "Lien",
          title: `Ouvrir ${q}`,
          icon: <ArrowRight />,
          run: () => {
            close();
            bridge.launch({ kind: "url", value: q }).catch((e) => actions.toastError("Lien", e));
          },
          alt: {
            label: "En faire une planète",
            run: () => {
              close();
              actions.newPlanet({ target: { kind: "url", value: q } });
            },
          },
          hint: "Ouvrir",
        },
        match: undefined,
      });
    }
    return ranked.slice(0, 40);
  }, [query, entries]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[active]?.entry;
      if (!r) return;
      if (e.shiftKey && r.alt) r.alt.run();
      else r.run();
    }
  };

  let lastGroup = "";
  return (
    <>
      <div className="backdrop" onClick={close} />
      <div className="launcher glass" role="dialog" aria-modal="true" aria-label="Lanceur">
        <div className="launcher-input">
          <Search />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Une planète, un système, une étoile, une action…"
            aria-label="Recherche"
            aria-controls="launcher-results"
            aria-activedescendant={results[active] ? `r-${active}` : undefined}
            spellCheck={false}
            autoComplete="off"
          />
          <Kbd>Échap</Kbd>
        </div>
        <div className="launcher-results" id="launcher-results" role="listbox" ref={listRef}>
          {results.length === 0 && <div className="empty">Rien dans cette galaxie ne correspond à « {query} ».</div>}
          {results.map(({ entry, match }, i) => {
            const header = entry.group !== lastGroup ? <div className="launcher-group">{entry.group}</div> : null;
            lastGroup = entry.group;
            return (
              <div key={entry.key}>
                {header}
                <button
                  id={`r-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`result ${i === active ? "is-active" : ""}`}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={(e) => (e.shiftKey && entry.alt ? entry.alt.run() : entry.run())}
                >
                  <span className="list-icon">{entry.icon}</span>
                  <span className="grow">
                    <b>
                      <Highlight text={entry.title} match={match} />
                    </b>
                    {entry.subtitle && <small>{entry.subtitle}</small>}
                  </span>
                  <span className="result-hint">
                    {entry.hint} <Kbd>↵</Kbd>
                    {entry.alt && (
                      <>
                        {" "}
                        · {entry.alt.label} <Kbd>⇧↵</Kbd>
                      </>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="launcher-foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> naviguer
          </span>
          <span>
            <Kbd>↵</Kbd> lancer
          </span>
          <span>
            <Kbd>⇧ ↵</Kbd> action secondaire
          </span>
          <span style={{ marginLeft: "auto" }}>
            <Rocket style={{ width: 12, height: 12 }} /> {MOD} K ou le raccourci global
          </span>
        </div>
      </div>
    </>
  );
}
