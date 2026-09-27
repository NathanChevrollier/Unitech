import type { Universe } from "./Universe";

// Instance unique du moteur, créée par le composant `Scene`.
let current: Universe | null = null;

export function setUniverse(u: Universe | null) {
  current = u;
}

export function universe(): Universe | null {
  return current;
}
