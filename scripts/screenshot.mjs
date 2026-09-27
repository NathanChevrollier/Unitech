// Captures d'écran de l'interface (mode navigateur) pour vérifier le rendu sans écran.
//
// Usage : pnpm build && pnpm preview --port 4173 &
//         node scripts/screenshot.mjs [url] [dossier]
// Chromium est cherché dans CHROMIUM_PATH, puis dans l'installation Playwright. Le rendu est
// logiciel (SwiftShader) : lent, mais fidèle.

import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const url = (process.argv[2] ?? "http://localhost:4173/") + "?debug";
const out = process.argv[3] ?? "screenshots";
const quality = process.env.QUALITY ?? "low";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const logs = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

// Espace de témoin : l'exemple des tests, avec la qualité demandée.
const sample = JSON.parse(readFileSync(new URL("../fixtures/sample-workspace.json", import.meta.url), "utf8"));
sample.settings = { ...sample.settings, quality, galaxyRotation: false };
const seed = process.env.EMPTY ? null : sample;
await page.addInitScript((ws) => {
  if (ws && !localStorage.getItem("unitech.workspace.v1")) localStorage.setItem("unitech.workspace.v1", JSON.stringify(ws));
}, seed);

const settle = async () => {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !window.__unitech?.universe.flying, null, { timeout: 120000 });
  await page.waitForTimeout(1200);
};
const shot = async (name) => {
  await settle();
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`capture : ${out}/${name}.png`);
};
const run = (fn, arg) => page.evaluate(fn, arg);

await page.goto(url);
await page.waitForSelector(".boot.is-done", { timeout: 120000 });
const skip = page.getByRole("button", { name: "Commencer sans importer" });
if (await skip.isVisible().catch(() => false)) await skip.click();
await shot("01-vue-ensemble");

await run(() => window.__unitech.actions.flyToArm("perseus"));
await shot("02-bras-persee");

await run(() => window.__unitech.actions.enterSystem("travail-sol"));
await shot("03-soleil");
await run(() => window.__unitech.actions.focusPlanet("p-code"));
await shot("04-planete");

await run(() => window.__unitech.actions.enterSystem("s-zenytt"));
await shot("05-systeme-bras");

await run(() => window.__unitech.actions.flyToBlackHole());
await shot("06-trou-noir");

await run(() => window.__unitech.actions.flyToNebula());
await shot("07-nebuleuse");

await run(() => {
  window.__unitech.workspace.getState().apply((w) => ({ ...w, settings: { ...w.settings, showConstellations: true } }));
  window.__unitech.universe.exitSystem(false);
  window.__unitech.actions.flyToRealStar(71456, "Rigil Kentaurus");
});
await shot("08-voisinage-solaire");

await page.keyboard.press("Control+k");
await page.keyboard.type("sir");
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/09-lanceur.png` });
console.log(`capture : ${out}/09-lanceur.png`);

console.log(logs.length ? logs.join("\n") : "aucune erreur dans la console");
await browser.close();
