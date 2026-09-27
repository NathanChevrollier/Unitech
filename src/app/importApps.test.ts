import { describe, expect, it } from "vitest";
import { defaultWorkspace } from "../model/defaults";
import { activeGalaxy } from "../model/ops";
import type { DiscoveredApp } from "../platform/bridge";
import { importApps, suggestArm } from "./importApps";

const app = (name: string, categories: string[] = []): DiscoveredApp => ({ name, target: { kind: "app", value: `/apps/${name}.desktop` }, categories });

describe("import des applications", () => {
  it("propose un bras par catégorie ou par nom", () => {
    expect(suggestArm(app("Code", ["Development"]))).toBe("perseus");
    expect(suggestArm(app("Steam"))).toBe("scutumCentaurus");
    expect(suggestArm(app("Inconnue"))).toBe("orion");
  });

  it("regroupe par bras, sans doublon, et réutilise les systèmes existants", () => {
    const code = app("Code", ["Development"]);
    const gimp = app("GIMP", ["Graphics"]);
    let ws = importApps(defaultWorkspace(), [
      { app: code, arm: "perseus" },
      { app: code, arm: "perseus" },
      { app: gimp, arm: "sagittarius" },
    ], 1);
    let g = activeGalaxy(ws);
    expect(g.systems.map((s) => s.name)).toEqual(["Soleil", "Développement", "Création"]);
    expect(g.systems[1].planets.map((p) => p.name)).toEqual(["Code"]);

    ws = importApps(ws, [{ app: app("Git", ["Development"]), arm: "perseus" }, { app: code, arm: "perseus" }], 2);
    g = activeGalaxy(ws);
    expect(g.systems).toHaveLength(3);
    expect(g.systems[1].planets.map((p) => p.name)).toEqual(["Code", "Git"]);
  });
});
