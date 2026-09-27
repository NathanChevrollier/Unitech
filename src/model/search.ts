// Recherche approximative du lanceur : insensible à la casse et aux accents, favorise les débuts de
// mot et les correspondances contiguës.

export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface Match {
  score: number;
  /** Index des caractères retrouvés dans le texte d'origine (surlignage). */
  positions: number[];
}

export function fuzzyMatch(query: string, text: string): Match | null {
  const q = fold(query.trim());
  if (!q) return { score: 0, positions: [] };
  const t = fold(text);
  // `fold` peut changer la longueur (ligatures rares) : on retombe alors sur une recherche simple.
  const aligned = t.length === text.length;

  const direct = t.indexOf(q);
  if (direct >= 0) {
    const wordStart = direct === 0 || /[\s\-_./]/.test(t[direct - 1]);
    const score = 1000 - direct * 2 - (t.length - q.length) + (direct === 0 ? 400 : wordStart ? 200 : 0);
    return { score, positions: aligned ? Array.from({ length: q.length }, (_, i) => direct + i) : [] };
  }

  let ti = 0;
  let score = 0;
  let streak = 0;
  const positions: number[] = [];
  for (const ch of q) {
    if (ch === " ") continue;
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
      ti++;
    }
    if (found < 0) return null;
    const boundary = found === 0 || /[\s\-_./]/.test(t[found - 1]);
    streak = positions.length && positions[positions.length - 1] === found - 1 ? streak + 1 : 0;
    score += 10 + (boundary ? 25 : 0) + streak * 8;
    positions.push(found);
    ti = found + 1;
  }
  score -= (positions[positions.length - 1] - positions[0]) * 0.5 + t.length * 0.2;
  return { score, positions: aligned ? positions : [] };
}

export interface Ranked<T> {
  item: T;
  match: Match;
}

export function rank<T>(query: string, items: T[], text: (item: T) => string, boost: (item: T) => number = () => 0): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, text(item));
    if (match) out.push({ item, match: { ...match, score: match.score + boost(item) } });
  }
  return out.sort((a, b) => b.match.score - a.match.score);
}
