// Génération procédurale des nuages de particules de la Voie lactée. Fonction pure, exécutée dans un
// Web Worker (`galaxy.worker.ts`) pour ne pas figer l'interface, et testable.
//
// Chaque particule représente une région d'étoiles (quelques dizaines de parsecs) : couleur HDR
// (l'intensité est portée par la couleur), taille en parsecs. Deux calques : la lumière (mélange
// additif) et la poussière (mélange normal, qui assombrit ce qu'elle recouvre).

import { ARM_SLOTS } from "../../model/types";
import { ARMS, BAR_ANGLE, BAR_HALF_LENGTH, DISK_OUTER, SUN, armRadius, polarToXZ } from "../math/milkyway";
import { gaussian, mulberry32 } from "../math/rng";

export interface Layer {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  count: number;
}

export interface GalaxyData {
  light: Layer;
  dust: Layer;
}

function layer(capacity: number): Layer {
  return { positions: new Float32Array(capacity * 3), colors: new Float32Array(capacity * 3), sizes: new Float32Array(capacity), count: 0 };
}

function push(l: Layer, x: number, y: number, z: number, r: number, g: number, b: number, size: number) {
  const i = l.count++;
  l.positions[i * 3] = x;
  l.positions[i * 3 + 1] = y;
  l.positions[i * 3 + 2] = z;
  l.colors[i * 3] = r;
  l.colors[i * 3 + 1] = g;
  l.colors[i * 3 + 2] = b;
  l.sizes[i] = size;
}

function trim(l: Layer): Layer {
  return { positions: l.positions.slice(0, l.count * 3), colors: l.colors.slice(0, l.count * 3), sizes: l.sizes.slice(0, l.count), count: l.count };
}

