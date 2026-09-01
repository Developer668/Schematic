import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    alias: {
      "@schematic/hardware-graph": path.resolve(__dirname, "../packages/hardware-graph/src"),
      "@schematic/behavior/canonicalize": path.resolve(__dirname, "../packages/behavior/src/canonicalize.ts"),
      "@schematic/behavior": path.resolve(__dirname, "../packages/behavior/src/index.ts"),
      "@schematic/validation": path.resolve(__dirname, "../packages/validation/src"),
      "@schematic/component-format": path.resolve(__dirname, "../packages/component-format/src"),
      "@schematic/firmware-harness": path.resolve(__dirname, "../packages/firmware-harness/src"),
      "@schematic/project-storage": path.resolve(__dirname, "../packages/project-storage/src"),
    },
  },
});
