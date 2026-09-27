import { PLANET_KINDS, type ArmSlot, type Planet, type PlanetKind, type Target } from "./types";

/** Hachage FNV-1a 32 bits : stable, pour dériver l'apparence d'un identifiant. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Type de planète effectif : celui choisi, ou un type stable tiré de l'identifiant. */
export function planetKind(p: Pick<Planet, "id" | "kind" | "target">): Exclude<PlanetKind, "auto"> {
  if (p.kind !== "auto") return p.kind;
  // Un indice de la cible donne un air de famille : les dossiers glacés, les liens océans…
  switch (p.target.kind) {
    case "folder":
      return "ice";
    case "url":
      return hash32(p.id) % 2 ? "ocean" : "gas";
    case "command":
      return "lava";
    default:
      return PLANET_KINDS[hash32(p.id) % PLANET_KINDS.length];
  }
}

/** Bras proposé pour une application d'après ses catégories freedesktop. */
export function armForCategories(categories: string[]): ArmSlot {
  const has = (...names: string[]) => names.some((n) => categories.includes(n));
  if (has("Development", "IDE", "RevisionControl", "Debugger")) return "perseus";
  if (has("Game", "ActionGame", "ArcadeGame", "BoardGame", "Emulator")) return "scutumCentaurus";
  if (has("Graphics", "AudioVideo", "Audio", "Video", "Photography", "2DGraphics", "3DGraphics", "Music")) return "sagittarius";
  if (has("Network", "WebBrowser", "Email", "Chat", "InstantMessaging", "Office")) return "norma";
  return "orion";
}

/** Bras proposé d'après le nom, quand le système ne fournit pas de catégories (Windows, macOS). */
export function armForName(name: string): ArmSlot | null {
  const n = name.toLowerCase();
  const any = (...w: string[]) => w.some((x) => n.includes(x));
  if (any("code", "studio", "intellij", "pycharm", "webstorm", "git", "terminal", "docker", "postman", "zenytt", "cursor", "zed")) return "perseus";
  if (any("steam", "epic", "game", "jeu", "battle.net", "riot", "minecraft", "gog", "ubisoft", "xbox")) return "scutumCentaurus";
  if (any("photoshop", "gimp", "blender", "figma", "krita", "premiere", "davinci", "obs", "audacity", "spotify", "illustrator", "inkscape", "affinity")) return "sagittarius";
  if (any("chrome", "firefox", "edge", "brave", "opera", "safari", "discord", "slack", "teams", "outlook", "mail", "thunderbird", "zoom", "word", "excel", "notion")) return "norma";
  return null;
}

/** Nom lisible d'une cible, pour préremplir le formulaire. */
export function nameFromTarget(target: Target): string {
  const v = target.value.trim();
  if (target.kind === "url") {
    try {
      return new URL(v).hostname.replace(/^www\./, "") || v;
    } catch {
      return v;
    }
  }
  const base = v.split(/[\\/]/).filter(Boolean).pop() ?? v;
  return target.kind === "folder" || target.kind === "command" ? base : base.replace(/\.(exe|lnk|app|desktop|appimage)$/i, "");
}
