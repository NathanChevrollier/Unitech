import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Tauri attend un port fixe et ne doit pas voir l'écran effacé par Vite.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("node_modules/three") ? "three" : id.includes("node_modules/react") ? "react" : undefined),
      },
    },
  },
  worker: { format: "es" },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
