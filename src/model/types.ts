// Types persistés de l'espace de travail : miroir exact de `crates/unitech-core/src/model.rs`.
// Le témoin `fixtures/default-workspace.json` est vérifié des deux côtés.

export const SCHEMA_VERSION = 1;

export type ArmSlot = "perseus" | "scutumCentaurus" | "sagittarius" | "norma" | "orion";
export const ARM_SLOTS: readonly ArmSlot[] = ["perseus", "scutumCentaurus", "sagittarius", "norma", "orion"];

export interface Arm {
  slot: ArmSlot;
  label: string;
  color: string;
}

export type Anchor =
  | { kind: "home" }
  | { kind: "arm"; arm: ArmSlot; t: number; offset: number }
  | { kind: "real"; hygId: number; name: string };

export type SystemStatus = "active" | "paused" | "dormant";

export type TargetKind = "app" | "file" | "folder" | "url" | "command";

export interface Target {
  kind: TargetKind;
  value: string;
  args?: string[];
  cwd?: string;
}

export type PlanetKind = "auto" | "rocky" | "desert" | "ocean" | "ice" | "lava" | "gas" | "toxic";
export const PLANET_KINDS: readonly Exclude<PlanetKind, "auto">[] = ["rocky", "desert", "ocean", "ice", "lava", "gas", "toxic"];

export interface Usage {
  launchCount: number;
  lastLaunched?: number;
}

export interface Moon {
  id: string;
  name: string;
  target: Target;
}

export interface Planet {
  id: string;
  name: string;
  target: Target;
  icon?: string;
  kind: PlanetKind;
  ring: boolean;
  moons: Moon[];
  usage: Usage;
  createdAt: number;
}

export interface StarSystem {
  id: string;
  name: string;
  anchor: Anchor;
  status: SystemStatus;
  color?: string;
  notes: string;
  planets: Planet[];
  createdAt: number;
}

export type Archived = { type: "system"; system: StarSystem } | { type: "planet"; systemId: string; planet: Planet };

export interface ArchivedItem {
  id: string;
  archivedAt: number;
  payload: Archived;
}

export interface Galaxy {
  id: string;
  name: string;
  seed: number;
  arms: Arm[];
  systems: StarSystem[];
  archive: ArchivedItem[];
  createdAt: number;
}

export type Quality = "low" | "medium" | "high" | "ultra";

export interface Settings {
  quality: Quality;
  bloom: boolean;
  galaxyRotation: boolean;
  orbitMotion: boolean;
  showLabels: boolean;
  showConstellations: boolean;
  reducedMotion: boolean;
  globalShortcut: string;
  closeToTray: boolean;
  onboarded: boolean;
}

export interface Workspace {
  version: number;
  activeGalaxy: string;
  galaxies: Galaxy[];
  settings: Settings;
}
