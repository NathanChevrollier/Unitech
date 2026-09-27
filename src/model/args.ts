// Arguments de ligne de commande saisis dans un champ texte : séparés par des espaces, avec
// guillemets simples ou doubles pour les arguments qui en contiennent.

export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && (text[i + 1] === '"' || text[i + 1] === "\\")) cur += text[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

export function joinArgs(args: string[] | undefined): string {
  return (args ?? []).map((a) => (a === "" || /[\s"']/.test(a) ? `"${a.replace(/(["\\])/g, "\\$1")}"` : a)).join(" ");
}
