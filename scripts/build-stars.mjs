// Prépare les données d'étoiles réelles embarquées dans l'application.
//
// Entrées (non versionnées, téléchargées une fois) :
//   - catalogue HYG v4.1 (CC BY-SA 4.0) : https://github.com/astronexus/HYG-Database (hyg/CURRENT/hygdata_v41.csv)
//   - tracés et noms des constellations de d3-celestial (BSD-3) : https://github.com/ofrohn/d3-celestial (data/)
//
// Usage : node scripts/build-stars.mjs <hygdata_v41.csv> <constellations.lines.json> <constellations.json>
//
// Sorties dans public/data :
//   - stars.bin        : Int16 × 5 par étoile (x, y, z en 1/32 pc dans le repère de la scène, centré sur le
//                        Soleil ; magnitude absolue × 100 ; indice de couleur B-V × 1000), de la plus brillante
//                        vue du Soleil à la plus faible ;
//   - stars-named.json : étoiles nommées (index dans stars.bin, nom, constellation, identifiant HYG) ;
//   - constellations.json : segments des 88 constellations, en paires d'index dans stars.bin.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [hygPath, linesPath, namesPath] = process.argv.slice(2);
if (!hygPath || !linesPath || !namesPath) {
  console.error("usage : node scripts/build-stars.mjs <hygdata_v41.csv> <constellations.lines.json> <constellations.json>");
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
mkdirSync(out, { recursive: true });

// Rotation équatorial J2000 → galactique (IAU 1958, Hipparcos vol. 1 §1.5.3).
const T = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
];
// Repère de la scène : Y vers le pôle nord galactique, -Z vers le centre galactique.
const toScene = (x, y, z) => {
  const gx = T[0][0] * x + T[0][1] * y + T[0][2] * z;
  const gy = T[1][0] * x + T[1][1] * y + T[1][2] * z;
  const gz = T[2][0] * x + T[2][1] * y + T[2][2] * z;
  return [-gy, gz, -gx];
};

function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

const GREEK = { Alp: "α", Bet: "β", Gam: "γ", Del: "δ", Eps: "ε", Zet: "ζ", Eta: "η", The: "θ", Iot: "ι", Kap: "κ", Lam: "λ", Mu: "μ", Nu: "ν", Xi: "ξ", Omi: "ο", Pi: "π", Rho: "ρ", Sig: "σ", Tau: "τ", Ups: "υ", Phi: "φ", Chi: "χ", Psi: "ψ", Ome: "ω" };

const lines = readFileSync(hygPath, "utf8").split(/\r?\n/);
const header = parseCsvLine(lines[0]);
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const stars = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const c = parseCsvLine(lines[i]);
  const id = Number(c[col.id]);
  const dist = Number(c[col.dist]);
  // Le Soleil est dessiné à part ; 100 000 pc signale une distance inconnue.
  if (id === 0 || !(dist > 0) || dist >= 100000) continue;
  const absmag = Number(c[col.absmag]);
  const mag = Number(c[col.mag]);
  if (!Number.isFinite(absmag) || !Number.isFinite(mag)) continue;
  const ci = c[col.ci] === "" ? 0.65 : Number(c[col.ci]);
  const [x, y, z] = toScene(Number(c[col.x]), Number(c[col.y]), Number(c[col.z]));
  stars.push({
    id,
    x, y, z,
    absmag,
    mag,
    ci: Number.isFinite(ci) ? ci : 0.65,
    ra: Number(c[col.ra]) * 15,
    dec: Number(c[col.dec]),
    proper: c[col.proper],
    bayer: c[col.bayer],
    con: c[col.con],
  });
}
stars.sort((a, b) => a.mag - b.mag);

const clamp16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
const bin = new Int16Array(stars.length * 5);
stars.forEach((s, i) => {
  bin[i * 5] = clamp16(s.x * 32);
  bin[i * 5 + 1] = clamp16(s.y * 32);
  bin[i * 5 + 2] = clamp16(s.z * 32);
  bin[i * 5 + 3] = clamp16(s.absmag * 100);
  bin[i * 5 + 4] = clamp16(s.ci * 1000);
});
writeFileSync(join(out, "stars.bin"), Buffer.from(bin.buffer));

// Étoiles nommées : noms propres, puis désignations de Bayer des étoiles visibles à l'œil nu.
const named = [];
stars.forEach((s, i) => {
  let name = s.proper;
  if (!name && s.bayer && s.mag < 4) {
    const m = /^([A-Z][a-z]{1,2})(-?\d*)$/.exec(s.bayer);
    if (m && GREEK[m[1]]) name = `${GREEK[m[1]]}${m[2] ? m[2].replace("-", "") : ""} ${s.con}`;
  }
  if (name) named.push({ i, n: name, c: s.con, h: s.id, m: Math.round(s.mag * 100) / 100 });
});
writeFileSync(join(out, "stars-named.json"), JSON.stringify(named));

// Constellations : chaque sommet est rattaché à l'étoile visible la plus proche dans le ciel.
const visible = stars.map((s, i) => ({ ...s, i })).filter((s) => s.mag < 6.5);
const rad = Math.PI / 180;
const unit = (ra, dec) => [Math.cos(dec * rad) * Math.cos(ra * rad), Math.cos(dec * rad) * Math.sin(ra * rad), Math.sin(dec * rad)];
const visUnits = visible.map((s) => unit(s.ra, s.dec));
function nearest(ra, dec) {
  const u = unit(ra, dec);
  let best = -2;
  let bi = -1;
  for (let k = 0; k < visible.length; k++) {
    const v = visUnits[k];
    const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    if (d > best) {
      best = d;
      bi = k;
    }
  }
  // Au-delà de 0,5° d'écart, le sommet ne correspond à aucune étoile du catalogue.
  return best > Math.cos(0.5 * rad) ? visible[bi].i : -1;
}
const names = Object.fromEntries(JSON.parse(readFileSync(namesPath, "utf8")).features.map((f) => [f.id, f.properties]));
const constellations = [];
let missing = 0;
for (const f of JSON.parse(readFileSync(linesPath, "utf8")).features) {
  const segs = [];
  for (const line of f.geometry.coordinates) {
    const idx = line.map(([lon, lat]) => nearest(lon < 0 ? lon + 360 : lon, lat));
    for (let k = 0; k + 1 < idx.length; k++) {
      if (idx[k] < 0 || idx[k + 1] < 0) {
        missing++;
        continue;
      }
      if (idx[k] !== idx[k + 1]) segs.push(idx[k], idx[k + 1]);
    }
  }
  const p = names[f.id] ?? {};
  constellations.push({ id: f.id, name: (p.fr || p.name || f.id).replace(/\s+/gu, " "), segs });
}
writeFileSync(join(out, "constellations.json"), JSON.stringify(constellations));

console.log(`${stars.length} étoiles, ${named.length} nommées, ${constellations.length} constellations (${missing} segments sans étoile)`);
