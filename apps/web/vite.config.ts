import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Los paquetes del workspace se resuelven **por fuente**, no por `dist`.
 *
 * Es el mismo arreglo que ya usan el visualizador y el harness de balance en sus
 * `vitest.config.ts`: TypeScript los tipa por project reference, y el bundler
 * los lee del fuente para no exigir un build previo en cada `pnpm dev`. Si se
 * toca una de las dos resoluciones, hay que tocar la otra.
 */
export const workspaceAlias = {
  "@beforeheadapts/core": fileURLToPath(
    new URL("../../packages/core/src/index.ts", import.meta.url),
  ),
  "@beforeheadapts/arena-dsl": fileURLToPath(
    new URL("../../packages/arena-dsl/src/index.ts", import.meta.url),
  ),
  "@beforeheadapts/visualizer": fileURLToPath(
    new URL("../../packages/visualizer/src/index.ts", import.meta.url),
  ),
  "@beforeheadapts/visualizer/browser": fileURLToPath(
    new URL("../../packages/visualizer/src/export/browser.ts", import.meta.url),
  ),
};

export default defineConfig({
  resolve: { alias: workspaceAlias },
  server: { port: 5173 },
  build: { target: "es2022", outDir: "dist" },
});
