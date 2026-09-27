import type { Usage } from "./types";

// Même formule que `crates/unitech-core/src/usage.rs`.
export const HALF_LIFE_DAYS = 14;
const DAY_MS = 86_400_000;

/** Score d'usage entre 0 (jamais utilisée) et 1 (souvent et récemment). */
export function usageScore(usage: Usage, now: number): number {
  if (usage.lastLaunched == null) return 0;
  const frequency = Math.log(1 + usage.launchCount) / Math.log(201);
  const ageDays = Math.max(0, now - usage.lastLaunched) / DAY_MS;
  const freshness = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  return Math.min(1, Math.max(0, Math.min(1, frequency) * (0.35 + 0.65 * freshness)));
}

export function recordLaunch(usage: Usage, now: number): Usage {
  return { launchCount: usage.launchCount + 1, lastLaunched: now };
}

/** « il y a 3 min », « hier »… */
export function relativeTime(ts: number | undefined, now: number): string {
  if (ts == null) return "jamais";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "hier";
  if (d < 30) return `il y a ${d} jours`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `il y a ${mo} mois`;
  return `il y a ${Math.round(mo / 12)} an${mo >= 24 ? "s" : ""}`;
}
