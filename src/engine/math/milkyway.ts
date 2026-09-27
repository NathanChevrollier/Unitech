// Géométrie de la Voie lactée, en parsecs.
//
// Repère de la scène : origine au centre galactique (Sagittarius A*), Y vers le pôle nord galactique,
// Soleil sur l'axe +Z. L'azimut β (0 vers le Soleil) croît dans le sens de rotation de la Galaxie,
// comme dans Reid et al. (2014). Chaque bras est une spirale logarithmique :
//   R(β) = R_ref · exp(-(β - β_phase) · tan ψ)
// Les rayons au passage de l'azimut du Soleil reproduisent l'ordre observé : Norma (~3,5 kpc),
// Écu-Centaure (~5 kpc), Sagittaire (~7 kpc), bras d'Orion (Soleil, 8,25 kpc), Persée (~10 kpc),
// puis le bras extérieur, prolongement de Norma (~13 kpc).

import type { ArmSlot } from "../../model/types";

export const KPC = 1000;
export const SUN_RADIUS = 8250;
export const SUN_HEIGHT = 20;
export const SUN: readonly [number, number, number] = [0, SUN_HEIGHT, SUN_RADIUS];

export const PITCH = (12 * Math.PI) / 180;
const K = Math.tan(PITCH);
export const DISK_INNER = 3200;
export const DISK_OUTER = 16000;
/** Demi-longueur et orientation de la barre centrale (alignée sur la naissance des bras majeurs). */
export const BAR_HALF_LENGTH = 4200;

export interface ArmModel {
  slot: ArmSlot;
  rRef: number;
  phase: number;
  /** Bornes de β : de l'extrémité intérieure (t = 0) à l'extérieure (t = 1). */
  betaInner: number;
  betaOuter: number;
  /** Poids relatif dans la génération (bras majeurs plus peuplés). */
  weight: number;
  /** Demi-largeur du bras, en parsecs. */
  width: number;
}

function arm(slot: ArmSlot, rRef: number, phase: number, weight: number, width: number, rInner = DISK_INNER, rOuter = DISK_OUTER): ArmModel {
  return {
    slot,
    rRef,
    phase,
    betaInner: phase + Math.log(rRef / rInner) / K,
    betaOuter: phase - Math.log(rOuter / rRef) / K,
    weight,
    width,
  };
}

export const ARMS: Record<ArmSlot, ArmModel> = {
  perseus: arm("perseus", 9900, 0, 1, 420),
  scutumCentaurus: arm("scutumCentaurus", 9900, Math.PI, 1, 420),
  sagittarius: arm("sagittarius", 6900, 0, 0.72, 360),
  norma: arm("norma", 6900, Math.PI, 0.72, 360),
  // Le bras d'Orion est un éperon court : quelques kilo-parsecs de part et d'autre du Soleil.
  orion: { slot: "orion", rRef: SUN_RADIUS, phase: 0, betaInner: 0.55, betaOuter: -0.5, weight: 0.14, width: 260 },
};

/** Azimut de l'extrémité intérieure du bras de Persée : la barre y aboutit. */
export const BAR_ANGLE = ARMS.perseus.betaInner;

export function armRadius(a: ArmModel, beta: number): number {
  return a.rRef * Math.exp(-(beta - a.phase) * K);
}

export function polarToXZ(r: number, beta: number): [number, number] {
  return [-r * Math.sin(beta), r * Math.cos(beta)];
}

/**
 * Point d'un bras. `t` va du cœur (0) au bord (1) ; `offset` de -1 à 1 traverse le bras
 * (négatif vers l'intérieur de la galaxie).
 */
export function armPoint(slot: ArmSlot, t: number, offset = 0, height = 0): [number, number, number] {
  const a = ARMS[slot];
  const beta = a.betaInner + (a.betaOuter - a.betaInner) * t;
  const r = armRadius(a, beta) + offset * a.width;
  const [x, z] = polarToXZ(r, beta);
  return [x, height, z];
}

/** Échantillons le long d'un bras, pour les tracés et les étiquettes. */
export function armCurve(slot: ArmSlot, samples = 128): [number, number, number][] {
  return Array.from({ length: samples }, (_, i) => armPoint(slot, i / (samples - 1)));
}

// --- Coordonnées équatoriales → scène (même transformation que scripts/build-stars.mjs) ---

const T = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
];

/** Direction du ciel (ascension droite et déclinaison en degrés) et distance → offset depuis le Soleil. */
export function equatorialToScene(raDeg: number, decDeg: number, distPc: number): [number, number, number] {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const x = distPc * Math.cos(dec) * Math.cos(ra);
  const y = distPc * Math.cos(dec) * Math.sin(ra);
  const z = distPc * Math.sin(dec);
  const gx = T[0][0] * x + T[0][1] * y + T[0][2] * z;
  const gy = T[1][0] * x + T[1][1] * y + T[1][2] * z;
  const gz = T[2][0] * x + T[2][1] * y + T[2][2] * z;
  return [-gy, gz, -gx];
}

/** Nébuleuse d'Orion (M42) : RA 5h35m17s, Déc. −5°23′, 412 pc. Elle accueille la boîte de réception. */
export const ORION_NEBULA_OFFSET = equatorialToScene(83.822, -5.391, 412);
export const ORION_NEBULA: [number, number, number] = [SUN[0] + ORION_NEBULA_OFFSET[0], SUN[1] + ORION_NEBULA_OFFSET[1], SUN[2] + ORION_NEBULA_OFFSET[2]];
