import { defineConfig } from "vitest/config";

import { workspaceAlias } from "./vite.config.js";

export default defineConfig({
  // Misma resolución por fuente que el dev server: los tests de la arena y lo
  // que corre en el navegador leen exactamente el mismo código.
  resolve: { alias: workspaceAlias },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
