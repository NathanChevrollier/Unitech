import { describe, expect, it } from "vitest";
import defaultFixture from "../../fixtures/default-workspace.json";
import sampleFixture from "../../fixtures/sample-workspace.json";
import { armForCategories, armForName, hash32, nameFromTarget, planetKind } from "./classify";
import { defaultWorkspace, newId } from "./defaults";
import { normalizeWorkspace } from "./normalize";
import * as ops from "./ops";
import { fold, fuzzyMatch, rank } from "./search";
import type { Workspace } from "./types";
import { relativeTime, usageScore } from "./usage";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe("valeurs par défaut", () => {
  it("correspondent au témoin partagé avec Rust", () => {
    expect(defaultWorkspace()).toEqual(defaultFixture);
  });

  it("produisent des identifiants acceptés par la validation Rust", () => {
    const id = newId("pl");
    expect(id).toMatch(/^pl-[0-9a-f]{16}$/);
    expect(newId("pl")).not.toBe(id);
  });
});

describe("normalisation", () => {
  it("conserve intégralement un espace de travail valide", () => {
    expect(normalizeWorkspace(sampleFixture)).toEqual(sampleFixture);
  });

  it("répare ou remplace les données invalides", () => {
    expect(normalizeWorkspace(null)).toEqual(defaultWorkspace());
    expect(normalizeWorkspace({ version: 99, galaxies: [] })).toEqual(defaultWorkspace());
    const ws = normalizeWorkspace({ version: 1, activeGalaxy: "x", galaxies: [{ id: "g", systems: [{ id: "s", anchor: { kind: "arm", arm: "nope" } }], arms: [] }] });
    expect(ws.activeGalaxy).toBe("g");
    expect(ws.galaxies[0].arms).toHaveLength(5);
    expect(ws.galaxies[0].systems.map((s) => s.anchor.kind)).toEqual(["home"]);
  });
});

describe("usage", () => {
  it("donne les mêmes valeurs que l'implémentation Rust", () => {
    expect(usageScore({ launchCount: 10, lastLaunched: NOW }, NOW)).toBeCloseTo(0.452151, 5);
    expect(usageScore({ launchCount: 3, lastLaunched: NOW - 14 * DAY }, NOW)).toBeCloseTo(0.176446, 5);
    expect(usageScore({ launchCount: 0 }, NOW)).toBe(0);
  });

  it("formule les durées", () => {
    expect(relativeTime(undefined, NOW)).toBe("jamais");
    expect(relativeTime(NOW - 5_000, NOW)).toBe("à l'instant");
    expect(relativeTime(NOW - 3 * 60_000, NOW)).toBe("il y a 3 min");
    expect(relativeTime(NOW - DAY, NOW)).toBe("hier");
    expect(relativeTime(NOW - 400 * DAY, NOW)).toBe("il y a 1 an");
  });
});

describe("recherche", () => {
  it("ignore accents et casse", () => {
    expect(fold("Éditeur Évolué")).toBe("editeur evolue");
    expect(fuzzyMatch("edit", "Éditeur")).not.toBeNull();
  });

  it("classe les débuts de mot avant les sous-séquences", () => {
    const names = ["Visual Studio Code", "Discord", "Code::Blocks", "Calculatrice"];
    const ranked = rank("code", names, (n) => n).map((r) => r.item);
    expect(ranked[0]).toBe("Code::Blocks");
    expect(ranked).toContain("Visual Studio Code");
    expect(ranked).not.toContain("Calculatrice");
    expect(rank("vsc", names, (n) => n)[0].item).toBe("Visual Studio Code");
  });

  it("renvoie les positions à surligner", () => {
    expect(fuzzyMatch("dis", "Discord")!.positions).toEqual([0, 1, 2]);
  });
});

describe("classification", () => {
  it("choisit un bras d'après les catégories ou le nom", () => {
    expect(armForCategories(["GNOME", "Development"])).toBe("perseus");
    expect(armForCategories(["Game"])).toBe("scutumCentaurus");
    expect(armForCategories(["Utility"])).toBe("orion");
    expect(armForName("Steam")).toBe("scutumCentaurus");
    expect(armForName("Inconnu")).toBeNull();
  });

  it("dérive un type de planète stable", () => {
    const p = { id: "pl-1", kind: "auto" as const, target: { kind: "app" as const, value: "x" } };
    expect(planetKind(p)).toBe(planetKind(p));
    expect(planetKind({ ...p, kind: "lava" })).toBe("lava");
    expect(planetKind({ ...p, target: { kind: "folder", value: "/" } })).toBe("ice");
    expect(hash32("a")).not.toBe(hash32("b"));
  });

  it("propose un nom lisible", () => {
    expect(nameFromTarget({ kind: "url", value: "https://www.github.com/x" })).toBe("github.com");
    expect(nameFromTarget({ kind: "app", value: "C:\\Games\\Doom.exe" })).toBe("Doom");
    expect(nameFromTarget({ kind: "folder", value: "/home/n/Projets/" })).toBe("Projets");
  });
});