/** Mélange linéaire de deux couleurs. */
function mix(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const YOUNG = [0.5, 0.68, 1.0];
const WHITE = [1.0, 0.96, 0.9];
const OLD = [1.0, 0.8, 0.55];
const CORE = [1.0, 0.72, 0.42];
const HII = [1.0, 0.33, 0.52];
const DUST = [0.09, 0.055, 0.035];

/** Tirage d'un bras proportionnellement à son poids. */
function pickArm(rand: () => number) {
  const arms = ARM_SLOTS.map((s) => ARMS[s]);
  const total = arms.reduce((s, a) => s + a.weight, 0);
  let x = rand() * total;
  for (const a of arms) {
    x -= a.weight;
    if (x <= 0) return a;
  }
  return arms[0];
}

export function generateGalaxy(seed: number, total: number): GalaxyData {
  const rand = mulberry32(seed);
  const light = layer(total + 4096);
  const dust = layer(Math.ceil(total * 0.14) + 64);

  const nArm = Math.floor(total * 0.44);
  const nDisk = Math.floor(total * 0.24);
  const nBulge = Math.floor(total * 0.11);
  const nBar = Math.floor(total * 0.08);
  const nHalo = Math.floor(total * 0.02);
  const nHii = Math.floor(total * 0.025);
  const nDust = Math.floor(total * 0.12);

  // Étoiles des bras : jeunes et bleues au centre du bras, plus vieilles sur les bords.
  for (let i = 0; i < nArm; i++) {
    const a = pickArm(rand);
    const beta = a.betaOuter + (a.betaInner - a.betaOuter) * Math.pow(rand(), 0.85);
    const r0 = armRadius(a, beta);
    const spread = gaussian(rand) * a.width * (0.4 + 0.35 * Math.sqrt(r0 / 8000));
    const r = r0 + spread;
    const along = gaussian(rand) * 0.02;
    const [x, z] = polarToXZ(r, beta + along);
    const y = gaussian(rand) * (60 + 40 * (r / 10000));
    const core = Math.exp(-Math.pow(spread / a.width, 2));
    const [cr, cg, cb] = mix(WHITE, YOUNG, core * (0.5 + 0.5 * rand()));
    // L'éclat diminue vers le bord du disque.
    const fade = Math.exp(-r / 7000) * 2.4 * (0.35 + 0.65 * core) * (0.4 + rand() * 0.9);
    push(light, x, y, z, cr * fade, cg * fade, cb * fade, 30 + rand() * 70);
  }

  // Régions HII : amas roses sur le bord intérieur des bras, là où naissent les étoiles.
  let placed = 0;
  while (placed < nHii) {
    const a = pickArm(rand);
    const beta = a.betaOuter + (a.betaInner - a.betaOuter) * rand();
    const r0 = armRadius(a, beta) - a.width * 0.25;
    const [cx, cz] = polarToXZ(r0 + gaussian(rand) * a.width * 0.3, beta);
    const cy = gaussian(rand) * 30;
    const n = 6 + Math.floor(rand() * 18);
    const glow = (0.6 + rand() * 1.6) * Math.exp(-r0 / 9000) * 2.2;
    for (let k = 0; k < n && placed < nHii; k++, placed++) {
      push(light, cx + gaussian(rand) * 45, cy + gaussian(rand) * 15, cz + gaussian(rand) * 45, HII[0] * glow, HII[1] * glow, HII[2] * glow, 18 + rand() * 40);
    }
  }

  // Disque ancien : loi exponentielle (longueur d'échelle 3,2 kpc), étoiles jaunâtres.
  for (let i = 0; i < nDisk; i++) {
    const r = Math.min(DISK_OUTER * 1.1, -3200 * Math.log(rand() * rand() + 1e-9));
    if (r < 900) {
      i--;
      continue;
    }
    const beta = rand() * Math.PI * 2;
    const [x, z] = polarToXZ(r, beta);
    const y = gaussian(rand) * (140 + r * 0.012);
    const [cr, cg, cb] = mix(OLD, WHITE, rand() * 0.6);
    const f = Math.exp(-r / 4200) * 0.55 * (0.5 + rand());
    push(light, x, y, z, cr * f, cg * f, cb * f, 60 + rand() * 90);
  }

  // Bulbe : ellipsoïde doré très lumineux.
  for (let i = 0; i < nBulge; i++) {
    const r = Math.abs(gaussian(rand)) * 950;
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const x = r * s * Math.cos(th);
    const z = r * s * Math.sin(th);
    const y = r * u * 0.62;
    const f = (0.8 + 2.2 * Math.exp(-r / 320)) * (0.6 + rand() * 0.6);
    const [cr, cg, cb] = mix(CORE, OLD, Math.min(1, r / 1500));
    push(light, x, y, z, cr * f, cg * f, cb * f, 40 + rand() * 80);
  }

  // Barre centrale.
  const cb0 = Math.cos(BAR_ANGLE);
  const sb0 = Math.sin(BAR_ANGLE);
  for (let i = 0; i < nBar; i++) {
    const along = gaussian(rand) * BAR_HALF_LENGTH * 0.42;
    const across = gaussian(rand) * 480;
    const y = gaussian(rand) * 220;
    // Axe de la barre dans le plan : direction de l'azimut BAR_ANGLE.
    const x = -along * sb0 + across * cb0;
    const z = along * cb0 + across * sb0;
    const f = (0.7 + 0.9 * Math.exp(-Math.abs(along) / 1500)) * (0.5 + rand() * 0.6);
    push(light, x, y, z, CORE[0] * f, CORE[1] * f, CORE[2] * f, 50 + rand() * 70);
  }

  // Halo diffus et amas globulaires.
  for (let i = 0; i < nHalo; i++) {
    const r = 2000 + Math.abs(gaussian(rand)) * 9000;
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const f = 0.12 + rand() * 0.15;
    push(light, r * s * Math.cos(th), r * u * 0.8, r * s * Math.sin(th), OLD[0] * f, OLD[1] * f, OLD[2] * f, 50 + rand() * 60);
  }
  for (let c = 0; c < 48; c++) {
    const r = 1500 + Math.abs(gaussian(rand)) * 11000;
    const u = rand() * 2 - 1;
    const th = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const cx = r * s * Math.cos(th);
    const cy = r * u;
    const cz = r * s * Math.sin(th);
    for (let k = 0; k < 40; k++) {
      const d = Math.abs(gaussian(rand)) * 18;
      const f = 1.6 * Math.exp(-d / 12);
      push(light, cx + gaussian(rand) * d, cy + gaussian(rand) * d, cz + gaussian(rand) * d, OLD[0] * f, OLD[1] * f, WHITE[2] * f * 0.8, 6 + rand() * 8);
    }
  }

  // Poussière : filaments sombres le long du bord intérieur des bras majeurs et dans le disque.
  for (let i = 0; i < nDust; i++) {
    let x: number, y: number, z: number, size: number;
    if (rand() < 0.78) {
      const a = pickArm(rand);
      const beta = a.betaOuter + (a.betaInner - a.betaOuter) * Math.pow(rand(), 0.9);
      const r = armRadius(a, beta) - a.width * (0.35 + gaussian(rand) * 0.3);
      [x, z] = polarToXZ(r, beta + gaussian(rand) * 0.012);
      y = gaussian(rand) * 28;
      size = 50 + rand() * 90;
    } else {
      const r = 1200 + rand() * 11000;
      [x, z] = polarToXZ(r, rand() * Math.PI * 2);
      y = gaussian(rand) * 35;
      size = 80 + rand() * 120;
    }
    // L'opacité est portée par la luminance de la couleur (lue dans le shader).
    const o = 0.55 + rand() * 0.45;
    push(dust, x, y, z, DUST[0] * o, DUST[1] * o, DUST[2] * o, size);
  }

  // Le voisinage immédiat du Soleil est laissé aux vraies étoiles : on y retire les particules.
  const clear = (l: Layer, radius: number) => {
    const out = layer(l.count);
    for (let i = 0; i < l.count; i++) {
      const dx = l.positions[i * 3] - SUN[0];
      const dy = l.positions[i * 3 + 1] - SUN[1];
      const dz = l.positions[i * 3 + 2] - SUN[2];
      if (dx * dx + dy * dy + dz * dz < radius * radius) continue;
      push(out, l.positions[i * 3], l.positions[i * 3 + 1], l.positions[i * 3 + 2], l.colors[i * 3], l.colors[i * 3 + 1], l.colors[i * 3 + 2], l.sizes[i]);
    }
    return out;
  };

  return { light: trim(clear(light, 120)), dust: trim(clear(dust, 160)) };
}

export const PARTICLES_BY_QUALITY = { low: 110_000, medium: 220_000, high: 400_000, ultra: 700_000 } as const;
