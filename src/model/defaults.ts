import { ARM_SLOTS, SCHEMA_VERSION, type Arm, type ArmSlot, type Galaxy, type Settings, type StarSystem, type Workspace } from "./types";

// Mêmes valeurs que `crates/unitech-core/src/model.rs` (vérifié par `defaults.test.ts`).

export const DEFAULT_SHORTCUT = "CommandOrControl+Shift+Space";
export const DEFAULT_SEED = 20_260_927;

const ARM_DEFAULTS: Record<ArmSlot, { label: string; color: string }> = {
  perseus: { label: "Développement", color: "#6ea8ff" },
  scutumCentaurus: { label: "Jeux", color: "#ff7a59" },
  sagittarius: { label: "Création", color: "#c77dff" },
  norma: { label: "Web", color: "#4dd4ac" },
  orion: { label: "Système", color: "#ffd166" },
};

/** Nom astronomique de chaque bras (affiché sous la catégorie). */
export const ARM_ASTRO_NAMES: Record<ArmSlot, string> = {
  perseus: "Bras de Persée",
  scutumCentaurus: "Bras de l'Écu-Centaure",
  sagittarius: "Bras du Sagittaire",
  norma: "Bras de la Règle",
  orion: "Bras d'Orion",
};

export function defaultArm(slot: ArmSlot): Arm {
  return { slot, ...ARM_DEFAULTS[slot] };
}

export function defaultSettings(): Settings {
  return {
    quality: "medium",
    bloom: true,
    galaxyRotation: true,
    orbitMotion: true,
    showLabels: true,
    showConstellations: false,
    reducedMotion: false,
    globalShortcut: DEFAULT_SHORTCUT,
    closeToTray: true,
    onboarded: false,
  };
}

export function homeSystem(id: string, createdAt: number): StarSystem {
  return { id, name: "Soleil", anchor: { kind: "home" }, status: "active", notes: "", planets: [], createdAt };
}

export function newGalaxy(id: string, name: string, seed: number, createdAt: number): Galaxy {
  return {
    id,
    name,
    seed,
    arms: ARM_SLOTS.map(defaultArm),
    systems: [homeSystem(`${id}-sol`, createdAt)],
    archive: [],
    createdAt,
  };
}

export function defaultWorkspace(): Workspace {
  return {
    version: SCHEMA_VERSION,
    activeGalaxy: "perso",
    galaxies: [newGalaxy("perso", "Perso", DEFAULT_SEED, 0)],
    settings: defaultSettings(),
  };
}

/** Identifiant court, unique et accepté par la validation Rust (`[A-Za-z0-9_-]`). */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${rand}`;
}
