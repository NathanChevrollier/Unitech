// Publie une nouvelle version : calcule le prochain numéro depuis les commits (Conventional Commits),
// met à jour les manifestes, commite, pose un tag annoté contenant les notes et pousse.
// Le tag déclenche la CI, qui construit les installeurs et publie la release GitHub.
//
//   pnpm release              # incrément déduit des commits depuis le dernier tag
//   pnpm release minor        # incrément forcé : major | minor | patch
//   pnpm release --dry-run    # affiche la version et les notes sans rien modifier
//   pnpm release --no-push    # commite et tague sans pousser

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRANCH = "main";
const LEVELS = ["patch", "minor", "major"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noPush = args.includes("--no-push");
const forced = args.find((a) => !a.startsWith("--"));
if (forced && !LEVELS.includes(forced)) fail(`incrément inconnu « ${forced} » (attendu : ${LEVELS.join(", ")})`);

const run = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }).trim();
const git = (...a) => run("git", a);

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

// --- État du dépôt ---------------------------------------------------------------------------

if (!dryRun) {
  if (git("rev-parse", "--abbrev-ref", "HEAD") !== BRANCH) fail(`les releases partent de la branche ${BRANCH}`);
  if (git("status", "--porcelain")) fail("l'arbre de travail n'est pas propre : commite ou remise tes changements");
  git("fetch", "--quiet", "--tags", "origin", BRANCH);
  if (git("rev-list", "--count", `HEAD..origin/${BRANCH}`) !== "0") fail(`${BRANCH} est en retard sur origin : fais un pull`);
}

// --- Commits depuis la dernière version ------------------------------------------------------

let lastTag = null;
try {
  lastTag = run("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], { stdio: ["ignore", "pipe", "ignore"] });
} catch {
  // Première release : on prend tout l'historique.
}

const raw = git("log", lastTag ? `${lastTag}..HEAD` : "HEAD", "--no-merges", "--format=%s%x1f%b%x1e");
const commits = raw
  .split("\x1e")
  .map((c) => c.trim())
  .filter(Boolean)
  .map((c) => {
    const [subject, body = ""] = c.split("\x1f");
    const m = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
    return {
      type: m ? m[1].toLowerCase() : "other",
      scope: m?.[2] ?? null,
      description: m ? m[4] : subject,
      breaking: Boolean(m?.[3]) || /^BREAKING[ -]CHANGE:/m.test(body),
    };
  })
  .filter((c) => !(c.type === "chore" && c.scope === "release"));

if (commits.length === 0) fail(`aucun commit depuis ${lastTag ?? "le début"} : rien à publier`);

const detected = commits.some((c) => c.breaking) ? "major" : commits.some((c) => c.type === "feat") ? "minor" : "patch";
const level = forced ?? detected;

// --- Nouvelle version ------------------------------------------------------------------------

const pkgPath = "package.json";
const confPath = "src-tauri/tauri.conf.json";
const cargoPath = "Cargo.toml";

const pkgText = readFileSync(pkgPath, "utf8");
const current = JSON.parse(pkgText).version;
const confVersion = JSON.parse(readFileSync(confPath, "utf8")).version;
const cargoText = readFileSync(cargoPath, "utf8");
const cargoVersionRe = /(\[workspace\.package\][^[]*?\nversion\s*=\s*")([^"]+)(")/;
const cargoVersion = cargoText.match(cargoVersionRe)?.[2];

if (new Set([current, confVersion, cargoVersion]).size !== 1) {
  fail(`versions désynchronisées : package.json ${current}, tauri.conf.json ${confVersion}, Cargo.toml ${cargoVersion}`);
}

const parts = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!parts) fail(`version actuelle non gérée : ${current}`);
let [major, minor, patch] = parts.slice(1).map(Number);
if (level === "major") [major, minor, patch] = [major + 1, 0, 0];
else if (level === "minor") [minor, patch] = [minor + 1, 0];
else patch += 1;
const next = `${major}.${minor}.${patch}`;
const tag = `v${next}`;

// --- Notes de version ------------------------------------------------------------------------

const sections = [
  ["⚠️ Changements incompatibles", (c) => c.breaking],
  ["✨ Nouveautés", (c) => !c.breaking && c.type === "feat"],
  ["🐛 Corrections", (c) => !c.breaking && c.type === "fix"],
  ["⚡ Performances", (c) => !c.breaking && c.type === "perf"],
  ["🔧 Divers", (c) => !c.breaking && !["feat", "fix", "perf"].includes(c.type)],
];
const line = (c) => `- ${c.scope ? `**${c.scope}** : ` : ""}${c.description}`;
const notes = sections
  .map(([title, keep]) => [title, commits.filter(keep)])
  .filter(([, list]) => list.length > 0)
  .map(([title, list]) => `## ${title}\n\n${list.map(line).join("\n")}`)
  .join("\n\n");

console.log(`${current} → ${next} (${level}${forced ? ", forcé" : ", déduit des commits"})\n`);
console.log(notes + "\n");

if (dryRun) process.exit(0);

// --- Écriture, commit, tag -------------------------------------------------------------------

const setJsonVersion = (text) => text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
writeFileSync(pkgPath, setJsonVersion(pkgText));
writeFileSync(confPath, setJsonVersion(readFileSync(confPath, "utf8")));
writeFileSync(cargoPath, cargoText.replace(cargoVersionRe, `$1${next}$3`));
// Répercute la nouvelle version des crates du workspace dans Cargo.lock, sans toucher aux dépendances.
run("cargo", ["update", "--workspace", "--quiet"], { stdio: "inherit" });

git("add", pkgPath, confPath, cargoPath, "Cargo.lock");
git("commit", "--quiet", "-m", `chore(release): ${tag}`);

const dir = mkdtempSync(join(tmpdir(), "unitech-release-"));
try {
  const notesFile = join(dir, "notes.md");
  writeFileSync(notesFile, notes + "\n");
  // verbatim : sinon git supprime les lignes « ## » des titres, prises pour des commentaires.
  git("tag", "--annotate", "--cleanup=verbatim", "--file", notesFile, tag);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (noPush) {
  console.log(`✔ ${tag} créé localement. Pour publier : git push --atomic origin ${BRANCH} ${tag}`);
} else {
  run("git", ["push", "--atomic", "origin", BRANCH, tag], { stdio: "inherit" });
  console.log(`✔ ${tag} poussé : la CI construit les installeurs puis publie la release.`);
}
