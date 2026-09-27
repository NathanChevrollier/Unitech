// Opérations sur l'espace de travail. Toutes pures : elles renvoient un nouvel objet sans modifier
// l'ancien, ce qui rend l'historique (annuler) et les tests triviaux.

import { newGalaxy, newId, homeSystem } from "./defaults";
import { recordLaunch } from "./usage";
import type { Arm, ArmSlot, ArchivedItem, Galaxy, Moon, Planet, StarSystem, Workspace } from "./types";

export function activeGalaxy(ws: Workspace): Galaxy {
  return ws.galaxies.find((g) => g.id === ws.activeGalaxy) ?? ws.galaxies[0];
}

function mapActive(ws: Workspace, fn: (g: Galaxy) => Galaxy): Workspace {
  const active = activeGalaxy(ws);
  return { ...ws, galaxies: ws.galaxies.map((g) => (g.id === active.id ? fn(g) : g)) };
}

function mapSystem(ws: Workspace, systemId: string, fn: (s: StarSystem) => StarSystem): Workspace {
  return mapActive(ws, (g) => ({ ...g, systems: g.systems.map((s) => (s.id === systemId ? fn(s) : s)) }));
}

export function homeOf(g: Galaxy): StarSystem {
  return g.systems.find((s) => s.anchor.kind === "home") ?? g.systems[0];
}

export function findSystem(g: Galaxy, id: string | null | undefined): StarSystem | undefined {
  return id ? g.systems.find((s) => s.id === id) : undefined;
}

export function findPlanet(g: Galaxy, planetId: string): { system: StarSystem; planet: Planet } | undefined {
  for (const system of g.systems) {
    const planet = system.planets.find((p) => p.id === planetId);
    if (planet) return { system, planet };
  }
  return undefined;
}

/**
 * Place un nouveau système sur un bras : la position libre la plus éloignée des systèmes existants,
 * et un décalage alterné de part et d'autre de l'axe du bras.
 */
export function freeArmSlot(g: Galaxy, arm: ArmSlot): { t: number; offset: number } {
  const taken = g.systems.flatMap((s) => (s.anchor.kind === "arm" && s.anchor.arm === arm ? [s.anchor.t] : []));
  let best = 0.35;
  let bestGap = -1;
  for (let i = 0; i <= 80; i++) {
    const t = 0.14 + (0.8 * i) / 80;
    const gap = taken.length ? Math.min(...taken.map((x) => Math.abs(x - t))) : 1 - Math.abs(t - 0.35);
    if (gap > bestGap + 1e-9) {
      bestGap = gap;
      best = t;
    }
  }
  const offset = taken.length % 2 === 0 ? 0.25 : -0.25;
  return { t: Math.round(best * 1000) / 1000, offset };
}

export interface SystemInput {
  name: string;
  anchor: StarSystem["anchor"];
  status?: StarSystem["status"];
  color?: string;
  notes?: string;
}

export function addSystem(ws: Workspace, input: SystemInput, now: number): { ws: Workspace; id: string } {
  const id = newId("sys");
  const system: StarSystem = {
    id,
    name: input.name.trim() || "Nouveau système",
    anchor: input.anchor.kind === "home" ? { kind: "arm", arm: "orion", ...freeArmSlot(activeGalaxy(ws), "orion") } : input.anchor,
    status: input.status ?? "active",
    color: input.color,
    notes: input.notes ?? "",
    planets: [],
    createdAt: now,
  };
  return { ws: mapActive(ws, (g) => ({ ...g, systems: [...g.systems, system] })), id };
}

export function updateSystem(ws: Workspace, id: string, patch: Partial<Omit<StarSystem, "id" | "planets">>): Workspace {
  return mapSystem(ws, id, (s) => {
    // Le Soleil reste l'unique système d'accueil, et il ne se déplace pas.
    let anchor = patch.anchor ?? s.anchor;
    if (s.anchor.kind === "home" || anchor.kind === "home") anchor = s.anchor;
    return { ...s, ...patch, anchor };
  });
}

export type PlanetInput = Pick<Planet, "name" | "target"> & Partial<Pick<Planet, "icon" | "kind" | "ring" | "moons">>;

export function addPlanet(ws: Workspace, systemId: string, input: PlanetInput, now: number): { ws: Workspace; id: string } {
  const id = newId("pl");
  const planet: Planet = {
    id,
    name: input.name.trim() || "Planète",
    target: input.target,
    icon: input.icon,
    kind: input.kind ?? "auto",
    ring: input.ring ?? false,
    moons: input.moons ?? [],
    usage: { launchCount: 0 },
    createdAt: now,
  };
  return { ws: mapSystem(ws, systemId, (s) => ({ ...s, planets: [...s.planets, planet] })), id };
}

export function updatePlanet(ws: Workspace, planetId: string, patch: Partial<Omit<Planet, "id">>): Workspace {
  return mapActive(ws, (g) => ({
    ...g,
    systems: g.systems.map((s) => (s.planets.some((p) => p.id === planetId) ? { ...s, planets: s.planets.map((p) => (p.id === planetId ? { ...p, ...patch } : p)) } : s)),
  }));
}

