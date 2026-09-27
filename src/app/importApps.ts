import { armForCategories, armForName } from "../model/classify";
import * as ops from "../model/ops";
import type { ArmSlot, Workspace } from "../model/types";
import type { DiscoveredApp } from "../platform/bridge";

/** Bras proposé pour une application découverte. */
export function suggestArm(app: DiscoveredApp): ArmSlot {
  return app.categories.length ? armForCategories(app.categories) : (armForName(app.name) ?? "orion");
}

/**
 * Met en orbite des applications découvertes : un système par bras concerné, nommé d'après la
 * catégorie (réutilisé s'il existe déjà), sans doublon de cible.
 */
export function importApps(ws: Workspace, picks: { app: DiscoveredApp; arm: ArmSlot }[], now: number): Workspace {
  let next = ws;
  const byArm = new Map<ArmSlot, DiscoveredApp[]>();
  for (const p of picks) byArm.set(p.arm, [...(byArm.get(p.arm) ?? []), p.app]);
  for (const [arm, apps] of byArm) {
    const g = ops.activeGalaxy(next);
    const label = g.arms.find((a) => a.slot === arm)?.label ?? "Applications";
    let sys = g.systems.find((s) => s.anchor.kind === "arm" && s.anchor.arm === arm && s.name === label);
    if (!sys) {
      const r = ops.addSystem(next, { name: label, anchor: { kind: "arm", arm, ...ops.freeArmSlot(g, arm) } }, now);
      next = r.ws;
      sys = ops.findSystem(ops.activeGalaxy(next), r.id)!;
    }
    const existing = new Set(sys.planets.map((p) => p.target.value));
    for (const app of apps) {
      if (existing.has(app.target.value)) continue;
      existing.add(app.target.value);
      next = ops.addPlanet(next, sys.id, { name: app.name, target: app.target, icon: app.icon }, now).ws;
    }
  }
  return next;
}
