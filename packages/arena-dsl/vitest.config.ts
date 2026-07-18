import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Espejo del project reference de tsconfig.json: el núcleo por fuente.
      "@beforeheadapts/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
