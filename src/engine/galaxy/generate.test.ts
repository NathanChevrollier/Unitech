import { describe, expect, it } from "vitest";
import { ARMS, ORION_NEBULA_OFFSET, PITCH, SUN, armPoint, equatorialToScene } from "../math/milkyway";
import { bvToRgb, bvToTemperature } from "../math/color";
import { generateGalaxy } from "./generate";

describe("modèle de la Voie lactée", () => {
  it("place le Soleil sur le bras d'Orion", () => {
    const o = ARMS.orion;
    const t = o.betaInner / (o.betaInner - o.betaOuter);
    const p = armPoint("orion", t);
    expect(p[0]).toBeCloseTo(SUN[0], 6);
    expect(p[2]).toBeCloseTo(SUN[2], 6);
  });

  it("ordonne les bras comme dans la Galaxie réelle, à l'azimut du Soleil", () => {
    const radiusAtSun = (slot: keyof typeof ARMS) => {
      const a = ARMS[slot];
      const out: number[] = [];
      for (const beta of [0, 2 * Math.PI]) {
        if (beta <= a.betaInner && beta >= a.betaOuter) out.push(a.rRef * Math.exp(-(beta - a.phase) * Math.tan(PITCH)));
      }
      return out;
    };
    expect(radiusAtSun("perseus")[0]).toBeCloseTo(9900, 0);
    expect(radiusAtSun("sagittarius")[0]).toBeCloseTo(6900, 0);
    const sc = radiusAtSun("scutumCentaurus");
    expect(sc.some((r) => r > 4500 && r < 5500)).toBe(true);
    const norma = radiusAtSun("norma");
    expect(norma.some((r) => r > 12000 && r < 14500)).toBe(true);
    expect(norma.some((r) => r > 3200 && r < 4000)).toBe(true);
  });

  it("convertit les coordonnées équatoriales comme le script de données", () => {
    // Sirius : RA 101,287°, Déc. −16,716°, 2,637 pc → même position que stars.bin (1,906 ; −0,406 ; 1,781).
    const [x, y, z] = equatorialToScene(101.287, -16.716, 2.637);
    expect(x).toBeCloseTo(1.906, 1);
    expect(y).toBeCloseTo(-0.406, 1);
    expect(z).toBeCloseTo(1.781, 1);
    expect(Math.hypot(...ORION_NEBULA_OFFSET)).toBeCloseTo(412, 3);
    // Le centre galactique (Sgr A*, RA 266,4°, Déc. −28,94°) est dans la direction −Z.
    const gc = equatorialToScene(266.405, -28.936, 1);
    expect(gc[2]).toBeLessThan(-0.99);
  });
});

describe("couleurs", () => {
  it("donne des étoiles bleues chaudes et rouges froides", () => {
    expect(bvToTemperature(0.65)).toBeGreaterThan(5500);
    expect(bvToTemperature(0.65)).toBeLessThan(6000);
    const [r, , b] = bvToRgb(-0.3);
    expect(b).toBeGreaterThan(r);
    const [r2, , b2] = bvToRgb(1.8);
    expect(r2).toBeGreaterThan(b2);
  });
});

describe("génération", () => {
  it("est déterministe et respecte le budget de particules", () => {
    const a = generateGalaxy(42, 20_000);
    const b = generateGalaxy(42, 20_000);
    expect(a.light.count).toBe(b.light.count);
    expect(Array.from(a.light.positions.slice(0, 30))).toEqual(Array.from(b.light.positions.slice(0, 30)));
    expect(a.light.count).toBeLessThanOrEqual(20_000 + 4096);
    expect(a.light.count).toBeGreaterThan(15_000);
    expect(a.dust.count).toBeGreaterThan(1_000);
    expect(generateGalaxy(43, 20_000).light.positions[0]).not.toBe(a.light.positions[0]);
  });

  it("laisse le voisinage du Soleil aux vraies étoiles", () => {
    const { light } = generateGalaxy(7, 50_000);
    for (let i = 0; i < light.count; i++) {
      const d = Math.hypot(light.positions[i * 3] - SUN[0], light.positions[i * 3 + 1] - SUN[1], light.positions[i * 3 + 2] - SUN[2]);
      expect(d).toBeGreaterThanOrEqual(120);
    }
    expect(light.positions.every(Number.isFinite)).toBe(true);
  });
});
