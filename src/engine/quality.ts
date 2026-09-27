import type { Quality } from "../model/types";
import { PARTICLES_BY_QUALITY } from "./galaxy/generate";

export interface QualityProfile {
  particles: number;
  /** Plafond du rapport de pixels (écrans haute densité). */
  maxPixelRatio: number;
  /** Résolution du bloom par rapport au canevas. */
  bloomScale: number;
  planetSegments: number;
  noiseOctaves: number;
  /** Échantillons d'anticrénelage (0 = désactivé). */
  msaa: number;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  low: { particles: PARTICLES_BY_QUALITY.low, maxPixelRatio: 1, bloomScale: 0.5, planetSegments: 48, noiseOctaves: 4, msaa: 0 },
  medium: { particles: PARTICLES_BY_QUALITY.medium, maxPixelRatio: 1.25, bloomScale: 0.5, planetSegments: 64, noiseOctaves: 5, msaa: 4 },
  high: { particles: PARTICLES_BY_QUALITY.high, maxPixelRatio: 1.5, bloomScale: 0.75, planetSegments: 96, noiseOctaves: 6, msaa: 4 },
  ultra: { particles: PARTICLES_BY_QUALITY.ultra, maxPixelRatio: 2, bloomScale: 1, planetSegments: 128, noiseOctaves: 6, msaa: 8 },
};

export const QUALITY_LABELS: Record<Quality, string> = { low: "Économe", medium: "Équilibrée", high: "Élevée", ultra: "Ultra" };