describe("opérations", () => {
  const base = (): Workspace => defaultWorkspace();
  const home = (ws: Workspace) => ops.homeOf(ops.activeGalaxy(ws));

  it("ajoute un système sur un bras à une place libre", () => {
    let ws = base();
    const g = ops.activeGalaxy(ws);
    const a = ops.freeArmSlot(g, "perseus");
    const r1 = ops.addSystem(ws, { name: "Zenytt", anchor: { kind: "arm", arm: "perseus", ...a } }, NOW);
    ws = r1.ws;
    const b = ops.freeArmSlot(ops.activeGalaxy(ws), "perseus");
    expect(Math.abs(a.t - b.t)).toBeGreaterThan(0.3);
    expect(ops.activeGalaxy(ws).systems).toHaveLength(2);
    expect(ops.findSystem(ops.activeGalaxy(ws), r1.id)?.name).toBe("Zenytt");
  });

  it("n'autorise qu'un seul système d'accueil, immobile", () => {
    let ws = base();
    const r = ops.addSystem(ws, { name: "Faux soleil", anchor: { kind: "home" } }, NOW);
    ws = r.ws;
    expect(ops.activeGalaxy(ws).systems.filter((s) => s.anchor.kind === "home")).toHaveLength(1);
    ws = ops.updateSystem(ws, home(ws).id, { anchor: { kind: "arm", arm: "norma", t: 0.5, offset: 0 }, name: "Maison" });
    expect(home(ws).anchor.kind).toBe("home");
    expect(home(ws).name).toBe("Maison");
    expect(ops.archiveSystem(ws, home(ws).id, NOW)).toBe(ws);
  });

  it("jette une planète dans le trou noir puis la restaure", () => {
    let ws = base();
    const { ws: w1, id } = ops.addPlanet(ws, home(ws).id, { name: "Firefox", target: { kind: "app", value: "firefox" } }, NOW);
    ws = ops.recordPlanetLaunch(w1, id, NOW);
    expect(home(ws).planets[0].usage).toEqual({ launchCount: 1, lastLaunched: NOW });
    ws = ops.archivePlanet(ws, id, NOW);
    expect(home(ws).planets).toHaveLength(0);
    const archived = ops.activeGalaxy(ws).archive[0];
    expect(archived.payload.type).toBe("planet");
    ws = ops.restoreArchived(ws, archived.id);
    expect(home(ws).planets[0].id).toBe(id);
    expect(ops.activeGalaxy(ws).archive).toHaveLength(0);
  });

  it("ramène au Soleil une planète dont le système a disparu", () => {
    let ws = base();
    const s = ops.addSystem(ws, { name: "Projet", anchor: { kind: "arm", arm: "norma", t: 0.4, offset: 0 } }, NOW);
    const p = ops.addPlanet(s.ws, s.id, { name: "Doc", target: { kind: "file", value: "/a" } }, NOW);
    ws = ops.archivePlanet(p.ws, p.id, NOW);
    ws = ops.archiveSystem(ws, s.id, NOW);
    ws = ops.purgeArchived(ws, ops.activeGalaxy(ws).archive[0].id);
    ws = ops.restoreArchived(ws, ops.activeGalaxy(ws).archive[0].id);
    expect(home(ws).planets.map((x) => x.name)).toEqual(["Doc"]);
  });

  it("déplace une planète entre systèmes", () => {
    const s = ops.addSystem(base(), { name: "B", anchor: { kind: "arm", arm: "orion", t: 0.5, offset: 0 } }, NOW);
    const p = ops.addPlanet(s.ws, home(s.ws).id, { name: "X", target: { kind: "url", value: "https://x.y" } }, NOW);
    const ws = ops.movePlanet(p.ws, p.id, s.id);
    expect(home(ws).planets).toHaveLength(0);
    expect(ops.findPlanet(ops.activeGalaxy(ws), p.id)?.system.id).toBe(s.id);
  });

  it("gère plusieurs galaxies", () => {
    let ws = base();
    const r = ops.addGalaxy(ws, "Travail", NOW);
    ws = r.ws;
    expect(ws.activeGalaxy).toBe(r.id);
    expect(ops.activeGalaxy(ws).systems[0].anchor.kind).toBe("home");
    ws = ops.removeGalaxy(ws, r.id);
    expect(ws.galaxies).toHaveLength(1);
    expect(ws.activeGalaxy).toBe("perso");
    expect(ops.removeGalaxy(ws, "perso")).toBe(ws);
  });
});
