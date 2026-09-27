// Couleurs d'étoiles : indice B-V → température (Ballesteros 2012) → couleur du corps noir.

export function bvToTemperature(bv: number): number {
  const c = Math.min(2.0, Math.max(-0.4, bv));
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
}

/** Couleur approchée d'un corps noir (Tanner Helland), composantes 0..1. */
export function temperatureToRgb(kelvin: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return [c(r), c(g), c(b)];
}

export function bvToRgb(bv: number): [number, number, number] {
  return temperatureToRgb(bvToTemperature(bv));
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Couleur d'une étoile de projet selon son état. */
export const STATUS_BV = { active: -0.2, paused: 1.6, dormant: 0.1 } as const;