export function movePlanet(ws: Workspace, planetId: string, toSystemId: string): Workspace {
  const g = activeGalaxy(ws);
  const found = findPlanet(g, planetId);
  if (!found || found.system.id === toSystemId || !findSystem(g, toSystemId)) return ws;
  return mapActive(ws, (g) => ({
    ...g,
    systems: g.systems.map((s) => {
      if (s.id === found.system.id) return { ...s, planets: s.planets.filter((p) => p.id !== planetId) };
      if (s.id === toSystemId) return { ...s, planets: [...s.planets, found.planet] };
      return s;
    }),
  }));
}

export function newMoon(name: string, target: Moon["target"]): Moon {
  return { id: newId("moon"), name, target };
}

export function recordPlanetLaunch(ws: Workspace, planetId: string, now: number): Workspace {
  const found = findPlanet(activeGalaxy(ws), planetId);
  return found ? updatePlanet(ws, planetId, { usage: recordLaunch(found.planet.usage, now) }) : ws;
}

// --- Trou noir ---

export function archivePlanet(ws: Workspace, planetId: string, now: number): Workspace {
  const found = findPlanet(activeGalaxy(ws), planetId);
  if (!found) return ws;
  const item: ArchivedItem = { id: newId("arc"), archivedAt: now, payload: { type: "planet", systemId: found.system.id, planet: found.planet } };
  return mapActive(ws, (g) => ({
    ...g,
    archive: [item, ...g.archive],
    systems: g.systems.map((s) => (s.id === found.system.id ? { ...s, planets: s.planets.filter((p) => p.id !== planetId) } : s)),
  }));
}

/** Le Soleil ne peut pas être jeté : ses planètes seraient orphelines. */
export function archiveSystem(ws: Workspace, systemId: string, now: number): Workspace {
  const system = findSystem(activeGalaxy(ws), systemId);
  if (!system || system.anchor.kind === "home") return ws;
  const item: ArchivedItem = { id: newId("arc"), archivedAt: now, payload: { type: "system", system } };
  return mapActive(ws, (g) => ({ ...g, archive: [item, ...g.archive], systems: g.systems.filter((s) => s.id !== systemId) }));
}

export function restoreArchived(ws: Workspace, archiveId: string): Workspace {
  const g = activeGalaxy(ws);
  const item = g.archive.find((a) => a.id === archiveId);
  if (!item) return ws;
  const archive = g.archive.filter((a) => a.id !== archiveId);
  if (item.payload.type === "system") {
    const system = item.payload.system;
    return mapActive(ws, (g) => ({ ...g, archive, systems: [...g.systems.filter((s) => s.id !== system.id), system] }));
  }
  const { planet } = item.payload;
  // Si son système a disparu entre-temps, la planète revient autour du Soleil.
  const targetId = findSystem(g, item.payload.systemId)?.id ?? homeOf(g).id;
  return mapActive(ws, (g) => ({
    ...g,
    archive,
    systems: g.systems.map((s) => (s.id === targetId ? { ...s, planets: [...s.planets.filter((p) => p.id !== planet.id), planet] } : s)),
  }));
}

export function purgeArchived(ws: Workspace, archiveId: string | "all"): Workspace {
  return mapActive(ws, (g) => ({ ...g, archive: archiveId === "all" ? [] : g.archive.filter((a) => a.id !== archiveId) }));
}

// --- Bras et galaxies ---

export function updateArm(ws: Workspace, slot: ArmSlot, patch: Partial<Omit<Arm, "slot">>): Workspace {
  return mapActive(ws, (g) => ({ ...g, arms: g.arms.map((a) => (a.slot === slot ? { ...a, ...patch } : a)) }));
}

export function addGalaxy(ws: Workspace, name: string, now: number): { ws: Workspace; id: string } {
  const id = newId("gal");
  const seed = (now ^ (Math.random() * 0x7fffffff)) >>> 0;
  const galaxy = newGalaxy(id, name.trim() || "Nouvelle galaxie", seed, now);
  return { ws: { ...ws, galaxies: [...ws.galaxies, galaxy], activeGalaxy: id }, id };
}

export function renameGalaxy(ws: Workspace, id: string, name: string): Workspace {
  return { ...ws, galaxies: ws.galaxies.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name } : g)) };
}

export function removeGalaxy(ws: Workspace, id: string): Workspace {
  if (ws.galaxies.length <= 1) return ws;
  const galaxies = ws.galaxies.filter((g) => g.id !== id);
  return { ...ws, galaxies, activeGalaxy: ws.activeGalaxy === id ? galaxies[0].id : ws.activeGalaxy };
}

export function setActiveGalaxy(ws: Workspace, id: string): Workspace {
  return ws.galaxies.some((g) => g.id === id) ? { ...ws, activeGalaxy: id } : ws;
}

export { homeSystem };
