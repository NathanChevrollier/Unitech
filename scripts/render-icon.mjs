// Rend public/icon.svg en PNG 1024 × 1024 (source de `tauri icon`), via Chromium.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const svg = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", '<svg width="1024" height="1024" ')}</body></html>`);
await page.screenshot({ path: new URL("../src-tauri/icons/source.png", import.meta.url).pathname, omitBackground: true });
await browser.close();
console.log("src-tauri/icons/source.png");
