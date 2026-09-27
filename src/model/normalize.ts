// Lecture défensive d'un espace de travail venu du stockage du navigateur ou d'un import en mode
// web. Dans l'application de bureau, c'est Rust (`unitech-core::sanitize`) qui fait foi.

import { defaultArm, defaultSettings, defaultWorkspace, homeSystem } from "./defaults";
import { ARM_SLOTS, SCHEMA_VERSION, type Galaxy, type Planet, type StarSystem, type Target, type Workspace } from "./types";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v : fallback);
const HEX = /^#[0-9a-fA-F]{6}$/;
const TARGET_KINDS = ["app", "file", "folder", "url", "command"];

function target(v: unknown): Target | null {
  if (!isObj(v) || !TARGET_KINDS.includes(v.kind as string) || typeof v.value !== "string") return null;
  const t: Target = { kind: v.kind as Target["kind"], value: v.value };
  if (Array.isArray(v.args) && v.args.every((a) => typeof a === "string") && v.args.length) t.args = v.args as string[];
  if (typeof v.cwd === "string" && v.cwd.trim()) t.cwd = v.cwd;
  return t;
}

function planet(v: unknown): Planet | null {
  if (!isObj(v) || typeof v.id !== "string") return null;
  const t = target(v.target);
  if (!t) return null;
  const usage = isObj(v.usage) ? v.usage : {};
  const p: Planet = {
    id: v.id,
    name: str(v.name, "Planète"),
    target: t,
    kind: (["auto", "rocky", "desert", "ocean", "ice", "lava", "gas", "toxic"].includes(v.kind as string) ? v.kind : "auto") as Planet["kind"],
    ring: v.ring === true,
    moons: Array.isArray(v.moons)
      ? v.moons.flatMap((m) => {
          const mt = isObj(m) ? target(m.target) : null;
          return isObj(m) && typeof m.id === "string" && mt ? [{ id: m.id, name: str(m.name, "Action"), target: mt }] : [];
        })
      : [],
    usage: {
      launchCount: typeof usage.launchCount === "number" && usage.launchCount >= 0 ? Math.floor(usage.launchCount) : 0,
      ...(typeof usage.lastLaunched === "number" ? { lastLaunched: usage.lastLaunched } : {}),
    },
    createdAt: typeof v.createdAt === "number" ? v.createdAt : 0,
  };
  if (typeof v.icon === "string" && v.icon) p.icon = v.icon;
  return p;
}

function system(v: unknown): StarSystem | null {
  if (!isObj(v) || typeof v.id !== "string" || !isObj(v.anchor)) return null;
  const a = v.anchor;
  let anchor: StarSystem["anchor"];
  if (a.kind === "home") anchor = { kind: "home" };
  else if (a.kind === "arm" && ARM_SLOTS.includes(a.arm as never))
    anchor = { kind: "arm", arm: a.arm as never, t: Math.min(1, Math.max(0, Number(a.t) || 0.5)), offset: Math.min(1, Math.max(-1, Number(a.offset) || 0)) };
  else if (a.kind === "real" && typeof a.hygId === "number") anchor = { kind: "real", hygId: a.hygId, name: str(a.name, "Étoile") };
  else return null;
  const s: StarSystem = {
    id: v.id,
    name: str(v.name, "Système"),
    anchor,
    status: (["active", "paused", "dormant"].includes(v.status as string) ? v.status : "active") as StarSystem["status"],
    notes: typeof v.notes === "string" ? v.notes : "",
    planets: Array.isArray(v.planets) ? v.planets.map(planet).filter((p): p is Planet => !!p) : [],
    createdAt: typeof v.createdAt === "number" ? v.createdAt : 0,
  };
  if (typeof v.color === "string" && HEX.test(v.color)) s.color = v.color;
  return s;
}

function galaxy(v: unknown): Galaxy | null {
  if (!isObj(v) || typeof v.id !== "string") return null;
  const arms = Array.isArray(v.arms) ? v.arms : [];
  const systems = Array.isArray(v.systems) ? v.systems.map(system).filter((s): s is StarSystem => !!s) : [];
  if (!systems.some((s) => s.anchor.kind === "home")) systems.unshift(homeSystem(`${v.id}-sol`, 0));
  return {
    id: v.id,
    name: str(v.name, "Galaxie"),
    seed: typeof v.seed === "number" ? v.seed >>> 0 : 1,
    arms: ARM_SLOTS.map((slot) => {
      const found = arms.find((a) => isObj(a) && a.slot === slot) as Record<string, unknown> | undefined;
      const def = defaultArm(slot);
      return { slot, label: str(found?.label, def.label), color: typeof found?.color === "string" && HEX.test(found.color) ? found.color : def.color };
    }),
    systems,
    archive: Array.isArray(v.archive) ? (v.archive.filter((a) => isObj(a) && typeof a.id === "string" && isObj(a.payload)) as Galaxy["archive"]) : [],
    createdAt: typeof v.createdAt === "number" ? v.createdAt : 0,
  };
}

export function normalizeWorkspace(v: unknown): Workspace {
  if (!isObj(v) || (typeof v.version === "number" && v.version > SCHEMA_VERSION)) return defaultWorkspace();
  const galaxies = Array.isArray(v.galaxies) ? v.galaxies.map(galaxy).filter((g): g is Galaxy => !!g) : [];
  if (!galaxies.length) return defaultWorkspace();
  const settings = { ...defaultSettings(), ...(isObj(v.settings) ? v.settings : {}) } as Workspace["settings"];
  return {
    version: SCHEMA_VERSION,
    activeGalaxy: galaxies.some((g) => g.id === v.activeGalaxy) ? (v.activeGalaxy as string) : galaxies[0].id,
    galaxies,
    settings,
  };
}
